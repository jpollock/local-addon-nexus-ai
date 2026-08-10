// tests/unit/renderer/inbox-pending.test.ts
import { pendingForAgent, totalPending, agentsWithPending } from
  '../../../src/renderer/components/agents/pending';

const counts = { 'security-sentinel': 3, 'seo-insights': 1 };

describe('pending counts derive from one source', () => {
  test('per-agent count reads the map', () => {
    expect(pendingForAgent(counts, 'security-sentinel')).toBe(3);
  });

  test('an agent with no entry has none pending, not undefined', () => {
    expect(pendingForAgent(counts, 'log-processor')).toBe(0);
  });

  test('total is the sum across agents', () => {
    expect(totalPending(counts)).toBe(4);
  });

  test('agentsWithPending counts agents, not items', () => {
    expect(agentsWithPending(counts)).toBe(2);
  });

  test('an agent present with a zero count is not "with pending"', () => {
    expect(agentsWithPending({ ...counts, 'log-processor': 0 })).toBe(2);
  });
});
