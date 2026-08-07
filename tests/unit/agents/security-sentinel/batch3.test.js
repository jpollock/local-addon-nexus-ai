'use strict';

// Batch 3 (#10) — attacker-scored admin accounts are DISABLED, not deleted.
// Deletion was irreversible and destroyed the forensic record; the sandbox drives
// the push verdict, so a false-positive deletion could remove a legitimate admin
// in production. This step now neutralizes every WordPress auth path reversibly
// and is surfaced for human approval before push.
const agent = require('../../../../agents/security-sentinel/agent');
const { buildRemediationChecklist } = agent._test;

const step2ForSignal = (id) => {
  const cl = buildRemediationChecklist({}, [{ id, severity: 'critical', title: id }], 'sbx');
  return cl.find(s => s.step === 2);
};

describe('Batch 3 — admin login-disable (#10)', () => {
  it('step 2 fires for each admin-related signal', () => {
    for (const id of ['REL-03', 'ABS-03', 'LLM-USER-01', 'ABS-01', 'ABS-02']) {
      expect(step2ForSignal(id)).toBeDefined();
    }
  });

  it('is marked requiresApproval (never silent)', () => {
    expect(step2ForSignal('REL-03').requiresApproval).toBe(true);
  });

  it('NEVER deletes the user row (irreversible + anti-forensic)', () => {
    const code = step2ForSignal('REL-03').toolArgs.code;
    expect(code).not.toContain('wpdb->delete($wpdb->users');
    expect(code).not.toContain('auto_deleted');
  });

  it('disables login across every auth path for score > 95', () => {
    const code = step2ForSignal('REL-03').toolArgs.code;
    // password scramble → blocks password login
    expect(code).toContain('wp_set_password(wp_generate_password');
    // role strip → neutralizes SSO/social-login bypass (they can auth but do nothing)
    expect(code).toMatch(/set_role\(''\)/);
    // session kill → force-logout any active session
    expect(code).toContain("delete_user_meta($u['ID'], 'session_tokens')");
    // app passwords removed → blocks the application-password auth path
    expect(code).toContain('_application_passwords');
  });

  it('reports disabled accounts under login_disabled, preserving the row', () => {
    const code = step2ForSignal('REL-03').toolArgs.code;
    expect(code).toContain("'login_disabled'");
  });

  it('50-95 tier still demotes and now also kills sessions', () => {
    const code = step2ForSignal('REL-03').toolArgs.code;
    expect(code).toContain("'role' => 'subscriber'");
  });
});

// Batch 3 (#6, part 1) — the raw-$wpdb scans must NOT detonate live plugin code.
// FS-MISMATCH is the deliberate exception: it needs plugins loaded to make an
// account-hiding hook fire, which is the whole point of that check.
//
// DB-01..DB-04 no longer belong in this file's "sets skip_plugins" list: they were ported to
// read app/sql/local.sql directly (checks/database.ts via runByteScan's preflightSignals),
// which is a strictly stronger guarantee than skip_plugins ever was — skip_plugins only
// filters active_plugins and does nothing about mu-plugins, so the old wp_eval calls could
// still trigger a mu-plugin webshell on the very sandbox they were trying to inspect safely.
describe('Batch 3 — sandbox detonation reduction (#6)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8'
  );

  it('DB-01..DB-04 have no wp_eval block left — no PHP runs for them at all', () => {
    for (const id of ['DB-01', 'DB-02', 'DB-03', 'DB-04']) {
      expect(src).not.toMatch(new RegExp(`//\\s*${id}:.*wp_eval`, 's'));
    }
    expect(src).not.toContain('const postsContentResult = await tools.invoke');
    expect(src).not.toContain('const optionsScanResult = await tools.invoke');
    expect(src).not.toContain('const usermetaResult = await tools.invoke');
    expect(src).not.toContain('const commentsResult = await tools.invoke');
  });

  it('FS-MISMATCH deliberately still loads plugins (needs the hiding hook to fire)', () => {
    const idx = src.indexOf('FS-MISMATCH: intentionally runs WITH plugins loaded');
    expect(idx).toBeGreaterThan(-1);
    // the invoke immediately after this comment must NOT set skip_plugins
    const block = src.slice(idx, idx + 300);
    expect(block).not.toContain('skip_plugins');
  });
});

// Regression: Step 8 (the final re-scan gating the push verdict) and the specialist-context
// obfuscation collector each carried their OWN copy of the FS-02 pattern list, unsynced with
// the retuned OBFUSCATION_PATTERNS in filesystem.ts. Both still had assert($ and
// create_function( — the two patterns measured at 236 and 5 false-positive hits with ZERO real
// catches on a clean fleet (both target PHP constructs removed in PHP 8). Live consequence: a
// commented-out create_function() call in a legitimate plugin (economic-market-news) blocked
// Step 8's push verdict on a real specimen.
describe('FS-02 pattern list stays synced everywhere it is duplicated', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8'
  );

  it('no PHP obfuscation-pattern array contains the two dead-vector patterns', () => {
    // Raw source text: each JS `\\` is one literal backslash character in the file.
    expect(src).not.toContain("'/assert\\\\s*\\\\(\\\\s*\\\\$/'");
    expect(src).not.toContain("'/create_function\\\\s*\\\\(/'");
  });

  it('Step 8 and the specialist collector both carry the retuned nested-decode pattern', () => {
    const needle = 'base64_decode\\\\s*\\\\(\\\\s*(base64_decode|gzinflate|gzuncompress|str_rot13|strrev|rawurldecode)';
    const occurrences = src.split(needle).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2); // Step 8 + specialist collector
  });
});
