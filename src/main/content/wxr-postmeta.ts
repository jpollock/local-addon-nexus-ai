/**
 * Public post meta for a page of remote posts, read out of a WXR export.
 *
 * WHY THIS EXISTS AND WHY IT IS SHAPED LIKE THIS (measured against a live WP
 * Engine install, cedarvalehealt, 2026-08-22):
 *
 *   - The local path reads `wp_postmeta` directly and appends every public
 *     custom field into the searchable text. The remote extractor asked for
 *     no meta at all, so ACF data was indexed on local sites and invisible on
 *     every WP Engine and external one.
 *   - `wp post list` CANNOT emit meta: `--fields=ID,meta` and
 *     `--fields=ID,_wp_page_template` both return `Error: Invalid field`.
 *   - `wp post meta list <id>` works but costs **2.9 s per post** (ten
 *     sequential calls in one warm SSH session, 29.0 s). 602 posts = 29
 *     minutes; 30,628 posts is roughly 24 hours. Not a mechanism.
 *   - `wp eval` and `wp db query` — the two commands that would do this in
 *     one statement — are on `REMOTE_POLICY.blocked`.
 *   - `wp export --stdout --post__in=<comma ids>` is the only permitted bulk
 *     route: **5.1 s and 1.26 MB for 200 posts**, one WordPress bootstrap,
 *     carrying full `<wp:postmeta>` for every item.
 *
 * The parser is deliberately not a general XML reader. It does ONE thing:
 * map post id to its public meta. Its safety property is that CDATA regions
 * are tokenized out BEFORE any tag matching happens, so post content — which
 * can legitimately contain the literal text `<item>` or `<wp:postmeta>` —
 * can never be mistaken for markup. WordPress escapes an internal `]]>` as
 * `]]]]><![CDATA[>`, which splits into two adjacent CDATA sections that
 * re-concatenate correctly, so the tokenizer's "first `]]>` ends the section"
 * rule is right rather than merely convenient.
 */

/**
 * Keys beginning with `_` are WordPress internals — the local path's SQL
 * filters them with `meta_key NOT LIKE '\_%'` and this mirrors it exactly.
 */
function isPublicMetaKey(key: string): boolean {
  return key.length > 0 && !key.startsWith('_');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The placeholder delimiter. NUL cannot appear in well-formed XML character
 * data, so a placeholder can never collide with document text — which is the
 * property this parser's safety rests on.
 *
 * CONSTRUCTED, never written as a character. This repo has twice shipped a
 * literal NUL that passed tsc, eslint and every test while making `grep`
 * answer "Binary file matches" — and a byte scan caught a third in this very
 * file while it was being written, twice, because the editor materialised a
 * backslash-u-0000 escape into the byte it denotes. `String.fromCharCode(0)`
 * cannot be materialised into anything, which is why it is spelled this way
 * rather than as the escape the rule nominally allows.
 */
const NUL = String.fromCharCode(0);
const PLACEHOLDER_RE = new RegExp(`${NUL}(\\d+)${NUL}`, 'g');

interface Tokenized {
  /** Markup with every CDATA section replaced by a NUL-delimited index. */
  skeleton: string;
  /** CDATA payloads, indexed by the number in the placeholder. */
  sections: string[];
}

/** Replace every `<![CDATA[ ... ]]>` with an index placeholder. */
function tokenizeCdata(xml: string): Tokenized {
  const sections: string[] = [];
  let skeleton = '';
  let cursor = 0;

  for (;;) {
    const open = xml.indexOf('<![CDATA[', cursor);
    if (open === -1) {
      skeleton += xml.slice(cursor);
      break;
    }
    const close = xml.indexOf(']]>', open + 9);
    if (close === -1) {
      // Unterminated section — take the remainder as one payload rather than
      // letting raw content leak into the skeleton and be parsed as markup.
      sections.push(xml.slice(open + 9));
      skeleton += `${xml.slice(cursor, open)}${NUL}${sections.length - 1}${NUL}`;
      break;
    }
    sections.push(xml.slice(open + 9, close));
    skeleton += `${xml.slice(cursor, open)}${NUL}${sections.length - 1}${NUL}`;
    cursor = close + 3;
  }

  return { skeleton, sections };
}

/**
 * Resolve a text node back to real text.
 *
 * Entity decoding runs on the ESCAPED parts only, and CDATA payloads are
 * spliced in afterwards: a payload legitimately containing `&amp;` means
 * those five characters and must not be decoded.
 */
function plainText(value: string, sections: string[]): string {
  let out = '';
  let cursor = 0;
  PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(value)) !== null) {
    out += decodeEntities(value.slice(cursor, m.index));
    out += sections[Number(m[1])] ?? '';
    cursor = m.index + m[0].length;
  }
  out += decodeEntities(value.slice(cursor));
  return out;
}

export interface WxrParseResult {
  meta: Map<number, Record<string, string>>;
  /** Items whose `<wp:post_id>` could not be read — counted, never dropped silently. */
  itemsWithoutId: number;
  itemsSeen: number;
}

/**
 * Extract `postId -> { publicMetaKey: value }` from a WXR document.
 *
 * Returns an empty map for anything that is not a WXR document (a JSON error
 * body, an empty string, a WP-CLI error) rather than throwing — the caller
 * degrades to "custom fields unavailable" and says so.
 */
export function parseWxrPostMeta(xml: string): WxrParseResult {
  const meta = new Map<number, Record<string, string>>();
  let itemsWithoutId = 0;
  let itemsSeen = 0;

  if (!xml || xml.indexOf('<item>') === -1) {
    return { meta, itemsWithoutId, itemsSeen };
  }

  const { skeleton, sections } = tokenizeCdata(xml);
  const items = skeleton.split('<item>').slice(1);

  for (const rawItem of items) {
    itemsSeen++;
    const item = rawItem.split('</item>')[0];

    const idMatch = /<wp:post_id>([\s\S]*?)<\/wp:post_id>/.exec(item);
    const id = idMatch ? Number(plainText(idMatch[1], sections).trim()) : NaN;
    if (!Number.isFinite(id) || id <= 0) {
      itemsWithoutId++;
      continue;
    }

    const fields: Record<string, string> = {};
    const blockRe = /<wp:postmeta>([\s\S]*?)<\/wp:postmeta>/g;
    let block: RegExpExecArray | null;
    while ((block = blockRe.exec(item)) !== null) {
      const body = block[1];
      const keyMatch = /<wp:meta_key>([\s\S]*?)<\/wp:meta_key>/.exec(body);
      const valMatch = /<wp:meta_value>([\s\S]*?)<\/wp:meta_value>/.exec(body);
      if (!keyMatch) continue;

      const key = plainText(keyMatch[1], sections).trim();
      if (!isPublicMetaKey(key)) continue;

      fields[key] = valMatch ? plainText(valMatch[1], sections) : '';
    }

    if (Object.keys(fields).length > 0) meta.set(id, fields);
  }

  return { meta, itemsWithoutId, itemsSeen };
}

/** The WP-CLI argv that produces the document `parseWxrPostMeta` reads. */
export function buildWxrExportArgs(postIds: number[]): string[] {
  return ['export', '--stdout', `--post__in=${postIds.join(',')}`];
}
