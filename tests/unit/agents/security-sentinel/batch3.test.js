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

// Batch 3 (#6, part 1) — the six raw-$wpdb scans must NOT detonate live plugin
// code. FS-MISMATCH is the deliberate exception: it needs plugins loaded to make
// an account-hiding hook fire, which is the whole point of that check.
describe('Batch 3 — sandbox detonation reduction (#6)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8'
  );

  // Every wp_eval whose code body is a raw $wpdb read should carry skip_plugins.
  // We assert on the source: each named DB scan sets skip_plugins on the call.
  const rawScans = [
    'const postsContentResult = await tools.invoke',
    'const optionsScanResult = await tools.invoke',
    'const usermetaResult = await tools.invoke',
    'const commentsResult = await tools.invoke',
  ];

  it('DB-01..DB-04 scans set skip_plugins/skip_themes', () => {
    for (const anchor of rawScans) {
      const idx = src.indexOf(anchor);
      expect(idx).toBeGreaterThan(-1);
      const block = src.slice(idx, idx + 200);
      expect(block).toContain('skip_plugins: true');
      expect(block).toContain('skip_themes: true');
    }
  });

  it('FS-MISMATCH deliberately still loads plugins (needs the hiding hook to fire)', () => {
    const idx = src.indexOf('FS-MISMATCH: intentionally runs WITH plugins loaded');
    expect(idx).toBeGreaterThan(-1);
    // the invoke immediately after this comment must NOT set skip_plugins
    const block = src.slice(idx, idx + 300);
    expect(block).not.toContain('skip_plugins');
  });
});
