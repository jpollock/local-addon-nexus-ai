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
});
