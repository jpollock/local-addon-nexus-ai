import Database from 'better-sqlite3';
import { WPESyncService } from '../../../src/main/events/WPESyncService';

/**
 * `wpe_site_id` is the grain the fleet list groups on — production, staging and
 * development installs of one site belong under one row. syncFromCAPI is the
 * Tier-1 sync that always runs, and it used to write the column on neither the
 * insert nor the update path, so a machine that had only ever run it saw every
 * install as a group of one.
 */
describe('WPESyncService.syncFromCAPI — writes the WPE site container id', () => {
  function memoryDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sites (
        id                TEXT PRIMARY KEY,
        name              TEXT,
        domain            TEXT,
        wp_version        TEXT,
        php_version       TEXT,
        account_id        TEXT,
        last_sync_at      INTEGER,
        is_active         INTEGER,
        created_at        INTEGER,
        updated_at        INTEGER,
        source            TEXT,
        environment       TEXT,
        remote_install_id TEXT,
        remote_domain     TEXT,
        wpe_site_id       TEXT
      );
    `);
    return db;
  }

  const INSTALLS = [
    { id: 'inst-prod', name: 'wwwjeremy', environment: 'production', primary_domain: 'jeremy.com', site: { id: 'site-A' } },
    { id: 'inst-dev', name: 'devjeremy', environment: 'development', primary_domain: 'dev.jeremy.com', site: { id: 'site-A' } },
  ];

  function makeService(db: Database.Database) {
    const upsertSite = jest.fn(async (site: any) => {
      db.prepare(
        `INSERT INTO sites (id, name, domain, is_active, created_at, updated_at, source, environment, remote_install_id, wpe_site_id)
         VALUES (?, ?, ?, 1, ?, ?, 'wpe', ?, ?, ?)`,
      ).run(site.id, site.name, site.domain, site.created_at, site.updated_at, site.environment, site.remote_install_id, site.wpe_site_id ?? null);
    });
    const graphService: any = {
      getDb: () => db,
      upsertSite,
      upsertAccount: jest.fn().mockResolvedValue(undefined),
    };
    const localServices: any = {
      isCAPIAvailable: () => true,
      capiGetAccounts: jest.fn().mockResolvedValue([]),
      capiGetInstalls: jest.fn().mockResolvedValue(INSTALLS),
    };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const service = new WPESyncService({ graphService, localServices, logger });
    return { service, upsertSite };
  }

  it('writes wpe_site_id on the insert path so new installs group', async () => {
    const db = memoryDb();
    try {
      const { service, upsertSite } = makeService(db);
      await service.syncFromCAPI();

      expect(upsertSite).toHaveBeenCalledWith(expect.objectContaining({ id: 'wpe-inst-prod', wpe_site_id: 'site-A' }));
      expect(upsertSite).toHaveBeenCalledWith(expect.objectContaining({ id: 'wpe-inst-dev', wpe_site_id: 'site-A' }));

      const ids = db.prepare('SELECT DISTINCT wpe_site_id FROM sites').all() as Array<{ wpe_site_id: string }>;
      expect(ids).toEqual([{ wpe_site_id: 'site-A' }]);
    } finally {
      db.close();
    }
  });

  it('backfills wpe_site_id on rows that predate it', async () => {
    const db = memoryDb();
    try {
      // Rows written by an earlier sync that never set the column.
      for (const i of INSTALLS) {
        db.prepare(
          `INSERT INTO sites (id, name, domain, is_active, created_at, updated_at, source, environment, remote_install_id, wpe_site_id)
           VALUES (?, ?, ?, 1, 0, 0, 'wpe', ?, ?, NULL)`,
        ).run(`wpe-${i.id}`, i.name, i.primary_domain, i.environment, i.id);
      }

      const { service, upsertSite } = makeService(db);
      await service.syncFromCAPI();

      expect(upsertSite).not.toHaveBeenCalled();
      const rows = db
        .prepare('SELECT id, wpe_site_id FROM sites ORDER BY id')
        .all() as Array<{ id: string; wpe_site_id: string | null }>;
      expect(rows).toEqual([
        { id: 'wpe-inst-dev', wpe_site_id: 'site-A' },
        { id: 'wpe-inst-prod', wpe_site_id: 'site-A' },
      ]);
    } finally {
      db.close();
    }
  });
});
