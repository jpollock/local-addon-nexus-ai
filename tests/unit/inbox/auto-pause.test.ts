import { trailingFailures, shouldPauseAgent } from '../../../src/main/inbox/autoPause';
import type { AgentRunRow } from '../../../src/main/agent-runtime/AgentStateStore';

const row = (
  id: number, status: AgentRunRow['status'], error?: string,
): AgentRunRow => ({
  id, agentName: 'security-sentinel', startedAt: id * 1000, finishedAt: id * 1000,
  status, error, findingsCount: 0,
});

describe('trailingFailures', () => {
  test('stops at the most recent success', () => {
    const runs = [
      row(5, 'error', 'boom'), row(4, 'error', 'boom'),
      row(3, 'success'),
      row(2, 'error', 'boom'), row(1, 'error', 'boom'),
    ];
    expect(trailingFailures(runs).map(f => f.at)).toEqual([5000, 4000]);
  });

  test('a leading success means no trailing failures', () => {
    expect(trailingFailures([row(2, 'success'), row(1, 'error', 'boom')])).toEqual([]);
  });

  test('accepts oldest-first input too', () => {
    const runs = [row(1, 'error', 'boom'), row(2, 'success'), row(3, 'error', 'boom')];
    expect(trailingFailures(runs).map(f => f.at)).toEqual([3000]);
  });
});

describe('shouldPauseAgent', () => {
  test('pauses after three consecutive identical failures', () => {
    expect(shouldPauseAgent([
      row(3, 'error', 'boom'), row(2, 'error', 'boom'), row(1, 'error', 'boom'),
    ])).toBe(true);
  });

  test('a success between failures prevents the pause', () => {
    // THE contract test. Five failures, same message, but not consecutive:
    // this agent is flaky, not stuck, and pausing it would be wrong.
    expect(shouldPauseAgent([
      row(5, 'error', 'boom'),
      row(4, 'success'),
      row(3, 'error', 'boom'),
      row(2, 'success'),
      row(1, 'error', 'boom'),
    ])).toBe(false);
  });

  test('three consecutive failures with differing messages do not pause', () => {
    expect(shouldPauseAgent([
      row(3, 'error', 'c'), row(2, 'error', 'b'), row(1, 'error', 'a'),
    ])).toBe(false);
  });

  test('a timeout counts as a failure', () => {
    expect(shouldPauseAgent([
      row(3, 'timeout', 'slow'), row(2, 'timeout', 'slow'), row(1, 'timeout', 'slow'),
    ])).toBe(true);
  });

  test('an empty run list does not pause and does not throw', () => {
    expect(shouldPauseAgent([])).toBe(false);
  });

  test('fewer runs than the threshold does not pause', () => {
    expect(shouldPauseAgent([row(2, 'error', 'boom'), row(1, 'error', 'boom')])).toBe(false);
  });

  test('a same-millisecond success and failure resolve deterministically', () => {
    // Both stamped at the same finishedAt; `id` decides which is newer.
    // The success (id 2) is newer, so there is no trailing failure at all.
    const a = { ...row(1, 'error', 'boom'), finishedAt: 5000 };
    const b = { ...row(2, 'success'),       finishedAt: 5000 };
    expect(trailingFailures([a, b])).toEqual([]);
    expect(trailingFailures([b, a])).toEqual([]);   // input order must not matter
  });
});
