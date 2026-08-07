// tests/unit/sentinel/database-check.test.ts
//
// Slice 3: DB-01 through DB-04 over a parsed mysqldump instead of a live `wp_eval` query.
//
// Ground-truth verified separately against a real 8.4.0 mysqld loaded with a live specimen's
// dump: 19/19 posts, 142/142 autoloaded options, 5/5 admin accounts, 12/12 suspicious posts —
// exact match on every count and every flagged ID. These tests pin the detection logic and the
// one deliberate behaviour change (DB-02's autoload vocabulary).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkDatabase } from '../../../src/main/sentinel/scanner/checks/database';

let tmp: string;
let dumpPath: string;

function writeDump(lines: string[]): void {
  fs.writeFileSync(dumpPath, lines.join('\n') + '\n-- Dump completed on 2026-08-06 12:00:00\n');
}

const postsInsert = (rows: string) => `INSERT INTO \`wp_posts\` VALUES ${rows};`;
const post = (id: number, status: string, type: string, date: string, title: string, content: string) =>
  `(${id},1,'${date}','${date}','${content}','${title}','',` +
  `'${status}','open','open','','slug-${id}','','','${date}','${date}','',0,'http://x/?p=${id}',0,'${type}','',0)`;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-check-'));
  dumpPath = path.join(tmp, 'local.sql');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('DB-01 wp_posts', () => {
  it('flags a post whose content matches a spam keyword', async () => {
    writeDump([postsInsert(post(1, 'publish', 'post', '2026-01-01 00:00:00', 'Hello', 'Best online casino bonuses'))]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.posts.suspicious).toHaveLength(1);
    expect(r.posts.suspicious[0].id).toBe('1');
    expect(r.posts.suspicious[0].reasons).toContain('casino/gambling spam');
  });

  it('flags injected script content separately from keyword spam', async () => {
    writeDump([postsInsert(post(1, 'publish', 'post', '2026-01-01 00:00:00', 'Hi', 'welcome <script>evil()</script>'))]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.posts.suspicious[0].reasons).toEqual(['injected script/eval']);
  });

  it('excludes revisions and auto-drafts even if their content matches', async () => {
    writeDump([postsInsert([
      post(1, 'inherit', 'revision', '2026-01-02 00:00:00', 'x', 'casino'),
      post(2, 'auto-draft', 'auto-draft', '2026-01-02 00:00:00', 'x', 'casino'),
    ].join(','))]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.posts.total).toBe(0);
    expect(r.posts.suspicious).toHaveLength(0);
  });

  it('does not flag ordinary content', async () => {
    writeDump([postsInsert(post(1, 'publish', 'page', '2026-01-01 00:00:00', 'About', 'We build things.'))]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.posts.suspicious).toHaveLength(0);
    expect(r.posts.total).toBe(1);
  });

  it('caps examination at 200 most-recent-by-date, matching the original LIMIT', async () => {
    const rows: string[] = [];
    for (let i = 1; i <= 210; i++) {
      rows.push(post(i, 'publish', 'post', `2026-01-01 00:${String(i % 60).padStart(2, '0')}:00`, 'x', 'ordinary'));
    }
    writeDump([postsInsert(rows.join(','))]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.posts.total).toBe(200);
  });
});

describe('DB-02 wp_options — the autoload vocabulary fix', () => {
  const optRow = (name: string, value: string, autoload: string) =>
    `INSERT INTO \`wp_options\` VALUES (1,'${name}','${value}','${autoload}');`;

  it('REGRESSION: examines autoload="on" — the original ="yes" filter missed this entirely', async () => {
    // Measured live: a real WP 7.0.2 install carries 101 'on', 41 'auto', 23 'off', ZERO 'yes'.
    // The original wp_eval query WHERE autoload='yes' examined 0 of those 142 rows.
    writeDump([optRow('evil_widget', 'eval(base64_decode("x"))', 'on')]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.options.total).toBe(1);
    expect(r.options.suspicious).toHaveLength(1);
  });

  it('examines autoload="auto" and "auto-on" as well', async () => {
    writeDump(['INSERT INTO `wp_options` VALUES (1,\'a\',\'eval(1)\',\'auto\'),(2,\'b\',\'eval(1)\',\'auto-on\');']);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.options.total).toBe(2);
    expect(r.options.suspicious).toHaveLength(2);
  });

  it('does not examine autoload="off"', async () => {
    writeDump([optRow('a', 'eval(1)', 'off')]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.options.total).toBe(0);
    expect(r.options.suspicious).toHaveLength(0);
  });

  it('flags an option value containing eval/base64_decode/exec/system', async () => {
    writeDump([optRow('x', 'system("rm -rf /")', 'yes')]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.options.suspicious[0].name).toBe('x');
  });

  it('does not flag an ordinary option', async () => {
    writeDump([optRow('blogname', 'My Site', 'yes')]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.options.suspicious).toHaveLength(0);
  });
});

describe('DB-03 wp_usermeta — the table-prefix fix', () => {
  const meta = (id: number, userId: number, key: string, value: string) =>
    `(${id},${userId},'${key}','${value}')`;

  it('finds admins and flags a serialized object in their meta', async () => {
    writeDump([
      `INSERT INTO \`wp_usermeta\` VALUES ${meta(1, 1, 'wp_capabilities', 'a:1:{s:13:"administrator";b:1;}')},` +
      `${meta(2, 1, 'evil_meta', 'O:8:"Backdoor":0:{}')};`,
    ]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.usermeta.adminCount).toBe(1);
    expect(r.usermeta.suspicious).toHaveLength(1);
    expect(r.usermeta.suspicious[0].userId).toBe('1');
  });

  it("REGRESSION: uses the site's table prefix, not a hardcoded wp_ — WPE randomizes it", async () => {
    // The original hardcoded 'wp_capabilities' as the meta_key literal, so on any install with a
    // non-wp_ prefix (every WP Engine production install) it found zero admins and reported clean.
    writeDump([
      `INSERT INTO \`abc123_usermeta\` VALUES ${meta(1, 1, 'abc123_capabilities', 'a:1:{s:13:"administrator";b:1;}')},` +
      `${meta(2, 1, 'evil_meta', 'O:8:"Backdoor":0:{}')};`,
    ]);
    const r = await checkDatabase(dumpPath, 'abc123_');
    expect(r.usermeta.adminCount).toBe(1);
    expect(r.usermeta.suspicious).toHaveLength(1);
  });

  it('reports adminCount=0 distinctly from "checked and found nothing suspicious"', async () => {
    writeDump([`INSERT INTO \`wp_usermeta\` VALUES ${meta(1, 1, 'wp_capabilities', 'a:1:{s:10:"subscriber";b:1;}')};`]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.usermeta.adminCount).toBe(0);
    expect(r.usermeta.suspicious).toHaveLength(0);
  });

  it("does not flag a non-admin user's serialized meta", async () => {
    writeDump([
      `INSERT INTO \`wp_usermeta\` VALUES ${meta(1, 1, 'wp_capabilities', 'a:1:{s:10:"subscriber";b:1;}')},` +
      `${meta(2, 1, 'some_meta', 'O:8:"Whatever":0:{}')};`,
    ]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.usermeta.suspicious).toHaveLength(0);
  });

  it('does not flag a plain (non-serialized) value even on an admin account', async () => {
    writeDump([
      `INSERT INTO \`wp_usermeta\` VALUES ${meta(1, 1, 'wp_capabilities', 'a:1:{s:13:"administrator";b:1;}')},` +
      `${meta(2, 1, 'nickname', 'admin')};`,
    ]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.usermeta.suspicious).toHaveLength(0);
  });
});

describe('DB-04 wp_comments', () => {
  const comment = (id: number, author: string, content: string, date: string, approved: string) =>
    `(${id},1,'${author}','a@x.com','','127.0.0.1','${date}','${date}','${content}',0,'${approved}','','comment',0,0)`;

  it('counts ALL comments but only samples approved ones', async () => {
    writeDump([`INSERT INTO \`wp_comments\` VALUES ` +
      `${comment(1, 'x', 'nice post', '2026-01-01 00:00:00', '1')},` +
      `${comment(2, 'y', 'casino bonus', '2026-01-02 00:00:00', '0')};`]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.comments.total).toBe(2);       // COUNT(*) over all
    expect(r.comments.examined).toBe(1);    // only the approved one is sampled
    expect(r.comments.suspicious).toHaveLength(0); // the spammy one was never approved
  });

  it('flags an approved comment with a spam keyword', async () => {
    writeDump([`INSERT INTO \`wp_comments\` VALUES ${comment(1, 'x', 'best casino ever', '2026-01-01 00:00:00', '1')};`]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.comments.suspicious).toHaveLength(1);
  });

  it('flags an approved comment with a long bare URL', async () => {
    const url = 'https://example.com/' + 'a'.repeat(30);
    writeDump([`INSERT INTO \`wp_comments\` VALUES ${comment(1, 'x', url, '2026-01-01 00:00:00', '1')};`]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.comments.suspicious).toHaveLength(1);
  });

  it('does not flag an ordinary approved comment', async () => {
    writeDump([`INSERT INTO \`wp_comments\` VALUES ${comment(1, 'x', 'great read, thanks!', '2026-01-01 00:00:00', '1')};`]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.comments.suspicious).toHaveLength(0);
  });
});

describe('Malformed rows are dropped, not misattributed', () => {
  it('drops a wp_options row with the wrong column count instead of guessing', async () => {
    writeDump(["INSERT INTO `wp_options` VALUES (1,'name_only_two_cols');"]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.options.total).toBe(0);
    expect(r.malformedRows.wp_options).toBe(1);
  });
});

describe('Coverage is declared, not assumed', () => {
  it('lists what DB-01/02/04 do not cover', async () => {
    writeDump([]);
    const r = await checkDatabase(dumpPath, 'wp_');
    expect(r.knownGaps.join(' ')).toMatch(/full wp_options table/);
    expect(r.knownGaps.join(' ')).toMatch(/200 posts/);
    expect(r.knownGaps.join(' ')).toMatch(/50 approved comments/);
  });
});
