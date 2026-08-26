/**
 * fixes-082526 · Tier A 4b — the migration ladder gets its own suite.
 *
 * MIGRATIONS is the one file every deployed ledger.db passes through on every
 * open, and it was tested only by implication: every suite that constructs a
 * Ledger exercises the fresh-database path, and NOTHING exercised stepping an
 * older database up the ladder — the path every real user's file takes on
 * upgrade. (appendOnly.test.ts covers the v2→v3 step for the triggers; this
 * suite owns the ladder as a whole.)
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { Ledger } from '../ledger/ledger';
import { MIGRATIONS } from '../ledger/migrations';

const tmpFile = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-mig-')), 'ledger.db');

function schemaVersion(db: Database.Database): number {
  return Number(
    (db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as { value: string })
      .value
  );
}

function objectNames(db: Database.Database, type: string): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = ? ORDER BY name`).all(type) as {
      name: string;
    }[]
  )
    .map((r) => r.name)
    .filter((n) => !n.startsWith('sqlite_'));
}

describe('the migration ladder', () => {
  it('a fresh ledger lands at the top of the ladder with the full expected schema', () => {
    const ledger = new Ledger(':memory:');
    const db = ledger.raw();
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    const tables = objectNames(db, 'table');
    for (const t of ['events', 'fold_cursors', 'twin_facts', 'entities', 'entity_aliases', 'entity_links']) {
      expect(tables).toContain(t);
    }
    expect(objectNames(db, 'trigger')).toEqual(
      expect.arrayContaining(['events_append_only_no_update', 'events_append_only_no_delete'])
    );
    ledger.close();
  });

  it('every PARTIAL ladder position steps up to the top on open — the upgrade path itself', () => {
    // v0 is the fresh path (covered above); start from each intermediate rung.
    for (let stopAt = 1; stopAt < MIGRATIONS.length; stopAt++) {
      const file = tmpFile();
      const db = new Database(file);
      db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      for (let v = 0; v < stopAt; v++) db.exec(MIGRATIONS[v]);
      db.prepare(`INSERT INTO _meta (key, value) VALUES ('schema_version', ?)`).run(String(stopAt));
      db.close();

      const ledger = new Ledger(file);
      expect(schemaVersion(ledger.raw())).toBe(MIGRATIONS.length);
      // The rungs above stopAt actually applied, not just the version stamp:
      expect(objectNames(ledger.raw(), 'table')).toContain('entities'); // v2
      expect(objectNames(ledger.raw(), 'trigger')).toContain('events_append_only_no_delete'); // v3
      ledger.close();
    }
  });

  it('reopening an up-to-date ledger changes nothing and loses nothing', () => {
    const file = tmpFile();
    const first = new Ledger(file);
    first.raw().prepare(`INSERT INTO twin_facts (entity_id, fact, value, observed_at, source_trust, event_id)
       VALUES ('ent_env_x', 'plugin:a', '"1"', '2026-08-20T00:00:00.000Z', 'observed', 'evt_x')`).run();
    const before = schemaVersion(first.raw());
    first.close();
    const second = new Ledger(file);
    expect(schemaVersion(second.raw())).toBe(before);
    expect(second.raw().prepare('SELECT COUNT(*) AS n FROM twin_facts').get()).toEqual({ n: 1 });
    second.close();
  });

  it('the ladder only ever grows — a migration edited in place would corrupt deployed files', () => {
    // Not a snapshot of the SQL (that may legitimately be reformatted), but a
    // pin on the property upgrades depend on: each rung is idempotent when
    // re-run against a database already shaped by it (IF NOT EXISTS
    // discipline), so a version-stamp mismatch cannot brick an open.
    const db = new Database(':memory:');
    for (const step of MIGRATIONS) db.exec(step);
    for (const step of MIGRATIONS) expect(() => db.exec(step)).not.toThrow();
    db.close();
  });
});
