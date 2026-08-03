import Database from 'better-sqlite3';
import { applyTaxonomyMigration } from '../../../src/main/events/GraphService';

function makeLegacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL,
      wp_version TEXT, last_sync_at INTEGER, is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      source TEXT DEFAULT 'local', environment TEXT
    );
  `);
  const ins = db.prepare(
    `INSERT INTO sites (id,name,domain,created_at,updated_at,source,environment)
     VALUES (?,?,?,0,0,?,?)`,
  );
  ins.run('l1', 'Local One', 'l1.local', 'local', null);
  ins.run('w1', 'wpeprod', 'wpeprod.com', 'wpe', 'production');
  ins.run('w2', 'wpestage', 'wpestage.com', 'wpe', null);
  return db;
}

describe('taxonomy migration', () => {
  it('adds platform and host, and is idempotent', () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    applyTaxonomyMigration(db as any); // must not throw on a second run
    const cols = (db.prepare('PRAGMA table_info(sites)').all() as any[]).map(c => c.name);
    expect(cols).toContain('platform');
    expect(cols).toContain('host');
  });

  it("backfills platform='wordpress' for every row", () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    const rows = db.prepare('SELECT platform FROM sites').all() as any[];
    expect(rows.every(r => r.platform === 'wordpress')).toBe(true);
  });

  it('backfills host from source', () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    const get = (id: string) => (db.prepare('SELECT host FROM sites WHERE id=?').get(id) as any).host;
    expect(get('l1')).toBe('local');
    expect(get('w1')).toBe('wpe');
  });

  it("gives local sites environment='development' and leaves WPE environments untouched", () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    const get = (id: string) => (db.prepare('SELECT environment FROM sites WHERE id=?').get(id) as any).environment;
    expect(get('l1')).toBe('development');
    expect(get('w1')).toBe('production');
  });

  it("defaults a WPE row with no environment to 'production', the safe value", () => {
    const db = makeLegacyDb();
    applyTaxonomyMigration(db as any);
    const env = (db.prepare("SELECT environment FROM sites WHERE id='w2'").get() as any).environment;
    expect(env).toBe('production');
  });
});
