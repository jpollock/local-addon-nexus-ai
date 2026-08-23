/**
 * Pipeline-status fold: `task.run.completed` (schema `pipeline.run/1`) ->
 * twin_facts `pipeline:<layer>` per site environment.
 *
 * The data-pipeline observability keystone (plan 2026-08-23). Every L1/L2/L3
 * run over any site — local, WP Engine, external SSH — is emitted as one
 * task.run.completed event; this fold materializes the LATEST outcome per
 * site x layer. History stays in the ledger, which is where success rates and
 * failure-reason rankings are computed from; this view answers only "what is
 * the current state of each site's pipeline, and when was it last true".
 *
 * `task.run.` is a shared prefix: agent-task producers (WP-19) emit
 * task.action.executed / task.outcome.recorded today and may emit
 * task.run.completed with their own schemas tomorrow. The schema check is
 * therefore the fold's identity test, not an optimisation — anything that is
 * not pipeline.run/1 is skipped with the cursor advanced, never guessed at
 * (the stateTwinFold rule).
 */
import { Fold } from './foldWorker';
import { Ledger } from '../ledger/ledger';
import { EventEnvelope } from '../envelope/types';

export const PIPELINE_RUN_SCHEMA = 'pipeline.run/1';

export type PipelineLayer = 'l1' | 'l2' | 'l3';
export type PipelineOutcome = 'ok' | 'skip' | 'fail';
export type PipelineTrigger = 'scheduled' | 'adhoc' | 'lifecycle' | 'startup';
export type PipelineSiteKind = 'local' | 'wpe' | 'external';

/** The pipeline.run/1 payload contract, shared with the host-side producer. */
export interface PipelineRunPayload {
  layer: PipelineLayer;
  site_kind: PipelineSiteKind;
  outcome: PipelineOutcome;
  trigger: PipelineTrigger;
  duration_ms: number;
  /** Present iff outcome != 'ok' — WP-67's rule: an absence carries its reason. */
  reason?: string;
  /** Allows producers to attach extras without a fold change; carried verbatim. */
  [key: string]: unknown;
}

const LAYERS: ReadonlySet<string> = new Set(['l1', 'l2', 'l3']);

export function createPipelineStatusFold(): Fold {
  return {
    name: 'pipeline-status/1',
    topicPrefix: 'task.run.',
    apply(event: EventEnvelope, ledger: Ledger): void {
      if (event.topic !== 'task.run.completed') return;
      if (event.schema !== PIPELINE_RUN_SCHEMA) return;

      const p = event.payload as Partial<PipelineRunPayload>;
      if (typeof p.layer !== 'string' || !LAYERS.has(p.layer)) return;
      const entityId = event.entity.environment ?? event.entity.site;
      if (!entityId) return;

      const fact = `pipeline:${p.layer}`;
      const db = ledger.raw();
      const existing = db
        .prepare(`SELECT observed_at FROM twin_facts WHERE entity_id = ? AND fact = ?`)
        .get(entityId, fact) as { observed_at: string } | undefined;

      // Out-of-order (a replay, a delayed arrival) must never roll a site's
      // pipeline status backwards. Strict '>' — ties break by arrival order.
      if (existing && existing.observed_at > event.observed_at) return;

      const value: Record<string, unknown> = {
        outcome: p.outcome,
        trigger: p.trigger,
        site_kind: p.site_kind,
        duration_ms: p.duration_ms,
        // The run's finish moment IS the fact's observation moment, duplicated
        // into the value so readers of the fact alone can render an age.
        finished_at: event.observed_at,
        ...(p.reason !== undefined ? { reason: p.reason } : {}),
      };

      db.prepare(
        `INSERT INTO twin_facts (entity_id, fact, value, observed_at, source_trust, event_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_id, fact) DO UPDATE SET
           value = excluded.value,
           observed_at = excluded.observed_at,
           source_trust = excluded.source_trust,
           event_id = excluded.event_id`,
      ).run(entityId, fact, JSON.stringify(value), event.observed_at, event.source.trust, event.id);
    },
  };
}
