import { computeFleetCounts } from '../../../src/main/fleet/FleetCounts';

describe('computeFleetCounts', () => {
  const input = {
    localSiteIds: ['l1', 'l2', 'l3'],
    graphRows: [
      { id: 'w1', source: 'wpe' as const, wpeSiteId: 'siteA' },
      { id: 'w2', source: 'wpe' as const, wpeSiteId: 'siteA' },
      { id: 'w3', source: 'wpe' as const, wpeSiteId: 'siteB' },
      { id: 'e1', source: 'external' as const, wpeSiteId: null },
    ],
  };

  test('the fleet total is the sum of the three populations', () => {
    const c = computeFleetCounts(input);
    expect(c.local.count).toBe(3);
    expect(c.wpe.count).toBe(3);
    expect(c.external.count).toBe(1);
    expect(c.installs.count).toBe(7);
  });

  test('wpeSites counts distinct parent sites, not installs', () => {
    expect(computeFleetCounts(input).wpeSites.count).toBe(2);
  });

  test('every population carries a non-empty scope label', () => {
    const c = computeFleetCounts(input);
    for (const key of ['installs', 'local', 'wpe', 'external', 'wpeSites'] as const) {
      expect(c[key].scope.length).toBeGreaterThan(0);
    }
  });

  test('an empty fleet is zeros with scopes intact', () => {
    const c = computeFleetCounts({ localSiteIds: [], graphRows: [] });
    expect(c.installs.count).toBe(0);
    expect(c.installs.scope.length).toBeGreaterThan(0);
  });

  test('WPE rows with no parent site each count as their own site', () => {
    const c = computeFleetCounts({
      localSiteIds: [],
      graphRows: [
        { id: 'w1', source: 'wpe' as const, wpeSiteId: 'siteA' },
        { id: 'w2', source: 'wpe' as const, wpeSiteId: null },
        { id: 'w3', source: 'wpe' as const, wpeSiteId: null },
      ],
    });
    // One real parent + two unparented rows that must NOT collapse together.
    expect(c.wpeSites.count).toBe(3);
    expect(c.wpe.count).toBe(3);
  });
});
