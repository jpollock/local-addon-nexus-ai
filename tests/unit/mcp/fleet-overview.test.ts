import { fleetOverviewHandler } from '../../../src/main/mcp/modules/fleet-intelligence/fleet-overview';
import type { SiteDigitalTwin } from '../../../src/main/twin/SiteDigitalTwin';

function getText(result: any): string {
  return result.content[0].text;
}

function makeLocalTwin(overrides: Partial<SiteDigitalTwin> & { userCount?: number } = {}): SiteDigitalTwin {
  return {
    siteId: 'local-1', siteName: 'my-site', domain: 'my-site.local',
    path: '/path', source: 'local', completeness: 'indexed',
    asOf: Date.now() - 1000, sources: {},
    wpVersion: '7.0', postCount: 10,
    ...overrides,
  } as SiteDigitalTwin;
}

/**
 * `wpeCount` here is the count of ALL remote rows (the probe query). The
 * aggregate row carries per-source columns because every coverage metric must
 * be divided by the population it was counted over — a numerator spanning WPE
 * + external over a WPE-only denominator printed "1 of 0".
 */
function makeDb(wpeCount: number, wpeAggRow?: any) {
  const aggRow = wpeAggRow ?? {
    count: wpeCount, total_posts: wpeCount * 50, total_users: wpeCount * 3,
    with_post_count: wpeCount, most_recent_post: null,
    wpe_count: wpeCount, wpe_with_wp_version: wpeCount, wpe_with_post_count: wpeCount,
    external_count: 0, external_with_wp_version: 0,
  };
  // fleet_overview now derives its wpeCount gate from collectFleetCounts,
  // which runs its own `id, source, wpe_site_id` query — synthesize rows
  // matching the aggregate row's wpe_count/external_count split so
  // collectFleetCounts() agrees with the aggregate row used further down.
  const rawRows = [
    ...Array.from({ length: aggRow.wpe_count }, (_, i) => ({ id: `wpe-${i}`, source: 'wpe', wpe_site_id: null })),
    ...Array.from({ length: aggRow.external_count }, (_, i) => ({ id: `ext-${i}`, source: 'external', wpe_site_id: null })),
  ];
  return {
    prepare: jest.fn().mockImplementation((sql: string) => {
      // The probe query selects "as c" only; the aggregate selects "as count".
      // collectFleetCounts selects raw id/source/wpe_site_id columns.
      // Discriminate by checking for "as count," which only appears in the aggregate.
      if (sql.includes('as count,')) {
        return { all: jest.fn().mockReturnValue(wpeCount > 0 ? [aggRow] : []) };
      }
      if (sql.includes('wpe_site_id')) {
        return { all: jest.fn().mockReturnValue(rawRows) };
      }
      return { get: jest.fn().mockReturnValue({ c: wpeCount }) };
    }),
  };
}

function makeServices(db: any, twins: SiteDigitalTwin[]) {
  return {
    graphService: { getDb: () => db },
    twinService: { getAll: () => twins },
  } as any;
}

describe('fleet_overview MCP tool', () => {
  describe('local-only user (0 WPE sites)', () => {
    test('describes local sites as the complete fleet without WPE mention', async () => {
      const db = makeDb(0);
      const twins = [makeLocalTwin({ siteId: 'a', siteName: 'blog', postCount: 42 })];
      const result = await fleetOverviewHandler.execute({}, makeServices(db, twins));
      const text = getText(result);
      expect(text).toContain('1 site');
      expect(text).toContain('42');
      expect(text).not.toContain('WP Engine');
      expect(text).not.toContain('WPE');
      expect(result.isError).toBeFalsy();
    });

    test('returns no-sites message when fleet is empty', async () => {
      const db = makeDb(0);
      const result = await fleetOverviewHandler.execute({}, makeServices(db, []));
      const text = getText(result);
      expect(text.toLowerCase()).toMatch(/no sites/);
    });

    test('shows multiple local sites with aggregate post count', async () => {
      const db = makeDb(0);
      const twins = [
        makeLocalTwin({ siteId: 'a', postCount: 10 }),
        makeLocalTwin({ siteId: 'b', siteName: 'shop', postCount: 30 }),
      ];
      const result = await fleetOverviewHandler.execute({}, makeServices(db, twins));
      const text = getText(result);
      expect(text).toContain('2 sites');
      expect(text).toContain('40'); // 10 + 30
    });
  });

  describe('WPE customer (>0 WPE sites)', () => {
    test('shows combined local + WPE total sites', async () => {
      const db = makeDb(10);
      const twins = [makeLocalTwin()];
      const result = await fleetOverviewHandler.execute({}, makeServices(db, twins));
      const text = getText(result);
      expect(text).toContain('WP Engine');
      expect(text).toContain('11 total sites'); // 1 local + 10 WPE
    });

    test('shows WPE section with install count', async () => {
      const db = makeDb(287);
      const twins = [makeLocalTwin({ postCount: 50 })];
      const result = await fleetOverviewHandler.execute({}, makeServices(db, twins));
      const text = getText(result);
      expect(text).toContain('287');
      expect(text).toContain('WP Engine Installs');
    });

    test('notes partial sync when not all WPE installs SSH-synced', async () => {
      const db = makeDb(100, {
        count: 100, total_posts: 500, total_users: 50,
        with_post_count: 10, most_recent_post: null,
        wpe_count: 100, wpe_with_wp_version: 100, wpe_with_post_count: 10,
        external_count: 0, external_with_wp_version: 0,
      });
      const twins = [makeLocalTwin()];
      const result = await fleetOverviewHandler.execute({}, makeServices(db, twins));
      const text = getText(result);
      // 10 of 100 synced = 10%
      expect(text).toMatch(/10%|10 of 100/);
    });
  });

  describe('mixed and external-only remote fleets', () => {
    test('reports WPE and external coverage against their own denominators', async () => {
      // 3 remote rows: 2 WPE (1 with a wp_version) and 1 external (with one).
      const db = makeDb(3, {
        count: 3, total_posts: 100, total_users: 5,
        with_post_count: 2, most_recent_post: null,
        wpe_count: 2, wpe_with_wp_version: 1, wpe_with_post_count: 2,
        external_count: 1, external_with_wp_version: 1,
      });
      const result = await fleetOverviewHandler.execute({}, makeServices(db, [makeLocalTwin()]));
      const text = getText(result);

      expect(text).toContain('### WP Engine Installs');
      expect(text).toMatch(/\*\*Installs:\*\* 2/);
      expect(text).toMatch(/With WP version \(CAPI\):\*\* 1 of 2/);

      expect(text).toContain('### External SSH Hosts');
      expect(text).toMatch(/\*\*Hosts:\*\* 1/);
      expect(text).toMatch(/With WP version:\*\* 1 of 1/);
    });

    test('an external-only fleet never prints a WPE denominator of 0', async () => {
      const db = makeDb(1, {
        count: 1, total_posts: null, total_users: null,
        with_post_count: 0, most_recent_post: null,
        wpe_count: 0, wpe_with_wp_version: 0, wpe_with_post_count: 0,
        external_count: 1, external_with_wp_version: 1,
      });
      const result = await fleetOverviewHandler.execute({}, makeServices(db, [makeLocalTwin()]));
      const text = getText(result);

      // The defect: "With WP version (CAPI): 1 of 0" for a user with SSH hosts
      // and no WP Engine account.
      expect(text).not.toContain('of 0');
      expect(text).not.toContain('### WP Engine Installs');
      expect(text).toContain('### External SSH Hosts');
      expect(text).toMatch(/With WP version:\*\* 1 of 1/);
    });
  });

  describe('graceful degradation', () => {
    test('works when twinService unavailable', async () => {
      const db = makeDb(0);
      const services = { graphService: { getDb: () => db }, twinService: null } as any;
      const result = await fleetOverviewHandler.execute({}, services);
      expect(result.isError).toBeFalsy();
    });

    test('works when graphService unavailable', async () => {
      const services = { graphService: { getDb: () => null }, twinService: { getAll: () => [] } } as any;
      const result = await fleetOverviewHandler.execute({}, services);
      expect(result.isError).toBeFalsy();
    });
  });
});
