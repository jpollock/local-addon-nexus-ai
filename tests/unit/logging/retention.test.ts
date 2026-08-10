import { planRetention } from '../../../src/main/logging/retention';

const POLICY = { logDays: 14, transcriptDays: 3, budgetBytes: 250 * 1024 * 1024 };
const f = (over: Partial<any> = {}) => ({
  path: '/logs/nexus-2026-08-01.log', category: 'combined' as const,
  day: '2026-08-01', bytes: 1024, preserved: false, ...over,
});

describe('planRetention', () => {
  it('keeps everything inside the day windows and under budget', () => {
    const plan = planRetention([f({ day: '2026-08-09' }), f({ day: '2026-08-08' })], POLICY);
    expect(plan.deletePaths).toEqual([]);
  });

  it('drops logs older than logDays', () => {
    const old = f({ day: '2026-07-01', path: '/logs/old.log' });
    const plan = planRetention([old, f({ day: '2026-08-09' })], POLICY);
    expect(plan.deletePaths).toEqual(['/logs/old.log']);
  });

  it('holds transcripts to a shorter window than logs', () => {
    // Transcripts carry prompt text, so they age out faster than the lines that reference them.
    const t = f({ day: '2026-08-04', category: 'transcript', path: '/logs/t.jsonl' });
    const l = f({ day: '2026-08-04', path: '/logs/keep.log' });
    const plan = planRetention([t, l], POLICY);
    expect(plan.deletePaths).toEqual(['/logs/t.jsonl']);
  });

  it('NEVER deletes a preserved file, however old', () => {
    // A run that errored or performed a Tier 3 operation is the one most worth auditing; ageing
    // it out on the same schedule as a quiet run defeats the point of keeping logs at all.
    const kept = f({ day: '2020-01-01', preserved: true, path: '/logs/failed-run.log' });
    const plan = planRetention([kept], POLICY);
    expect(plan.deletePaths).toEqual([]);
  });

  it('evicts oldest-first when the budget is exceeded', () => {
    const big = { ...POLICY, budgetBytes: 2048 };
    const plan = planRetention([
      f({ day: '2026-08-09', bytes: 1024, path: '/logs/new.log' }),
      f({ day: '2026-08-08', bytes: 1024, path: '/logs/mid.log' }),
      f({ day: '2026-08-07', bytes: 1024, path: '/logs/old.log' }),
    ], big);
    expect(plan.deletePaths).toEqual(['/logs/old.log']);
    expect(plan.keptBytes).toBeLessThanOrEqual(2048);
  });

  it('will not breach the budget by deleting a preserved file', () => {
    // The budget yields to preservation: going over disk is recoverable, losing the evidence of a
    // failed production run is not. The caller surfaces this rather than silently deleting.
    const tiny = { ...POLICY, budgetBytes: 10 };
    const plan = planRetention([f({ bytes: 5000, preserved: true, path: '/logs/keep.log' })], tiny);
    expect(plan.deletePaths).toEqual([]);
    expect(plan.keptBytes).toBe(5000);
  });

  it('reports how much it would free, so the UI can say so before deleting', () => {
    const plan = planRetention([f({ day: '2026-07-01', bytes: 4096, path: '/logs/old.log' })], POLICY);
    expect(plan.freedBytes).toBe(4096);
  });

  it('preserved files are exempt from BOTH day and budget passes', () => {
    // A preserved file that is recent enough to pass the day window should ALSO be exempt
    // from the budget pass. This catches the bug where preserved check is only in one pass.
    const tiny = { ...POLICY, budgetBytes: 2000 };
    const plan = planRetention([
      f({ day: '2026-08-09', bytes: 1000, preserved: false, path: '/logs/unpres.log' }),
      f({ day: '2026-08-08', bytes: 2000, preserved: true, path: '/logs/pres.log' }),
    ], tiny);
    // The preserved file survived the day pass (recent). Now budget is 2000, total is 3000.
    // Only the unpreserved file should be deleted, even though it's newer.
    expect(plan.deletePaths).toEqual(['/logs/unpres.log']);
    expect(plan.keptBytes).toBe(2000);
  });
});
