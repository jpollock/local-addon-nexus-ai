// tests/unit/agents/security-sentinel/allowlists.test.js
'use strict';

// FS-01 and FS-03 report anything not on these lists. Both omitted files that this addon and
// Local install themselves, so every scan raised a CRITICAL on 15 of 15 local sites for
// nexus-hub-bridge.php and flagged local-xdebuginfo.php in the web root.
//
// These tests pin the entries that caused it, and pin the single-definition property — the list
// existed twice (FS-01's PHP literal and a Tier 3 copy), identical and identically wrong.

const fs = require('fs');
const path = require('path');
const agent = require('../../../../agents/security-sentinel/agent');
const { KNOWN_MU_PLUGINS, KNOWN_ROOT_PHP, phpStringArray } = agent._test;

const SRC_PATH = path.join(__dirname, '../../../../agents/security-sentinel/agent.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

describe('Files this addon installs are not reported as compromise', () => {
  // Observed on 15/15 sites under ~/Local Sites. Omitting it made FS-01 fire CRITICAL every run.
  it.each(['nexus-ai-connector-config.php', 'nexus-hub-bridge.php'])(
    'mu-plugin allowlist contains our own %s',
    (name) => expect(KNOWN_MU_PLUGINS).toContain(name),
  );

  // Local injects this into every docroot it manages.
  it('root allowlist contains Local\'s local-xdebuginfo.php', () => {
    expect(KNOWN_ROOT_PHP).toContain('local-xdebuginfo.php');
  });

  it('root allowlist still contains every WordPress core docroot file', () => {
    const core = [
      'index.php', 'wp-activate.php', 'wp-blog-header.php', 'wp-comments-post.php',
      'wp-config.php', 'wp-cron.php', 'wp-links-opml.php', 'wp-load.php',
      'wp-login.php', 'wp-mail.php', 'wp-settings.php', 'wp-signup.php',
      'wp-trackback.php', 'xmlrpc.php', 'wp-config-sample.php',
    ];
    core.forEach(f => expect(KNOWN_ROOT_PHP).toContain(f));
  });

  it('mu-plugin allowlist still contains the WP Engine platform files', () => {
    ['wpe-wp-sign-on-plugin.php', 'wpe-cache-plugin.php', 'wpengine-security-auditor.php',
     'mu-plugin.php', 'slt-force-strong-passwords.php', 'wpe-update-source-selector.php',
     'site-compat-layer.php'].forEach(f => expect(KNOWN_MU_PLUGINS).toContain(f));
  });
});

describe('Each allowlist is defined exactly once', () => {
  // Detection and remediation disagreeing about which mu-plugins are legitimate means a
  // remediation step can delete a file the scan considered fine, or spare one it flagged.
  it('KNOWN_MU_PLUGINS has a single declaration', () => {
    const declarations = src.match(/^const KNOWN_MU_PLUGINS\s*=/gm) || [];
    expect(declarations).toHaveLength(1);
  });

  it('KNOWN_ROOT_PHP has a single declaration', () => {
    const declarations = src.match(/^const KNOWN_ROOT_PHP\s*=/gm) || [];
    expect(declarations).toHaveLength(1);
  });

  it('no PHP heredoc re-hardcodes the mu-plugin names inline', () => {
    // The bug was a literal buried in a wp_eval template. Both call sites must interpolate.
    const inlineLiterals = src.match(/'wpe-wp-sign-on-plugin\.php'/g) || [];
    expect(inlineLiterals).toHaveLength(1);  // only the constant itself
  });

  it('no PHP heredoc re-hardcodes the root filenames inline', () => {
    const inlineLiterals = src.match(/'wp-links-opml\.php'/g) || [];
    expect(inlineLiterals).toHaveLength(1);
  });
});

describe('phpStringArray renders a safe PHP literal', () => {
  it('renders a simple list', () => {
    expect(phpStringArray(['a.php', 'b.php'])).toBe("['a.php','b.php']");
  });

  it('escapes single quotes so a name cannot break out of the literal', () => {
    expect(phpStringArray(["o'brien.php"])).toBe("['o\\'brien.php']");
  });

  it('escapes backslashes', () => {
    expect(phpStringArray(['a\\b.php'])).toBe("['a\\\\b.php']");
  });

  it('renders an empty list as an empty PHP array', () => {
    expect(phpStringArray([])).toBe('[]');
  });

  it('produces output that both allowlists actually embed', () => {
    // Guards against the interpolation being dropped and the check silently allowlisting nothing.
    expect(src).toContain('${phpStringArray(KNOWN_MU_PLUGINS)}');
    expect(src).toContain('${phpStringArray(KNOWN_ROOT_PHP)}');
  });
});
