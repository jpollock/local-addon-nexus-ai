/**
 * One-shot graph.db backfill.
 *
 * Two properties matter here and both are invariants, not preferences: rows
 * are seeded with their REAL `updated_at` as `observed_at` (stamping "now" on
 * old graph rows is the data laundering CLAUDE.md forbids), and soft-deleted
 * rows (`is_active = 0`) never enter the ledger — `nexus host remove` and the
 * WPE sweep both soft-delete, so a backfill that ignored the flag would
 * resurrect removed sites into every twin-backed reader.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore } from '../bootstrap';
import { runGraphBackfill } from '../graphBackfill';

function fakeGraphDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
      php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER);
    CREATE TABLE plugins (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
    CREATE TABLE themes (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
  `);
  const t = Date.now() - 3600_000; // observed an hour ago
  db.prepare(`INSERT INTO sites VALUES ('localwpe','localwpe','a.com','7.0','8.3','wpe',?,1)`).run(t);
  db.prepare(`INSERT INTO sites VALUES ('jppblank','jppblank','b.com','6.9',NULL,'local',?,1)`).run(t);
  db.prepare(`INSERT INTO sites VALUES ('removedhost','removedhost','c.com','6.8',NULL,'external',?,0)`).run(t);
  db.prepare(`INSERT INTO plugins VALUES ('localwpe','woocommerce','9.9.1',1,?)`).run(t);
  db.prepare(`INSERT INTO plugins VALUES ('jppblank','woocommerce','9.8.0',1,?)`).run(t);
  db.prepare(`INSERT INTO plugins VALUES ('removedhost','woocommerce','9.0.0',1,?)`).run(t); // must be excluded
  db.prepare(`INSERT INTO themes VALUES ('localwpe','twentytwentyfive','2.1',1,?)`).run(t);
  return db;
}

test('backfill seeds twins from active graph rows; soft-deleted excluded; fleet reads work', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-bf-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
  const graphDb = fakeGraphDb();

  const result = runGraphBackfill(core, graphDb, { info: () => {}, error: () => {} });
  expect(result).toEqual({ sites: 2, plugins: 2, themes: 1, emitted: 5, skippedNoTime: 0 }); // removedhost excluded entirely

  await new Promise((r) => setTimeout(r, 700)); // debounced fold

  // Fleet read primitive: which environments run woocommerce?
  const woo = core.twins.byFact('plugin:woocommerce');
  expect(woo).toHaveLength(2);
  const versions = woo.map((f) => (f.value as { version: string }).version).sort();
  expect(versions).toEqual(['9.8.0', '9.9.1']);

  // observed_at came from the row, not from "now"
  const ageS = (Date.now() - Date.parse(woo[0].observedAt)) / 1000;
  expect(ageS).toBeGreaterThan(3000);

  // Idempotent: a second backfill emits nothing (change gate + twins)
  const again = runGraphBackfill(core, graphDb, { info: () => {}, error: () => {} });
  expect(again.emitted).toBe(0);

  // search() prefix read
  expect(core.twins.search('site.').length).toBe(2);
  core.close();
  graphDb.close();
});
