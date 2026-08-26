/**
 * fixes-082526 · Tier A 3 — `events` append-only becomes ENFORCED, not asserted.
 *
 * The header of ledger.ts has said "events are immutable" since v1, while
 * `raw()` hands the live connection to 20 call sites (and every future one)
 * with nothing stopping an UPDATE or DELETE. Discipline held because nothing
 * had slipped yet — which is a description of luck, not a property.
 *
 * The guard is a pair of SQLite triggers (migration v3), so it binds at the
 * only chokepoint every writer shares: the database itself. TypeScript can't
 * see into a SQL string; the engine can.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Ledger } from '../ledger/ledger';
import { createEmitter } from '../emit/emitter';
import { EventDraft } from '../envelope/types';

const identity = {
  actor: () => ({ id: 'act_test', kind: 'system' as const }),
  via: () => 'sat_test_machine',
  tenant: () => 'local',
};

function draft(): EventDraft<{ slug: string; version: string; active: boolean }> {
  return {
    observed_at: '2026-08-20T10:00:00.000Z',
    topic: 'state.plugin.observed',
    schema: 'plugin.observed/1',
    entity: { environment: 'ent_env_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    actor: { id: 'act_test', kind: 'system' },
    source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
    access: { tenant: 'local' },
    payload: { slug: 'akismet', version: '5.3', active: true },
  };
}

function seeded(): Ledger {
  const ledger = new Ledger(':memory:');
  createEmitter({ ledger, clock: { now: () => new Date() }, identity }).emit(draft());
  return ledger;
}

describe('events is append-only — enforced by the database, not by discipline', () => {
  it('refuses UPDATE through the raw() escape hatch', () => {
    const ledger = seeded();
    expect(() => ledger.raw().prepare(`UPDATE events SET payload = '{}'`).run()).toThrow(
      /append-only/
    );
    ledger.close();
  });

  it('refuses DELETE through the raw() escape hatch', () => {
    const ledger = seeded();
    expect(() => ledger.raw().prepare('DELETE FROM events').run()).toThrow(/append-only/);
    expect(ledger.count()).toBe(1); // the row survived the attempt
    ledger.close();
  });

  it('append and idempotent re-append still work — the guard blocks mutation, not the ledger', () => {
    const ledger = seeded();
    const events = ledger.query({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(ledger.append(events[0])).toBe(false); // INSERT OR IGNORE no-op, untouched by the triggers
    expect(ledger.count()).toBe(1);
    ledger.close();
  });

  it('an EXISTING ledger gains the guard on reopen — the migration reaches deployed files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-ao-'));
    const file = path.join(dir, 'ledger.db');
    // Simulate a pre-guard database: real schema, triggers stripped, version pinned back.
    const first = new Ledger(file);
    createEmitter({ ledger: first, clock: { now: () => new Date() }, identity }).emit(draft());
    const db = first.raw();
    for (const row of db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'events'`)
      .all() as { name: string }[]) {
      db.exec(`DROP TRIGGER ${row.name}`);
    }
    db.prepare(`UPDATE _meta SET value = ? WHERE key = 'schema_version'`).run('2');
    first.close();

    const reopened = new Ledger(file); // migrate() runs in the constructor
    expect(() => reopened.raw().prepare('DELETE FROM events').run()).toThrow(/append-only/);
    expect(reopened.count()).toBe(1);
    reopened.close();
  });
});
