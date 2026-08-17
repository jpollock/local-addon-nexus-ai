/**
 * WP-18 · What the real-ledger replay actually checks.
 *
 * TESTING_STRATEGY.md layer 6: rebuild every fold from a copy of the production
 * ledger and assert the invariants hold. The driver (`run.ts`) does the I/O;
 * every judgement lives here, pure, so it can be pinned both ways — fires on
 * the broken shape, quiet on the healthy one — without a real ledger.
 *
 * Each check returns REASONS, never a boolean. A replay that fails against a
 * developer's real ledger has to say what it saw, or the run is just a red
 * light with no diagnosis attached.
 */

/** The envelope's trust vocabulary (src/intelligence/envelope/types.ts). */
const TRUST_CLASSES = ['observed', 'reported', 'derived', 'asserted', 'inferred'];

// ---------------------------------------------------------------------------
// Monotonic ids
// ---------------------------------------------------------------------------

/**
 * Ids must strictly increase in read order.
 *
 * Every fold cursor is an event id compared with `>`, so a duplicate or a
 * decrease does not merely look untidy — it silently skips or re-consumes
 * events, and the twin set stops being a function of the ledger.
 */
export function checkMonotonicIds(ids: string[]): string[] {
  const violations: string[] = [];
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] > ids[i - 1]) continue;
    violations.push(
      ids[i] === ids[i - 1]
        ? `duplicate event id at position ${i}: ${ids[i - 1]} then ${ids[i]}`
        : `non-monotonic event id at position ${i}: ${ids[i - 1]} then ${ids[i]}`
    );
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Drift events
// ---------------------------------------------------------------------------

export const DRIFT_TOPIC = 'state.drift.detected';
const DRIFT_SCHEMA = /^drift\.detected\/(\d+)$/;

/**
 * Every actor id a drift-emitting fold has stamped, past and present.
 *
 * MEASURED against the developer's real ledger on the first replay run
 * (2026-08-17, 9,332 events): 328 of 365 drift events carry
 * `act_fold_plugin_twin` at schema `drift.detected/1`, and 37 carry
 * `act_fold_state_twin` at `/2` — the actor id was renamed alongside the
 * schema bump, while `source.system` was already `fold:state-twin` in both.
 *
 * A set, not a wildcard: an actor outside it is still flagged, so the check
 * keeps catching an impostor producer while no longer reporting a developer's
 * whole drift history as broken.
 */
const DRIFT_ACTOR_IDS = ['act_fold_state_twin', 'act_fold_plugin_twin'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseableIso(v: unknown): boolean {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/**
 * Why this drift event is malformed — empty when it is fine.
 *
 * Schema-version aware: `previous_observed_at` arrived with `drift.detected/2`
 * (WP-03), and a real ledger legitimately holds v1 events from before it.
 * Demanding the field unconditionally would report a developer's whole drift
 * history as broken — a false red on real data, which is exactly the failure
 * mode a layer-6 check must not have.
 */
export function checkDriftEvent(event: unknown): string[] {
  const reasons: string[] = [];
  if (!isRecord(event)) return ['drift event is not an object'];

  const id = typeof event.id === 'string' ? event.id : '(no id)';
  const say = (reason: string) => reasons.push(`${id}: ${reason}`);

  if (event.topic !== DRIFT_TOPIC) say(`topic is "${String(event.topic)}", expected "${DRIFT_TOPIC}"`);

  const schemaMatch = typeof event.schema === 'string' ? DRIFT_SCHEMA.exec(event.schema) : null;
  if (!schemaMatch) say(`schema "${String(event.schema)}" is not drift.detected/<version>`);
  const version = schemaMatch ? Number(schemaMatch[1]) : 0;

  const entity = isRecord(event.entity) ? event.entity : {};
  if (typeof entity.environment !== 'string' || entity.environment === '') {
    say('entity.environment is missing — the drift is unattributed');
  }

  const actor = isRecord(event.actor) ? event.actor : {};
  if (typeof actor.id !== 'string' || !DRIFT_ACTOR_IDS.includes(actor.id)) {
    say(`actor.id "${String(actor.id)}" belongs to no known drift-emitting fold`);
  }

  const source = isRecord(event.source) ? event.source : {};
  if (source.system !== 'fold:state-twin') {
    say(`source.system is "${String(source.system)}", expected "fold:state-twin"`);
  }

  if (typeof event.causation !== 'string' || event.causation === '') {
    say('causation is missing — no provenance back to the observation that caused it');
  }

  if (!parseableIso(event.observed_at)) say(`observed_at "${String(event.observed_at)}" is unparseable`);

  const payload = isRecord(event.payload) ? event.payload : {};
  if (typeof payload.fact !== 'string' || payload.fact === '') {
    say('payload.fact is missing — the notice names no fact');
  }
  if (!('previous' in payload)) say('payload.previous is absent (null is fine, absent is not)');
  if (!('observed' in payload)) say('payload.observed is absent (null is fine, absent is not)');
  if (version >= 2 && !parseableIso(payload.previous_observed_at)) {
    say('payload.previous_observed_at is missing or unparseable (required at drift.detected/2)');
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Twin rows
// ---------------------------------------------------------------------------

export interface TwinRow {
  entity_id: string;
  fact: string;
  value: string;
  observed_at: string;
  source_trust: string;
  event_id: string;
}

/** Why this twin fact is malformed — empty when it is fine. */
export function checkTwinRow(row: TwinRow): string[] {
  const reasons: string[] = [];
  const where = `${row.entity_id || '(no entity)'} / ${row.fact || '(no fact)'}`;
  const say = (reason: string) => reasons.push(`${where}: ${reason}`);

  if (!row.entity_id) say('empty entity_id');
  if (!row.fact) say('empty fact');
  if (!parseableIso(row.observed_at)) say(`unparseable observed_at "${row.observed_at}"`);
  if (!TRUST_CLASSES.includes(row.source_trust)) say(`unknown source_trust "${row.source_trust}"`);
  if (!row.event_id) say('empty event_id — the fact has no provenance pointer');
  try {
    JSON.parse(row.value);
  } catch {
    say('value is not JSON');
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Sanity bounds
// ---------------------------------------------------------------------------

export interface TwinCounts {
  twins: number;
  /** Events the state fold can extract a fact from. */
  stateObservations: number;
  /** Distinct entity ids across the twin set. */
  entities: number;
}

/**
 * The stated bounds. Each is an invariant of the fold, not a guess about the
 * developer's fleet — a bound tuned to one machine's data would red on
 * another's, and a check nobody trusts gets ignored.
 */
export function checkTwinCounts(counts: TwinCounts): string[] {
  const problems: string[] = [];

  if (counts.stateObservations > 0 && counts.twins === 0) {
    problems.push(
      `no twin facts folded from ${counts.stateObservations} state observation(s) — ` +
        'events are arriving and nothing is materialising'
    );
  }

  if (counts.twins > counts.stateObservations) {
    problems.push(
      `more twin facts (${counts.twins}) than state observations (${counts.stateObservations}) — ` +
        'twin_facts is an upsert keyed by (entity, fact), so it cannot exceed the observations ' +
        'that wrote it; rows arrived from somewhere other than the fold'
    );
  }

  if (counts.twins > 0 && counts.entities === 0) {
    problems.push(`${counts.twins} twin fact(s) spread over 0 entities`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// The determinism claim
// ---------------------------------------------------------------------------

export interface TwinSetDiff {
  identical: boolean;
  /** In the live set, absent from the replay. */
  missing: string[];
  /** In the replay, absent from the live set. */
  extra: string[];
  /** Present in both, but not equal — one line per difference, field named. */
  differing: string[];
}

const key = (r: TwinRow) => `${r.entity_id} / ${r.fact}`;

/**
 * "Twins are a materialized view, rebuildable from the ledger" — ADR-language
 * that has never been tested against real data until now. This is that test:
 * fold the same ledger again from event 0 and the same facts must come out,
 * value, timestamp, trust and provenance pointer alike.
 */
export function diffTwinSets(live: TwinRow[], replayed: TwinRow[]): TwinSetDiff {
  const liveByKey = new Map(live.map((r) => [key(r), r]));
  const replayedByKey = new Map(replayed.map((r) => [key(r), r]));

  const missing: string[] = [];
  const differing: string[] = [];
  for (const [k, liveRow] of liveByKey) {
    const replayedRow = replayedByKey.get(k);
    if (!replayedRow) {
      missing.push(k);
      continue;
    }
    for (const field of ['value', 'observed_at', 'source_trust', 'event_id'] as const) {
      if (liveRow[field] !== replayedRow[field]) {
        differing.push(`${k}: ${field} live=${liveRow[field]} replayed=${replayedRow[field]}`);
      }
    }
  }

  const extra = [...replayedByKey.keys()].filter((k) => !liveByKey.has(k));

  return {
    identical: missing.length === 0 && extra.length === 0 && differing.length === 0,
    missing,
    extra,
    differing,
  };
}
