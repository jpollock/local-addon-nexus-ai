import { readDumpTables } from '../db/readDumpTables';
import { SqlValue } from '../db/sqlDump';

/**
 * DB-01 through DB-04 against a parsed mysqldump instead of a live `wp_eval` query.
 *
 * DETECTION IS REPRODUCED EXACTLY, with one deliberate fix called out because it changes
 * behaviour rather than ports it:
 *
 *   DB-02's original WHERE clause was `autoload='yes'`. WordPress 6.6 widened the column's
 *   vocabulary to `('yes','on','auto-on','auto')` via `wp_autoload_values_to_autoload()`
 *   (wp-includes/option.php) — measured on a real WP 7.0.2 install, 142 autoloaded options carry
 *   `on`/`auto`/`off` and ZERO carry the literal `yes`, so the original examines 0 of 142 rows
 *   and reports clean. This port uses the current value set.
 *
 * Column ordinals are WordPress core's own CREATE TABLE order, verified against a real dump
 * (wp_posts 23 cols, wp_options 4, wp_usermeta 4, wp_users 10, wp_comments 15) rather than
 * assumed. `readDumpTables` drops any row whose column count does not match — a plugin that
 * altered one of these core tables produces a reported `malformed` count, never a
 * misattributed value.
 *
 * ORDER BY ... DESC is reproduced as a string sort on MySQL's `YYYY-MM-DD HH:MM:SS` DATETIME
 * format, which sorts identically as text and as time — no date parsing needed or wanted.
 *
 * A site whose database contents cannot be trusted (running, stale, no dump, no completion
 * marker) never reaches this function — see resolveDbSource, whose refusal is a distinct
 * result the caller must render as "not checked", never silently absorbed into "no findings".
 */

export interface PostFinding { id: string; title: string; status: string; date: string; reasons: string[]; }
export interface OptionFinding { name: string; snippet: string; }
export interface UserMetaFinding { userId: string; key: string; snippet: string; }
export interface CommentFinding { id: string; author: string; date: string; snippet: string; }

export interface DatabaseCheckResult {
  posts: { total: number; examined: number; suspicious: PostFinding[] };
  options: { total: number; examined: number; suspicious: OptionFinding[] };
  usermeta: { adminCount: number; examined: number; suspicious: UserMetaFinding[] };
  comments: { total: number; examined: number; suspicious: CommentFinding[] };
  malformedRows: Record<string, number>;
  unparseableLines: number;
  knownGaps: string[];
}

const SPAM_CONTENT_PATTERNS = [/<script/i, /javascript:/i, /base64_decode/i, /eval\s*\(/i, /document\.write/i, /\.onload\s*=/i];
const SPAM_KEYWORDS = [/casino/i, /poker/i, /slots?/i, /gambling/i, /kasyno/i, /spielautomat/i, /scommesse/i];
const OPTION_CODE_PATTERNS = [/eval\s*\(/i, /base64_decode/i, /<script/i, /exec\s*\(/i, /system\s*\(/i];
const SERIALIZED_OBJECT = /O:\d+:"[^"]+":/;
const COMMENT_SPAM_KEYWORDS = [/casino/i, /poker/i, /slot/i, /gambling/i, /kasyno/i, /https?:\/\/[^\s]{30,}/];

/** WordPress's own list — widened from `autoload='yes'` alone. See the module note above. */
const AUTOLOAD_VALUES = new Set(['yes', 'on', 'auto-on', 'auto']);

const KNOWN_GAPS = [
  'only autoloaded options were examined for DB-02, not the full wp_options table',
  'DB-01 examines at most 200 posts (the most recent by post_date), matching the original query LIMIT',
  'DB-04 samples at most 50 approved comments (the most recent by comment_date), matching the original query LIMIT',
];

const s = (v: SqlValue): string => v ?? '';

export async function checkDatabase(dumpPath: string, tablePrefix: string): Promise<DatabaseCheckResult> {
  const postsTable = `${tablePrefix}posts`;
  const optionsTable = `${tablePrefix}options`;
  const usermetaTable = `${tablePrefix}usermeta`;
  const commentsTable = `${tablePrefix}comments`;

  const { rows, malformed, unparseable } = await readDumpTables(dumpPath, {
    [postsTable]: 23,
    [optionsTable]: 4,
    [usermetaTable]: 4,
    [commentsTable]: 15,
  });

  // ── DB-01: wp_posts ──────────────────────────────────────────────────────
  const postStatuses = new Set(['publish', 'draft', 'private', 'future', 'pending']);
  const postTypesExcluded = new Set(['revision', 'auto-draft']);
  const eligiblePosts = rows[postsTable]
    .filter((r) => postStatuses.has(s(r[7])) && !postTypesExcluded.has(s(r[20])))
    .sort((a, b) => s(b[2]).localeCompare(s(a[2]))) // post_date DESC, string-sortable DATETIME
    .slice(0, 200);

  const suspiciousPosts: PostFinding[] = [];
  for (const r of eligiblePosts) {
    const content = s(r[4]).slice(0, 1000); // LEFT(post_content, 1000), as the original queried
    const title = s(r[5]);
    const reasons: string[] = [];
    if (SPAM_CONTENT_PATTERNS.some((p) => p.test(content))) reasons.push('injected script/eval');
    if (SPAM_KEYWORDS.some((p) => p.test(title) || p.test(content))) reasons.push('casino/gambling spam');
    if (reasons.length) {
      suspiciousPosts.push({ id: s(r[0]), title, status: s(r[7]), date: s(r[2]), reasons });
    }
  }

  // ── DB-02: wp_options (autoloaded) ───────────────────────────────────────
  const autoloaded = rows[optionsTable].filter((r) => AUTOLOAD_VALUES.has(s(r[3])));
  const suspiciousOptions: OptionFinding[] = [];
  for (const r of autoloaded) {
    const value = s(r[2]).slice(0, 500); // LEFT(option_value, 500), as the original queried
    if (OPTION_CODE_PATTERNS.some((p) => p.test(value))) {
      suspiciousOptions.push({ name: s(r[1]), snippet: value.slice(0, 150) });
    }
  }

  // ── DB-03: wp_usermeta (serialized objects on admin accounts) ────────────
  const capKey = `${tablePrefix}capabilities`;
  const adminUserIds = new Set(
    rows[usermetaTable]
      .filter((r) => s(r[2]) === capKey && /administrator/.test(s(r[3])))
      .map((r) => s(r[1])),
  );
  const suspiciousMeta: UserMetaFinding[] = [];
  for (const r of rows[usermetaTable]) {
    if (!adminUserIds.has(s(r[1]))) continue;
    const value = s(r[3]);
    if (!value.startsWith('O:')) continue;
    const snippet = value.slice(0, 300);
    if (SERIALIZED_OBJECT.test(snippet)) {
      suspiciousMeta.push({ userId: s(r[1]), key: s(r[2]), snippet: snippet.slice(0, 100) });
    }
  }

  // ── DB-04: wp_comments ────────────────────────────────────────────────────
  const allComments = rows[commentsTable];
  const approvedSample = allComments
    .filter((r) => s(r[10]) === '1')
    .sort((a, b) => s(b[6]).localeCompare(s(a[6]))) // comment_date DESC
    .slice(0, 50);

  const suspiciousComments: CommentFinding[] = [];
  for (const r of approvedSample) {
    const content = s(r[8]);
    if (COMMENT_SPAM_KEYWORDS.some((p) => p.test(content))) {
      suspiciousComments.push({ id: s(r[0]), author: s(r[2]), date: s(r[6]), snippet: content.slice(0, 100) });
    }
  }

  return {
    posts: { total: eligiblePosts.length, examined: eligiblePosts.length, suspicious: suspiciousPosts },
    options: { total: autoloaded.length, examined: autoloaded.length, suspicious: suspiciousOptions },
    usermeta: { adminCount: adminUserIds.size, examined: rows[usermetaTable].length, suspicious: suspiciousMeta },
    comments: { total: allComments.length, examined: approvedSample.length, suspicious: suspiciousComments },
    malformedRows: malformed,
    unparseableLines: unparseable,
    knownGaps: KNOWN_GAPS,
  };
}

export const _internals = {
  SPAM_CONTENT_PATTERNS, SPAM_KEYWORDS, OPTION_CODE_PATTERNS, SERIALIZED_OBJECT,
  COMMENT_SPAM_KEYWORDS, AUTOLOAD_VALUES,
};
