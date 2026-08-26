/**
 * fixes-082526 · Tier A 1 — "rebuildable from the ledger" becomes exercisable.
 *
 * ADR-1 and §4.3 state the twin is "rebuildable from the ledger at any time —
 * a cache by construction". Until this module, no shipped code could DO it:
 * the property lived in a manual replay harness and had never been proven by
 * a round-trip inside the product. These tests are that round-trip.
 *
 * The strong assertion is byte-equality: rebuild after corruption must
 * reproduce EXACTLY the rows the folds originally materialised — same values,
 * same provenance pointers, same observed_at. Anything less would be a new
 * cache, not a rebuilt one.
 */
import { Ledger } from '../ledger/ledger';
import { createEmitter } from '../emit/emitter';
import { catchUp, Fold } from '../folds/foldWorker';
import { createPluginTwinFold } from '../folds/pluginTwinFold';
import { rebuildTwins } from '../folds/rebuild';
import { EventDraft } from '../envelope/types';

const identity = {
  actor: () => ({ id: 'act_test', kind: 'system' as const }),
  via: () => 'sat_test_machine',
  tenant: () => 'local',
};

const ENV = 'ent_env_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function pluginObserved(slug: string, version: string, observedAt: string): EventDraft<{ slug: string; version: string; active: boolean }> {
  return {
    observed_at: observedAt,
    topic: 'state.plugin.observed',
    schema: 'plugin.observed/1',
    entity: { environment: ENV },
    actor: { id: 'act_test', kind: 'system' },
    source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
    access: { tenant: 'local' },
    payload: { slug, version, active: true },
  };
}

function seeded(): { ledger: Ledger; folds: Fold[] } {
  const ledger = new Ledger(':memory:');
  const emitter = createEmitter({ ledger, clock: { now: () => new Date() }, identity });
  emitter.emit(pluginObserved('woocommerce', '9.8.0', '2026-08-14T10:00:00.000Z'));
  emitter.emit(pluginObserved('woocommerce', '9.9.1', '2026-08-14T18:00:00.000Z'));
  emitter.emit(pluginObserved('akismet', '5.0', '2026-08-15T08:00:00.000Z'));
  const folds: Fold[] = [createPluginTwinFold(() => {})];
  for (const f of folds) catchUp(ledger, f);
  return { ledger, folds };
}

const rows = (ledger: Ledger) =>
  ledger.raw().prepare('SELECT * FROM twin_facts ORDER BY entity_id, fact').all();

describe('rebuildTwins — the round-trip that makes the ADR claim true', () => {
  it('reproduces the materialised rows byte-for-byte after corruption', () => {
    const { ledger, folds } = seeded();
    const before = rows(ledger);
    expect(before.length).toBeGreaterThan(0);

    // Corrupt the view three ways: a mutated value, a deleted row, a row the
    // ledger never produced. Exactly what "never authoritative" permits.
    const db = ledger.raw();
    db.prepare(`UPDATE twin_facts SET value = '"tampered"' WHERE fact = 'plugin:akismet'`).run();
    db.prepare(`DELETE FROM twin_facts WHERE fact = 'plugin:woocommerce'`).run();
    db.prepare(
      `INSERT INTO twin_facts (entity_id, fact, value, observed_at, source_trust, event_id)
       VALUES ('ent_env_bogus', 'plugin:phantom', '"1.0"', '2026-08-15T00:00:00.000Z', 'observed', 'evt_none')`,
    ).run();
    expect(rows(ledger)).not.toEqual(before);

    const result = rebuildTwins(ledger, folds);

    expect(rows(ledger)).toEqual(before);          // the whole claim, in one line
    expect(result.eventsReplayed).toBe(3);
    expect(result.twinsAfter).toBe(before.length);
    expect(result.folds).toEqual(['plugin-twin/1']); // the fold names carry their version
  });

  it('resets every fold cursor, so the replay is from event zero — nothing inherited', () => {
    const { ledger, folds } = seeded();
    rebuildTwins(ledger, folds);
    const cursors = ledger.raw().prepare('SELECT fold, last_event_id FROM fold_cursors').all() as Array<{ fold: string; last_event_id: string }>;
    expect(cursors).toHaveLength(1);
    const lastEvent = ledger.raw().prepare('SELECT id FROM events ORDER BY id DESC LIMIT 1').get() as { id: string };
    expect(cursors[0].last_event_id).toBe(lastEvent.id);
  });

  it('is idempotent — a second rebuild changes nothing', () => {
    const { ledger, folds } = seeded();
    rebuildTwins(ledger, folds);
    const first = rows(ledger);
    const again = rebuildTwins(ledger, folds);
    expect(rows(ledger)).toEqual(first);
    expect(again.eventsReplayed).toBe(3);
  });

  it('an empty ledger rebuilds to an empty view without throwing', () => {
    const ledger = new Ledger(':memory:');
    const result = rebuildTwins(ledger, [createPluginTwinFold(() => {})]);
    expect(result.eventsReplayed).toBe(0);
    expect(result.twinsAfter).toBe(0);
    expect(rows(ledger)).toEqual([]);
  });
});
