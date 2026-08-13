import Database from 'better-sqlite3';
import { SiteLinkStore } from '../../../src/main/fleet/SiteLinkStore';
import { SiteLinkResolver } from '../../../src/main/fleet/SiteLinkResolver';

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
});
