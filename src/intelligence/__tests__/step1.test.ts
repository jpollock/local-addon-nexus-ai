/**
 * Step-1 smoke: envelope -> ledger -> emitter -> fold -> twin -> freshness.
 * Runs entirely in-memory (better-sqlite3 ':memory:').
 */
import { Ledger } from '../ledger/ledger';
import { createEmitter } from '../emit/emitter';
import { catchUp } from '../folds/foldWorker';
import { createPluginTwinFold, DriftNotice } from '../folds/pluginTwinFold';
import { TwinStore } from '../folds/twinStore';
import { EventDraft } from '../envelope/types';

const identity = {
  actor: () => ({ id: 'act_test', kind: 'system' as const }),
  via: () => 'sat_test_machine',
  tenant: () => 'local',
};

function pluginObserved(
  version: string,
  observedAt: string
): EventDraft<{ slug: string; version: string; active: boolean }> {
  return {
    observed_at: observedAt,
    topic: 'state.plugin.observed',
    schema: 'plugin.observed/1',
    entity: { environment: 'ent_env_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    actor: { id: 'act_test', kind: 'system' },
    source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
    access: { tenant: 'local' },
    payload: { slug: 'woocommerce', version, active: true },
  };
}

describe('intelligence core — step 1', () => {
  test('emit → ledger → fold → twin, with freshness and provenance', () => {
    const ledger = new Ledger(':memory:');
    const emitter = createEmitter({ ledger, clock: { now: () => new Date() }, identity });

    const e1 = emitter.emit(pluginObserved('9.8.0', '2026-08-14T10:00:00.000Z'));
    expect(e1.actor.via).toBe('sat_test_machine'); // ADR-14
    expect(ledger.count()).toBe(1);

    // idempotent replay
    expect(ledger.append(e1)).toBe(false);
    expect(ledger.count()).toBe(1);

    const drifts: DriftNotice[] = [];
    const fold = createPluginTwinFold((d) => drifts.push(d));
    expect(catchUp(ledger, fold)).toBe(1);

    const twins = new TwinStore(ledger);
    const fact = twins.get('ent_env_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'plugin:woocommerce');
    expect(fact?.value).toEqual({ version: '9.8.0', active: true });
    expect(fact?.eventId).toBe(e1.id); // provenance pointer
    expect(fact?.sourceTrust).toBe('observed');

    // newer observation updates + fires drift
    emitter.emit(pluginObserved('9.9.1', '2026-08-14T18:00:00.000Z'));
    catchUp(ledger, fold);
    expect(drifts).toHaveLength(1);
    expect(twins.get('ent_env_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'plugin:woocommerce')?.value).toEqual({
      version: '9.9.1',
      active: true,
    });

    // OUT-OF-ORDER: older observation must not overwrite (observed_at wins)
    emitter.emit(pluginObserved('9.7.0', '2026-08-14T09:00:00.000Z'));
    catchUp(ledger, fold);
    const finalFact = twins.get('ent_env_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'plugin:woocommerce');
    expect((finalFact?.value as { version: string }).version).toBe('9.9.1');

    // freshness computes from observed_at against the plugin SLO (8h)
    const fresh = twins.freshness(finalFact!, new Date('2026-08-14T19:00:00.000Z'));
    expect(fresh.fresh).toBe(true);
    const stale = twins.freshness(finalFact!, new Date('2026-08-15T18:00:00.000Z'));
    expect(stale.fresh).toBe(false);

    // audit: rejects an envelope missing provenance
    expect(() =>
      ledger.append({ ...e1, id: 'evt_01ARZ3NDEKTSV4RRFFQ69G5FBB', source: undefined as never })
    ).toThrow();

    ledger.close();
  });
});
