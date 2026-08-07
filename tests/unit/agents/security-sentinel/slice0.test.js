// tests/unit/agents/security-sentinel/slice0.test.js
//
// Slice 0 of the byte-scanner port: delete and repair before porting, so four units never get
// carried across. Each of these was doing real damage or real waste.

const fs = require('fs');
const path = require('path');
const agent = require('../../../../agents/security-sentinel/agent');
const { fmtIntegrity, pushWpContentDeletion } = agent._test;

const SRC = fs.readFileSync(
  path.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8');

/** agent.js documents its own bugs at length; absence checks must ignore prose. */
const CODE = SRC.split('\n')
  .filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
  .join('\n');

describe('The capabilities meta_key is derived, never hardcoded', () => {
  // 'wp_capabilities' matches nothing on a randomised prefix, which WP Engine always uses.
  // FS-MISMATCH was fixed earlier; DB-03 and remediation step 2 were missed.
  //
  // DB-03 dropped out of this count when it was ported to TypeScript (checks/database.ts):
  // it derives the capabilities key from resolveScanRoot's own tablePrefix, not PHP, so there
  // is no `$capKey = ...` line left in agent.js for it to contribute here. Two remain:
  // FS-MISMATCH (still wp_eval, intentionally runs with plugins loaded) and remediation step 2.
  it('no SQL compares meta_key against the literal wp_capabilities', () => {
    // The remaining textual occurrences are explanatory comments, including one inside a PHP
    // /* */ comment embedded in a JS template literal, which a line-based stripper cannot see.
    // What matters is that no query uses it.
    expect(CODE).not.toMatch(/meta_key\s*=\s*'wp_capabilities'/);
  });

  it('both remaining PHP sites derive it from $wpdb->prefix', () => {
    const derived = CODE.match(/\$capKey = \$wpdb->prefix \. 'capabilities'/g) || [];
    expect(derived.length).toBe(2);   // FS-MISMATCH, remediation step 2
  });

  it('each derived key is passed through $wpdb->prepare, not interpolated', () => {
    // A prefix is not attacker-controlled, but interpolating it re-teaches the wrong habit.
    expect(CODE).toMatch(/meta_key = %s/);
    expect(CODE).not.toMatch(/meta_key = '\{\$capKey\}'/);
  });
});

describe('The duplicate core-checksum collector is gone', () => {
  it('no nested shell_exec of wp core verify-checksums', () => {
    // It duplicated CHK-01 inside the same function, spawned a nested wp-cli, and its output
    // was truncated to 1000 chars before any specialist saw it.
    expect(CODE).not.toContain('core verify-checksums');
  });

  it('specialists receive the already-parsed CHK-01/CHK-02 verdicts instead', () => {
    expect(CODE).toContain('fmtIntegrity(\'core\', integrity.core)');
    expect(CODE).toContain('fmtIntegrity(\'plugin\', integrity.plugin)');
  });

  it('no longer tells the specialist every plugin is unverifiable', () => {
    // This was a hardcoded string, emitted even when CHK-02 had just verified them.
    expect(CODE).not.toContain('not collected — mark all plugins as unverifiable');
  });

  it('collector indices stay contiguous after the removal', () => {
    // get(6) was the deleted collector; behavioral moved 7 -> 6. An off-by-one here silently
    // feeds the wrong data to a specialist.
    expect(CODE).toContain('const behavioral  = typeof get(6)');
    expect(CODE).not.toMatch(/get\(7\)/);
  });
});

describe('fmtIntegrity keeps "not verified" distinct from "clean"', () => {
  it('reports a missing manifest as NOT VERIFIED, not as a pass', () => {
    const out = fmtIntegrity('core', {
      status: 'unavailable', failures: [], verified: 0,
      reason: 'wordpress.org publishes no checksum manifest for version 7.0-RC4-62365',
    });
    expect(out).toMatch(/NOT VERIFIED/);
    expect(out).toMatch(/7\.0-RC4-62365/);
    expect(out).toMatch(/not evidence of integrity/i);
  });

  it('says zero files were compared, so the specialist cannot infer coverage', () => {
    const out = fmtIntegrity('core', { status: 'unavailable', failures: [] });
    expect(out).toMatch(/[Zz]ero core files were compared/);
  });

  it('distinguishes a genuine clean result', () => {
    const out = fmtIntegrity('core', { status: 'passed', failures: [], verified: 3485 });
    expect(out).toMatch(/3485 core file\(s\) matched/);
    expect(out).not.toMatch(/NOT VERIFIED/);
  });

  it('surfaces plugin coverage gaps alongside a clean verdict', () => {
    const out = fmtIntegrity('plugin', {
      status: 'passed', failures: [], verified: 4, activeTotal: 30,
      unverifiable: ['acf-pro (6.2)', 'custom-thing (1.0)'], capped: 5,
    });
    expect(out).toMatch(/4 of 30/);
    expect(out).toMatch(/2 plugin\(s\) publish no manifest/);
    expect(out).toMatch(/5 beyond the scan cap/);
  });

  it('lists failures when there are any', () => {
    const out = fmtIntegrity('core', { status: 'failed', failures: ['wp-admin/x.php', 'wp-includes/y.php'] });
    expect(out).toMatch(/2 core file\(s\) FAILED/);
    expect(out).toContain('wp-admin/x.php');
  });

  it('says so when the check never ran at all', () => {
    expect(fmtIntegrity('core', null)).toMatch(/did not run/);
    expect(fmtIntegrity('plugin', undefined)).toMatch(/did not run/);
  });
});

describe('collector 4 no longer claims coverage it never measured', () => {
  it('counts posts from the posts collector, not the options collector', () => {
    // `dbData.posts` is always undefined — dbData is collector 5. postsGot was therefore always
    // 0, so the note always claimed the full set had been examined.
    expect(CODE).toContain('const postsGot = (posts || []).length');
    expect(CODE).not.toContain('const postsGot = (dbData.posts || []).length');
  });

  it('no longer selects a post_content column nothing renders', () => {
    expect(CODE).not.toContain('LEFT(post_content, 500) AS content_preview');
  });

  it('no longer claims post_content was provided to the specialist', () => {
    expect(CODE).not.toContain('post_content truncated to the first 500 characters');
    expect(CODE).toContain('post_content is NOT provided to this specialist');
  });
});

describe('Steps 5c and 5e share one implementation', () => {
  const mkSignal = (id, evidence) => ({ id, evidence });

  it('builds a step from the matching signal', () => {
    const checklist = [];
    pushWpContentDeletion(checklist, [mkSignal('ABS-09', ['wp-content/plugins/x/evil.php extra'])],
      'sandbox-1', { step: '5c', signalId: 'ABS-09', label: (n) => `Remove ${n} file(s)` });

    expect(checklist).toHaveLength(1);
    expect(checklist[0].step).toBe('5c');
    expect(checklist[0].action).toBe('Remove 1 file(s)');
    expect(checklist[0].expectedEmpty).toBe(true);
    expect(checklist[0].toolArgs.site).toBe('sandbox-1');
  });

  it('emits nothing when the signal is absent or has no evidence', () => {
    const empty = [];
    pushWpContentDeletion(empty, [], 's', { step: '5c', signalId: 'ABS-09', label: () => 'x' });
    pushWpContentDeletion(empty, [mkSignal('ABS-09', [])], 's', { step: '5c', signalId: 'ABS-09', label: () => 'x' });
    pushWpContentDeletion(empty, [mkSignal('ABS-09', undefined)], 's', { step: '5c', signalId: 'ABS-09', label: () => 'x' });
    expect(empty).toHaveLength(0);
  });

  it('drops paths outside wp-content before they reach unlink', () => {
    const checklist = [];
    pushWpContentDeletion(checklist, [mkSignal('FS-06', [
      'wp-content/uploads/miner note',
      '../../etc/passwd escape',
      'wp-admin/thing.php',
    ])], 's', { step: '5e', signalId: 'FS-06', label: (n) => `${n}` });

    expect(checklist).toHaveLength(1);
    // phpJson base64-encodes the array rather than interpolating it, so decode before asserting.
    const b64 = checklist[0].toolArgs.code.match(/base64_decode\('([^']+)'\)/)[1];
    const paths = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    expect(paths).toEqual(['wp-content/uploads/miner']);
  });

  it('keeps the realpath containment check', () => {
    const checklist = [];
    pushWpContentDeletion(checklist, [mkSignal('FS-06', ['wp-content/x.php'])], 's',
      { step: '5e', signalId: 'FS-06', label: () => 'x' });
    const code = checklist[0].toolArgs.code;
    expect(code).toContain('realpath(ABSPATH . $rel)');
    expect(code).toContain("strpos($full, $base . '/') !== 0");
  });

  it('is used by both callers rather than duplicated', () => {
    // The definition shares the parameter names, so exclude it from the call-site count.
    const calls = CODE.match(/(?<!function )pushWpContentDeletion\(checklist, allSignals, sandboxName/g) || [];
    expect(calls).toHaveLength(2);
    const defs = CODE.match(/^function pushWpContentDeletion\(/gm) || [];
    expect(defs).toHaveLength(1);
  });
});
