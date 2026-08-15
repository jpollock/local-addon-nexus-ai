/**
 * Event envelope v1 — the enforcement fabric made concrete.
 *
 * Every fact that enters the intelligence layer is an event wearing this
 * envelope. Provenance, freshness, and access ride the envelope as required
 * fields, not tribal knowledge. Mirrors schemas/event-envelope.schema.json
 * (architecture doc §4.1); the JSON Schema is the interchange contract,
 * these types are the in-process contract.
 */

/** The nine source classes (model: "The nine sources"). */
export const SOURCE_CLASSES = [
  'platform',
  'work_product',
  'work',
  'expertise',
  'intent',
  'audience_instrument',
  'market_instrument',
  'regulation',
  'commons',
] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

/** Trust classes, 1:1 with how each source acquires (model: trust ranks by source). */
export const TRUST_CLASSES = [
  'observed', // platform
  'derived', // work_product
  'emitted', // work
  'authored', // expertise
  'elicited', // intent
  'measured', // audience_instrument
  'estimated', // market_instrument
  'imposed', // regulation
  'imported', // commons
] as const;
export type TrustClass = (typeof TRUST_CLASSES)[number];

export const EVENT_TYPES = [
  'state',
  'semantic',
  'procedure',
  'policy',
  'episodic',
  'task',
  'control',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type ActorKind = 'human' | 'agent' | 'ability' | 'system';
export type Sensitivity = 'ops' | 'content' | 'client_confidential' | 'security';

export interface ActorRef {
  id: string; // act_*
  kind: ActorKind;
  /** ADR-14: "actor X via satellite Y" — the gateway/satellite the action flowed through. */
  via: string;
}

export interface SourceRef {
  class: SourceClass;
  /** Concrete system observed through: 'wp-cli' | 'capi' | 'ga4' | 'human' | ... */
  system: string;
  trust: TrustClass;
}

export interface AccessRef {
  /** ADR-11: reserved from day one so events migrate into any hub tenancy model. */
  tenant: string;
  client?: string; // ent_client_*
  sensitivity?: Sensitivity;
}

/** Entity references only — never raw names. Keys are entity roles. */
export type EntityRefs = Record<string, string>; // role -> ent_<type>_<ULID>

export interface EventEnvelope<P = Record<string, unknown>> {
  id: string; // evt_<ULID> — idempotency key
  /** When the layer recorded the event. */
  recorded_at: string; // ISO 8601
  /**
   * When the fact was true at its source. NEVER conflate with recorded_at —
   * freshness computes from this field ("synced-at is not changed-at").
   */
  observed_at: string; // ISO 8601
  /** Type-prefixed taxonomy: <type>.<subject>.<verb> (architecture doc §4.2). */
  topic: string;
  /** Payload schema name/version, e.g. "plugin.observed/1". */
  schema: string;
  entity: EntityRefs;
  actor: ActorRef;
  source: SourceRef;
  access: AccessRef;
  /** The task moment this belongs to; audit is `WHERE correlation = ?`. */
  correlation?: string; // task_<ULID>
  /** The event that caused this one; supersession chains resolve along it. */
  causation?: string; // evt_<ULID>
  payload: P;
}

/** What a producer supplies; the emitter fills id, recorded_at, actor.via, and access.tenant. */
export type EventDraft<P = Record<string, unknown>> = Omit<
  EventEnvelope<P>,
  'id' | 'recorded_at' | 'actor' | 'access'
> & {
  actor: Omit<ActorRef, 'via'> & { via?: string };
  access?: Omit<AccessRef, 'tenant'> & { tenant?: string };
};
