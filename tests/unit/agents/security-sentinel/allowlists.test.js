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
const { KNOWN_MU_PLUGINS } = agent._test;

const SRC_PATH = path.join(__dirname, '../../../../agents/security-sentinel/agent.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

describe('Files this addon installs are not reported as compromise', () => {
  // KNOWN_MU_PLUGINS survives in the agent because Tier 3 remediation still uses it. The
  // scanner keeps its own copy (it cannot import from src/), and a test in
  // tests/unit/sentinel/scanner.test.ts asserts the two agree.
  // Observed on 15/15 sites under ~/Local Sites. Omitting it made FS-01 fire CRITICAL every run.
  it.each(['nexus-ai-connector-config.php', 'nexus-hub-bridge.php'])(
    'mu-plugin allowlist contains our own %s',
    (name) => expect(KNOWN_MU_PLUGINS).toContain(name),
  );

  // The docroot allowlist moved to the byte scanner when FS-03 stopped being a wp_eval.
  // src/main/sentinel/scanner owns it now; tests/unit/sentinel covers it there.

  it('mu-plugin allowlist still contains the WP Engine platform files', () => {
    ['wpe-wp-sign-on-plugin.php', 'wpe-cache-plugin.php', 'wpengine-security-auditor.php',
     'mu-plugin.php', 'slt-force-strong-passwords.php', 'wpe-update-source-selector.php',
     'site-compat-layer.php'].forEach(f => expect(KNOWN_MU_PLUGINS).toContain(f));
  });
});


