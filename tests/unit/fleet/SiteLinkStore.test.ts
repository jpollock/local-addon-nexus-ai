import Database from 'better-sqlite3';
import { SiteLinkStore } from '../../../src/main/fleet/SiteLinkStore';
import type { SiteLink } from '../../../src/main/fleet/types';

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
    CREATE INDEX idx_site_links_install ON site_links(wpe_install_id);
  `);
  return db;
}

const link: SiteLink = {
  localSiteId: 'local-1',
  wpeInstallId: 'inst-abc',
  wpeInstallName: 'goodaesthetic',
  linkSource: 'hostConnection',
  verifiedAt: 1_700_000_000_000,
};

describe('SiteLinkStore', () => {
  let db: Database.Database;
  let store: SiteLinkStore;

  beforeEach(() => {
    db = memoryDb();
    store = new SiteLinkStore(db);
  });

  afterEach(() => db.close());

  it('returns null for an unknown local site', () => {
    expect(store.get('nope')).toBeNull();
  });

  it('round-trips a link', () => {
    store.put(link);
    expect(store.get('local-1')).toEqual(link);
  });

  it('put replaces an existing row for the same local site', () => {
    store.put(link);
    store.put({ ...link, wpeInstallId: 'inst-xyz', wpeInstallName: 'other', linkSource: 'user' });

    expect(store.list()).toHaveLength(1);
    expect(store.get('local-1')?.wpeInstallId).toBe('inst-xyz');
    expect(store.get('local-1')?.linkSource).toBe('user');
  });

  it('getByInstall returns every local site pointing at one install, in a stable order', () => {
    // Inserted out of order — callers take [0] as "the" sandbox, so the order
    // must come from the query, not from however SQLite laid the pages out.
    store.put({ ...link, localSiteId: 'local-2' });
    store.put(link);

    const found = store.getByInstall('inst-abc').map((l) => l.localSiteId);
    expect(found).toEqual(['local-1', 'local-2']);
  });

  it('getByInstall returns an empty array for an unlinked install', () => {
    expect(store.getByInstall('inst-none')).toEqual([]);
  });

  it('remove deletes the row', () => {
    store.put(link);
    store.remove('local-1');
    expect(store.get('local-1')).toBeNull();
    expect(store.list()).toEqual([]);
  });
});
