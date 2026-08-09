import { newRunId } from '../../../src/main/logging/runId';

describe('newRunId', () => {
  it('prefixes by kind so a raw grep says what it matched', () => {
    expect(newRunId('agent')).toMatch(/^r_[0-9a-z]+$/);
    expect(newRunId('chat')).toMatch(/^c_[0-9a-z]+$/);
    expect(newRunId('gateway')).toMatch(/^g_[0-9a-z]+$/);
  });

  it('is short enough to type into a grep', () => {
    expect(newRunId('agent').length).toBeLessThanOrEqual(16);
  });

  it('does not collide within the same millisecond', () => {
    // Date.now() alone collides for runs started in a loop — Run Now fires one call per
    // selected site, back to back. A per-millisecond counter ensures uniqueness by construction.
    const ids = new Set(Array.from({ length: 1000 }, () => newRunId('agent')));
    expect(ids.size).toBe(1000);
  });

  it('sorts lexicographically in time order', () => {
    const a = newRunId('agent');
    const b = newRunId('agent');
    // Base36 time prefix of fixed width, so `sort` on a log grep is chronological.
    expect(a.slice(2, 10) <= b.slice(2, 10)).toBe(true);
  });

  it('uses counter to differentiate same-millisecond runs', () => {
    // Stub Date.now to return a constant value so all 5000 calls happen in the same millisecond.
    // The counter must increment, making every id unique even though they all have the same
    // time prefix.
    const fixedMs = 1234567890;
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedMs);
    try {
      const ids = new Set(Array.from({ length: 5000 }, () => newRunId('agent')));
      expect(ids.size).toBe(5000);
      // All ids should have the same time prefix since Date.now is stubbed.
      const timePrefix = ids.values().next().value?.slice(2, 10);
      for (const id of ids) {
        expect(id.slice(2, 10)).toBe(timePrefix);
      }
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});
