import { ReleasePolicyGate } from '../../../src/main/startup/releasePolicyGate';

describe('ReleasePolicyGate (T-KILLSWITCH, main process)', () => {
  it('is fail-safe before any successful fetch: agents are NOT disabled', () => {
    const gate = new ReleasePolicyGate('0.5.2', async () => null);
    expect(gate.verdict().agentsDisabled).toBe(false);
  });

  it('disables agents once the policy is fetched with disableAgents=true', async () => {
    const gate = new ReleasePolicyGate('0.5.2', async () => ({ disableAgents: true }));
    await gate.refresh();
    expect(gate.verdict().agentsDisabled).toBe(true);
  });

  it('disables agents when the running version is blocked', async () => {
    const gate = new ReleasePolicyGate('0.5.2', async () => ({ minSupportedVersion: '0.6.0' }));
    await gate.refresh();
    const v = gate.verdict();
    expect(v.agentsDisabled).toBe(true);
    expect(v.versionBlocked).toBe(true);
  });

  it('keeps the last-known policy when a later fetch fails (fail-safe, no flapping to disabled)', async () => {
    let call = 0;
    const gate = new ReleasePolicyGate(
      '0.5.2',
      async () => (call++ === 0 ? { disableAgents: false } : null),
      0, // ttl 0 → always refetch
    );
    await gate.refresh();
    expect(gate.verdict().agentsDisabled).toBe(false);
    await gate.refresh(); // returns null (failed) — must keep the last good policy
    expect(gate.verdict().agentsDisabled).toBe(false);
  });

  it('does not throw when the fetch throws', async () => {
    const gate = new ReleasePolicyGate('0.5.2', async () => { throw new Error('network'); });
    await expect(gate.refresh()).resolves.toBeUndefined();
    expect(gate.verdict().agentsDisabled).toBe(false);
  });

  it('refetches at most once per TTL', async () => {
    let calls = 0;
    let t = 1000;
    const gate = new ReleasePolicyGate('0.5.2', async () => { calls++; return null; }, 60_000, () => t);
    await gate.refresh();
    await gate.refresh(); // within TTL — no refetch
    expect(calls).toBe(1);
    t += 61_000;
    await gate.refresh(); // TTL elapsed — refetch
    expect(calls).toBe(2);
  });
});
