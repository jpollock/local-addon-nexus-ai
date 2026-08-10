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
});
