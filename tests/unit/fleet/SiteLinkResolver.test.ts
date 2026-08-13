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

function fakeBridge(install: unknown) {
  return { resolveWpeInstall: jest.fn().mockResolvedValue(install) } as any;
}

const INSTALL = {
  installName: 'goodaesthetic',
  installId: 'inst-abc',
  remoteSiteId: 'site-uuid',
  primaryDomain: 'good-aesthetic.com',
  environment: 'production',
};

describe('SiteLinkResolver', () => {
  let db: Database.Database;
  let store: SiteLinkStore;

  beforeEach(() => {
    db = memoryDb();
    store = new SiteLinkStore(db);
  });

  afterEach(() => db.close());

  it('writes a hostConnection link when CAPI resolves the site', async () => {
    const resolver = new SiteLinkResolver(store, fakeBridge(INSTALL));
    const link = await resolver.resolveOne('local-1');

    expect(link).toMatchObject({
      localSiteId: 'local-1',
      wpeInstallId: 'inst-abc',
      wpeInstallName: 'goodaesthetic',
      linkSource: 'hostConnection',
    });
    expect(typeof link!.verifiedAt).toBe('number');
    expect(store.get('local-1')).toEqual(link);
  });

  it('returns null and writes nothing when CAPI cannot resolve the site', async () => {
    const resolver = new SiteLinkResolver(store, fakeBridge(null));
    expect(await resolver.resolveOne('local-1')).toBeNull();
    expect(store.get('local-1')).toBeNull();
  });

  it('never overwrites a user link with a resolved one', async () => {
    store.put({
      localSiteId: 'local-1',
      wpeInstallId: 'inst-chosen-by-human',
      wpeInstallName: 'humanchoice',
      linkSource: 'user',
      verifiedAt: 1,
    });

    const bridge = fakeBridge(INSTALL);
    const resolver = new SiteLinkResolver(store, bridge);
    const link = await resolver.resolveOne('local-1');

    expect(link!.wpeInstallId).toBe('inst-chosen-by-human');
    expect(link!.linkSource).toBe('user');
    expect(bridge.resolveWpeInstall).not.toHaveBeenCalled();
  });

  it('setManualLink writes a user link that survives a later resolve', async () => {
    const resolver = new SiteLinkResolver(store, fakeBridge(INSTALL));
    resolver.setManualLink('local-1', 'inst-manual', 'manualname');

    expect(store.get('local-1')?.linkSource).toBe('user');
    await resolver.resolveOne('local-1');
    expect(store.get('local-1')?.wpeInstallId).toBe('inst-manual');
  });

  it('clearLink removes the link so resolution can run again', async () => {
    const resolver = new SiteLinkResolver(store, fakeBridge(INSTALL));
    resolver.setManualLink('local-1', 'inst-manual', 'manualname');
    resolver.clearLink('local-1');

    const link = await resolver.resolveOne('local-1');
    expect(link!.wpeInstallId).toBe('inst-abc');
  });
});
