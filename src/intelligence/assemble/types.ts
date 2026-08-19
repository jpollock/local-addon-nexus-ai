/**
 * Context assembler v0 — contract types (architecture doc §6.1, §6.4).
 *
 * `assemble(req) -> ContextBundle` with the manifest as the audit artifact
 * (ADR-10). Three deliberate deviations from the §6.1 sketch, all recorded in
 * WP-11's packet note:
 *
 *  1. `assemble` is **async**. §6.1 shows a synchronous signature, but semantic
 *     retrieval is a promise on every store this codebase has. The alternative
 *     — the host pre-fetching and passing candidates in — would move ranking
 *     and budget out of the assembler, which is exactly what ADR-10 says must
 *     not happen.
 *  2. The bundle carries its own **rendered blocks**. The budget numbers in the
 *     manifest are measured over the text the actor actually receives, so the
 *     renderer cannot live outside the thing that reports the number.
 *  3. `procedure` and `tools` are present but inert in v0 (always `null` / `[]`)
 *     — recon §4.3 defers both to the procedure packet, gated on eval B-03.
 *
 * ADR-16 seam: nothing here imports electron, `src/main`, or `src/renderer`.
 * Every host capability arrives through `AssembleDeps` as a narrow port that
 * the real classes satisfy structurally.
 */
import { ActorKind, TrustClass } from '../envelope/types';
import {
  AttestClass,
  Constraint,
  Enforcement,
  Runbook,
  RunbookLoadError,
  RunbookStrictness,
} from '../law/types';
import { ConstraintFilter } from '../law/registry';
import { EventEnvelope } from '../envelope/types';
import { QueryOptions } from '../ledger/ledger';
import { Freshness, TwinFact } from '../folds/twinStore';

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * ADR-7's input: the autonomy class, not the operation, selects fail-closed vs
 * warn-and-proceed semantics when the policy set is missing or stale.
 */
export type Autonomy = 'interactive' | 'autonomous';

export interface AssembleActor {
  id: string;
  kind: ActorKind;
  autonomy: Autonomy;
}

/** A resolved entity — never a raw name (§6.1 "resolved entities"). */
export interface EntityRef {
  /** Entity role, matching the envelope's entity block: 'environment' | 'site' | … */
  role: string;
  /** ent_<type>_<ULID> */
  id: string;
  /**
   * Display label for prose. Entity ids are unreadable to a model and to a
   * user; the label is what appears in rendered text, never the id.
   */
  label?: string;
}

/**
 * The four planes the assembler routes. Named for the intelligence TYPES of
 * the §4 table, not for the collectors that serve them: `state` is served by
 * freshness disclosures today and by live tool grants later, and the table must
 * outlive that change.
 *
 * `procedural` and `policy` are absent deliberately. Both are Site-level by the
 * table and neither is per-target in this codebase — the policy set is global
 * and the procedure plane is inert in v0 — so a routing row for either would
 * record a decision nothing acts on.
 */
export type IntelligencePlane = 'state' | 'episodic' | 'semantic' | 'audience';

/** The three layers a plane can resolve to (ADR-21). */
export type FrameSlot = 'workingCopy' | 'site' | 'production';

/**
 * The task frame (ADR-22, audit F3) — WHERE the actor is standing, so the
 * assembler can route each type to its own home without the actor choosing.
 *
 * Per-turn and never persisted: it is derived from the entity graph at assembly
 * time, and a stored copy would be a second source of truth for something the
 * links already say.
 *
 * Every slot is optional, and an absent slot is honest rather than fatal: a copy
 * nothing has linked has no `production`, and the planes that would have routed
 * there say so instead of pretending (see `RoutingRecord.servedBy`).
 */
export interface TaskFrame {
  /** The copy the actor is standing in — Layer 3. */
  workingCopy?: EntityRef;
  /** The logical Site everything here is a version of — Layer 1. */
  site?: EntityRef;
  /**
   * The environment carrying the audience's attention — Layer 2, and only when
   * something on record SAYS it is that. Never inferred from being the only
   * other place a copy could be compared with.
   */
  production?: EntityRef;
  /**
   * Per-plane overrides of the §4 table. Absent planes use the table, which is
   * the normal case — ADR-22 says the assembler routes and actors never do, so
   * this exists for a host that genuinely knows better (a Site-wide question
   * asked of the semantic plane), not as a caller-facing knob.
   */
  routing?: Partial<Record<IntelligencePlane, FrameSlot>>;
}

/**
 * What routing actually did, per plane — part of the manifest, because routing
 * nobody can see is indistinguishable from no routing at all.
 */
export interface RoutingRecord {
  plane: IntelligencePlane;
  /** The slot the table (or an override) named for this plane. */
  slot: FrameSlot;
  /** The entities the plane was actually read from. Empty when nothing served it. */
  entityIds: string[];
  /**
   * Present only when the plane's own slot was absent and something else stood
   * in: another slot, or `targets` (the request's flat list — the pre-frame
   * behaviour). A fallback that went unrecorded would read as a routed answer.
   */
  servedBy?: FrameSlot | 'targets';
  /** Why the plane produced nothing. Present only when it produced nothing. */
  unavailable?: string;
}

// ---------------------------------------------------------------------------
// Procedure (WP-20c) — what the caller supplies, what the bundle carries
// ---------------------------------------------------------------------------

/**
 * A capability grant, as the DELIVERY layer needs it: identity plus the pin.
 *
 * Deliberately structural and deliberately smaller than WP-20b's own
 * `CapabilityGrant` (which also carries scope and an enabled flag). 20b decides
 * WHETHER a capability is armed and for which sites; the assembler decides only
 * whether the document it is about to deliver is the document that was granted.
 * Its objects satisfy this shape without an import in either direction.
 */
export interface ProcedureGrantRef {
  capability: string;
  runbookId: string;
  /** `sha256:…` over the canonical document, as reviewed. The integrity pin (§6b). */
  runbookHash: string;
}

/** How the capability came to be armed — recorded, because "why the ceremony?" is the first question. */
export type ProcedureArmedBy = 'predicate' | 'model-request' | 'late-gate';

/**
 * Checkpoint progress, folded by WP-20d from `task.*` events.
 *
 * **Absent means "the platform is not tracking attestation", not "nothing has
 * been attested"** — and the rendered block says exactly that. The two are
 * different facts, and rendering the second when the first is true is the
 * green-tick-over-an-unchecked-step failure §7 names.
 */
export interface ProcedureCursor {
  /** Checkpoint ids attested so far, in attestation order. */
  attested: string[];
  /** The abort taken, when the run aborted. */
  aborted?: string;
  /**
   * WP-20d: checkpoints nothing in the ledger can ever attest. Reported
   * separately because "the platform cannot verify this" and "this has not
   * happened yet" are different facts, and the second is what an unattested
   * narrative checkpoint would otherwise be read as. Four of the anchor
   * runbook's eight are in here.
   */
  narrative?: string[];
  /**
   * WP-20d: checkpoints whose attesting evidence exists and says NO — an
   * approval that was denied and not superseded. Distinct from unattested for
   * the same reason: one invites asking again, the other forbids it.
   */
  denied?: string[];
}

/** The procedure half of a request: what the actor holds, and what is armed now. */
export interface ProcedureRequest {
  /**
   * Every capability grant this actor holds. The always-on procedure index is
   * one line per entry — so an actor with NO grants gets no index at all, which
   * is what keeps every caller predating WP-20 byte-identical.
   */
  grants: ProcedureGrantRef[];
  /** The capability armed for THIS task (WP-20b's `armFor`). Absent ⇒ not armed. */
  armed?: { capability: string; armedBy: ProcedureArmedBy };
  cursor?: ProcedureCursor;
}

export const PROCEDURE_REFUSAL_CODES = ['not-loaded', 'over-ceiling', 'hash-mismatch'] as const;
/**
 * Three refusals and one absence, and they are four different facts:
 * `not-loaded` (the document is missing or its contract is unhonourable),
 * `over-ceiling` (it exists and is too large to deliver whole — never trimmed),
 * `hash-mismatch` (it exists and is not the reviewed document — integrity), and
 * `procedure: null` (nothing was armed, so nothing was owed).
 */
export type ProcedureRefusalCode = (typeof PROCEDURE_REFUSAL_CODES)[number];

export interface ProcedureCheckpointView {
  id: string;
  /** Never upgraded here: `narrative` unless the runbook itself declared otherwise. */
  attest: AttestClass;
  /** True only when a cursor SAYS so. No cursor ⇒ false for every checkpoint. */
  attested: boolean;
}

export interface ProcedureDelivery {
  status: 'delivered';
  capability: string;
  runbookId: string;
  version: string;
  hash: string;
  strictness: RunbookStrictness;
  armedBy: ProcedureArmedBy;
  /** ADR-20 extended to procedure: the full document rides only when it must. */
  assertFull: boolean;
  /**
   * Whether the canonical document itself rode this turn. False on a re-assert,
   * and false for a GUIDED runbook always — nothing delivers a guided procedure
   * whole, which is the premise of the ceiling's strict-only scope.
   */
  bodyDelivered: boolean;
  checkpoints: ProcedureCheckpointView[];
  /** Ordered step ids, for guided runbooks. Empty for strict ones. */
  steps: string[];
  /** Estimated tokens of the rendered procedure section (see `estimateTokens`). */
  tokens: number;
}

export interface ProcedureRefusal {
  status: 'refused';
  capability: string;
  code: ProcedureRefusalCode;
  /** The runbook the grant NAMED, when a grant was found. */
  runbookId: string | null;
  reason: string;
  /** The hash the grant pinned, and the hash on disk. Both, in full, on a mismatch. */
  expectedHash?: string;
  actualHash?: string;
  tokens: number;
}

export type ProcedureOutcome = ProcedureDelivery | ProcedureRefusal;

/** One line of the always-on index — what is grantable, and whether it is servable. */
export interface ProcedureIndexEntry {
  capability: string;
  runbookId: string;
  version: string | null;
  strictness: RunbookStrictness | null;
  checkpoints: number | null;
  /** Present when this grant's runbook cannot currently be served. */
  unavailable?: ProcedureRefusalCode;
}

export interface AssembleRequest {
  actor: AssembleActor;
  /** The granted capability this task runs under. v0 chat has no grant: null. */
  capability?: string | null;
  /**
   * WP-20c. Grants held, the capability armed for this task, and the checkpoint
   * cursor. Absent ⇒ no index, no procedure, and a turn block byte-identical to
   * the pre-WP-20 build.
   */
  procedure?: ProcedureRequest;
  task: { id: string; intent: string };
  targets: EntityRef[];
  /**
   * ADR-22's routing input. **Absent ⇒ every collector reads `targets`, exactly
   * as it did before the frame existed** — the parity contract every shipped
   * caller depends on, pinned in both directions by `frameRouting.test.ts`.
   */
  frame?: TaskFrame;
  budget?: { tokens?: number; toolCalls?: number };
  /** Names the actor surface for the manifest, e.g. 'chat.docked-panel'. */
  surface: string;
  /** What the actor's context ALREADY holds — the ADR-20 input. */
  context?: {
    /**
     * Policy version hash the actor's durable context already carries. When it
     * equals the current set's hash, the per-turn carrier re-asserts by hash
     * alone; when it differs or is absent, the full set rides.
     */
    policyVersionHash?: string;
    /**
     * True when the caller is (re)building the actor's durable context this
     * turn — the full set rides there, so the per-turn carrier must not repeat
     * it. On this codebase's chat surface that means "building the system
     * prompt".
     */
    rebuildingDurableContext?: boolean;
    /**
     * WP-20c: the same ADR-20 mechanism, for procedure. The content hash of the
     * runbook the actor's context already carries this task. Equal ⇒ the carrier
     * re-asserts by hash and cursor; different or absent ⇒ the full document
     * rides.
     *
     * `rebuildingDurableContext` deliberately does NOT suppress it the way it
     * suppresses policy: the procedure never rides the system prompt (§3), so
     * there is no other copy for the carrier to defer to.
     */
    procedureHash?: string;
    /**
     * WP-34: the same ADR-20 mechanism again, for the citation convention
     * (ADR-24). The convention's version hash the actor's context already
     * carries. Equal ⇒ the carrier re-asserts in one line; different or absent
     * ⇒ the full instruction block rides.
     *
     * Like `procedureHash` and unlike `policyVersionHash`,
     * `rebuildingDurableContext` does NOT suppress it: the convention never
     * rides the system prompt, so there is no other copy for the carrier to
     * defer to.
     */
    citationConventionHash?: string;
  };
  /**
   * Divergences the host's `verifyMirror()` reported at assembly time. Non-zero
   * means the mirrored policy disagrees with the live settings, which the
   * ambient block must disclose rather than present policy as certain.
   */
  policyDivergences?: number;
  retrieval?: {
    /**
     * Topic prefix(es) for the episodic slice — one query per prefix, per
     * target. Default `['state.', 'episodic.']` (WP-16b): a surface that asks
     * for neither must still be able to consult the incident history, which
     * lives under `episodic.*`. A string narrows to exactly that family.
     */
    episodicTopicPrefix?: string | string[];
    episodicLimit?: number;
    semanticLimit?: number;
    /** Max freshness rows rendered before the tail is summarised as a count. */
    freshnessLimit?: number;
  };
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

/** A constraint as the bundle carries it — the registry's row, minus internals. */
export interface PolicyConstraintView {
  id: string;
  rule: string;
  enforcement: Enforcement;
  origin: string;
  docId: string;
  docVersion: string;
  /** Present when the constraint mirrors a live settings surface. */
  derivedFrom?: string;
}

export interface PolicySet {
  /** Joined document ids, e.g. 'pol.ops-default'. */
  id: string;
  /** psv_<12 hex> over the constraint set — the ADR-20 re-assert key. */
  versionHash: string;
  constraints: PolicyConstraintView[];
  documents: Array<{ id: string; version: string }>;
  /** ADR-20: true when the full set must ride the per-turn carrier this turn. */
  assertFull: boolean;
  /** `verifyMirror()` divergence count at assembly time. */
  divergences: number;
}

export interface RetrievedItem {
  store: 'ledger' | 'semantic';
  id: string;
  title: string;
  detail?: string;
  /**
   * WP-13c. What the event was ABOUT, in prose — bounded, composed from an
   * explicit allow-list of payload fields, never a dump of the payload.
   *
   * A separate channel from `detail` on purpose. `detail` carries the fact KEY
   * (`factKeyOf`), which is identity; this carries substance, which is
   * rendering. WP-13b measured the cost of having only the first: a planted
   * incident reached the model as topic + age + provenance + id, so "tell the
   * user the specific historical finding" was unsatisfiable without
   * fabrication. Widening `factKeyOf` instead would have leaked arbitrary
   * payload keys into fact identity — the owner's ruling, not a preference.
   */
  summary?: string;
  /** Provenance — every item carries source and trust (§6.2 step 5). */
  source?: string;
  trust?: TrustClass;
  observedAt?: string;
  ageSeconds?: number;
  entityId?: string;
  score?: number;
}

/**
 * A freshness DISCLOSURE, not a fact. The value is deliberately absent: §6.2
 * step 4 forbids copying state into the bundle, so v0 discloses that a cached
 * observation exists and how old it is, and leaves reading it to a live tool
 * call at execution time.
 */
export interface FreshnessRecord {
  entityId: string;
  entityLabel?: string;
  fact: string;
  ageSeconds: number;
  sloSeconds: number;
  fresh: boolean;
  served: 'twin';
}

export interface RetrievalRecord {
  query: string;
  store: 'ledger' | 'semantic';
  returned: number;
  ids: string[];
}

/**
 * Scoped live-pull handles — capabilities, not data (§6.2 step 4).
 * Always empty in v0; populating it changes what the model can see and is
 * gated on eval B-03 (recon §4.3).
 */
export interface ToolGrant {
  name: string;
  mode?: 'live' | 'cached';
}

/** §6.4 — "what did the agent know when it acted?" is now a stored answer. */
export interface BundleManifest {
  bundle_id: string;
  task: string;
  assembled_at: string;
  actor: string;
  actor_autonomy: Autonomy;
  capability: string | null;
  surface: string;
  policy: {
    set: string;
    version: string;
    constraints: number;
    /** What actually rode this turn — the ADR-20 claim, stated not implied. */
    asserted: 'full' | 'hash';
    /**
     * §6.4 shows `age_s`. v0 has no pin timestamp to measure it from: the
     * registry is built at process start from a directory on disk, with no
     * pull-time or signature. NULL is the honest answer; fabricating an age
     * here would be the exact staleness-laundering the envelope rules forbid.
     */
    age_s: null;
    divergences: number;
  } | null;
  /**
   * WP-20c widened this from `null` IN PLACE, inside `context.assembled/1`
   * (escalation 1, ratified): `procedure: null` and `procedure: {…}` are the
   * same field answering the same question — what procedure governed this turn
   * — and a reader that ignores it is unaffected either way.
   *
   * `null` means nothing was armed. It never means "something was armed and we
   * are not saying", which is what the `refused` status is for.
   */
  procedure: {
    capability: string;
    /** The runbook the grant named. Null when no grant could be found at all. */
    runbook: string | null;
    version: string | null;
    /** The hash of the document that actually rode, or null when none did. */
    hash: string | null;
    status: 'delivered' | 'refused';
    /** ADR-20's claim, stated not implied — as it already is for policy. */
    asserted?: 'full' | 'hash';
    armed_by?: ProcedureArmedBy;
    strictness?: RunbookStrictness;
    /** How many checkpoints the runbook declares, and how many a cursor attests. */
    checkpoints?: number;
    attested?: number;
    /** Estimated tokens the procedure section cost this turn; inside `budget.tokens_used`. */
    tokens: number;
    refusal?: {
      code: ProcedureRefusalCode;
      reason: string;
      expected_hash?: string;
      actual_hash?: string;
    };
  } | null;
  /**
   * WP-34 · which citation convention (ADR-24) governed this reply, and whether
   * the actor received it in full this turn.
   *
   * OWNER-RATIFIED at WP-34's gate. Widened IN PLACE inside
   * `context.assembled/1` — the second time this manifest has grown that way
   * (WP-20c's `procedure` was the first, ratified on the same reasoning): the
   * field answers a question the record could not previously answer, and a
   * reader that ignores it is unaffected either way.
   *
   * ADR-20's argument applies verbatim. "Convention vX was in effect" is
   * provable from the hash without the full text ever being re-shipped, which
   * is exactly the claim `policy.asserted` already makes for the policy set.
   *
   * `null` means NO convention rode this turn — a bare carrier, or a
   * fail-closed refusal. It never means one rode and is not being named.
   */
  citation: {
    /** The convention's version hash, `cnv_<12 hex>` over its own text. */
    convention: string;
    /** What actually rode — the ADR-20 claim, stated not implied. */
    asserted: 'full' | 'hash';
  } | null;
  tools: string[];
  retrieval: RetrievalRecord[];
  /**
   * ADR-22, one row per plane. **Absent entirely when the request carried no
   * frame** — an empty array would claim routing ran and found nothing, which is
   * a different fact from "this caller predates the frame".
   */
  routing?: RoutingRecord[];
  freshness_report: FreshnessRecord[];
  budget: {
    tokens_used: number;
    of: number | null;
    /** How the number was produced. It is an ESTIMATE — see `estimateTokens`. */
    method: string;
    /** What the number covers, so nobody reads it as a whole-prompt figure. */
    scope: string;
  };
  /** Present only when ADR-7 fail-closed fired. */
  fail_closed?: true;
}

export interface ContextBundle {
  manifest: BundleManifest;
  ambient: PolicySet | null;
  /** WP-20c: the delivered procedure, the refusal that replaced it, or null when unarmed. */
  procedure: ProcedureOutcome | null;
  /** The always-on index — one entry per grant held. Empty when none are. */
  procedureIndex: ProcedureIndexEntry[];
  tools: ToolGrant[];
  retrieved: RetrievedItem[];
  /** Rendered text, ready for the actor surface. Null when there is nothing to say. */
  blocks: {
    /** Full policy set, for the actor's durable context (the system prompt). */
    ambient: string | null;
    /** Per-turn carrier: policy re-assert + freshness + retrieval. */
    turn: string | null;
    /**
     * WP-34 · the citable keys of the sections that actually rode this turn,
     * in order — the `carrier:` half of ADR-24's supply universe.
     *
     * Derived from the same array `renderTurnBlock` joined, never recomputed:
     * a citation of a carrier line that did not render, and a rendered line
     * that cannot be cited, are both drift this field exists to make
     * impossible. Empty when no carrier rode.
     */
    turnSections: readonly string[];
  };
  /** ADR-7: an autonomous actor with no policy set gets a refusal bundle. */
  failClosed: boolean;
}

// ---------------------------------------------------------------------------
// Ports (ADR-16) — the real classes satisfy these structurally.
// ---------------------------------------------------------------------------

export interface ConstraintRegistryPort {
  constraints(filter?: ConstraintFilter): Constraint[];
  documents(): Array<{ id: string; version: string }>;
}

/**
 * The runbook index, as the assembler consumes it (WP-20a's `RunbookRegistry`
 * satisfies this structurally). `errors()` is not optional decoration: a runbook
 * the registry REFUSED is the difference between "this capability has no
 * procedure" and "this capability's procedure is over the ceiling", and those
 * are two different things to tell a user.
 */
export interface RunbookRegistryPort {
  byCapability(capability: string): Runbook | undefined;
  errors(): RunbookLoadError[];
}

export interface LedgerPort {
  query(opts: QueryOptions): EventEnvelope[];
}

export interface TwinsPort {
  forEntity(entityId: string): TwinFact[];
  freshness(fact: TwinFact, now?: Date): Freshness;
}

export interface SemanticHit {
  id: string;
  title: string;
  excerpt?: string;
  label?: string;
  score?: number;
}

export interface SemanticPort {
  search(query: string, entityIds: string[], limit: number): Promise<SemanticHit[]>;
}

export interface AssembleDeps {
  law?: ConstraintRegistryPort;
  /** WP-20c. Absent ⇒ an armed capability refuses (`not-loaded`) rather than improvising. */
  runbooks?: RunbookRegistryPort;
  ledger?: LedgerPort;
  twins?: TwinsPort;
  semantic?: SemanticPort;
  now?: () => Date;
  /**
   * Wraps retrieved site-derived content in the host's untrusted-data
   * delimiters (R7). Injected rather than duplicated: the delimiters and their
   * spoof-neutralisation live in ONE place (`src/main/mcp/pii.ts`), and a
   * second copy across the seam would drift from the directive that gives them
   * meaning. **Retrieval is skipped entirely when this is absent** — shipping
   * attacker-authorable text into a trusted channel is the one failure this
   * assembler must not have.
   */
  wrapUntrusted?: (content: string) => string;
}
