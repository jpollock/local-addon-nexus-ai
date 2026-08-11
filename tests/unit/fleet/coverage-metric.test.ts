import { computeFleetCounts } from '../../../src/main/fleet/FleetCounts';
import { completenessRatio } from '../../../src/main/fleet/coverageMetric';

describe('completenessRatio', () => {
  // A fleet where local and installs deliberately differ, so a wrong
  // denominator produces a different number rather than the same one.
  const counts = computeFleetCounts({
    localSiteIds: ['l1', 'l2'],
    graphRows: [
      { id: 'w1', source: 'wpe' as const, wpeSiteId: 'a', accountId: null, lastSyncAt: null, contentIndexedAt: null },
      { id: 'w2', source: 'wpe' as const, wpeSiteId: 'b', accountId: null, lastSyncAt: null, contentIndexedAt: null },
      { id: 'e1', source: 'external' as const, wpeSiteId: null, accountId: null, lastSyncAt: null, contentIndexedAt: null },
    ],
    wpeAccountFilter: null,
    siteRows: null,
    pendingBySite: null,
    indexEntries: null,
  });

  test('a local-scoped numerator divides by the local denominator', () => {
    // 2 local sites, 5 installs. Measuring 1 local site is 50%, not 20%.
    const r = completenessRatio({ measured: 1, scope: 'local' }, counts);
    expect(r.denominator).toBe(2);
    expect(r.percent).toBe(50);
  });

  test('a fleet-scoped numerator divides by the fleet total', () => {
    const r = completenessRatio({ measured: 1, scope: 'installs' }, counts);
    expect(r.denominator).toBe(5);
    expect(r.percent).toBe(20);
  });

  test('throws when the numerator exceeds its own denominator', () => {
    // This is the "370/370 beside 367 sites" shape — a local-scoped count
    // larger than the local population means the scopes were mismatched.
    expect(() => completenessRatio({ measured: 4, scope: 'local' }, counts))
      .toThrow(/exceeds/i);
  });

  test('an empty population is 0%, not a division by zero', () => {
    const empty = computeFleetCounts({
      localSiteIds: [],
      graphRows: [],
      wpeAccountFilter: null,
      siteRows: null,
      pendingBySite: null,
      indexEntries: null,
    });
    const r = completenessRatio({ measured: 0, scope: 'local' }, empty);
    expect(r.percent).toBe(0);
    expect(Number.isFinite(r.percent)).toBe(true);
  });
});
