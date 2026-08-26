/**
 * fixes-082526 · Tier A 5a — the operation badge must not be greener than
 * its run.
 *
 * WP-67's ruling, verbatim: "a status word that summarizes a run must not be
 * greener than the run … it may be a colour rule rather than a new status.
 * Try the colour first." This is the colour rule. The WORD stays the
 * operation's own status — the run did complete; what it completed was
 * nothing — only the colour stops claiming success.
 */
import { badgeToneFor, BADGE_COLORS } from '../../../src/renderer/components/BulkOperationsPanel';
import type { BulkOperationSummary } from '../../../src/main/bulk/summary';

const summary = (partial: Partial<BulkOperationSummary>): BulkOperationSummary => ({
  succeeded: 0, failed: 0, skipped: 0, running: 0, pending: 0, total: 0,
  ...partial,
});

describe('badgeToneFor — the colour rule', () => {
  test('a completed run in which sites succeeded is green', () => {
    expect(badgeToneFor('completed', summary({ succeeded: 3 }))).toEqual(BADGE_COLORS.completed);
  });

  test('"Completed" above "0 succeeded · 365 did not run" is NOT green — the WP-67 case', () => {
    const tone = badgeToneFor('completed', summary({ skipped: 365 }));
    expect(tone).not.toEqual(BADGE_COLORS.completed);
    expect(tone).toEqual(BADGE_COLORS.skipped); // amber: the run ran, the work did not
  });

  test('completed with zero succeeded and some failed is not green either', () => {
    expect(badgeToneFor('completed', summary({ failed: 2, skipped: 1 }))).not.toEqual(
      BADGE_COLORS.completed
    );
  });

  test('a completed run of an EMPTY selection stays green — nothing was asked, nothing failed', () => {
    expect(badgeToneFor('completed', summary({}))).toEqual(BADGE_COLORS.completed);
  });

  test('completed_with_errors has its own explicit amber entry, not a fallback', () => {
    expect(BADGE_COLORS.completed_with_errors).toBeDefined();
    expect(BADGE_COLORS.completed_with_errors).not.toEqual(BADGE_COLORS.completed);
    expect(BADGE_COLORS.completed_with_errors).not.toEqual(BADGE_COLORS.pending);
  });

  test('every other status keeps its own colour untouched by the summary', () => {
    for (const s of ['running', 'failed', 'cancelled', 'pending'] as const) {
      expect(badgeToneFor(s, summary({ skipped: 10 }))).toEqual(BADGE_COLORS[s]);
    }
  });
});
