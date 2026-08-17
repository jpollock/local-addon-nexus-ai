/**
 * WP-18 · Unit pins for the replay's verdict and its rendering.
 *
 * The verdict is the whole point of a pre-release check: it is read by a human
 * in a terminal, once, quickly. So two things are pinned — that EVERY problem
 * category can fail the run (a verdict that only watches one of them is a
 * verdict that certifies the rest), and that nothing is dropped from the
 * rendering without saying how much was dropped.
 */
import { formatReplayReport, replayPassed, ReplayResult } from './report';

function result(overrides: Partial<ReplayResult> = {}): ReplayResult {
  return {
    ledgerPath: '/tmp/replay/ledger.db',
    events: 9000,
    stateObservations: 8000,
    driftEvents: 12,
    liveTwins: 400,
    replayedTwins: 400,
    entities: 60,
    foldNames: ['state-twin/1'],
    durationMs: 1234,
    problems: {
      monotonic: [],
      drift: [],
      twinRows: [],
      counts: [],
      diff: { identical: true, missing: [], extra: [], differing: [] },
    },
    ...overrides,
  };
}

describe('replayPassed', () => {
  it('passes a clean replay', () => {
    expect(replayPassed(result())).toBe(true);
  });

  it('fails when the replay threw', () => {
    expect(replayPassed(result({ problems: { ...result().problems, threw: 'boom' } }))).toBe(false);
  });

  // Each category gets its own pin: a verdict that watched only the twin diff
  // would silently certify malformed drift events, and vice versa.
  const categories: Array<[string, Partial<ReplayResult['problems']>]> = [
    ['non-monotonic ids', { monotonic: ['dup at 3'] }],
    ['malformed drift events', { drift: ['01X: no fact'] }],
    ['malformed twin rows', { twinRows: ['env / plugin:x: empty event_id'] }],
    ['out-of-bounds counts', { counts: ['no twin facts folded'] }],
    [
      'a twin set that did not reproduce',
      { diff: { identical: false, missing: ['env / plugin:x'], extra: [], differing: [] } },
    ],
  ];

  for (const [what, problems] of categories) {
    it(`fails on ${what}`, () => {
      expect(replayPassed(result({ problems: { ...result().problems, ...problems } }))).toBe(false);
    });
  }
});

describe('formatReplayReport', () => {
  it('leads with a verdict a skim cannot miss', () => {
    expect(formatReplayReport(result())).toContain('PASS');
    expect(
      formatReplayReport(result({ problems: { ...result().problems, counts: ['bad'] } }))
    ).toContain('FAIL');
  });

  it('prints what was measured, not just the verdict', () => {
    const text = formatReplayReport(result());
    expect(text).toContain('9000');       // events replayed
    expect(text).toContain('state-twin/1'); // the fold that ran
    expect(text).toContain('400');        // twins compared
  });

  it('prints every problem line when there are few', () => {
    const text = formatReplayReport(
      result({ problems: { ...result().problems, drift: ['01A: no fact', '01B: no entity'] } })
    );
    expect(text).toContain('01A: no fact');
    expect(text).toContain('01B: no entity');
  });

  it('caps a long list but says how many it withheld', () => {
    // A silently truncated list reads as "that is all of them", which is how a
    // 3000-row breakage gets reported as 20 rows and treated as minor.
    const many = Array.from({ length: 50 }, (_, i) => `row ${i}`);
    const text = formatReplayReport(
      result({ problems: { ...result().problems, twinRows: many } })
    );
    expect(text).toContain('row 0');
    expect(text).not.toContain('row 49');
    expect(text).toContain('30 more');
  });

  it('names the ledger copy it read, never the live file', () => {
    expect(formatReplayReport(result())).toContain('/tmp/replay/ledger.db');
  });
});
