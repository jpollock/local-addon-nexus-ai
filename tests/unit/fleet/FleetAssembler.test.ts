import Database from 'better-sqlite3';
import { SiteLinkStore } from '../../../src/main/fleet/SiteLinkStore';
import { FleetAssembler } from '../../../src/main/fleet/FleetAssembler';

function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE site_links (
      local_site_id    TEXT PRIMARY KEY,
      wpe_install_id   TEXT NOT NULL,
      wpe_install_name TEXT NOT NULL,
      link_source      TEXT NOT NULL,
      verified_at      INTEGER
    );
  `);
  return db;
}

const NOW = 1_800_000_000_000;

function graphWith(rows: unknown[]) {
  return { listSites: jest.fn().mockResolvedValue(rows) } as any;
}

const SITE_DATA = {
  getSite: (id: string) =>
    id === 'local-1'
      ? { id: 'local-1', name: 'good-aesthetic sandbox', path: '/a', domain: 'a.local' }
      : null,
} as any;

describe('FleetAssembler', () => {
  let db: Database.Database;
  let store: SiteLinkStore;

  beforeEach(() => {
    db = memoryDb();
    store = new SiteLinkStore(db);
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    db.close();
  });

  it('groups installs under their WPE site', async () => {
    const graph = graphWith([
      { id: 'i1', name: 'ga-prod', remote_install_id: 'inst-1', environment: 'production', wpe_site_id: 'site-A', domain: 'a.com', last_sync_at: NOW - 60_000 },
      { id: 'i2', name: 'ga-stg', remote_install_id: 'inst-2', environment: 'staging', wpe_site_id: 'site-A', domain: 'stg.a.com', last_sync_at: NOW - 60_000 },
      { id: 'i3', name: 'other', remote_install_id: 'inst-3', environment: 'production', wpe_site_id: 'site-B', domain: 'b.com', last_sync_at: NOW - 60_000 },
    ]);

    const groups = await new FleetAssembler(graph, store, SITE_DATA).listFleet();

    expect(groups).toHaveLength(2);
    expect(groups[0].installs.map((i) => i.installName)).toEqual(['ga-prod', 'ga-stg']);
    expect(groups[1].installs.map((i) => i.installName)).toEqual(['other']);
  });

  it('attaches a linked sandbox to its install', async () => {
    store.put({
      localSiteId: 'local-1',
      wpeInstallId: 'inst-1',
      wpeInstallName: 'ga-prod',
      linkSource: 'user',
      verifiedAt: NOW,
    });
    const graph = graphWith([
      { id: 'i1', name: 'ga-prod', remote_install_id: 'inst-1', environment: 'production', wpe_site_id: 'site-A', domain: 'a.com', last_sync_at: NOW },
    ]);

    const [group] = await new FleetAssembler(graph, store, SITE_DATA).listFleet();

    expect(group.installs[0].sandbox).toEqual({
      localSiteId: 'local-1',
      localSiteName: 'good-aesthetic sandbox',
      linkSource: 'user',
    });
  });

  it('reports no sandbox when nothing is linked', async () => {
    const graph = graphWith([
      { id: 'i1', name: 'ga-prod', remote_install_id: 'inst-1', environment: 'production', wpe_site_id: 'site-A', domain: 'a.com', last_sync_at: NOW },
    ]);
    const [group] = await new FleetAssembler(graph, store, SITE_DATA).listFleet();
    expect(group.installs[0].sandbox).toBeNull();
  });

  it('derives provenance from last_sync_at', async () => {
    const graph = graphWith([
      { id: 'i1', name: 'fresh', remote_install_id: 'inst-1', environment: 'production', wpe_site_id: 'site-A', domain: 'a.com', last_sync_at: NOW - 60_000 },
      { id: 'i2', name: 'stale', remote_install_id: 'inst-2', environment: 'production', wpe_site_id: 'site-B', domain: 'b.com', last_sync_at: NOW - 4 * 86_400_000 },
      { id: 'i3', name: 'never', remote_install_id: 'inst-3', environment: 'production', wpe_site_id: 'site-C', domain: 'c.com', last_sync_at: null },
    ]);

    const groups = await new FleetAssembler(graph, store, SITE_DATA).listFleet();
    const byName = Object.fromEntries(
      groups.flatMap((g) => g.installs).map((i) => [i.installName, i.provenance]),
    );

    expect(byName.fresh.level).toBe('live');
    expect(byName.fresh.ageSeconds).toBe(60);
    expect(byName.stale.level).toBe('configured');
    expect(byName.never.level).toBe('scanned');
    expect(byName.never.ageSeconds).toBeNull();
    expect(byName.never.caveat).toBeTruthy();
  });

  it('asks the graph only for WPE-sourced sites', async () => {
    const graph = graphWith([]);
    await new FleetAssembler(graph, store, SITE_DATA).listFleet();
    expect(graph.listSites).toHaveBeenCalledWith({ source: 'wpe', active_only: true });
  });
});
