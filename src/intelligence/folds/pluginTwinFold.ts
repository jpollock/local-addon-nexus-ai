/**
 * First fold worker: state.plugin.observed -> twin_facts.
 *
 * Payload contract (plugin.observed/1): { slug, version, active }.
 * Out-of-order protection: an observation older than the stored fact's
 * observed_at is ignored (correctness from observed_at, not arrival order).
 * Drift: when a newer observation disagrees with the stored value, the
 * onDrift hook fires — wire it to emit state.drift.detected.
 */
import { Fold } from './foldWorker';
import { Ledger } from '../ledger/ledger';
import { EventEnvelope } from '../envelope/types';

export interface PluginObservedPayload extends Record<string, unknown> {
  slug: string;
  version: string;
  active: boolean;
}

export interface DriftNotice {
  entityId: string;
  fact: string;
  previous: unknown;
  observed: unknown;
  previousObservedAt: string;
  observedAt: string;
  causeEventId: string;
}

export function createPluginTwinFold(onDrift?: (d: DriftNotice) => void): Fold {
  return {
    name: 'plugin-twin/1',
    topicPrefix: 'state.plugin.',
    apply(event: EventEnvelope, ledger: Ledger): void {
      const payload = event.payload as PluginObservedPayload;
      if (!payload?.slug) return; // unknown payload shape — skip, never throw mid-fold
      const entityId = event.entity.environment ?? event.entity.site;
      if (!entityId) return;

      const fact = `plugin:${payload.slug}`;
      const value = { version: payload.version, active: payload.active };
      const db = ledger.raw();

      const existing = db
        .prepare(`SELECT value, observed_at FROM twin_facts WHERE entity_id = ? AND fact = ?`)
        .get(entityId, fact) as { value: string; observed_at: string } | undefined;

      // Out-of-order: never let an older observation overwrite a newer fact.
      // Strict '>' — at equal observed_at, ledger (arrival) order breaks the tie.
      if (existing && existing.observed_at > event.observed_at) return;

      if (existing && onDrift) {
        const previous = JSON.parse(existing.value);
        if (JSON.stringify(previous) !== JSON.stringify(value)) {
          onDrift({
            entityId,
            fact,
            previous,
            observed: value,
            previousObservedAt: existing.observed_at,
            observedAt: event.observed_at,
            causeEventId: event.id,
          });
        }
      }

      db.prepare(
        `INSERT INTO twin_facts (entity_id, fact, value, observed_at, source_trust, event_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_id, fact) DO UPDATE SET
           value = excluded.value,
           observed_at = excluded.observed_at,
           source_trust = excluded.source_trust,
           event_id = excluded.event_id`
      ).run(
        entityId,
        fact,
        JSON.stringify(value),
        event.observed_at,
        event.source.trust,
        event.id
      );
    },
  };
}
