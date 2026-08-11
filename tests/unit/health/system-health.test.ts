import { rollUpSystemHealth, SystemHealthInputs } from '../../../src/main/health/SystemHealth';

const ok = { state: 'ok' as const, reason: null };
const allOk: SystemHealthInputs = {
  agentRuns: ok, syncStaleness: ok, credentials: ok, eventQueue: ok,
};

describe('rollUpSystemHealth', () => {
  test('green only when every input has actually answered', () => {
    expect(rollUpSystemHealth(allOk).overall).toBe('ok');
  });

  test('a single unknown input degrades the whole pill to unknown', () => {
    const r = rollUpSystemHealth({ ...allOk, credentials: { state: 'unknown', reason: 'Could not read credential status' } });
    expect(r.overall).toBe('unknown');
  });

  test('failing beats unknown, because it is more actionable', () => {
    const r = rollUpSystemHealth({
      ...allOk,
      agentRuns: { state: 'failing', reason: 'security-sentinel failed 5 times since 3:17 PM' },
      credentials: { state: 'unknown', reason: 'Could not read credential status' },
    });
    expect(r.overall).toBe('failing');
  });

  test('degraded when something is stale but nothing is failing or unknown', () => {
    const r = rollUpSystemHealth({ ...allOk, syncStaleness: { state: 'degraded', reason: '44 sites not checked in 9 days' } });
    expect(r.overall).toBe('degraded');
  });

  test('the event queue alone can never produce green', () => {
    const unknown = { state: 'unknown' as const, reason: 'not read' };
    const r = rollUpSystemHealth({
      agentRuns: unknown, syncStaleness: unknown, credentials: unknown, eventQueue: ok,
    });
    expect(r.overall).toBe('unknown');
  });

  test('reasons from every non-ok input are carried, in severity order', () => {
    const r = rollUpSystemHealth({
      ...allOk,
      agentRuns: { state: 'failing', reason: 'agent failed' },
      syncStaleness: { state: 'degraded', reason: 'sync stale' },
    });
    expect(r.reasons).toEqual(['agent failed', 'sync stale']);
  });

  test('a malformed state (outside the union) becomes unknown, never green', () => {
    const malformed = { state: 'timeout' as any, reason: 'signal timed out' };
    const r = rollUpSystemHealth({
      ...allOk,
      agentRuns: malformed,
    });
    expect(r.overall).toBe('unknown');
  });

  test('a malformed state\'s reason appears in output', () => {
    const malformed = { state: 'timeout' as any, reason: 'signal timed out' };
    const r = rollUpSystemHealth({
      ...allOk,
      agentRuns: malformed,
    });
    expect(r.reasons).toContain('signal timed out');
  });

  test('same-severity inputs are ordered by INPUT_ORDER, not arbitrary key order', () => {
    const r = rollUpSystemHealth({
      ...allOk,
      syncStaleness: { state: 'degraded', reason: 'sync stale' },
      credentials: { state: 'degraded', reason: 'creds missing' },
    });
    // syncStaleness comes before credentials in INPUT_ORDER, so its reason should be first
    expect(r.reasons).toEqual(['sync stale', 'creds missing']);
  });
});
