/**
 * Pipeline-status fold: task.run.completed (pipeline.run/1) -> twin_facts
 * `pipeline:<layer>` per site environment.
 *
 * The keystone of the 2026-08-23 pipeline-observability plan: every L1/L2/L3
 * run becomes a ledger event, and this fold materializes latest-status per
 * site x layer. History (rates, reasons over time) stays in the ledger; the
 * fold is a rebuildable cache like every other twin.
 */
import { Ledger } from '../ledger/ledger';
import { createEmitter } from '../emit/emitter';
import { catchUp } from '../folds/foldWorker';
import { createPipelineStatusFold } from '../folds/pipelineStatusFold';
import { TwinStore } from '../folds/twinStore';
import { EventDraft } from '../envelope/types';
import type { PipelineRunPayload } from '../folds/pipelineStatusFold';

const identity = {
  actor: () => ({ id: 'act_test', kind: 'system' as const }),
  via: () => 'sat_test_machine',
  tenant: () => 'local',
};

const ENV = 'ent_env_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function runCompleted(
  overrides: Partial<PipelineRunPayload> & { observedAt?: string; schema?: string } = {},
): EventDraft<Record<string, unknown>> {
  const { observedAt, schema, ...payload } = overrides;
  return {
    observed_at: observedAt ?? '2026-08-23T18:00:00.000Z',
    topic: 'task.run.completed',
    schema: schema ?? 'pipeline.run/1',
    entity: { environment: ENV },
    actor: { id: 'act_test', kind: 'system' },
    source: { class: 'platform', system: 'pipeline:wpe-ssh', trust: 'observed' },
    access: { tenant: 'local' },
    payload: {
      layer: 'l3',
      site_kind: 'wpe',
      outcome: 'ok',
      trigger: 'scheduled',
      duration_ms: 42000,
      ...payload,
    },
  };
}

function harness() {
  const ledger = new Ledger(':memory:');
  const emitter = createEmitter({ ledger, clock: { now: () => new Date() }, identity });
  const fold = createPipelineStatusFold();
  const twins = new TwinStore(ledger);
  return { ledger, emitter, fold, twins };
}

describe('pipelineStatusFold', () => {
  test('a completed run materializes as pipeline:<layer> with provenance', () => {
    const { ledger, emitter, fold, twins } = harness();

    const e = emitter.emit(runCompleted({ outcome: 'ok', duration_ms: 42000 }));
    expect(catchUp(ledger, fold)).toBe(1);

    const fact = twins.get(ENV, 'pipeline:l3');
    expect(fact?.value).toEqual({
      outcome: 'ok',
      trigger: 'scheduled',
      site_kind: 'wpe',
      duration_ms: 42000,
      finished_at: '2026-08-23T18:00:00.000Z',
    });
    expect(fact?.eventId).toBe(e.id);
    expect(fact?.sourceTrust).toBe('observed');
  });

  test('layers are independent facts on the same entity', () => {
    const { ledger, emitter, fold, twins } = harness();

    emitter.emit(runCompleted({ layer: 'l2', outcome: 'ok' }));
    emitter.emit(runCompleted({ layer: 'l3', outcome: 'fail', reason: 'ssh: Connection refused' }));
    catchUp(ledger, fold);

    expect((twins.get(ENV, 'pipeline:l2')?.value as any).outcome).toBe('ok');
    const l3 = twins.get(ENV, 'pipeline:l3')?.value as any;
    expect(l3.outcome).toBe('fail');
    expect(l3.reason).toBe('ssh: Connection refused');
  });

  test('a newer run replaces the fact; an older replay does not', () => {
    const { ledger, emitter, fold, twins } = harness();

    emitter.emit(runCompleted({ outcome: 'fail', reason: 'x', observedAt: '2026-08-23T18:00:00.000Z' }));
    catchUp(ledger, fold);
    emitter.emit(runCompleted({ outcome: 'ok', observedAt: '2026-08-23T19:00:00.000Z' }));
    catchUp(ledger, fold);
    expect((twins.get(ENV, 'pipeline:l3')?.value as any).outcome).toBe('ok');

    // An out-of-order arrival (backfill, replay) must not roll status backwards.
    emitter.emit(runCompleted({ outcome: 'fail', reason: 'stale', observedAt: '2026-08-23T17:00:00.000Z' }));
    catchUp(ledger, fold);
    expect((twins.get(ENV, 'pipeline:l3')?.value as any).outcome).toBe('ok');
  });

  // The fold shares the task.run. prefix with future task.run.* producers and
  // with task.run.completed events that are NOT pipeline runs. Skipped, never
  // guessed — the stateTwinFold rule.
  test('a task.run.completed with a different schema is skipped', () => {
    const { ledger, emitter, fold, twins } = harness();

    emitter.emit(runCompleted({ schema: 'agent.run/1' }));
    expect(catchUp(ledger, fold)).toBe(1); // consumed (cursor advances)…
    expect(twins.get(ENV, 'pipeline:l3')).toBeUndefined(); // …but no fact guessed
  });

  test('a payload with no recognisable layer is skipped, not guessed', () => {
    const { ledger, emitter, fold, twins } = harness();

    emitter.emit(runCompleted({ layer: 'l9' as any }));
    catchUp(ledger, fold);
    expect(twins.get(ENV, 'pipeline:l9')).toBeUndefined();
  });

  test('an event with no environment entity is skipped', () => {
    const { ledger, emitter, fold } = harness();
    const draft = runCompleted();
    draft.entity = {};

    emitter.emit(draft);
    expect(() => catchUp(ledger, fold)).not.toThrow();
  });

  test('reason is carried only when present — an ok run stores none', () => {
    const { ledger, emitter, fold, twins } = harness();

    emitter.emit(runCompleted({ outcome: 'skip', reason: 'thelocalshed is not running' }));
    catchUp(ledger, fold);

    const v = twins.get(ENV, 'pipeline:l3')?.value as any;
    expect(v.outcome).toBe('skip');
    expect(v.reason).toBe('thelocalshed is not running');
    expect('reason' in (runCompleted().payload as any)).toBe(false);
  });
});
