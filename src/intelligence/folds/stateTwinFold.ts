/**
 * Generalized state fold: state.* observations -> twin_facts.
 *
 * Supersedes pluginTwinFold (kept for compatibility) by consuming every
 * state observation kind emitted so far:
 *
 *   state.plugin.observed|removed -> plugin:<slug>   { version, active }
 *   state.theme.observed          -> theme:<slug>    { version, active }
 *   state.user.observed           -> user:<user_id>  { username, roles }
 *   state.site.observed           -> site.core       { name, domain, wp_version, php_version }
 *
 * Unknown state.* topics (e.g. state.drift.detected) are skipped — the cursor
 * advances, nothing is guessed. Same invariants as pluginTwinFold: older
 * observed_at never overwrites, every fact carries provenance + trust.
 */
import { Fold } from './foldWorker';
import { Ledger } from '../ledger/ledger';
import { EventEnvelope } from '../envelope/types';
import { DriftNotice } from './pluginTwinFold';

type FactExtractor = (payload: Record<string, unknown>) => { fact: string; value: unknown } | null;

const EXTRACTORS: Record<string, FactExtractor> = {
  'state.plugin.observed': (p) =>
    p.slug ? { fact: `plugin:${p.slug}`, value: { version: p.version, active: p.active } } : null,
  'state.plugin.removed': (p) =>
    p.slug
      ? { fact: `plugin:${p.slug}`, value: { version: p.version, active: false, removed: true } }
      : null,
  'state.theme.observed': (p) =>
    p.slug ? { fact: `theme:${p.slug}`, value: { version: p.version, active: p.active } } : null,
  'state.user.observed': (p) =>
    p.user_id != null
      ? { fact: `user:${p.user_id}`, value: { username: p.username, roles: p.roles } }
      : null,
  'state.site.observed': (p) => ({
    fact: 'site.core',
    value: {
      name: p.name,
      domain: p.domain,
      wp_version: p.wp_version,
      php_version: p.php_version,
    },
  }),
};

export function createStateTwinFold(onDrift?: (d: DriftNotice) => void): Fold {
  return {
    name: 'state-twin/1',
    topicPrefix: 'state.',
    apply(event: EventEnvelope, ledger: Ledger): void {
      const extract = EXTRACTORS[event.topic];
      if (!extract) return; // unknown state topic — skip, never guess
      const extracted = extract(event.payload);
      if (!extracted) return;
      const entityId = event.entity.environment ?? event.entity.site;
      if (!entityId) return;

      const db = ledger.raw();
      const existing = db
        .prepare(`SELECT value, observed_at FROM twin_facts WHERE entity_id = ? AND fact = ?`)
        .get(entityId, extracted.fact) as { value: string; observed_at: string } | undefined;

      // Out-of-order: never let an older observation overwrite a newer fact.
      // Strict '>' — at equal observed_at, ledger (arrival) order breaks the tie,
      // so two changes inside one timestamp granule don't freeze the first value.
      if (existing && existing.observed_at > event.observed_at) return;

      if (existing && onDrift) {
        const previous = JSON.parse(existing.value);
        if (JSON.stringify(previous) !== JSON.stringify(extracted.value)) {
          onDrift({
            entityId,
            fact: extracted.fact,
            previous,
            observed: extracted.value,
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
        extracted.fact,
        JSON.stringify(extracted.value),
        event.observed_at,
        event.source.trust,
        event.id
      );
    },
  };
}
