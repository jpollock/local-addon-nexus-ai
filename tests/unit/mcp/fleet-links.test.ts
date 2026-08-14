import Database from 'better-sqlite3';
import { linkSiteHandler, listFleetHandler, unlinkSiteHandler } from '../../../src/main/mcp/modules/fleet-links';

function install(overrides: Record<string, unknown> = {}) {
  return {
    installId: 'inst-1',
    installName: 'ga-prod',
    environment: 'production',
    domain: 'good-aesthetic.com',
    sandbox: null,
    provenance: { level: 'live', source: 'WPE sync', ageSeconds: 60, caveat: null },
    ...overrides,
  };
}

const GROUPS = [
  {
    wpeSiteId: 'site-A',
    name: 'good-aesthetic.com',
    installs: [install()],
  },
];

function installsDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, source TEXT, remote_install_id TEXT);
    INSERT INTO sites VALUES ('wpe-inst-1', 'ga-prod', 'wpe', 'inst-1');
    INSERT INTO sites VALUES ('local-1', 'sandbox', 'local', NULL);
  `);
  return db;
}

function services(overrides: Record<string, unknown> = {}, db?: Database.Database) {
  return {
    fleetAssembler: { listFleet: jest.fn().mockResolvedValue(GROUPS) },
    siteLinkResolver: {
      setManualLink: jest.fn(),
      clearLink: jest.fn(),
      getLastReport: jest.fn().mockReturnValue(null),
    },
    graphService: { getDb: () => db },
    ...overrides,
  } as any;
}

describe('fleet-links tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = installsDb();
  });

  afterEach(() => db.close());

  describe('nexus_fleet_list', () => {
    it('renders compact markdown with provenance and sandbox inline', async () => {
      const result = await listFleetHandler.execute({}, services({}, db));
      const text = result.content[0].text;

      expect(result.isError).toBeFalsy();
      expect(text).toContain('### good-aesthetic.com');
      expect(text).toContain('**ga-prod**');
      expect(text).toContain('live 1m');
      expect(text).toContain('no sandbox');
      // Not JSON — the whole point of the change.
      expect(text).not.toContain('"installId"');
    });

    it('caps output by default and says so', async () => {
      const many = [
        {
          wpeSiteId: 'site-A',
          name: 'big.com',
          installs: Array.from({ length: 120 }, (_, n) =>
            install({ installId: `inst-${n}`, installName: `big${n}` }),
          ),
        },
      ];
      const svc = services({ fleetAssembler: { listFleet: jest.fn().mockResolvedValue(many) } }, db);

      const text = (await listFleetHandler.execute({}, svc)).content[0].text;

      expect(text).toContain('120 install(s)');
      expect(text).toContain('Showing 50 of 120 installs');
      expect(text).toContain('**big49**');
      expect(text).not.toContain('**big50**');
    });

    it('honours an explicit limit', async () => {
      const many = [
        {
          wpeSiteId: 'site-A',
          name: 'big.com',
          installs: Array.from({ length: 5 }, (_, n) =>
            install({ installId: `inst-${n}`, installName: `big${n}` }),
          ),
        },
      ];
      const svc = services({ fleetAssembler: { listFleet: jest.fn().mockResolvedValue(many) } }, db);

      const text = (await listFleetHandler.execute({ limit: 2 }, svc)).content[0].text;

      expect(text).toContain('Showing 2 of 5 installs');
      expect(text).not.toContain('**big2**');
    });

    it('filters by environment', async () => {
      const groups = [
        {
          wpeSiteId: 'site-A',
          name: 'jeremy.com',
          installs: [
            install({ installName: 'wwwjeremy', environment: 'production' }),
            install({ installId: 'inst-2', installName: 'devjeremy', environment: 'development' }),
          ],
        },
      ];
      const svc = services({ fleetAssembler: { listFleet: jest.fn().mockResolvedValue(groups) } }, db);

      const text = (await listFleetHandler.execute({ environment: 'development' }, svc)).content[0].text;

      expect(text).toContain('**devjeremy**');
      expect(text).not.toContain('**wwwjeremy**');
    });

    it('filters by site name or install name', async () => {
      const groups = [
        { wpeSiteId: 'site-A', name: 'jeremy.com', installs: [install({ installName: 'wwwjeremy' })] },
        { wpeSiteId: 'site-B', name: 'other.com', installs: [install({ installId: 'inst-2', installName: 'wwwother' })] },
      ];
      const svc = services({ fleetAssembler: { listFleet: jest.fn().mockResolvedValue(groups) } }, db);

      const byGroup = (await listFleetHandler.execute({ site: 'jeremy' }, svc)).content[0].text;
      expect(byGroup).toContain('### jeremy.com');
      expect(byGroup).not.toContain('### other.com');

      const byInstall = (await listFleetHandler.execute({ site: 'wwwother' }, svc)).content[0].text;
      expect(byInstall).toContain('### other.com');
      expect(byInstall).not.toContain('### jeremy.com');
    });

    it('reports no match rather than an empty document', async () => {
      const svc = services({}, db);
      const text = (await listFleetHandler.execute({ site: 'nothing-like-this' }, svc)).content[0].text;
      expect(text).toContain('No WP Engine installs match');
    });

    it('lists the local sites reconciliation could not link', async () => {
      const svc = services({}, db);
      svc.siteLinkResolver.getLastReport.mockReturnValue({
        linked: [],
        unresolved: [{ localSiteId: 'local-9', localSiteName: 'orphan' }],
      });

      const text = (await listFleetHandler.execute({}, svc)).content[0].text;

      expect(text).toContain('### Unresolved local sites (1)');
      expect(text).toContain('orphan (site: local-9)');
      expect(text).toContain('nexus_link_site');
    });

    it('omits the unresolved section when there is nothing to report', async () => {
      const text = (await listFleetHandler.execute({}, services({}, db))).content[0].text;
      expect(text).not.toContain('Unresolved local sites');
    });

    it('is unavailable, not error-returning, when the assembler is absent', () => {
      expect(listFleetHandler.definition.isAvailable!(services({ fleetAssembler: undefined }, db))).toBe(false);
      expect(listFleetHandler.definition.isAvailable!(services({}, db))).toBe(true);
    });
  });

  describe('nexus_link_site', () => {
    it('records a user link, deriving the install name from the id', async () => {
      const svc = services({}, db);
      const result = await linkSiteHandler.execute({ site: 'local-1', install_id: 'inst-1' }, svc);

      expect(svc.siteLinkResolver.setManualLink).toHaveBeenCalledWith('local-1', 'inst-1', 'ga-prod');
      expect(result.isError).toBeFalsy();
    });

    it('ignores a caller-supplied install name — the stored name is an SSH target', async () => {
      const svc = services({}, db);
      await linkSiteHandler.execute(
        { site: 'local-1', install_id: 'inst-1', install_name: 'hallucinated' },
        svc,
      );

      expect(svc.siteLinkResolver.setManualLink).toHaveBeenCalledWith('local-1', 'inst-1', 'ga-prod');
    });

    it('rejects an install id no WPE install has', async () => {
      const svc = services({}, db);
      const result = await linkSiteHandler.execute({ site: 'local-1', install_id: 'inst-made-up' }, svc);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/no wp engine install with id/i);
      expect(svc.siteLinkResolver.setManualLink).not.toHaveBeenCalled();
    });

    it('does not match a local site row masquerading as an install', async () => {
      const svc = services({}, db);
      const result = await linkSiteHandler.execute({ site: 'local-1', install_id: 'local-1' }, svc);

      expect(result.isError).toBe(true);
      expect(svc.siteLinkResolver.setManualLink).not.toHaveBeenCalled();
    });

    it('rejects a missing install_id', async () => {
      const svc = services({}, db);
      const result = await linkSiteHandler.execute({ site: 'local-1' }, svc);

      expect(result.isError).toBe(true);
      expect(svc.siteLinkResolver.setManualLink).not.toHaveBeenCalled();
    });

    it('no longer requires install_name', () => {
      const schema = linkSiteHandler.definition.inputSchema as {
        required: string[];
        properties: Record<string, unknown>;
      };
      expect(schema.required).toEqual(['site', 'install_id']);
      expect(schema.properties.install_name).toBeUndefined();
    });

    it('errors clearly when the graph database is unavailable', async () => {
      const svc = services({ graphService: undefined });
      const result = await linkSiteHandler.execute({ site: 'local-1', install_id: 'inst-1' }, svc);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/graph database is not available/i);
    });
  });

  it('nexus_unlink_site clears the link', async () => {
    const svc = services({}, db);
    const result = await unlinkSiteHandler.execute({ site: 'local-1' }, svc);
    expect(svc.siteLinkResolver.clearLink).toHaveBeenCalledWith('local-1');
    expect(result.isError).toBeFalsy();
  });
});
