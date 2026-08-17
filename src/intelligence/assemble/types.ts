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
import { Constraint, Enforcement } from '../law/types';
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

export interface AssembleRequest {
  actor: AssembleActor;
  /** The granted capability this task runs under. v0 chat has no grant: null. */
  capability?: string | null;
  task: { id: string; intent: string };
  targets: EntityRef[];
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
  /** Deferred to the procedure packet — always null in v0. */
  procedure: null;
  tools: string[];
  retrieval: RetrievalRecord[];
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
  procedure: null;
  tools: ToolGrant[];
  retrieved: RetrievedItem[];
  /** Rendered text, ready for the actor surface. Null when there is nothing to say. */
  blocks: {
    /** Full policy set, for the actor's durable context (the system prompt). */
    ambient: string | null;
    /** Per-turn carrier: policy re-assert + freshness + retrieval. */
    turn: string | null;
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
