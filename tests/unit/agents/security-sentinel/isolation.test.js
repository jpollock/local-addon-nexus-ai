'use strict';

// Source-of-truth guard for sandbox isolation. Static assertions on the merged agent source.
//
// HISTORY — read before changing these. This file used to assert that the sandbox hardening
// (#6a php.ini disable_functions, #6b WP_HTTP_BLOCK_EXTERNAL) was PRESENT. Both were removed in
// August 2026 after being measured, and the assertions were inverted, because the hardening did
// not work and could not be made to work:
//
//   * The php.ini approach never applied once. Its probe `php_ini_loaded_file()` runs on the CLI
//     SAPI, which loads no php.ini, so the guard fell through and the block silently skipped.
//     When it did write, Local regenerates php.ini from php.ini.hbs on every start, so the
//     restart performed to apply the change erased it. Measured on a real machine: 20 failures
//     to 10 believed successes, and no php.ini anywhere carrying its marker.
//   * Even applied correctly, a function blocklist leaves 5 of 8 egress channels open
//     (stream_socket_client, file_get_contents and fopen on URLs, gethostbyname, mail), and
//     `disable_classes` is accepted but inert for statically compiled extensions, so
//     `new mysqli(...)` and `new SoapClient(...)` escape under any configuration.
//   * WP_HTTP_BLOCK_EXTERNAL applied, but only constrains WordPress's own wp_remote_* API, which
//     malware has no reason to use — while mutating wp-config.php inside what is meant to be a
//     forensic artifact.
//
// See docs/planning/2026-08-03-php-ini-scan-dir-hardening.md and
// docs/planning/2026-08-03-sentinel-execution-model.md.
//
// These tests now guard the DECISION. If you are here because you want to re-add hardening:
// measure it first, and note that 21 of 22 Tier 2 units need only bytes and belong in Node,
// where nothing executes at all.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8'
);

// The absence assertions below must inspect CODE, not prose. agent.js documents at length why
// the hardening was removed, and that documentation necessarily names the things it is
// explaining — so a naive substring check over the whole file fails on its own comments.
const code = src
  .split('\n')
  .filter((line) => {
    const t = line.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  })
  .join('\n');

describe('Sandbox scoping is still enforced', () => {
  it('#7: registers the sandbox with the tool provider before scanning', () => {
    // This one still matters — it is what stops wp_eval being pointed at a non-sandbox site.
    expect(src).toContain('registerSandbox(sandboxName)');
  });
});

describe('Ineffective hardening stays removed', () => {
  it('does not write disable_functions into a generated php.ini', () => {
    expect(code).not.toContain('php_ini_loaded_file()');
    expect(code).not.toContain('disable_functions = fsockopen');
  });

  it('does not mutate the sandbox wp-config.php to block the WP HTTP layer', () => {
    // Mutating wp-config.php corrupts the evidence the sandbox exists to preserve, and blocks
    // only wp_remote_*, which malware does not use.
    expect(code).not.toContain('WP_HTTP_BLOCK_EXTERNAL');
    expect(code).not.toContain('WP_ACCESSIBLE_HOSTS');
  });

  it('does not restart the sandbox to apply hardening', () => {
    // The restart was both useless (it erased the write) and expensive (~30s of polling per scan).
    // local_restart_site had no other caller, so it is no longer declared at all.
    expect(code).not.toContain('local_restart_site');
  });

  it('records why hardening is absent, so it is not silently re-added', () => {
    expect(src).toContain('THE SANDBOX IS NOT A CONTAINMENT BOUNDARY');
  });
});

describe('Endpoints the core-restore and diff paths need remain reachable', () => {
  it('CHK-01 restore and runCoreDiff still reference the WordPress.org sources', () => {
    expect(src).toContain('core.svn.wordpress.org');
  });
});

describe('The sandbox is stopped when the scan ends', () => {
  it('declares local_stop_site', () => {
    // A running sandbox is a live PHP-FPM plus MySQL pair serving a known-compromised site.
    // Thirteen accumulated on one machine (6.5 GB) before this was noticed.
    expect(src).toContain("'local_stop_site'");
  });

  it('stops the sandbox but does not delete it — the files are evidence', () => {
    expect(src).toContain("local_stop_site', { site: sandboxName }");
    expect(src).not.toContain("local_delete_site', { site: sandboxName }");
  });

  it('also stops the ORIGINAL local site after cloning it — not just the sandbox', () => {
    // Reproduced live, twice in one session: local_start_site was called unconditionally to
    // give local_clone_site something to copy, and nothing ever called local_stop_site on
    // install.name afterward — only on sandboxName. The actual known-compromised site was left
    // running indefinitely after every scan, which is the exact "live PHP-FPM plus MySQL pair
    // serving a known-compromised site" problem the sandbox-stop above exists to prevent, just
    // on the real site instead of a copy. It also broke resolveDbSource's own staleness gate on
    // the NEXT scan: the running site's data files kept advancing past the last dump, so the
    // pre-flight byte scan correctly refused to trust it as stale.
    expect(src).toContain("local_stop_site', { site: install.name }");
  });
});

describe('fullRun forces Tier 2 past a Tier-1-clean verdict, scoped only', () => {
  // The AgentRunner/AGENT_RUN_NOW plumbing for a "Full Run" toggle already existed
  // (src/main/agent-runtime/AgentRunner.ts, buildAgentContext.ts) — the sentinel itself never
  // read ctx.fullRun, so the toggle in Local's Run Now dialog was silently a no-op for this
  // agent specifically. Fixed by reading it and forcing escalation when set.

  it('destructures fullRun from run() and computes forceEscalate from it', () => {
    expect(src).toMatch(/async run\(\{[^}]*\bfullRun\b[^}]*\}\)/);
    expect(src).toContain('const forceEscalate = !!fullRun');
  });

  it('is gated on an actual scope — never forces escalation on an unscoped fleet-wide sweep', () => {
    // Forcing a ~5 minute sandbox investigation on every clean site in the fleet on every cron
    // tick would be exactly the disk-filling problem MAX_TIER2_PER_SWEEP exists to prevent,
    // self-inflicted by this same feature.
    const idx = src.indexOf('const forceEscalate = !!fullRun');
    const line = src.slice(idx, src.indexOf('\n', idx));
    expect(line).toMatch(/scope\.installId/);
    expect(line).toMatch(/scope\.installName/);
  });

  it('the clean-verdict gate does not fire when forceEscalate is true', () => {
    expect(src).toContain('if (signals.length === 0 && !forceEscalate)');
  });

  it('the Tier 2 escalation gate fires on forceEscalate alone, with zero signals', () => {
    expect(src).toMatch(/else if \(forceEscalate \|\| criticalCount >= 1 \|\| compromiseHighCount >= 2\)/);
  });
});
