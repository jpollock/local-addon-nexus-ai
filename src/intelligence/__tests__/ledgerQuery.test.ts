/**
 * Ledger query ordering.
 *
 * `order: 'desc'` is not a cosmetic default — every "recent events" reader
 * applies a row limit, and an ascending scan spends that limit on the OLDEST
 * events and silently drops the newest. This suite pins the direction so a
 * reader that asks for "the last N" gets the last N.
 */
import { Ledger } from '../ledger/ledger';
import { createEmitter } from '../emit/emitter';

test('query order: desc returns newest-first, so a hit limit drops OLD events, not new', () => {
  const ledger = new Ledger(':memory:');
  const emitter = createEmitter({
    ledger,
    clock: { now: () => new Date() },
    identity: { actor: () => ({ id: 'act_t', kind: 'system' }), via: () => 'sat_t', tenant: () => 'local' },
  });
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    ids.push(
      emitter.emit({
        observed_at: new Date().toISOString(),
        topic: 'state.plugin.observed',
        schema: 'plugin.observed/1',
        entity: { environment: 'ent_env_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        actor: { id: 'act_t', kind: 'system' },
        source: { class: 'platform', system: 't', trust: 'observed' },
        payload: { slug: `p${i}`, version: '1', active: true },
      }).id
    );
  }
  const asc = ledger.query({ topicPrefix: 'state.', limit: 3 });
  expect(asc.map((e) => e.id)).toEqual(ids.slice(0, 3)); // oldest 3 — the trap
  const desc = ledger.query({ topicPrefix: 'state.', order: 'desc', limit: 3 });
  expect(desc.map((e) => e.id)).toEqual([...ids.slice(-3)].reverse()); // newest 3
  ledger.close();
});
