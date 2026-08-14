import Database from 'better-sqlite3';
import { SiteLinkStore } from '../../../src/main/fleet/SiteLinkStore';
import { RESOLVE_TIMEOUT_MS, SiteLinkResolver } from '../../../src/main/fleet/SiteLinkResolver';

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

const SITES = {
  'local-1': { id: 'local-1', name: 'good-aesthetic', path: '/a', domain: 'a.local' },
  'local-2': { id: 'local-2', name: 'orphan', path: '/b', domain: 'b.local' },
};

describe('SiteLinkResolver.reconcileAll', () => {
  let db: Database.Database;
  let store: SiteLinkStore;

  beforeEach(() => {
    db = memoryDb();
    store = new SiteLinkStore(db);
  });

  afterEach(() => db.close());

  it('links what CAPI resolves and reports what it cannot', async () => {
    const bridge = {
      resolveWpeInstall: jest.fn(async (id: string) =>
        id === 'local-1'
          ? {
              installName: 'goodaesthetic',
              installId: 'inst-abc',
              remoteSiteId: 'site-uuid',
              primaryDomain: 'good-aesthetic.com',
              environment: 'production',
            }
          : null,
      ),
    } as any;

    const resolver = new SiteLinkResolver(store, bridge);
    const report = await resolver.reconcileAll(SITES);

    expect(report.linked.map((l) => l.localSiteId)).toEqual(['local-1']);
    expect(report.unresolved).toEqual([{ localSiteId: 'local-2', localSiteName: 'orphan' }]);
    expect(store.list()).toHaveLength(1);
  });

  it('one site failing to resolve does not abort the sweep', async () => {
    const bridge = {
      resolveWpeInstall: jest.fn(async (id: string) => {
        if (id === 'local-1') throw new Error('CAPI exploded');
        return {
          installName: 'orphanname',
          installId: 'inst-two',
          remoteSiteId: 'site-two',
          primaryDomain: 'b.com',
        };
      }),
    } as any;

    const resolver = new SiteLinkResolver(store, bridge);
    const report = await resolver.reconcileAll(SITES);

    expect(report.linked.map((l) => l.localSiteId)).toEqual(['local-2']);
    expect(report.unresolved).toEqual([
      { localSiteId: 'local-1', localSiteName: 'good-aesthetic' },
    ]);
  });

  it('a CAPI call that never returns does not stall the sweep', async () => {
    jest.useFakeTimers();
    try {
      const bridge = {
        resolveWpeInstall: jest.fn((id: string) =>
          id === 'local-1'
            ? new Promise(() => {
                /* never settles — captive portal, hung VPN */
              })
            : Promise.resolve({
                installName: 'orphanname',
                installId: 'inst-two',
                remoteSiteId: 'site-two',
                primaryDomain: 'b.com',
              }),
        ),
      } as any;

      const resolver = new SiteLinkResolver(store, bridge);
      const pending = resolver.reconcileAll(SITES);
      await jest.advanceTimersByTimeAsync(RESOLVE_TIMEOUT_MS + 1);
      const report = await pending;

      expect(report.unresolved).toEqual([
        { localSiteId: 'local-1', localSiteName: 'good-aesthetic' },
      ]);
      expect(report.linked.map((l) => l.localSiteId)).toEqual(['local-2']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('remembers the last report so callers can surface the unresolved', async () => {
    const bridge = { resolveWpeInstall: jest.fn().mockResolvedValue(null) } as any;
    const resolver = new SiteLinkResolver(store, bridge);

    expect(resolver.getLastReport()).toBeNull();
    const report = await resolver.reconcileAll(SITES);
    resolver.setLastReport(report);
    expect(resolver.getLastReport()?.unresolved).toHaveLength(2);
  });
});
