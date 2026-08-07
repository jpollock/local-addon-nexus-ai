// tests/unit/sentinel/directives.test.ts
//
// .htaccess, .user.ini and php.ini. Two of the three had NO coverage at all.
//
// .user.ini is the important one: auto_prepend_file runs an arbitrary script before every
// request, ahead of wp-config.php and every drop-in — and it is invisible to `wp eval` BY
// CONSTRUCTION, because the CLI SAPI does not read .user.ini. The eval-based checks could never
// have found one, and `grep -c 'user\.ini'` over the agent returned zero.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalFileSource } from '../../../src/main/sentinel/scanner/LocalFileSource';
import { scanDirectiveFiles } from '../../../src/main/sentinel/scanner/checks/directives';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dirs-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function tree(files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return new LocalFileSource(tmp);
}
const scan = (src: LocalFileSource, host?: string) => scanDirectiveFiles(src, { siteHost: host ?? null });

describe('.user.ini — the slot wp_eval cannot see', () => {
  it('flags auto_prepend_file', async () => {
    const r = await scan(tree({ '.user.ini': 'auto_prepend_file = /tmp/guard.php\n' }));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].reason).toMatch(/auto_prepend_file runs a script/);
    expect(r.findings[0].kind).toBe('user-ini');
  });

  it('flags auto_append_file, disable_functions and open_basedir overrides', async () => {
    const r = await scan(tree({ '.user.ini': 'auto_append_file = /x.php\ndisable_functions =\nopen_basedir = /\n' }));
    expect(r.findings).toHaveLength(3);
  });

  it('flags a NESTED .user.ini — deeper overrides shallower', async () => {
    // How a 22-byte file neutralises a defensive prepend guard. Even an empty assignment counts.
    const r = await scan(tree({ 'wp-content/uploads/.user.ini': 'auto_prepend_file =\n' }));
    expect(r.findings.some((f) => /overrides auto_prepend_file/.test(f.reason))).toBe(true);
    expect(r.findings[0].depth).toBeGreaterThan(0);
  });

  it('examines files it does not flag, so coverage is reportable', async () => {
    const r = await scan(tree({ '.user.ini': 'max_execution_time = 60\n' }));
    expect(r.findings).toHaveLength(0);
    expect(r.filesExamined).toEqual([{ path: '.user.ini', kind: 'user-ini' }]);
  });

  it('states the limits of what a .user.ini on disk proves', async () => {
    const r = await scan(tree({ '.user.ini': 'x = 1\n' }));
    expect(r.knownGaps.join(' ')).toMatch(/CLI SAPI proves nothing/);
    expect(r.knownGaps.join(' ')).toMatch(/cache_ttl/);
  });
});

describe('.htaccess execution directives', () => {
  it.each([
    ['php_value auto_prepend_file /x.php', /auto_prepend\/append_file set via php_value/],
    ['AddHandler application/x-httpd-php .jpg', /AddHandler\/AddType maps files/],
    ['SetHandler application/x-httpd-php', /SetHandler routes requests to PHP/],
    ['Options +ExecCGI', /ExecCGI enabled/],
  ])('flags %s', async (body, reason) => {
    const r = await scan(tree({ '.htaccess': body }));
    expect(r.findings.some((f) => reason.test(f.reason))).toBe(true);
  });
});

describe('uploads/.htaccess — protective files are not compromise', () => {
  // Measured: the ported FS-05 rule flagged WPForms' own hardening file as compromise, because
  // it matched any mention of `.php`. That was the only "finding" on a clean 33-site fleet.
  const WPFORMS = `<Files *>
  SetHandler none
  SetHandler default-handler
  RemoveHandler .cgi .php .php3 .phtml .pl .py
  RemoveType .cgi .php .php3 .phtml .pl .py
</Files>
<IfModule mod_php8.c>
  php_flag engine off
</IfModule>`;

  it('does not flag the WPForms hardening file', async () => {
    const r = await scan(tree({ 'wp-content/uploads/wpforms/.htaccess': WPFORMS }));
    expect(r.findings).toHaveLength(0);
  });

  it('does not flag a deny-from-all guard', async () => {
    const r = await scan(tree({ 'wp-content/uploads/.htaccess': '<Files *.php>\ndeny from all\n</Files>' }));
    expect(r.findings).toHaveLength(0);
  });

  it('DOES flag an uploads .htaccess that enables PHP', async () => {
    const r = await scan(tree({ 'wp-content/uploads/.htaccess': '<IfModule mod_php8.c>\nphp_flag engine on\n</IfModule>' }));
    expect(r.findings.some((f) => /enables PHP execution/.test(f.reason))).toBe(true);
  });

  it('RemoveHandler is treated as protective, not enabling', async () => {
    // It was in the "enables" list and is exactly backwards — it REMOVES the PHP handler.
    // Note honestly what protects this now: mutation testing showed that putting RemoveHandler
    // back into `enables` does NOT reintroduce the false positive, because it also appears in
    // `denies` and a deny always wins. The deny list is the real guard; dropping it from
    // `enables` is belt-and-braces.
    const r = await scan(tree({ 'wp-content/uploads/.htaccess': 'RemoveHandler .php' }));
    expect(r.findings).toHaveLength(0);
  });

  it('a deny wins even when an enabling directive is also present', async () => {
    // This is the property that actually stops WPForms-style files being flagged: those files
    // legitimately contain both vocabularies.
    const r = await scan(tree({
      'wp-content/uploads/.htaccess': 'SetHandler application/x-httpd-php\ndeny from all',
    }));
    expect(r.findings.filter((f) => /enables PHP execution/.test(f.reason))).toHaveLength(0);
  });
});

describe('External redirects are judged against the real host', () => {
  it('flags a redirect to a foreign domain', async () => {
    const r = await scan(tree({ '.htaccess': 'RewriteRule ^(.*)$ https://evil.example/$1 [R,L]' }), 'mysite.local');
    expect(r.findings.some((f) => /external domain \(evil\.example\)/.test(f.reason))).toBe(true);
  });

  it('does NOT flag a redirect to the site\'s own host or a subdomain', async () => {
    // The original used $_SERVER['HTTP_HOST'], which is never set under the CLI SAPI where
    // wp eval runs — so the lookahead was permanently (?!localhost) and EVERY absolute
    // RewriteRule was flagged, including the canonical domain.
    const src = tree({ '.htaccess': 'RewriteRule ^(.*)$ https://mysite.local/$1 [R,L]\nRewriteRule ^a$ https://www.mysite.local/b [R]' });
    expect((await scan(src, 'mysite.local')).findings).toHaveLength(0);
  });

  it('skips the redirect check entirely when the host is unknown, and says so', async () => {
    const r = await scan(tree({ '.htaccess': 'RewriteRule ^(.*)$ https://anything.example/$1' }));
    expect(r.findings).toHaveLength(0);
    expect(r.knownGaps.join(' ')).toMatch(/host unknown.*NOT evaluated/);
  });
});
