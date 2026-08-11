import {
  aggregateFailures, shouldAutoPause, AUTO_PAUSE_THRESHOLD,
} from '../../../src/main/agents/failureAggregation';

const run = (at: number, message: string) => ({ agentId: 'security-sentinel', at, message });

describe('aggregateFailures', () => {
  test('collapses identical failures into one entry with a count and time range', () => {
    const out = aggregateFailures([
      run(1000, '(s.evidence || []).map is not a function'),
      run(2000, '(s.evidence || []).map is not a function'),
      run(3000, '(s.evidence || []).map is not a function'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    expect(out[0].firstAt).toBe(1000);
    expect(out[0].lastAt).toBe(3000);
  });

  test('different messages stay separate entries', () => {
    const out = aggregateFailures([run(1000, 'boom'), run(2000, 'different')]);
    expect(out).toHaveLength(2);
  });

  test('an empty run list aggregates to nothing', () => {
    expect(aggregateFailures([])).toEqual([]);
  });

  test('aggregated failures are sorted by most recent timestamp descending (Finding 2)', () => {
    // Multiple distinct groups with insertion order differing from lastAt order
    const out = aggregateFailures([
      // Group 1: lastAt = 3000 (inserted first but not newest)
      run(1000, 'error-a'),
      run(2000, 'error-a'),
      run(3000, 'error-a'),
      // Group 2: lastAt = 5000 (newest overall)
      { agentId: 'a', at: 4000, message: 'error-b' },
      { agentId: 'a', at: 5000, message: 'error-b' },
      // Group 3: lastAt = 1500 (oldest)
      { agentId: 'a', at: 1500, message: 'error-c' },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0].message).toBe('error-b'); // lastAt = 5000 (newest)
    expect(out[1].message).toBe('error-a'); // lastAt = 3000
    expect(out[2].message).toBe('error-c'); // lastAt = 1500 (oldest)
  });

  test('messages containing the grouping delimiter do not collide (Finding 3)', () => {
    // Test a message containing a pipe delimiter
    const out = aggregateFailures([
      { agentId: 'agent1', at: 1000, message: 'error|part1' },
      { agentId: 'agent1', at: 2000, message: 'error|part1' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].message).toBe('error|part1');
    expect(out[0].count).toBe(2);

    // Test the collision case: different agentId/message combinations should NOT merge
    const out2 = aggregateFailures([
      { agentId: 'a|b', at: 1000, message: 'c' },
      { agentId: 'a', at: 2000, message: 'b|c' },
    ]);
    expect(out2).toHaveLength(2); // Should be 2 distinct entries, not 1 collision
    expect(out2.some((a) => a.agentId === 'a|b' && a.message === 'c')).toBe(true);
    expect(out2.some((a) => a.agentId === 'a' && a.message === 'b|c')).toBe(true);
  });
});

describe('shouldAutoPause', () => {
  test('pauses after three consecutive identical failures', () => {
    const runs = [run(1, 'boom'), run(2, 'boom'), run(3, 'boom')];
    expect(AUTO_PAUSE_THRESHOLD).toBe(3);
    expect(shouldAutoPause(runs)).toBe(true);
  });

  test('does not pause below the threshold', () => {
    expect(shouldAutoPause([run(1, 'boom'), run(2, 'boom')])).toBe(false);
  });

  test('a different recent failure resets the streak', () => {
    expect(shouldAutoPause([run(1, 'boom'), run(2, 'boom'), run(3, 'other')])).toBe(false);
  });

  test('the most recent N are chosen by time, not by array position (negative case)', () => {
    // The three newest by time are boom(20), boom(30), different(40).
    // Since the newest differs, the streak is broken → false.
    // But array order puts 'different' first, and the last three positions are
    // all 'boom'. Position-based slicing (without sort) would wrongly return true.
    const runs = [
      { agentId: 'a', at: 40, message: 'different' },
      { agentId: 'a', at: 10, message: 'boom' },
      { agentId: 'a', at: 20, message: 'boom' },
      { agentId: 'a', at: 30, message: 'boom' },
    ];
    expect(shouldAutoPause(runs)).toBe(false);
  });

  test('the most recent N are chosen by time, not by array position (positive case)', () => {
    // The three newest by time are boom(30), boom(40), boom(50) - all identical → true.
    // But array order puts an unrelated 'different' run last.
    // Position-based slicing of the last three array positions would include
    // the different run and wrongly return false.
    const runs = [
      { agentId: 'a', at: 30, message: 'boom' },
      { agentId: 'a', at: 40, message: 'boom' },
      { agentId: 'a', at: 50, message: 'boom' },
      { agentId: 'a', at: 10, message: 'different' },
    ];
    expect(shouldAutoPause(runs)).toBe(true);
  });

  test('does not pause when different agents have identical recent failures (Finding 1 negative)', () => {
    // Agent A: 2 booms, Agent B: 1 boom. Total 3 booms but no single agent has 3.
    // Without per-agent grouping, this falsely triggers a pause.
    const runs = [
      { agentId: 'agent-a', at: 1, message: 'boom' },
      { agentId: 'agent-a', at: 2, message: 'boom' },
      { agentId: 'agent-b', at: 3, message: 'boom' },
    ];
    expect(shouldAutoPause(runs)).toBe(false);
  });

  test('pauses when a single agent genuinely has the streak, despite interleaved failures (Finding 1 positive)', () => {
    // Agent A has failures at times 1, 2, 4 with message 'foo'.
    // Agent B has one failure at time 3 with message 'bar'.
    // Agent A's three most recent are all 'foo' → should pause.
    // Without per-agent grouping, the interleaved 'bar' at time 3 masks the streak.
    const runs = [
      { agentId: 'agent-a', at: 1, message: 'foo' },
      { agentId: 'agent-a', at: 2, message: 'foo' },
      { agentId: 'agent-b', at: 3, message: 'bar' },
      { agentId: 'agent-a', at: 4, message: 'foo' },
    ];
    expect(shouldAutoPause(runs)).toBe(true);
  });
});
