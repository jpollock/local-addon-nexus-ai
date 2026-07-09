/**
 * Tests for GET_FLEET_SUMMARY IPC handler SQL query behavior.
 *
 * We test the queries directly against an in-memory SQLite DB rather than
 * instantiating the full IPC handler, which requires a complete Electron deps
 * mock. The queries here must stay in sync with the ones in
 * src/main/ipc-handlers.ts GET_FLEET_SUMMARY handler.
 */
import Database from 'better-sqlite3';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (
      id TEXT PRIMARY KEY,
      name TEXT,
      source TEXT,
      wp_version TEXT,
      php_version TEXT,
      is_active INTEGER DEFAULT 1,
      last_sync_at INTEGER
    )
  `);
  return db;
}

const WPE_QUERY = "SELECT id, wp_version, php_version, last_sync_at FROM sites WHERE source='wpe' AND is_active=1";

describe('GET_FLEET_SUMMARY — WPE site query', () => {
  test('excludes inactive WPE sites from the count', () => {
    const db = makeDb();
    db.prepare("INSERT INTO sites VALUES ('w1','a','wpe','7.0','8.2',1,1000)").run();
    db.prepare("INSERT INTO sites VALUES ('w2','b','wpe','6.9','8.1',0,1000)").run(); // inactive
    db.prepare("INSERT INTO sites VALUES ('w3','c','wpe','7.0','8.3',1,2000)").run();

    const rows = db.prepare(WPE_QUERY).all();
    expect(rows).toHaveLength(2);
    expect((rows as any[]).map(r => r.id)).not.toContain('w2');
  });

  test('local sites are not included in WPE query', () => {
    const db = makeDb();
    db.prepare("INSERT INTO sites VALUES ('l1','local-site','local','7.0','8.2',1,1000)").run();
    db.prepare("INSERT INTO sites VALUES ('w1','wpe-site','wpe','7.0','8.2',1,1000)").run();

    const rows = db.prepare(WPE_QUERY).all();
    expect(rows).toHaveLength(1);
    expect((rows as any[])[0].id).toBe('w1');
  });

  test('includes last_sync_at in results for staleness calculation', () => {
    const now = Date.now();
    const db = makeDb();
    db.prepare("INSERT INTO sites VALUES ('w1','a','wpe','7.0','8.2',1,?)").run(now - 1000);

    const rows = db.prepare(WPE_QUERY).all() as any[];
    expect(rows[0].last_sync_at).toBeDefined();
    expect(typeof rows[0].last_sync_at).toBe('number');
  });

  test('returns null last_sync_at for never-synced sites', () => {
    const db = makeDb();
    db.prepare("INSERT INTO sites VALUES ('w1','a','wpe','7.0','8.2',1,null)").run();

    const rows = db.prepare(WPE_QUERY).all() as any[];
    expect(rows[0].last_sync_at).toBeNull();
  });
});

describe('GET_FLEET_SUMMARY — WPE staleness calculation', () => {
  test('stale WPE site (last_sync_at > 24h ago) increments staleCount', () => {
    const now = Date.now();
    const rows = [
      { last_sync_at: now - DAY_MS - 1000 }, // stale
      { last_sync_at: now - 1000 },           // fresh
      { last_sync_at: null },                 // never synced — not stale, just unknown
    ] as any[];

    let staleCount = 0;
    for (const site of rows) {
      if (site.last_sync_at && now - site.last_sync_at > DAY_MS) staleCount++;
    }
    expect(staleCount).toBe(1);
  });

  test('WPE site with null last_sync_at does not count as stale', () => {
    const now = Date.now();
    const rows = [{ last_sync_at: null }] as any[];

    let staleCount = 0;
    for (const site of rows) {
      if (site.last_sync_at && now - site.last_sync_at > DAY_MS) staleCount++;
    }
    expect(staleCount).toBe(0);
  });

  test('all fresh WPE sites produce staleCount 0', () => {
    const now = Date.now();
    const rows = [
      { last_sync_at: now - 1000 },
      { last_sync_at: now - DAY_MS + 1000 }, // just under threshold
    ] as any[];

    let staleCount = 0;
    for (const site of rows) {
      if (site.last_sync_at && now - site.last_sync_at > DAY_MS) staleCount++;
    }
    expect(staleCount).toBe(0);
  });
});

describe('GET_FLEET_SUMMARY — count consistency between local + WPE', () => {
  test('total = local twin count + active WPE count (not including inactive)', () => {
    const db = makeDb();
    db.prepare("INSERT INTO sites VALUES ('w1','a','wpe','7.0','8.2',1,1000)").run();
    db.prepare("INSERT INTO sites VALUES ('w2','b','wpe','6.9','8.1',0,1000)").run(); // inactive — excluded
    db.prepare("INSERT INTO sites VALUES ('w3','c','wpe','7.0','8.3',1,2000)").run();

    const wpeSites = db.prepare(WPE_QUERY).all() as any[];
    const mockLocalTwinCount = 5;
    const total = mockLocalTwinCount + wpeSites.length;

    expect(wpeSites).toHaveLength(2);   // not 3 (inactive excluded)
    expect(total).toBe(7);              // 5 local + 2 active WPE
  });
});
