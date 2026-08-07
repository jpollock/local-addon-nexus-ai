import { FileSource } from '../FileSource';

/**
 * Directive files — `.htaccess`, `.user.ini`, `php.ini` — anywhere in the install.
 *
 * These configure the PHP runtime and the web server before a single line of WordPress runs, and
 * two of the three had NO coverage at all.
 *
 * `.user.ini` is the important one and the gap is stark. On a PHP-FPM host it is the
 * highest-privilege persistence slot available to anyone who can write a file: `auto_prepend_file`
 * runs an arbitrary script before every request, ahead of wp-config.php, ahead of every drop-in
 * and mu-plugin. It is also invisible to `wp eval` **by construction** — the CLI SAPI does not
 * read `.user.ini` at all (measured: a `.user.ini` setting auto_prepend_file yields `prepend=''`
 * under `php main.php`). So the existing eval-based checks could never have found one, and
 * `grep -c 'user\.ini'` over the agent returned zero.
 *
 * A nested `.user.ini` also *overrides* a shallower one — deeper wins — which is how an attacker
 * neutralises a defensive prepend guard with a 22-byte file. Depth is therefore reported.
 *
 * FS-05's `.htaccess` rules are reproduced here with one deliberate fix, called out because it
 * changes behaviour rather than porting it: the original built
 * `preg_quote($_SERVER['HTTP_HOST'] ?? 'localhost')`, but `HTTP_HOST` is never set under the CLI
 * SAPI where `wp eval` runs, so the negative lookahead was permanently `(?!localhost)` and every
 * RewriteRule to any absolute URL was flagged — including the site's own canonical domain. Here
 * the host comes from the site record, which is what the original intended.
 */

export interface DirectiveFinding {
  path: string;
  kind: 'htaccess' | 'user-ini' | 'php-ini';
  reason: string;
  snippet: string;
  /** Directory depth below the web root. Depth > 0 on a .user.ini overrides shallower ones. */
  depth: number;
}

export interface DirectiveScanResult {
  findings: DirectiveFinding[];
  /** Every directive file seen, whether or not it was suspicious — coverage, not just hits. */
  filesExamined: Array<{ path: string; kind: string }>;
  unreadable: Array<{ path: string; reason: string }>;
  truncated: boolean;
  knownGaps: string[];
}

const DIRECTIVE_NAMES: Record<string, DirectiveFinding['kind']> = {
  '.htaccess': 'htaccess',
  '.user.ini': 'user-ini',
  'php.ini': 'php-ini',
};

/** Directives that cause arbitrary code to run, or that re-enable execution. */
const EXECUTION_DIRECTIVES = [
  { re: /^\s*auto_prepend_file\s*=\s*(\S.*)$/im, reason: 'auto_prepend_file runs a script before every request' },
  { re: /^\s*auto_append_file\s*=\s*(\S.*)$/im,  reason: 'auto_append_file runs a script after every request' },
  { re: /^\s*disable_functions\s*=\s*(.*)$/im,   reason: 'disable_functions overridden' },
  { re: /^\s*open_basedir\s*=\s*(.*)$/im,        reason: 'open_basedir overridden' },
];

const HTACCESS_EXECUTION = [
  { re: /php_(?:admin_)?value\s+auto_(?:prepend|append)_file[^\n]*/i, reason: 'auto_prepend/append_file set via php_value' },
  { re: /Add(?:Handler|Type)\s+[^\n]*(?:x-httpd-php|php)[^\n]*/i,     reason: 'AddHandler/AddType maps files to the PHP interpreter' },
  { re: /SetHandler\s+[^\n]*php[^\n]*/i,                             reason: 'SetHandler routes requests to PHP' },
  { re: /ForceType\s+[^\n]*x-httpd-php[^\n]*/i,                      reason: 'ForceType forces PHP interpretation' },
  { re: /Options[^\n]*\+?ExecCGI[^\n]*/i,                            reason: 'ExecCGI enabled' },
];

const KNOWN_GAPS = [
  'a .user.ini is only honoured by PHP-FPM/CGI; its presence under the CLI SAPI proves nothing about what the web server loads',
  'user_ini.cache_ttl means a removed .user.ini can stay active for up to 300s',
  'directive files outside the web root are not examined',
];

function snippet(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 160);
}

export async function scanDirectiveFiles(
  source: FileSource,
  opts: { siteHost?: string | null; limit?: number } = {},
): Promise<DirectiveScanResult> {
  const findings: DirectiveFinding[] = [];
  const filesExamined: Array<{ path: string; kind: string }> = [];

  const walked = await source.walk('', { limit: opts.limit ?? 400_000 });

  // The host the site legitimately redirects to. Absent means we cannot judge "external", so
  // the redirect rule is skipped rather than guessed at — guessing is what produced the
  // original's permanent false positive.
  const host = (opts.siteHost ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();

  for (const entry of walked.entries) {
    if (!entry.isFile) continue;
    const kind = DIRECTIVE_NAMES[entry.name];
    if (!kind) continue;

    filesExamined.push({ path: entry.path, kind });
    const buf = await source.readFile(entry.path);
    if (!buf) continue;
    const content = buf.toString('latin1');
    const depth = entry.path.split('/').length - 1;

    if (kind === 'user-ini' || kind === 'php-ini') {
      for (const d of EXECUTION_DIRECTIVES) {
        const m = content.match(d.re);
        if (m) findings.push({ path: entry.path, kind, reason: d.reason, snippet: snippet(m[0]), depth });
      }
      // A .user.ini below the docroot overrides shallower ones. Even an empty
      // `auto_prepend_file =` is meaningful there: it is how a guard gets neutralised.
      if (kind === 'user-ini' && depth > 0 && /auto_prepend_file\s*=/i.test(content)) {
        findings.push({
          path: entry.path, kind, depth,
          reason: 'nested .user.ini overrides auto_prepend_file set closer to the docroot',
          snippet: snippet(content.match(/auto_prepend_file\s*=.*/i)?.[0] ?? ''),
        });
      }
    }

    if (kind === 'htaccess') {
      for (const h of HTACCESS_EXECUTION) {
        const m = content.match(h.re);
        if (m) findings.push({ path: entry.path, kind, reason: h.reason, snippet: snippet(m[0]), depth });
      }
      // An uploads/ .htaccess that mentions PHP is usually PROTECTIVE — WPForms, Elementor and
      // others write `<Files *.php> deny from all </Files>`. The original FS-05 matched any
      // mention of `.php` and flagged those as compromise (measured: 1 finding on a clean fleet,
      // and it was WPForms). Only flag it when PHP is being ENABLED and not denied.
      if (/\/uploads\//.test('/' + entry.path)) {
        // `RemoveHandler .php` was in this list and is exactly backwards — it REMOVES the PHP
        // handler. That mistake flagged WPForms' own hardening file as compromise. The
        // protective vocabulary is recognised explicitly so the next plugin that ships one is
        // not flagged either.
        const enables = HTACCESS_EXECUTION.some((h) => h.re.test(content))
          || /php_flag\s+engine\s+on/i.test(content);
        const denies = /(deny\s+from\s+all|Require\s+all\s+denied)/i.test(content)
          || /SetHandler\s+(none|default-handler)/i.test(content)
          || /php_flag\s+engine\s+off/i.test(content)
          || /Remove(Handler|Type)[^\n]*\.php/i.test(content);
        if (enables && !denies) {
          findings.push({
            path: entry.path, kind, depth,
            reason: 'uploads/ .htaccess enables PHP execution',
            snippet: snippet(content),
          });
        }
      }
      if (host) {
        // Only judge "external" when we actually know the site's host.
        const rules = content.match(/RewriteRule[^\n]*https?:\/\/[^\n]*/gi) ?? [];
        for (const rule of rules) {
          const target = rule.match(/https?:\/\/([^/\s'"]+)/)?.[1] ?? '';
          if (target && target !== host && !target.endsWith('.' + host)) {
            findings.push({
              path: entry.path, kind, depth,
              reason: `RewriteRule redirects to an external domain (${target})`,
              snippet: snippet(rule),
            });
          }
        }
      }
    }
  }

  return {
    findings,
    filesExamined,
    unreadable: walked.unreadable,
    truncated: walked.truncated,
    knownGaps: host ? KNOWN_GAPS : [...KNOWN_GAPS, 'site host unknown, so external-redirect rules were NOT evaluated'],
  };
}
