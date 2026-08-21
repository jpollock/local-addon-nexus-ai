/**
 * WP-30 · The session registry — one fold, one query surface.
 *
 * `sessionRegistry.ts` answers four questions, and it answers all four from the
 * ledger alone: what sessions exist, what each is waiting on, AT WHICH GATE, and
 * what changed since a given cursor. Before this file those answers were spread
 * across three ad-hoc readers and one Map in host memory; this is the one place
 * they are derived.
 *
 * ## Three rules, and everything below follows from them
 *
 * **1 · IT IS A READ.** The registry derives; it never writes. No topic, no
 * envelope field, no storage marker, no table. A new ledger topic here would be
 * escalation-grade and none was needed — every input below is an event some
 * producer already writes.
 *
 * **2 · IT HOLDS NO STATE.** Every query re-folds from scratch. That is not a
 * performance decision, it is the acceptance criterion: "resume after restart"
 * is only true if the answers derive from events, so the strongest way to prove
 * it is to have nowhere else for an answer to come from. `sessionRegistryTest`
 * kills `procedureCursor`'s in-memory run map and re-asks; the answers are
 * identical because this file never consulted it.
 *
 * **3 · THE UNIT IS THE SITUATION, NOT THE EVENT** (moments-model 1.3 §4a,
 * tear 2). Charlie's halt, the verify that failed, and the incident it opened
 * are one thing that happened, and the designer's argument is that a correct
 * list of parts is not a verdict about the whole. Coalescing is derived from
 * the record's own links — `correlation` into the run's turn set, `causation`
 * from an incident back to the outcome that caused it — never from adjacency or
 * from a similarity score.
 *
 * ## What a SESSION is here, and the one thing the ledger cannot tell us
 *
 * The ledger records no chat-session id. Nothing carries one: the manifest
 * (`task.context.assembled`) carries the per-TURN TaskId as `correlation` and
 * names the procedure that governed the turn, and that is all. So a "session"
 * in this file is derived, and it is derived as the RUN:
 *
 *   run key   = (procedure.capability, procedure.hash) off the manifest
 *   session   = the turns bearing that key, from the first one onward
 *   id        = `sess_<first turn's TaskId>` — stable, derived, re-derivable
 *
 * This mirrors `armProcedureRun`'s own idempotence rule exactly (same capability
 * AND same document hash ⇒ same run; a different hash is a different run because
 * an edited runbook is not the document whose checkpoints were attested), which
 * is what makes the registry's answers agree with the guard's.
 *
 * A session CLOSES when the record says it reached a terminal state — every
 * gated checkpoint attested, or a consent gate denied. A later turn bearing the
 * same key then opens a NEW session (`splitAtTerminal`, whose comment carries the
 * reasoning and the measurement behind it). Without that rule two sequential
 * runs of one runbook fold into one row and run 1's decision reads as run 2's —
 * the subject-blindness WP-36 fixed one level down, recreated one level up.
 *
 * **THE LIMIT, MEASURED AND STATED RATHER THAN PAPERED OVER:** two chat sessions
 * whose runs are BOTH IN FLIGHT at the same capability and the same document
 * hash are ONE session to this registry, because the ledger holds nothing that
 * separates them. The terminal cut above bounds this to genuinely concurrent
 * runs — sequential ones separate — but it does not close it. This is not a new
 * property of the layer: `procedureArming.ts` records the identical limit for
 * its own queue ("two concurrent chats asking for procedures in the same second
 * cannot be told apart here"). Closing it means putting a session id on an event
 * payload, which is escalation-grade. It is reported on the snapshot
 * (`concurrencyLimit`) rather than left for a reader to discover.
 *
 * A turn whose procedure was REFUSED is not a turn of the run: the document did
 * not ride, and a refusal's hash may be null, which would fork the run key on a
 * value that names no document.
 *
 * ## The consequence order (moments-model 1.3 §4a, at v1.3)
 *
 * Rank by what the delay costs and who can pay it — WITHIN A COLUMN, over
 * situations:
 *
 *   T1  the world is mid-change and only you can move it
 *   T2  awaiting consent, world untouched
 *   T3  NOT A TIER — one RESERVED slot, one folded row (the record's own
 *       health), always rendered, cannot grow, cannot be scrolled away
 *   T4  changed — orders the changed column
 *   T5  drift LEAVES THE LIST: it is a rendering rule on a fact's own chip.
 *       There is no field on any type below that could hold it, which is the
 *       only enforcement of a "never render this" rule that actually enforces.
 *
 * Gates classify by the STATE OF THE WORLD behind them, not by their kind
 * (tear 4): T1 when a write has landed in the session's scope, or when the
 * delay has a derivable deadline; T2 otherwise. Within tier: place-set first
 * (by the highest-consequence member of the derived affected set), then age,
 * oldest first.
 *
 * **The world-state rule is applied to HALTS as well as to gates, and that is a
 * judgement this file states rather than hides.** Tear 4's letter is about
 * gates; its principle is that classifying by an item's KIND rather than by the
 * world behind it is the error. A halt with nothing written is a run that
 * stopped in an untouched world; calling it T1 because "halt" sounds urgent is
 * the same mistake with a different noun. The designer's own fixture agrees —
 * Charlie is T1 because two sites are done and standing, which the row says.
 *
 * ## Pinned by "one morning, both ways"
 *
 * The designer's §2 fixture is this fold's regression pin: eight live things in,
 * two waiting situations + one reserved + one changed out. It lives in
 * `__tests__/sessionRegistry.test.ts`, under the describe named `the golden
 * fixture — the designer's "one morning, both ways" (§2)`, and future tears
 * re-render the same morning. It shares that file rather than having its own
 * because jest collects every `.ts` under `__tests__/` as a suite, so a shared
 * emitter helper cannot live beside two test files without being run as one —
 * and two copies of the emitters is how the golden fixture would quietly stop
 * being shaped like what the producers write.
 */
import type { EventEnvelope, Ledger, Runbook, RunbookCheckpoint } from '../../intelligence';
import {
  ACTION_EXECUTED_TOPIC,
  DEFERRAL_PAYLOAD_SOURCE,
  OUTCOME_RECORDED_TOPIC,
  RATIONALE_RECORDED_TOPIC,
  type DeferralWake,
} from './actionProducer';
import { AGENT_FAILURE_TOPIC, type AgentFailurePayload } from './agentFailureProducer';
import { getIntelligenceCore } from './coreRegistry';
import type { IntelligenceCore } from './bootstrap';
import { collectIntelligenceHealth, type IntelligenceHealthReport } from './health';
import { INCIDENT_TOPIC, SENTINEL_SYSTEM } from './incidentProducer';
// WP-54's merge: the Inbox's OWN hash, imported rather than reimplemented. The
// signature that lets an Inbox row ride on the situation it duplicates has to
// produce the code the Inbox actually stored, and a second implementation of a
// hash is a second answer by construction.
import { failureCode } from '../inbox/InboxStore';
import { foldProcedureCursor, runEvents, type ProcedureRun } from './procedureCursor';
import { deriveCheckpointStates, type CheckpointState } from './procedureView';
import { placeLabel, placeToken, type ScopePlace } from './procedureScope';
import {
  DOORS,
  LIST_VERDICT,
  RESERVED,
  RUN_NOUN,
  SITUATION_TEMPLATES,
  type SituationTemplate,
} from './situationCopy.generated';

/**
 * The manifest's topic, defined locally rather than imported.
 *
 * Its producer is `chatAssembly`, and importing that module for one string
 * constant is what `procedureCursor` already declined to do — the three topics
 * above come from `actionProducer`, which is a producer module light enough to
 * import and which exports them for exactly this. The asymmetry is deliberate
 * and is the directory's existing shape (`procedureView` and `incidentProducer`
 * both do the same).
 */
const MANIFEST_TOPIC = 'task.context.assembled';

// ---------------------------------------------------------------------------
// THE QUERY CONTRACT — gate-held (WP-30). M6's surfaces consume this over IPC.
// ---------------------------------------------------------------------------

/**
 * Tiers 1, 2, 3 and 4.
 *
 * **TWO PACKETS WIDENED THIS INDEPENDENTLY, FROM THE SAME EVIDENCE, WITHOUT
 * EITHER SEEING THE OTHER — and the owner GRANTED it at both gates.** WP-54a
 * reached it from the producer side and WP-54 from the render side; the merge
 * found one type declaration and two reasonings, which is convergence rather
 * than duplication. Both are kept, because they are different halves of the
 * same argument.
 *
 * It used to read `1 | 2 | 4` with the note: *"there is deliberately no 3: tear
 * 3 ruled tier 3 out of the comparator and into structure, and a tier value
 * nothing can hold is how that ruling is enforced rather than merely
 * documented."* That note recorded a real ruling — moments-model §4a tear 3,
 * 2026-08-18, ratified at WP-30's gate: *"Tier 3 is STRUCTURE, not rank: one
 * RESERVED slot…"*
 *
 * **WP-54a's half — TWO RATIFIED FACTS DISAGREE**, which is the family that
 * produced every defect that week: one rule, two sources. The ratified
 * `agent.stuck` template carries **`Tier 3 · the agent is asking, not the
 * fleet`** and states its own sort consequence: *"the one class where the
 * subject is the platform rather than the fleet, which is why it sorts below
 * both waiting classes however old it is."* That is a RANK claim, and it is
 * newer than tear 3. Ranking it 2 while the card reads Tier 3 would reproduce
 * the tier-drift finding in a brand-new class the same week it was raised.
 *
 * **WP-54's half — THE PROXY IS NOT THE PROPERTY**, which is the reasoning the
 * ruling cites. Tear 3 ruled the EPISTEMIC tier out of the comparator, and that
 * ruling is UNTOUCHED: `ReservedRow` is not a `Situation`, it never enters
 * `rankSituations`, and there is no field on it that could hold a second row.
 * The absent type value was a PROXY for that property, and the property is now
 * asserted directly (`sessionRegistry.test.ts`: "staleness is counted, never
 * turned into rows"). What was lost is an enforcement device, and a device is
 * not the ruling. The designer's tier 3 is a tier of the OPERATIONAL list, not
 * the epistemic one — two different facts that happened to be given one number.
 *
 * A type that cannot hold what the ratified copy says forces the copy and the
 * comparator apart, which is the defect both packets exist to remove. So the
 * type holds it. **`agent.stuck` now has a producer** (WP-54a's
 * `agentFailureProducer.ts`), so tier 3 has a real resident rather than a
 * reserved seat — which is the widening's justification arriving rather than
 * being argued.
 */
export type ConsequenceTier = 1 | 2 | 3 | 4;

/** Return's two columns, one verdict (designer §1 objection 1; the split refused). */
export type TriageColumn = 'waiting' | 'changed';

/** What a session is doing, derived — never a label a caller sets. */
export type SessionStatus = 'waiting' | 'running' | 'halted' | 'complete';

/** What an active gate is waiting for. A narrative step is never active. */
export type GateAwaits = 'approval' | 'evidence';

/**
 * WHERE you are needed, by gate id.
 *
 * J-Return's must-not is "a needs-you row that knows THAT but not WHERE", and
 * `checkpointId` is the where. `index`/`of` exist because the designer's row
 * says "approval gate 3 of 8 in remediate" — a position a reader can hold in
 * their head, derived from the document's own ordered checkpoint list.
 */
export interface PendingGate {
  checkpointId: string;
  /** 1-based position in the runbook's declared checkpoint list. */
  index: number;
  of: number;
  awaits: GateAwaits;
  runbookId: string;
  capability: string;
}

/**
 * One consent gate and its standing.
 *
 * `state` is the invariant J-Return's second must-not is about: an approval
 * given before the user left must still read `approved` after they come back.
 * It is folded from `task.rationale.recorded` through `foldProcedureCursor`, so
 * it survives a restart for the same reason the cursor does — it was never in
 * memory.
 *
 * A SET OF {checkpoint, decision, moment}, NEVER A COUNT OR A BOOLEAN — the
 * designer's second contract requirement (from-designer-09 §"What I need from
 * WP-30's query contract"; adopted into this contract at the cycle-five
 * adjudication). XD-26 renders the standing approval as its own block above the
 * gate — "You approved this plan yesterday at 12:11. That approval still stands
 * — you are not being asked again." A boolean makes that sentence unwriteable,
 * and a count makes it a lie about which plan.
 */
export interface PendingApproval {
  checkpointId: string;
  state: 'pending' | 'approved' | 'denied';
  /**
   * The rationale event that decided it.
   *
   * PRESENT FOR `approved`, ABSENT FOR `denied`, and that asymmetry is
   * inherited rather than chosen: `ProcedureCursorState.evidence` is populated
   * "only for checkpoints in `attested` … never for denied ones, whose evidence
   * says no" (WP-20e). Re-deriving a denial's event here would put a second
   * copy of the bound/legacy rationale rule beside `foldProcedureCursor`'s,
   * which is how a reader and a fold start disagreeing about what a run
   * contains. Reported as a measured limit instead.
   */
  eventId?: string;
  /**
   * WHEN the human decided — `observed_at` on the rationale event, which is the
   * moment of the click. Deliberately not `recorded_at`: the sentence XD-26
   * renders is about when the person approved, and conflating the two is the
   * one thing the envelope rules forbid outright.
   *
   * Same presence rule as `eventId`, and for the same inherited reason.
   */
  decidedAt?: string;
}

/**
 * PLACE IS A SET (§4a tear 6). The sort key and the rendered fact come from one
 * derivation, so the sort is inspectable where it is used.
 */
export interface PlaceSet {
  /** Canonical place tokens the affected set spans, highest-consequence first. */
  tokens: string[];
  /** The member that ORDERS the row. Null when nothing named a place. */
  highest: string | null;
  /** Targets at `highest`, and targets in the affected set. "production on 2 of 5". */
  atHighest: number;
  total: number;
  /** Targets whose place nothing on record could name. Never guessed. */
  unresolved: number;
  /** The rendered fact, derived from the same numbers the sort used. */
  summary: string;
}

/**
 * A target whose last recorded act FAILED, and the record that says so.
 *
 * Carried whole rather than as a bare id because a failure is a situation PART
 * (tear 2, "expandable to its parts") and a part with no event id is a claim.
 */
export interface FailedTarget {
  entityId: string;
  outcomeEventId: string;
  observedAt: string;
  tool: string;
}

/** What the run did to the world, per target, from `task.outcome.recorded`. */
export interface SessionOutcomes {
  /** Entity ids with a recorded successful gated act. */
  succeeded: string[];
  /** Targets whose last recorded act failed. One representation, not two. */
  failed: FailedTarget[];
  /**
   * True when a gated act SUCCEEDED — the platform's own "this was not a
   * read" classification, since `recordGatedAction` emits nothing below tier 2.
   * This is the T1 test's first arm.
   */
  writeLanded: boolean;
  /** The action event that proves `writeLanded`. */
  writeEventId?: string;
}

/**
 * A deadline the RECORD derives — §4a's second T1 condition.
 *
 * Implemented as a port because the rule is law and dropping it would be
 * silently not implementing a ruled rule. **Nothing supplies one today**: no
 * producer records a dry-run staleness clock or a maintenance window, so in
 * production T1 is reached by the write-landed arm alone. Stated on the
 * snapshot (`deadlineSource`) rather than left to be inferred from an always-
 * absent field.
 */
export interface DerivedDeadline {
  at: string;
  /** What derives it. Never authored beside the value. */
  from: string;
}

/** One session, as the registry derives it. */
export interface SessionRow {
  /** `sess_<first turn's TaskId>`. Stable across re-entry and across restart. */
  id: string;
  capability: string;
  /** The runbook the manifest named. Null when the manifest carried none. */
  runbookId: string | null;
  /** The document hash the run is pinned to — half of the run key. */
  runbookHash: string;
  /** Turn TaskIds, oldest first. The correlation set the fold is over. */
  taskIds: string[];
  status: SessionStatus;
  /** Absent when nothing is pending — a complete run has no gate. */
  gate?: PendingGate;
  /**
   * THE WHOLE DECLARED LIST AND WHAT THE RECORD SAYS OF EACH — the designer's
   * first contract requirement, in its stronger half.
   *
   * The gate id alone tells a surface where the run stands; this tells it which
   * checkpoints were attested BEFORE the excursion, so a resumed declaration
   * renders its marks from the record rather than from the cursor's position.
   * XD-26's marks discipline depends on the difference: the tick belongs only
   * to an attested PROVABLE checkpoint and a reached narrative one takes the
   * neutral recorded-not-proved dot, which a position cannot distinguish.
   *
   * It is `CheckpointState` — `procedureView`'s own type, from
   * `deriveCheckpointStates`, the SAME derivation the two densities render.
   * "A difference between the densities and this sheet would be a defect in one
   * of them" (XD-26), and one shape from one derivation is how that is kept
   * true rather than promised.
   *
   * Absent when `documentUnavailable`: there is no declared list to report.
   */
  checkpoints?: CheckpointState[];
  /** Every consent gate the document declares, with its standing. */
  approvals: PendingApproval[];
  outcomes: SessionOutcomes;
  places: PlaceSet;
  /**
   * HOW MANY TARGETS THE ARMING SELECTED — the "derived target set" the
   * designer's slot table names, read from the manifest's own `scope.runnable`.
   *
   * **This is NOT `places.total`, and conflating them was WP-48's defect.**
   * `places` describes the targets that have an OUTCOME; this describes the
   * targets a human or a predicate SELECTED, before anything was done to them.
   * A run mid-flight has 2 in `places` and 5 here, and that difference is
   * exactly what "the rest are waiting on you" refers to.
   *
   * **Null means UNKNOWN, never empty.** A manifest with no scope means nothing
   * selected anything, which is a different fact from selecting nothing.
   */
  targetSet: number | null;
  /** ISO — the first turn's observed_at. */
  startedAt: string;
  /** ISO — the newest folded event's observed_at. */
  lastActivityAt: string;
  /** The newest ledger event id folded into this row. The change cursor. */
  lastEventId: string;
  /**
   * The registry holds no document matching this run's pinned hash, so no
   * cursor could be folded. The session is reported with what IS known rather
   * than folded against a document it was not run under.
   */
  documentUnavailable?: boolean;
  /**
   * The ledger read was truncated and this session owns the oldest turn read,
   * so its first turn — and therefore its id — may lie beyond the horizon.
   * Only ever set on one session per snapshot.
   */
  idProvisional?: true;
}

/**
 * One part of a situation, kept so a row can expand to its parts (tear 2).
 *
 * **The GATE is not a part.** It is an attribute of the situation, because the
 * row's job is to name where you are needed — one situation, one where. Making
 * it a part would put the answer inside the expansion, which is the shape tear 2
 * is against: "a correct list of parts is not a verdict about the whole."
 */
export interface SituationPart {
  kind: 'run' | 'outcome' | 'incident' | 'agentFailure';
  /** The ledger event this part is, when it is one. */
  eventId?: string;
  topic?: string;
  /** ISO, from the part's own record. */
  observedAt?: string;
  /** Derived from the part's own fields. Never composed prose. */
  summary: string;
}

/**
 * WP-56 · A STANDING DEFERRAL, folded from the run's own record.
 *
 * Cycle two's ruling, and every clause of it is a property of this shape rather
 * than a note about it:
 *
 *  - **It is not a dismissal.** There is no field here that could remove a row,
 *    change a tier or change a place — the fold attaches this and touches
 *    nothing else, so "keeps its tier and its place, lowers escalation only" is
 *    enforced by what the post-pass CAN reach.
 *  - **It hangs off the SITUATION.** `SituationPart` gains no equivalent, which
 *    is XD-28's "applies to the situation, never to its parts" enforced the way
 *    tier 3 is enforced — by there being nowhere to put the other thing.
 *  - **Only the user defers**, so a record whose actor is not human never
 *    becomes one of these (`foldDeferrals`).
 *  - **Absent means escalating.** A woken, ended or answered deferral leaves no
 *    residue on the row: the field is simply not there, and every consumer's
 *    question is `!situation.deferral`.
 */
export interface SituationDeferral {
  /** The rationale event that recorded it. The row's receipt. */
  eventId: string;
  /**
   * The user's own words, as the record holds them.
   *
   * Masked at the producer against the value-shape layer, so a reason that
   * carried something credential-shaped reads back with that part redacted.
   * Never composed, never defaulted, and never empty — the producer refuses a
   * deferral with no reason.
   */
  reason: string;
  /**
   * ISO — `observed_at` on the deferral event, which is the moment of the click.
   *
   * Deliberately not `recorded_at`: "deferred by you 4h ago" is a claim about
   * when the person decided, and conflating the two is the one thing the
   * envelope rules forbid outright. A surface ages it with `ageLabel`, the same
   * function the headline uses, so the row cannot disagree with itself.
   */
  deferredAt: string;
  /**
   * NULL WHEN UNCONDITIONED, and that is a permitted deferral rather than a
   * degraded one: "an unconditioned deferral is permitted and simply never
   * wakes — the item keeps its tier and place forever at low intensity, which
   * is your never-a-dismissal rule holding."
   */
  wake: DeferralWake | null;
}

/**
 * WP-51 · the ENVELOPE fields a fold may key on. Deliberately a closed union.
 *
 * `correlation` is the only member today: a scan's TaskId, minted by the
 * sentinel producer, naming a `task.run.completed` act that exists. A second
 * member (`causation`, say) would be a ruling, and adding it here is where that
 * ruling would have to be written down — which is the point of naming the kind
 * on the row rather than leaving the reader to infer it.
 */
export type SituationLink = 'correlation';

/**
 * WP-54 · ITEM 1 — WHAT MAKES TWO RECORDS THE SAME THING.
 *
 * The Now list renders situations folded from the ledger AND items from the
 * Inbox, and nothing reconciled them: four security findings rendered as
 * situations and again as inbox cards, twelve rows under a badge of seven.
 *
 * The two records are the same THING when three facts agree — the producer that
 * raised it, the finding it is about, and the target it is on. Three, not one:
 * `fact` alone collides across sites (every site can have `FS-01`), `target`
 * alone collides across findings (four of them are on one site), and `producer`
 * alone is an agent. All three is the same observation seen from two stores.
 *
 * COMPOSED HERE rather than matched in the surface, because a match rule in the
 * renderer is a second opinion about identity. `null` on a row with no such
 * identity — every session row — and absent is the honest answer there rather
 * than a signature nothing can match.
 */
export interface SituationSignature {
  /** The producer, normalised — see `normalizeProducerId`. */
  producer: string;
  /** The finding's own code, as the producer wrote it (`ABS-05`, `FS-01`). */
  fact: string;
  /** What the finding is on, resolved to its name where the record has one. */
  target: string;
}

/**
 * One spelling for a producer, so two stores can be compared.
 *
 * The ledger stamps an ACTOR id (`act_security_sentinel`); the Inbox stores an
 * AGENT id (`security-sentinel`). Same producer, two spellings, and neither
 * store is wrong — so the comparison normalises rather than either side being
 * rewritten. Same shape as this repo's other two-copies-of-one-rule cases
 * (`normalizeLogPrefix`, `localDay`), and it is exported so a pin can drive it
 * over both spellings directly.
 */
export function normalizeProducerId(value: string): string {
  return value.replace(/^act_/, '').replace(/_/g, '-').toLowerCase();
}

/**
 * Where a row's door goes, and what it says.
 *
 * `label` is ratified copy with its slots filled; `kind` and `target` are the
 * destination. Kept as a small record rather than a bare string because a door
 * that names a place without carrying it is the "top of Settings" failure
 * WP-44 already paid for — the bridge must carry the WHOLE target.
 */
export interface RowDoor {
  label: string;
  kind: 'session' | 'site' | 'agent';
  target: string;
}

/** The triage's unit. A situation of one is still a situation. */
export interface Situation {
  /** The session id, or the incident event id for a situation of one. */
  id: string;
  /**
   * WP-54a added `agentFailure`, and the addition is the whole packet in one
   * word: the fold built situations from sessions and orphan incidents and
   * nothing else, so the ratified `agent.stuck` class had a working selector
   * arm and no input that could reach it.
   *
   * Deliberately NOT folded into `incident`. The designer's own note is that
   * this is "the one class where the subject is the platform rather than the
   * fleet", and an agent timeout filed as an incident would reach
   * `situationOfIncident` and the assembler's episodic summary as though a
   * site were broken.
   */
  kind: 'session' | 'incident' | 'agentFailure';
  column: TriageColumn;
  tier: ConsequenceTier;
  /** WHY this tier, naming the evidence. Derived, never authored. */
  tierReason: string;
  /** Present on `kind: 'session'`. */
  sessionId?: string;
  /**
   * WP-49a · THE RUN'S CAPABILITY — `SessionRow.capability`, carried onto the
   * situation, and it closes two escalations with one field.
   *
   * The row already knew it; nothing on `Situation` said it, so every surface
   * that wanted to name the run in a sentence had to reach for `meta` (the
   * runbook id) instead. That is why WP-49 shipped two interim asks reading
   * *"Why has {runbookId} changed nothing?"* where §5's own bytes say *"Why has
   * the update run changed nothing?"* — the run NOUN is `RUN_NOUN[capability]`
   * (Controlled Vocabulary v1.4) and the capability was one join away.
   *
   * ABSENT ON AN INCIDENT ROW, and absent rather than empty: an orphan incident
   * was never armed under a capability, and `''` would read as one it could not
   * name. A surface reading this on an incident gets `undefined` and withholds,
   * which is this layer's own rule about an absence.
   */
  capability?: string;
  /** Present when a gate is pending — the WHERE. */
  gate?: PendingGate;
  places: PlaceSet;
  /** ISO — the oldest part. The age the sort uses. */
  since: string;
  /** Newest event id across the parts. */
  lastEventId: string;
  parts: SituationPart[];

  // --- WP-51 · what the fold folded, and what justified folding it ---------

  /**
   * HOW MANY EVENTS THIS SITUATION FOLDED. Present on every incident row,
   * absent on a session row.
   *
   * The designer's coalesced sheet reads it in two guards —
   * `incident.no-run` gained `&& memberCount === 1` and `incident.coalesced`
   * is `memberCount > 1 && row.linkKind !== null` — so it is their field, not
   * this fold's invention, and a singleton carries `1` because folding one
   * event is a true statement about it rather than a default standing in for
   * a missing one.
   *
   * ABSENT on a session row: a session's members are its turns, its outcomes
   * and its incidents, which is a different count with a different meaning,
   * and giving it this name would be the `{total}` collision one field over.
   */
  memberCount?: number;
  /**
   * THE RECORD LINK THAT JUSTIFIED THE FOLD, or `null` when nothing was folded.
   *
   * `null` on every row that stands alone — including one that HAS a
   * correlation and simply had no sibling to join. The field answers "what
   * made these one thing", and a row that is one thing on its own was made so
   * by nothing.
   *
   * A payload field can never appear here. That is the doctrine WP-50's ruling
   * left unamended — *"the link becomes a genuine record link; the payload
   * stays unread"* — and the type is what enforces it: `source: sentinel:<run>`
   * is a payload string and has no value in this union.
   */
  linkKind?: SituationLink | null;

  // --- WP-48 · the verdict, composed ONCE here (the ratified placement) ----

  /**
   * THE ROW'S ONE SENTENCE. World state first, then the ask beneath it.
   *
   * Composed in the host from the ratified templates
   * (`situationCopy.generated.ts`) so every `TriageView` consumer renders the
   * identical verdict — the arrival, the panel and the rail's accounting line
   * cannot drift between densities because there is only one derivation. A
   * surface that composed its own would be the second place the wording lives.
   */
  headline: string;
  /** What is being asked, and what stopping costs. Follows the headline. */
  ask: string;
  /**
   * ONE WORD, or empty. A badge never carries a sentence — the phrases the
   * chips used to carry live on the meta line as text, which is why `state`
   * exists beside this.
   */
  chip: string;
  /** A status phrase for the meta line, or empty. */
  state: string;
  /** The meta line's identifier — the runbook id, the producer, the agent. */
  meta: string;
  /**
   * WP-52 · THE RULE LINE'S TEXT, COMPOSED ONCE HERE — item 3, ratified.
   *
   * The designer read the live build: "the rule lines are rendering as lowercase
   * italic prose. The ratified form is the template's own `rule` field —
   * `Tier 2 · the world is untouched`, upright, tier named. Italics is a
   * treatment nothing ratified, and a lowercase fragment reads like an apology
   * for the row."
   *
   * So a row composed from a ratified class carries that class's `rule`. A row
   * that reached the DERIVED fallback has no class and therefore no ratified
   * rule, and carries `tierReason` instead — the derived evidence that placed it
   * ("a write has landed in scope — 2 target(s) …"), which is XD-23's own
   * requirement and is exactly right for a row the ratified set does not cover.
   *
   * ONE FIELD, FILLED HERE, so the component renders it unconditionally. The
   * alternative — a renderer choosing between `rule` and `tierReason` — would
   * put a branch on "which sentence a row deserves" back in the surface, which
   * is the property WP-48's placement argument bought.
   *
   * `tierReason` STAYS ON THE CONTRACT and is unchanged: it is the audit answer
   * to "why is this row here", and the eval's no-prose accounting reads it.
   */
  rule: string;
  /**
   * WHICH ratified class composed the headline, by the designer's own id, or
   * `null` when no template's guard selected this row and the derived sentence
   * was used instead. Reported rather than inferred: a surface that cannot say
   * which sentence set it is rendering cannot be audited against the set.
   */
  headlineTemplate: string | null;
  /**
   * WP-54 · ITEM 6 — THE DOOR, NAMING ITS DESTINATION, composed here.
   *
   * "Open where you are needed" was ratified and failed its first contact with
   * a person: the owner, on the live build, *"not sure what that really means."*
   * A door now says where it goes — *Open the run at cp.backup*, *Open
   * theawfulpm-test* — from a fact the row already carries, so the reader knows
   * what the click costs before making it.
   *
   * COMPOSED IN THE HOST for the reason every other sentence on this contract
   * is: a label built in the surface is a second place the vocabulary lives.
   * `kind` says what the surface must DO with `target`, and the three kinds are
   * three different destinations — a session promotes, a site scopes the panel
   * to it, an agent opens the agent. `null` on a row with nowhere to go, which
   * is a state the surface must render as no door rather than as a dead one.
   */
  door: RowDoor | null;
  /**
   * WP-54 · ITEM 1 — the identity an Inbox item is matched against, or `null`.
   * See `SituationSignature`.
   */
  signature: SituationSignature | null;
  /**
   * The three numbers the headline was composed FROM, carried on the row.
   *
   * The list verdict reads these rather than re-deriving them from sessions, so
   * it is generated from the very rows the columns render and structurally
   * cannot disagree with them — the accounting line's own property, applied to
   * the sentence the accounting line cannot say.
   *
   * `total` is the ARMED TARGET SET (`SessionRow.targetSet`) and is **null when
   * the record does not say** — not zero. It is deliberately not
   * `places.total`: see `SessionRow.targetSet` for the collision that cost.
   */
  written: { done: number; failed: number; total: number | null };
  /**
   * WP-56 · PRESENT ONLY WHILE A DEFERRAL STANDS. See `SituationDeferral`.
   *
   * The row is still in the list, still at its tier, still in its place. What
   * it is out of is the badge and the verdict's count — read `TriageCounts`,
   * never `waiting.length`, for the number that means "escalating".
   */
  deferral?: SituationDeferral;
}

/**
 * The reserved slot (tear 3). ONE row, always, whatever the counts say.
 *
 * Twelve dark producers are one row saying twelve, not twelve rows: "going
 * blind is not one item… twelve dark producers under a visibility guarantee
 * become twelve rows in the list they were promised a place in, and the
 * epistemic tier evicts the operational one it was ranked below."
 */
export interface ReservedRow {
  /** Derived from the counts. One sentence, always present. */
  headline: string;
  /** Every dark producer, folded into the one row. */
  dark: Array<{ system: string; label: string; detail?: string }>;
  /** Producers reporting late but not dark — counted, never promoted to a row. */
  staleCount: number;
  /** The worst verdict the health report reached. */
  verdict: IntelligenceHealthReport['worst'];
  /** True when the health check itself could not measure something. */
  degraded: boolean;
}

/**
 * WP-49a · XD-27 RIDER 1 — an in-flight run that needs nothing of you.
 *
 * "An in-flight run needing nothing goes to Nothing-needed-of-you as ONE LINE
 * with its door, and PROMOTES ITSELF into the list when it stalls or reaches a
 * gate — the consequence order doing its job, not a new mechanism."
 *
 * WP-49 built the predicate, MEASURED that every reachable shape belonged in the
 * list where the fold already put it, and removed it rather than shipping a
 * filter that would have moved XD-26's 6c rows — a run the platform cannot place
 * — into the section for things that need nobody. This is the same predicate,
 * built where the fact lives, with the third finding encoded as a guard rather
 * than as a paragraph:
 *
 *   status is `running` · no pending gate · **not `documentUnavailable`**
 *
 * MEASURED ON THE OWNER'S REAL LEDGER, 2026-08-20, and the number is zero: of
 * three sessions, one is gated at `cp.backup` and the other two are gateless AND
 * `documentUnavailable` — WP-49's finding 3, twice over. So this list is EMPTY on
 * the real fleet today and nothing moves out of the waiting column. The rider is
 * law with its fact now on the contract; the day a run is genuinely in flight
 * under a document the registry holds, it renders here instead of asking.
 *
 * A WORKING ROW IS NOT IN `waiting`. That is the rider's whole content — a run
 * needing nothing must not be counted among the things needing you, or the badge
 * and the verdict both lie — and it is why `triage()` filters the column against
 * this list rather than composing them independently.
 */
export interface WorkingRow {
  sessionId: string;
  capability: string;
  /**
   * The one line. COMPOSED FROM THE RECORD'S OWN WORDS AND NOTHING ELSE: the run
   * noun from Controlled Vocabulary v1.4 (`RUN_NOUN[capability]`, ratified) and
   * the fold's own `SessionStatus` value. No sentence is authored here — the
   * copy discipline's rule is that a class the ratified set does not cover gets
   * the derived form, never new prose, and this is the derived form.
   *
   * A capability the vocabulary does not name falls back to the capability id,
   * cited in full. An id is honest; a guessed noun is not.
   */
  line: string;
  /** ISO — when the run started, so a surface can age the line with `ageLabel`. */
  since: string;
  /** The newest folded event id. The change cursor, as everywhere else. */
  lastEventId: string;
}

/**
 * WP-56 · THE COUNTS, DERIVED HERE BECAUSE A COUNT IS A DERIVED FACT.
 *
 * **This closes a latent defect that predates deferral.** `arrivalCounts()` in
 * the renderer computed `needsYou: triage.waiting.length` — a surface
 * re-deriving a count from a list, which is the shape WP-49a's rider already
 * ruled against: "the badge, the verdict and the rows all count the same set —
 * composing the two independently is how a list and the sentence about it start
 * disagreeing." Deferral is simply the first fact that makes the disagreement
 * visible, because it is the first thing that is IN the list and NOT in the
 * count.
 *
 * So the host counts, and the surface reads. That is this contract's own rule
 * (`arrivalModel.ts`: "THE HOST FOLDS AND THE SURFACE READS") applied to the one
 * number it had not yet reached.
 */
export interface TriageCounts {
  /**
   * THE SITUATIONS THIS FOLD HOLDS THAT ARE CURRENTLY ESCALATING.
   *
   * XD-23: "the ambient badge counts situations currently escalating — an
   * instrument, not an inventory." A deferred situation is not escalating, so it
   * is not here; it IS in `waiting`, where the inventory lives. A badge that
   * kept counting a deferred situation would mean the deferral deferred nothing.
   *
   * **This is `waiting.length` MINUS `deferred`, and it must never be re-derived
   * as `waiting.length` by a consumer.** That is the whole reason the field
   * exists rather than the arithmetic being left to each surface.
   *
   * **IT IS NOT, BY ITSELF, THE RAIL BADGE — and the correction is WP-54's.**
   * This doc said "the rail badge, and nothing else" and that stopped being true
   * when the Now list became one list: the screen renders these situations PLUS
   * every Inbox item matching none of them, and those rows exist ONLY in the
   * renderer. A surface that painted this number on the badge would drop them.
   * The badge is `arrivalCounts().needsYou`, and the two are tied by an identity
   * pinned in `nowList.test.tsx`:
   *
   *     badge  ===  counts.needsYou  +  <escalating unheld rows>
   *
   * With no Inbox read the second term is zero and the two are equal, which is
   * why the wrong version of this sentence survived as long as it did.
   */
  needsYou: number;
  /**
   * DEFERRED BY THE USER, and still standing in `waiting`.
   *
   * XD-23's honesty guarantee: "the panel's accounting line states the deferral,
   * so the count can never read as the whole truth — '1 needs you · 1 deferred
   * by you'." Without this number the accounting line could state the first
   * clause and not the second, and `needsYou` alone would read as the whole
   * list. The two are published together because they are only honest together.
   */
  deferred: number;
}

/** The arrival triage: two columns of one verdict, plus the reserved slot. */
export interface TriageView {
  waiting: Situation[];
  reserved: ReservedRow;
  changed: Situation[];
  /**
   * WP-49a · rider 1's rows — in-flight runs needing nothing, one line each.
   * Empty is the normal state and is not an error; see `WorkingRow`.
   */
  working: WorkingRow[];
  /**
   * ONE SENTENCE ABOUT THE WHOLE LIST, which no single row can say.
   *
   * "Nothing is half-done, so nothing is expensive to stop" is the most useful
   * thing this data produces and it is invisible row by row. Derived from
   * `waiting`'s own `written` counts — the same rows the columns are about to
   * render — so it cannot contradict them. Empty when nothing is waiting.
   */
  verdict: string;
  /**
   * WP-56 · The numbers the columns are about, derived from the very rows the
   * columns render. Read `counts.needsYou` for the badge, never `waiting.length`.
   */
  counts: TriageCounts;
  /** Hand this back to `changedSince` next time. */
  cursor: string;
}

/** What moved since a caller's cursor. */
export interface ChangeSet {
  /** The new cursor. */
  cursor: string;
  /** Sessions whose newest folded event is newer than the caller's cursor. */
  sessions: SessionRow[];
  /** Situations whose newest part is newer than the caller's cursor. */
  situations: Situation[];
  /**
   * The caller's cursor is older than the oldest event the ledger still holds,
   * so this is a full re-read wearing a delta's clothes. Saying so is the
   * difference between a delta and a claim.
   */
  cursorUnknown: boolean;
}

/** One fold, everything derived from it. `triage`/`sessions`/`changedSince` are views. */
export interface SessionRegistrySnapshot {
  /** ISO — when this fold ran. */
  at: string;
  sessions: SessionRow[];
  situations: Situation[];
  reserved: ReservedRow;
  /** The newest ledger event id this fold saw. The cursor callers hold. */
  cursor: string;
  /** How the ledger read was bounded, and whether it bit. */
  horizon: {
    manifestsRead: number;
    limit: number;
    truncated: boolean;
    /** The oldest manifest id read. Null when nothing was read. */
    oldestManifestId: string | null;
  };
  /**
   * Two concurrent chats at one capability and one hash are one session here.
   * Carried on every snapshot so no consumer has to know to ask.
   */
  concurrencyLimit: string;
  /** Where a derivable deadline would come from. Names the absence honestly. */
  deadlineSource: string;
  /**
   * WP-56 · Where a `record` wake condition would be decided. Names the absence
   * honestly, exactly as `deadlineSource` does for the other half-implemented
   * ruled rule.
   */
  wakeSource: string;
}

/** The query surface. M6's IPC handlers call these; nothing else does. */
export interface SessionRegistry {
  /** Every session the ledger knows about, newest activity first. */
  sessions(): SessionRow[];
  /** One session by its derived id. */
  session(id: string): SessionRow | undefined;
  /** The arrival triage, ranked by the consequence order. */
  triage(): TriageView;
  /** What moved since a cursor. Omit the cursor for everything. */
  changedSince(cursor?: string): ChangeSet;
  /** The whole fold, for a caller that wants all four answers from one read. */
  snapshot(): SessionRegistrySnapshot;
}

/** Resolve an entity id to WHERE it is. Absent ⇒ places go unresolved, never guessed. */
export type DescribePlace = (entityId: string) => ScopePlace | undefined;

/** Runbooks, narrowed to what the fold reads. */
export type RunbookLookup = Pick<
  { byCapability(capability: string): Runbook | undefined },
  'byCapability'
>;

export interface SessionRegistryDeps {
  /** Test seam. Production reads the process-wide core, like every reader here. */
  core?: IntelligenceCore;
  /** Overrides `core.law.runbooks`. */
  runbooks?: RunbookLookup;
  /** Overrides `collectIntelligenceHealth(...)` — the reserved slot's only input. */
  health?: IntelligenceHealthReport;
  describePlace?: DescribePlace;
  /**
   * WP-54 · ITEM 4 — WHAT A TARGET IS CALLED, from the record itself.
   *
   * `describePlace` answers WHERE an entity is (production, staging, local).
   * Nothing answered WHAT IT IS CALLED, so four incident cards rendered
   * *"… on ent_env_2TH5EJB62XMHN2YRX5V0JTHWMA"* while the inbox card beneath
   * each of them said *theawfulpm-test*. The platform had the name.
   *
   * IT IS IN THE LEDGER, not in a host service: the `site.core` twin fact
   * carries `{"name":…,"domain":…}` for exactly these entities, folded from
   * observations the platform already recorded. So this port is DEFAULTED from
   * `core.twins` inside the fold rather than wired from `services` — no new
   * host reach, nothing outside the ledger, and the identity that answers is
   * the same one every other twin-backed reader would get.
   *
   * `undefined` when the record does not name the entity, and the composer then
   * cites the id in full. An id is not a failure; a fabricated name would be.
   */
  nameOf?: (entityId: string) => string | undefined;
  /**
   * §4a's second T1 condition. Nothing supplies one in production; the port is
   * here so the rule is implemented and pinned rather than quietly dropped.
   */
  deadlineFor?: (input: {
    capability: string;
    taskIds: readonly string[];
    events: readonly EventEnvelope[];
  }) => DerivedDeadline | undefined;
  /**
   * WP-56 · HAS A `record` WAKE CONDITION FIRED?
   *
   * A port for the same reason `deadlineFor` is one: cycle two ruled that a
   * wake may be "a time, or a record condition (the window opening, a producer
   * coming back)", and implementing only half of a ruled rule while the other
   * half looks implemented is worse than implementing neither.
   *
   * **A `time` wake never reaches here** — it is derivable from the clock the
   * fold already holds, so `foldDeferrals` decides it directly. This is asked
   * only about `kind: 'record'`.
   *
   * **NOTHING SUPPLIES ONE TODAY.** No producer publishes a vocabulary of record
   * conditions, so in production a record-conditioned deferral never wakes and
   * behaves exactly like an unconditioned one. Stated on the snapshot
   * (`wakeSource`) rather than left to be inferred from a port that is always
   * absent — the same treatment, for the same reason, as `deadlineSource`.
   *
   * A throwing implementation costs the wake, never the row.
   */
  wakeFired?: (input: {
    wake: Extract<DeferralWake, { kind: 'record' }>;
    situation: Situation;
    now: Date;
  }) => boolean;
  now?: Date;
  /** How many manifests to read, newest first. */
  manifestLimit?: number;
  /** How many rationale events to read for deferrals, newest first. */
  deferralLimit?: number;
}

/**
 * Manifests read per fold, newest first.
 *
 * Newest-first because an ascending query that hits its limit silently drops the
 * NEWEST events (the ledger's own WP-03 note), and a triage missing today's
 * sessions is worse than one missing last month's. The cost is that a very old
 * session's FIRST turn can fall outside the horizon; the one session that could
 * happen to is flagged `idProvisional` rather than left to shift its id
 * silently as the ledger grows.
 */
export const MANIFEST_SCAN_LIMIT = 2000;

/**
 * Incidents read per fold, newest first.
 *
 * Bounded for the same reason the manifests are, and read DESC for the same
 * reason: an incident that fell outside the window is one nobody is being shown
 * a stale row about, whereas a missing recent one is a halt the triage does not
 * mention.
 */
const INCIDENT_SCAN_LIMIT = 500;

/**
 * Agent failures read per fold, newest first — same bound and same direction as
 * the incidents, for the same two reasons. Generous relative to the traffic:
 * the topic records one event per agent per open-or-close transition, and the
 * owner's live ledger holds one such fact in total.
 */
const AGENT_FAILURE_SCAN_LIMIT = 500;

const CONCURRENCY_LIMIT_NOTE =
  'the ledger records no chat-session id, so two chats whose runs are BOTH IN FLIGHT at the same ' +
  'capability and the same document hash are ONE session here; sequential runs separate at the ' +
  'terminal cut. Closing the concurrent case means a session id on an event payload, which is ' +
  'escalation-grade (procedureArming.ts records the identical limit for its own queue)';

const DEADLINE_SOURCE_NOTE =
  'no producer records a dry-run staleness clock or a maintenance window, so §4a\'s deadline arm ' +
  'of T1 has no input in production and T1 is reached by the write-landed arm alone';

/**
 * Deferral records read per fold, newest first.
 *
 * Bounded and DESC for the reason the other two scans are: a deferral that fell
 * outside the window is one nobody is being shown a stale quieting for, whereas
 * a missing recent one would put a situation the user just deferred straight
 * back in the badge — which reads as the affordance not working.
 */
const DEFERRAL_SCAN_LIMIT = 500;

const WAKE_SOURCE_NOTE =
  'a `time` wake is derived from the fold\'s own clock and works today; a `record` wake is decided ' +
  'by the `wakeFired` port, and NOTHING SUPPLIES ONE — no producer publishes a vocabulary of record ' +
  'conditions — so a record-conditioned deferral never wakes in production and behaves as an ' +
  'unconditioned one until a producer does';

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/**
 * How much a place costs to be wrong about. Production above staging above
 * development above local — the rank the order sorts by, in one place.
 */
const PLACE_CONSEQUENCE: Record<string, number> = {
  wpe_production: 4,
  external_production: 4,
  wpe_staging: 3,
  external_staging: 3,
  wpe_development: 2,
  external_development: 2,
  local: 1,
};

function placeRank(token: string | null): number {
  return token ? (PLACE_CONSEQUENCE[token] ?? 0) : 0;
}

/**
 * The affected set, as a set.
 *
 * `summary` is built from the same counts the sort key came from, which is
 * tear 6's point: "sort key and rendered fact come from the same derivation, so
 * the sort is inspectable in the place it is used."
 */
function derivePlaces(entityIds: readonly string[], describe?: DescribePlace): PlaceSet {
  const unique = [...new Set(entityIds)];
  const tokens: string[] = [];
  let unresolved = 0;

  for (const id of unique) {
    let place: ScopePlace | undefined;
    try {
      place = describe?.(id);
    } catch {
      place = undefined; // a faulty describer costs the place, not the row
    }
    if (!place) {
      unresolved += 1;
      continue;
    }
    tokens.push(placeToken(place));
  }

  const distinct = [...new Set(tokens)].sort((a, b) => placeRank(b) - placeRank(a) || (a < b ? -1 : 1));
  const highest = distinct[0] ?? null;
  const atHighest = highest ? tokens.filter((t) => t === highest).length : 0;
  const total = unique.length;

  return {
    tokens: distinct,
    highest,
    atHighest,
    total,
    unresolved,
    summary: summarisePlaces(highest, atHighest, total, unresolved),
  };
}

function summarisePlaces(
  highest: string | null,
  atHighest: number,
  total: number,
  unresolved: number
): string {
  // WP-52 · ITEM 4, AND IT IS THE MEASUREMENT'S OWN ANSWER.
  //
  // This branch used to return **'no targets on record'**, and the architect
  // caught it contradicting the guard that produced the row it appeared on: the
  // oldest gateless run renders the DERIVED fallback (guard 1 declined, because
  // guard 1 needs `total === 0` and `total` is `null`), yet its meta line
  // asserted a KNOWN-EMPTY target set. MEASURED on the owner's real ledger,
  // 2026-08-21, and the measurement named which of the two candidates was true:
  //
  //     SessionRow.targetSet : null      <- the ARMED set, UNKNOWN
  //     places.total         : 0         <- the OUTCOME set, empty
  //     places.summary       : "no targets on record"
  //
  // So the composer was right and the WORDING was the defect. `total` here is
  // `PlaceSet.total` — the targets that have an OUTCOME — and zero of them
  // means nothing has been written yet. It never meant "no targets were
  // recorded", which is a fact about the ARMING and lives on `targetSet`. WP-48's
  // name collision, in its third form: not a binding this time, but a sentence.
  //
  // THE HONEST RENDERING OF AN EMPTY PLACE SET IS NO PLACE CLAUSE AT ALL. A set
  // with no members has no place to report, `metaLine` filters falsy values, and
  // the row keeps its age, its state and its identifier. Saying nothing is the
  // strongest form of "say unknown, not empty" available here: any replacement
  // phrase would be authored copy on the one surface whose whole discipline is
  // that nothing is authored — and the designer's §2 meta columns carry NO place
  // clause on any of the three run rows, so silence is also the drawn rendering.
  //
  // Note this was never ratified copy: from-designer-10 QUOTES this line as an
  // example of a host derivation, not as a sentence the designer wrote.
  if (total === 0) return '';
  // WP-54 · ITEM 4 — THE CLAUSE THAT CONTRADICTED THE CARD BESIDE IT, DELETED.
  //
  // This branch returned "nothing on record names where the target is" on all
  // four security findings, while the DUPLICATE inbox card six inches below
  // rendered the same finding as "theawfulpm-test · security-sentinel". The
  // platform had the name and was claiming it did not — measured: the twin
  // holds `site.core` for that very entity, `{"name":"theawfulpm-test",…}`.
  //
  // The composer now resolves the target's NAME (see `nameOfEntity`), so the
  // sentence is false in the only case that reached it. And there is no
  // replacement clause: `describePlace` answers WHERE a target is, and an
  // unwired describer means the surface does not know the ENVIRONMENT — which
  // is not a fact the row needs to state. Silence is the same rendering the
  // `total === 0` branch above chose, for the same reason, and the designer's
  // §2 meta columns carry no place clause on any run row.
  if (!highest) return '';
  const label = readablePlace(highest);
  const head = `touches ${label} on ${atHighest} of ${total}`;
  return unresolved > 0 ? `${head} (${unresolved} unplaced)` : head;
}

/** `wpe_production` → `production`; `external_staging` → `external staging`. */
function readablePlace(token: string): string {
  if (token === 'local') return 'local';
  const [host, kind] = token.split('_');
  if (host !== 'wpe' && host !== 'external') return token;
  if (kind !== 'production' && kind !== 'staging' && kind !== 'development') return token;
  return placeLabel({ host, kind });
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

interface ManifestTurn {
  taskId: string;
  eventId: string;
  observedAt: string;
  capability: string;
  runbookId: string | null;
  hash: string;
  /** WP-51 · the incidents this turn's arming named. See `answeredIncidents`. */
  answers: string[];
}

function payloadOf(event: EventEnvelope): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * A manifest that DELIVERED a hash-pinned procedure, and nothing else.
 *
 * A refused turn is skipped: the document did not ride, so the actor was not
 * following it, and a refusal's hash can be null — which would fork the run key
 * on a value that names no document.
 */
function turnOf(event: EventEnvelope): ManifestTurn | undefined {
  const payload = payloadOf(event);
  const procedure = payload.procedure as Record<string, unknown> | null | undefined;
  if (!procedure || typeof procedure !== 'object') return undefined;
  if (procedure.status !== 'delivered') return undefined;

  const capability = str(procedure.capability);
  const hash = str(procedure.hash);
  const taskId = str(payload.task) ?? str(event.correlation);
  if (!capability || !hash || !taskId) return undefined;

  return {
    taskId,
    eventId: event.id,
    observedAt: event.observed_at,
    capability,
    runbookId: str(procedure.runbook) ?? null,
    hash,
    answers: answeredIncidents(payload),
  };
}

/**
 * WP-51 item 3 · THE INCIDENTS AN ARMING SAID IT WAS ANSWERING.
 *
 * Read only from a DELIVERED turn, because `turnOf` returns before this on
 * anything else — the same bound the writer holds to, from the other side.
 *
 * The designer's Q1 in one line: *"The containment run folds if and only if its
 * arming names the incidents it answers."* The "only if" is what this function
 * is: nothing here looks at a target, a timestamp, or a payload origin, so a
 * run and an incident that merely happen to be about the same site within the
 * same hour are two rows, permanently, unless the armer wrote the join down.
 */
function answeredIncidents(payload: Record<string, unknown>): string[] {
  const cause = payload.cause as { answers?: unknown } | null | undefined;
  if (!cause || typeof cause !== 'object' || !Array.isArray(cause.answers)) return [];
  return cause.answers.filter((id): id is string => typeof id === 'string' && !!id);
}

/**
 * THE SIZE OF THE ARMED TARGET SET, from the arming record's own scope.
 *
 * WP-48's ruling, and it repairs a NAME COLLISION rather than adding a feature.
 * The designer's slot table defines `{total}` as "size of the derived target
 * set"; the host field wearing that name — `places.total` — is a different
 * fact, the targets that have an OUTCOME. Binding the slot to it made two
 * sentences wrong at once: a gated run with nothing written reported "0
 * targets" and drew the class that says it "never received a target list", and
 * a genuinely mid-flight run would have said "2 of 2 are changed and the rest
 * are waiting on you", which contradicts itself.
 *
 * **WP-50 CORRECTION — this paragraph used to be false, and it is kept with its
 * correction rather than quietly rewritten.** It said: "`chatAssembly` spreads
 * the honoured arming's `scope` onto the manifest payload (WP-37's carrier)".
 * It did not. `chatAssembly` spread the scope onto `notifyProcedureState`, which
 * is an IPC STREAM to the renderer and reaches no ledger at all — which is
 * exactly why 0 of 36 manifests carried the key and why this reader was correct
 * and permanently null. `chatAssembly.emitManifest` now records it (WP-48b), and
 * `ProcedureScope.runnable` IS the selected target list.
 *
 * NULL IS NOT ZERO, and the distinction is the whole point. A manifest with no
 * scope means nothing selected anything — the size is UNKNOWN, not empty — so
 * it reports null and every guard that tests `total` declines rather than
 * treating an absence as a count. Defaulting it to 0 would rebuild the exact
 * collision this removes, one field over.
 *
 * MEASURED on the developer's ledger 2026-08-20: **0 of 36 manifests carry a
 * scope**, and no event anywhere carries a `runnable` key at all — every run on
 * that machine was armed by predicate rather than by a selection. So this reads
 * null in production today. That is the honest answer and it is reported at the
 * gate rather than papered over with a fallback.
 */
function armedTargetSetOf(events: readonly EventEnvelope[]): number | null {
  let newest: number | null = null;
  for (const event of events) {
    if (event.topic !== MANIFEST_TOPIC) continue;
    const count = armedTargetCount(payloadOf(event));
    if (count !== null) newest = count;
  }
  return newest;
}

function armedTargetCount(payload: Record<string, unknown>): number | null {
  const scope = payload.scope as Record<string, unknown> | null | undefined;
  if (!scope || typeof scope !== 'object') return null;
  const runnable = scope.runnable;
  return Array.isArray(runnable) ? runnable.length : null;
}

interface OpenSession {
  id: string;
  capability: string;
  runbookId: string | null;
  hash: string;
  taskIds: string[];
  /**
   * Fallback only. `foldOneSession` derives the real start from the run's OWN
   * events — the manifest carries `correlation`, so it is always one of them —
   * because a cut session's tail must start when the tail started, not when the
   * candidate it was cut out of did. Copying the candidate's value onto both
   * halves gave two sessions one timestamp, which the age sort then ordered by
   * coin toss.
   */
  startedAt: string;
}

interface LedgerLike {
  query(opts: {
    topicPrefix?: string;
    correlation?: string;
    limit?: number;
    order?: 'asc' | 'desc';
  }): EventEnvelope[];
}

/**
 * Fold the ledger into sessions, situations and the reserved row.
 *
 * Non-fatal by construction, like everything on this seam: an unreadable ledger
 * yields an EMPTY snapshot with the reserved row reporting the degradation, and
 * never an exception into a caller that predates the layer.
 */
export function foldSessionRegistry(deps: SessionRegistryDeps = {}): SessionRegistrySnapshot {
  const now = deps.now ?? new Date();
  const core = deps.core ?? getIntelligenceCore() ?? undefined;
  const limit = deps.manifestLimit ?? MANIFEST_SCAN_LIMIT;

  const reserved = deriveReserved(core, deps.health, now);
  const empty: SessionRegistrySnapshot = {
    at: now.toISOString(),
    sessions: [],
    situations: [],
    reserved,
    cursor: '',
    horizon: { manifestsRead: 0, limit, truncated: false, oldestManifestId: null },
    concurrencyLimit: CONCURRENCY_LIMIT_NOTE,
    deadlineSource: DEADLINE_SOURCE_NOTE,
    wakeSource: WAKE_SOURCE_NOTE,
  };
  if (!core?.ledger) return empty;

  const ledger = core.ledger as unknown as LedgerLike;
  const runbooks = deps.runbooks ?? core.law?.runbooks;

  let manifests: EventEnvelope[];
  try {
    // Newest-first, then reversed: see MANIFEST_SCAN_LIMIT.
    manifests = ledger
      .query({ topicPrefix: MANIFEST_TOPIC, limit, order: 'desc' })
      .slice()
      .reverse();
  } catch {
    return empty;
  }

  const truncated = manifests.length >= limit;
  const oldestManifestId = manifests[0]?.id ?? null;

  // --- sessions, opened and closed as the record says ----------------------
  const open = new Map<string, OpenSession>(); // run key → the session still taking turns
  // WP-51 · what each turn's arming said it was answering, kept by task id so
  // the session that owns the turn can be resolved after the terminal split.
  const answersByTask = new Map<string, string[]>();

  for (const manifest of manifests) {
    const turn = turnOf(manifest);
    if (!turn) continue;
    // Keyed by TASK, not by run: a session takes many turns, any of them may
    // have armed in answer to something, and the union across a run's turns is
    // taken below where its task list is known. Accumulating here would be
    // unreachable — one manifest carries one task — and a battery mutation
    // proved it: nothing could tell the two apart.
    if (turn.answers.length > 0) answersByTask.set(turn.taskId, turn.answers);
    // `@` rather than a space, and that is a FINDING rather than a style choice:
    // the first draft of this line carried a literal NUL byte where the separator
    // should have been. It passed tsc, eslint and 48 tests, and announced itself
    // only by making grep call this file "Binary file matches" — WP-25's
    // non-printing-character finding, reproduced in freshly authored source. A
    // separator you can see is a separator you can check.
    const key = `${turn.capability}@${turn.hash}`;
    const existing = open.get(key);
    if (existing) {
      if (!existing.taskIds.includes(turn.taskId)) existing.taskIds.push(turn.taskId);
      continue;
    }
    open.set(key, {
      id: `sess_${turn.taskId}`,
      capability: turn.capability,
      runbookId: turn.runbookId,
      hash: turn.hash,
      taskIds: [turn.taskId],
      startedAt: turn.observedAt,
    });
  }

  // A session closes at a terminal state, and a later turn at the same key
  // opens a new one. Detecting terminality needs the fold, so the pass above
  // collects one candidate per key and this one cuts each into the sessions the
  // record actually holds.
  const split: SessionRow[] = [];
  for (const candidate of open.values()) {
    const row = foldOneSession(candidate, ledger, runbooks, deps);
    if (row) split.push(...splitAtTerminal(row, ledger, runbooks, deps));
  }

  // --- incidents, linked into their session or standing alone --------------
  let incidents: EventEnvelope[] = [];
  try {
    incidents = ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: INCIDENT_SCAN_LIMIT, order: 'desc' });
  } catch {
    incidents = [];
  }

  const sessionByTask = new Map<string, SessionRow>();
  for (const row of split) for (const taskId of row.taskIds) sessionByTask.set(taskId, row);

  // WP-51 item 3 · the SECOND way an incident reaches a session: the run's own
  // arming named it. `answeredBy` is keyed by the INCIDENT's event id, which is
  // what the arming records, so an id naming nothing simply never matches and
  // no part is manufactured for it.
  const answeredBy = new Map<string, SessionRow>();
  for (const row of split) {
    for (const taskId of row.taskIds) {
      for (const incidentId of answersByTask.get(taskId) ?? []) {
        // First writer wins: two runs both claiming to answer one incident is a
        // disagreement in the record, and the earlier claim is the one that was
        // already true when the later one was written.
        if (!answeredBy.has(incidentId)) answeredBy.set(incidentId, row);
      }
    }
  }

  const attached = new Map<string, EventEnvelope[]>();
  const orphans: EventEnvelope[] = [];
  for (const incident of incidents) {
    // Which run PRODUCED it outranks which run ANSWERS it, and both are record
    // links. An abort incident belongs to the run whose failure opened it; a
    // later containment arming naming it must not move it out of that run's
    // situation, or the halt would leave the row that halted.
    const owner =
      (incident.correlation ? sessionByTask.get(incident.correlation) : undefined) ??
      answeredBy.get(incident.id);
    if (!owner) {
      orphans.push(incident);
      continue;
    }
    const list = attached.get(owner.id) ?? [];
    list.push(incident);
    attached.set(owner.id, list);
  }

  // A halt is a fact about the session, and it is the incident that says so.
  for (const row of split) {
    const halting = (attached.get(row.id) ?? []).filter((e) => isOpenAbort(e));
    if (halting.length > 0 && row.status !== 'complete') row.status = 'halted';
  }

  if (truncated && split.length > 0) {
    const boundary = split.find((row) => row.taskIds[0] && oldestTurnOf(split) === row.taskIds[0]);
    if (boundary) boundary.idProvisional = true;
  }

  // WP-54 · ITEM 4 — the name resolver, defaulted from the record itself.
  // An injected `nameOf` wins (the tests' seam); otherwise the twin answers.
  // Declared BEFORE the passes below because every one of them composes an
  // incident sentence, and a target named on one row and an id on the next
  // would be the divergence WP-54 removed arriving through a new door.
  const named: SessionRegistryDeps = deps.nameOf ? deps : { ...deps, nameOf: twinNameOf(core) };

  // --- agent failures, the platform's own situations of one (WP-54a) --------
  //
  // Read like the incidents and for the same reasons: newest-first, bounded,
  // and an unreadable slice costs this class its rows rather than the fold.
  // These are NOT correlated into sessions — an agent run has no TaskId, which
  // WP-48a measured and pinned — so every one of them is its own row.
  let agentFailures: EventEnvelope[] = [];
  try {
    agentFailures = ledger.query({
      topicPrefix: AGENT_FAILURE_TOPIC,
      limit: AGENT_FAILURE_SCAN_LIMIT,
      order: 'desc',
    });
  } catch {
    agentFailures = [];
  }

  // WP-51 item 2 · THE ORPHAN-GROUPING RULE. Run-less incidents SHARING A
  // CORRELATION are one situation with parts; everything else stands alone.
  //
  // The rule reads an ENVELOPE field and nothing else. Two incidents about the
  // same site, from the same producer, in the same millisecond, are still two
  // rows — a shared payload origin is not a link, and the four on the owner's
  // real ledger are exactly that shape. What changed is upstream: the sentinel
  // now records its scan as an act, so its findings carry a correlation that
  // names something. The coalescer did not learn to guess; the record learned
  // to say.
  const bySharedLink = new Map<string, EventEnvelope[]>();
  const alone: EventEnvelope[] = [];
  for (const incident of orphans) {
    const link = incident.correlation;
    if (!link) {
      alone.push(incident);
      continue;
    }
    const siblings = bySharedLink.get(link) ?? [];
    siblings.push(incident);
    bySharedLink.set(link, siblings);
  }
  const coalesced: Situation[] = [];
  for (const [link, members] of bySharedLink) {
    // A GROUP OF ONE IS NOT A GROUP. It has a link and no sibling, so nothing
    // was folded and the row is the situation of one the designer already drew.
    if (members.length < 2) {
      alone.push(members[0]);
      continue;
    }
    coalesced.push(situationOfCoalescedIncidents(link, members, named));
  }

  const situations = [
    ...split.map((row) => situationOfSession(row, attached.get(row.id) ?? [], named)),
    // Every incident row states how many events it folded and what linked them,
    // whether or not anything was folded — see `Situation.memberCount`. Set
    // HERE rather than inside `situationOfIncident` because that function was
    // held by a sibling packet's lock when this landed; it belongs inside it.
    ...alone.map((incident) => withFoldFacts(situationOfIncident(incident, named), 1, null)),
    ...coalesced,
    ...openAgentFailures(agentFailures).map((event) => situationOfAgentFailure(event)),
  ];

  // WP-56 · the deferral post-pass. It runs AFTER the situations are composed
  // and BEFORE they are ranked, and the order is irrelevant by construction: a
  // deferral changes no tier and no place, so `rankSituations` returns the same
  // order either way. Running it here rather than inside `situationOfSession`
  // is what keeps "lowers escalation only" a property of the code's shape.
  applyDeferrals(situations, ledger, deps, now);

  const cursor = maxId([
    ...split.map((row) => row.lastEventId),
    ...incidents.map((e) => e.id),
    ...agentFailures.map((e) => e.id),
    ...manifests.map((e) => e.id),
  ]);

  split.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0));

  return {
    at: now.toISOString(),
    sessions: split,
    situations: rankSituations(situations),
    reserved,
    cursor,
    horizon: { manifestsRead: manifests.length, limit, truncated, oldestManifestId },
    concurrencyLimit: CONCURRENCY_LIMIT_NOTE,
    deadlineSource: DEADLINE_SOURCE_NOTE,
    wakeSource: WAKE_SOURCE_NOTE,
  };
}

/**
 * WP-54 · ITEM 4 — what an entity is CALLED, read from the twin.
 *
 * `site.core` is the fold's own materialisation of the platform's site
 * observations and it carries `{"name":…,"domain":…}` keyed by the very entity
 * ids the incident producer stamps. So the name is IN THE RECORD, one read
 * away, and the four cards that said "nothing on record names where the target
 * is" were wrong about the record rather than honest about it.
 *
 * NON-FATAL AND NEVER FABRICATING, in that order: an unreadable twin, a value
 * that is not JSON, a JSON value with no `name`, or a name that is not a
 * non-empty string all yield `undefined`, and the composer then cites the id.
 */
function twinNameOf(core: IntelligenceCore | undefined): (entityId: string) => string | undefined {
  return (entityId: string) => {
    try {
      const fact = core?.twins?.get(entityId, 'site.core');
      if (!fact) return undefined;
      const value = typeof fact.value === 'string' ? JSON.parse(fact.value) : fact.value;
      const name = (value as { name?: unknown } | null)?.name;
      return typeof name === 'string' && name !== '' ? name : undefined;
    } catch {
      return undefined; // a faulty twin costs the name, never the row
    }
  };
}

/** The oldest turn across every session — the horizon boundary's owner. */
function oldestTurnOf(rows: readonly SessionRow[]): string | undefined {
  let oldest: string | undefined;
  for (const row of rows) {
    const first = row.taskIds[0];
    if (!first) continue;
    if (!oldest || first < oldest) oldest = first;
  }
  return oldest;
}

function maxId(ids: readonly string[]): string {
  let max = '';
  for (const id of ids) if (id > max) max = id;
  return max;
}

/**
 * An abort incident that is still open.
 *
 * `recordAbortIncidents` writes an amendment with `resolved: true` when a retry
 * clears the halt, and both events stay in the ledger — so reading only the
 * topic would report a healed run as halted forever.
 */
function isOpenAbort(event: EventEnvelope): boolean {
  const payload = payloadOf(event);
  if (payload.resolved === true) return false;
  return typeof payload.source === 'string' && payload.source.startsWith('abort:');
}

// ---------------------------------------------------------------------------
// One session
// ---------------------------------------------------------------------------

function foldOneSession(
  candidate: OpenSession,
  ledger: LedgerLike,
  runbooks: RunbookLookup | undefined,
  deps: SessionRegistryDeps
): SessionRow | undefined {
  const run: ProcedureRun = {
    sessionId: candidate.id,
    capability: candidate.capability,
    runbookId: candidate.runbookId ?? '',
    runbookHash: candidate.hash,
    taskIds: [...candidate.taskIds],
  };

  let events: EventEnvelope[];
  try {
    events = runEvents(run, ledger as unknown as Ledger);
  } catch {
    return undefined; // an unreadable run is not a session; it is nothing at all
  }

  const runbook = runbooks?.byCapability(candidate.capability);
  // A document whose hash does not match the pin is NOT this run's document.
  // Folding a cursor against it would attest checkpoints from a text the run
  // was never governed by — the same class of error as WP-20d's re-arm rule.
  const document = runbook && runbook.hash === candidate.hash ? runbook : undefined;
  const checkpoints: RunbookCheckpoint[] = document?.checkpoints ?? [];

  const cursor = document
    ? foldProcedureCursor(run, checkpoints, ledger as unknown as Ledger)
    : undefined;
  const states = document ? deriveCheckpointStates(document, cursor) : [];

  const outcomes = deriveOutcomes(events);
  const places = derivePlaces(
    [...outcomes.succeeded, ...outcomes.failed.map((f) => f.entityId)],
    deps.describePlace
  );
  const gate = deriveGate(states, checkpoints, candidate, document);
  const approvals = deriveApprovals(checkpoints, cursor, events);
  // DERIVED FROM THE RUN'S OWN EVENTS, for the reason `startedAt` is two lines
  // below: `splitAtTerminal` re-folds a cut session's halves through here, and
  // copying the candidate's value onto both would give the HEAD a target set
  // its TAIL selected. The newest arming that carried a scope wins — a re-arm
  // replaces the selection; a turn without one leaves it alone.
  // ONE derivation, from the run's own turns. There is deliberately no
  // candidate-carried fallback: `armedTargetSetOf` returns null exactly when no
  // turn of this run carried a scope, which is exactly when a candidate-carried
  // value would be null too — so the fallback could never change an answer. A
  // mutation battery proved it (nothing could kill a change to it), and
  // zero-caller code is deleted here rather than pinned (WP-47a's ruling).
  const targetSet = armedTargetSetOf(events);

  const lastEventId = maxId(events.map((e) => e.id));
  // Derived from this run's own events, so a cut session's halves get their own
  // clocks. `oldestIso` rather than `events[0]`: `runEvents` sorts by ULID (when
  // the ledger heard) and these are `observed_at` (when the fact was true), and
  // conflating the two is the one thing the envelope rules forbid outright.
  const startedAt = oldestIso(events.map((e) => e.observed_at)) || candidate.startedAt;
  const lastActivityAt = newestIso(events.map((e) => e.observed_at)) || candidate.startedAt;

  return {
    id: candidate.id,
    capability: candidate.capability,
    runbookId: candidate.runbookId,
    runbookHash: candidate.hash,
    taskIds: [...candidate.taskIds],
    status: deriveStatus(states, gate, cursor?.denied ?? []),
    ...(gate ? { gate } : {}),
    ...(document ? { checkpoints: states } : {}),
    approvals,
    outcomes,
    places,
    targetSet,
    startedAt,
    lastActivityAt,
    lastEventId,
    ...(document ? {} : { documentUnavailable: true as const }),
  };
}

/**
 * Cut a candidate into the sessions the record actually holds.
 *
 * A run that reached a TERMINAL state and then took another turn at the same key
 * is two runs. The cut point is derived: fold the cursor over each turn prefix
 * and stop at the first prefix the record says is over.
 *
 * TWO TERMINAL STATES, and the difference between them and the third thing that
 * looks like one is load-bearing:
 *
 *   COMPLETE — every gated checkpoint attested. There is nothing left to do.
 *   DENIED   — a consent gate was refused. `deriveCheckpointStates` rule 2 is
 *              that "a denial is an abort": the decision exists and it was no,
 *              and the runbook forbids re-proposing it. The run is over.
 *   an ABORT INCIDENT is NOT terminal. A halt is a failure a run may recover
 *              from — `recordAbortIncidents` closes its own incident when a
 *              retry succeeds, which only means anything if the retry is the
 *              same run.
 *
 * WHY THE DENIAL CUT EXISTS, measured rather than reasoned: without it, the
 * eval report's own ledger folded a freshly-armed run INTO an unrelated denied
 * one, because both stood at the same capability and the same document hash.
 * The fresh run inherited the denial, reported `halted`, and its pending consent
 * gate vanished from the waiting column entirely. For a triage whose whole job
 * is "what needs you", losing a waiting row is the worst available failure, and
 * it was reachable from two chats doing ordinary things.
 *
 * THE RESIDUE, STATED: the same chat re-arming after its own denial reads here
 * as a new session standing at a fresh gate, while the sequence guard goes on
 * refusing it. The registry is a READ and gates nothing, so the disagreement
 * costs a row that looks more alive than it is — the opposite direction from
 * losing one, and the safe direction for a surface that cannot authorise
 * anything.
 */
function splitAtTerminal(
  row: SessionRow,
  ledger: LedgerLike,
  runbooks: RunbookLookup | undefined,
  deps: SessionRegistryDeps
): SessionRow[] {
  if (row.documentUnavailable || row.taskIds.length < 2) return [row];
  const runbook = runbooks?.byCapability(row.capability);
  if (!runbook || runbook.hash !== row.runbookHash) return [row];
  const gated = runbook.checkpoints.filter((c) => c.attest !== 'narrative');
  if (gated.length === 0) return [row];

  for (let cut = 1; cut < row.taskIds.length; cut++) {
    const prefix: ProcedureRun = {
      sessionId: row.id,
      capability: row.capability,
      runbookId: row.runbookId ?? '',
      runbookHash: row.runbookHash,
      taskIds: row.taskIds.slice(0, cut),
    };
    let state;
    try {
      state = foldProcedureCursor(prefix, runbook.checkpoints, ledger as unknown as Ledger);
    } catch {
      return [row];
    }
    if (state.fault) return [row];
    const complete = gated.every((c) => state.attested.includes(c.id));
    const denied = state.denied.length > 0;
    if (!complete && !denied) continue;

    // The prefix is over. Everything after it is a NEW session at the same key.
    const head = foldOneSession(
      {
        id: row.id,
        capability: row.capability,
        runbookId: row.runbookId,
        hash: row.runbookHash,
        taskIds: row.taskIds.slice(0, cut),
        startedAt: row.startedAt,
      },
      ledger,
      runbooks,
      deps
    );
    const tailIds = row.taskIds.slice(cut);
    const tail = foldOneSession(
      {
        id: `sess_${tailIds[0]}`,
        capability: row.capability,
        runbookId: row.runbookId,
        hash: row.runbookHash,
        taskIds: tailIds,
        // Fallback only, and it is deliberately the CANDIDATE's: if the tail
        // has no readable events there is nothing better to say, and
        // `foldOneSession` overrides it whenever there is. Same for the target
        startedAt: row.startedAt,
      },
      ledger,
      runbooks,
      deps
    );
    const out: SessionRow[] = [];
    if (head) out.push(head);
    if (tail) out.push(...splitAtTerminal(tail, ledger, runbooks, deps));
    return out.length > 0 ? out : [row];
  }
  return [row];
}

function deriveOutcomes(events: readonly EventEnvelope[]): SessionOutcomes {
  const actions = new Map<string, string>(); // action event id → tool
  for (const event of events) {
    if (event.topic !== ACTION_EXECUTED_TOPIC) continue;
    const tool = str(payloadOf(event).tool);
    if (tool) actions.set(event.id, tool);
  }

  /** Latest outcome per target wins: a retry that succeeded is not still failed. */
  const perTarget = new Map<string, { ok: boolean; failure?: FailedTarget }>();
  let writeEventId: string | undefined;

  for (const event of events) {
    if (event.topic !== OUTCOME_RECORDED_TOPIC) continue;
    const payload = payloadOf(event);
    const result = payload.result;
    if (result !== 'success' && result !== 'failure') continue;
    const target = event.entity?.environment ?? event.entity?.site;
    const actionId = event.causation && actions.has(event.causation) ? event.causation : undefined;
    if (result === 'success' && actionId && !writeEventId) writeEventId = actionId;
    if (!target) continue;
    const tool = str(payload.tool) ?? (actionId ? actions.get(actionId) : undefined) ?? 'unknown';
    perTarget.set(
      target,
      result === 'success'
        ? { ok: true }
        : {
            ok: false,
            failure: {
              entityId: target,
              outcomeEventId: event.id,
              observedAt: event.observed_at,
              tool,
            },
          }
    );
  }

  const succeeded: string[] = [];
  const failed: FailedTarget[] = [];
  for (const [target, state] of perTarget) {
    if (state.ok) succeeded.push(target);
    else if (state.failure) failed.push(state.failure);
  }

  return {
    succeeded: succeeded.sort(),
    failed: failed.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)),
    writeLanded: !!writeEventId,
    ...(writeEventId ? { writeEventId } : {}),
  };
}

/**
 * The gate, by id — J-Return's WHERE.
 *
 * `deriveCheckpointStates` already names the active step, and reusing it is the
 * point of "one fold": a second rule for which step is next is how a rail and a
 * triage start disagreeing about where a run is.
 */
function deriveGate(
  states: readonly CheckpointState[],
  checkpoints: readonly RunbookCheckpoint[],
  candidate: OpenSession,
  document: Runbook | undefined
): PendingGate | undefined {
  const activeIndex = states.findIndex((s) => s.status === 'active');
  if (activeIndex < 0 || !document) return undefined;
  const checkpoint = checkpoints[activeIndex];
  if (!checkpoint) return undefined;

  return {
    checkpointId: checkpoint.id,
    index: activeIndex + 1,
    of: checkpoints.length,
    awaits:
      checkpoint.attest === 'event' && checkpoint.evidence?.topic === RATIONALE_RECORDED_TOPIC
        ? 'approval'
        : 'evidence',
    runbookId: document.id,
    capability: candidate.capability,
  };
}

/**
 * Every consent gate the document declares, with its standing.
 *
 * Declared rather than pending-only, because the must-not is about an approval
 * that was ALREADY GIVEN: a list that dropped decided approvals could not
 * express "still given", which is the whole assertion.
 */
function deriveApprovals(
  checkpoints: readonly RunbookCheckpoint[],
  cursor: ReturnType<typeof foldProcedureCursor> | undefined,
  events: readonly EventEnvelope[]
): PendingApproval[] {
  // The MOMENT comes off the deciding event itself, never off a clock read
  // here: "you approved this yesterday at 12:11" is a claim about the record,
  // and a time this function invented would be a claim about this function.
  const observedAt = new Map<string, string>();
  for (const event of events) observedAt.set(event.id, event.observed_at);

  const out: PendingApproval[] = [];
  for (const checkpoint of checkpoints) {
    if (checkpoint.attest !== 'event') continue;
    if (checkpoint.evidence?.topic !== RATIONALE_RECORDED_TOPIC) continue;
    const evidence = cursor?.evidence?.[checkpoint.id];
    const state = cursor?.attested.includes(checkpoint.id)
      ? 'approved'
      : cursor?.denied.includes(checkpoint.id)
        ? 'denied'
        : 'pending';
    const decidedAt = evidence ? observedAt.get(evidence.eventId) : undefined;
    out.push({
      checkpointId: checkpoint.id,
      state,
      ...(state !== 'pending' && evidence ? { eventId: evidence.eventId } : {}),
      // A decided approval with no readable moment reports no moment rather
      // than a plausible one — the surface then omits the time clause instead
      // of printing a time nothing observed.
      ...(state !== 'pending' && decidedAt ? { decidedAt } : {}),
    });
  }
  return out;
}

function deriveStatus(
  states: readonly CheckpointState[],
  gate: PendingGate | undefined,
  denied: readonly string[]
): SessionStatus {
  if (denied.length > 0) return 'halted';
  if (states.length > 0 && states.every((s) => s.attest === 'narrative' || s.status === 'attested')) {
    return 'complete';
  }
  if (gate?.awaits === 'approval') return 'waiting';
  return 'running';
}

// ---------------------------------------------------------------------------
// Situations, and the consequence order
// ---------------------------------------------------------------------------

function situationOfSession(
  row: SessionRow,
  incidents: readonly EventEnvelope[],
  deps: SessionRegistryDeps
): Situation {
  const parts: SituationPart[] = [
    {
      kind: 'run',
      observedAt: row.startedAt,
      summary: runSummary(row),
    },
  ];

  for (const failure of row.outcomes.failed) {
    parts.push({
      kind: 'outcome',
      eventId: failure.outcomeEventId,
      topic: OUTCOME_RECORDED_TOPIC,
      observedAt: failure.observedAt,
      summary: `${failure.tool} failed on ${failure.entityId}`,
    });
  }

  for (const incident of incidents) {
    const payload = payloadOf(incident);
    parts.push({
      kind: 'incident',
      eventId: incident.id,
      topic: incident.topic,
      observedAt: incident.observed_at,
      summary: `${payload.resolved === true ? 'incident closed' : 'incident open'}: ${
        str(payload.symptom) ?? str(payload.fact) ?? 'no symptom recorded'
      }`,
    });
  }

  const column: TriageColumn = row.status === 'complete' ? 'changed' : 'waiting';
  const deadline =
    column === 'waiting'
      ? safeDeadline(deps, row)
      : undefined;
  const { tier: derivedTier, tierReason } = rankSession(row, column, deadline);

  const since = oldestIso([row.startedAt, ...incidents.map((e) => e.observed_at)]);
  const lastEventId = maxId([row.lastEventId, ...incidents.map((e) => e.id)]);
  // WP-54 · ITEM 2 — THE TIER COMES BACK WITH THE SENTENCE THAT NAMES IT.
  // `rankSession` supplies §4a's derived answer; the composer returns the tier
  // the row is actually ranked at, which is the ratified class's when a class
  // composed the card and the derived one when none did. There is no second
  // assignment of `tier` anywhere on this path.
  const copy = composeSessionCopy(row, column, deps.now ?? new Date(), since, tierReason, derivedTier);

  return {
    id: row.id,
    kind: 'session',
    column,
    // `tier` and `door` arrive with `...copy` below — the composer returns them
    // beside the sentence that names them, which is the whole of item 2.
    tierReason,
    sessionId: row.id,
    // WP-49a · the run's capability, carried so a surface can name the run in a
    // sentence without reaching for the runbook id. Read off the row, never
    // re-derived.
    capability: row.capability,
    ...(row.gate ? { gate: row.gate } : {}),
    places: row.places,
    since,
    lastEventId,
    parts,
    ...copy,
    written: {
      done: row.outcomes.succeeded.length,
      failed: row.outcomes.failed.length,
      total: row.targetSet,
    },
  };
}

/**
 * WP-49a · rider 1's rows, derived from the sessions the fold already folded.
 *
 * THE THIRD GUARD IS THE ONE THAT MATTERS. `documentUnavailable` is XD-26's 6c —
 * the platform naming its own limit — and filing such a run under "nothing needed
 * of you" would be the platform quietly deciding that a run it cannot place needs
 * no one. WP-49 measured that filing exact regression before building anything;
 * the guard is that measurement, kept as code.
 *
 * `status === 'running'` and no gate is the rider's own condition: a run that has
 * stalled is `halted`, a run at an approval is `waiting`, a finished one is
 * `complete`, and each of those promotes itself into the list by the consequence
 * order that already exists. Nothing new decides anything here.
 */
function workingRows(sessions: readonly SessionRow[]): WorkingRow[] {
  const rows: WorkingRow[] = [];
  for (const row of sessions) {
    if (row.status !== 'running') continue;
    if (row.gate) continue;
    if (row.documentUnavailable) continue;
    rows.push({
      sessionId: row.id,
      capability: row.capability,
      line: `${RUN_NOUN[row.capability] ?? row.capability} is ${row.status}`,
      since: row.startedAt,
      lastEventId: row.lastEventId,
    });
  }
  return rows;
}

function runSummary(row: SessionRow): string {
  const done = row.outcomes.succeeded.length;
  const failed = row.outcomes.failed.length;
  const head =
    row.status === 'halted'
      ? 'halted'
      : row.status === 'complete'
        ? 'complete'
        : row.status === 'waiting'
          ? 'waiting'
          : 'running';
  return `${head} under ${row.runbookId ?? row.capability} — ${done} done and standing, ${failed} failed`;
}

// ---------------------------------------------------------------------------
// WP-48 · the verdict, composed here and nowhere else
// ---------------------------------------------------------------------------

/**
 * Whole hours between two instants — the age every surface renders.
 *
 * It lives HERE rather than in the arrival because the headline now carries an
 * age too, and two implementations of "how old is this" is how the row's own
 * sentence starts disagreeing with the meta line beneath it. `Arrival.tsx`
 * imports this one; the renderer copy it used to own is gone.
 */
export function ageLabel(sinceIso: string, now: Date): string {
  const then = Date.parse(sinceIso);
  if (!Number.isFinite(then)) return '';
  return `${Math.max(0, Math.floor((now.getTime() - then) / 3_600_000))}h`;
}

/**
 * The values a template's `{slot}` braces are filled from.
 *
 * Every key here is a field the fold ALREADY derived — the fixture's own rule
 * that "nothing here computes anything" holds on both sides of the seam. A slot
 * whose value is `undefined` is one the record cannot answer.
 */
export type SlotBag = Record<string, string | number | undefined>;

/**
 * The facts the guards read. EXPORTED so its pins can drive the selector
 * DIRECTLY across the whole input domain — including states no current caller
 * can supply, which is exactly where `agent.stuck` and the unreachable corners
 * of the other four live. A render test cannot pin a guard the render never
 * reaches (WP-46), and every guard here has such a corner.
 */
export interface SituationClassInput {
  kind: 'run' | 'incident' | 'agentFailure';
  done: number;
  failed: number;
  /**
   * The ARMED TARGET SET, or null when the record does not say.
   *
   * Null is a third state and both guards that read it must mean it: `total ===
   * 0` is "nothing was selected", `total > 0` is "something was", and null is
   * neither. JavaScript agrees by coercion — `null === 0` and `null > 0` are
   * both false — which is why the ratified guard strings need no amendment for
   * it and the agreement table can carry null cases directly.
   */
  total: number | null;
  gate: PendingGate | null;
  runId: string | null;
  /**
   * WP-54's merge · HOW MANY EVENTS THIS ROW FOLDED — 1 for a situation of one.
   *
   * The designer's cycle-seven sheet split the incident classes on it:
   * `incident.no-run` now guards on `memberCount === 1` and `incident.coalesced`
   * on `memberCount > 1`, so the selector has to read it or the two copies of
   * one rule stop agreeing — which is what the agreement pin caught the moment
   * the new fixture arrived, exactly as it is meant to.
   *
   * Defaults to 1 where a caller does not say, because a row that folded
   * nothing IS a situation of one. That is the record's own answer for every
   * caller in the tree today, not a convenience.
   */
  memberCount?: number;
}

/** Every `{slot}` a string carries. */
function slotsOf(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]);
}

/**
 * Fill a ratified sentence from the bag.
 *
 * EXPORTED for its own pins. A mutation battery found nothing holding either
 * half of this function: an absent slot rendering the six characters
 * `undefined`, and the gap an absent slot opens mid-sentence, both survived.
 * Neither is reachable through the composer's public path often enough to pin
 * there, which is WP-46's rule exactly — drive the builder directly.
 *
 * An ABSENT slot renders empty rather than as its own braces: six literal
 * characters `{target}` reaching a customer is the substitution form of the
 * blank-where-a-sentence-belongs defect the copy generator exists to prevent.
 * The HEADLINE never reaches this state — `selectTemplate` refuses a class
 * whose headline has an unfillable slot — so an empty fill can only ever
 * shorten a meta or an ask, never leave the verdict itself with a hole.
 */
export function fillSituationSentence(template: string, bag: SlotBag): string {
  return template
    .replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_m, slot: string) => {
      const value = bag[slot];
      return value === undefined ? '' : String(value);
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The guards, in the fixture's order, first match wins — though nothing
 * depends on the order: the five are MUTUALLY EXCLUSIVE, proven by brute force
 * over the whole input domain in `situationHeadlines.test.ts` rather than
 * asserted here. A battery mutation that reversed the order survived, which is
 * the honest result and is why this says so instead of claiming otherwise.
 *
 * Each arm is the fixture's own guard string transcribed into TypeScript, and
 * `__tests__/situationHeadlines.test.ts` EVALUATES every guard string from the
 * generated module over a shared case table and asserts this function agrees on
 * every case. That is the pattern this repo already uses to pin two copies of
 * one rule together (`resolveAgentCron`/`effectiveCadenceExpression`,
 * `localDay`) — the guards are not evaluated in production, because running a
 * string from a file inside the main process is a code-execution surface, and
 * they are not merely commented alongside either, because a comment drifts in
 * silence.
 *
 * ONE READING IS STATED RATHER THAN HIDDEN: these select rows of the NOW LIST,
 * which is the waiting column. The changed column is a different list with its
 * own ratified head, and template 1 applied to it would tell a reader that a
 * FINISHED run "has waited 6h and changed nothing" and offer to close it. The
 * guards say `row.kind === "run"` because in the fixture every `row` is a
 * Now-list row; they are applied to the list they were written for.
 */
export function guardHolds(template: SituationTemplate, input: SituationClassInput): boolean {
  const { kind, done, failed, total, gate } = input;
  switch (template.id) {
    case 'run.waiting.nothing-written':
      return kind === 'run' && done === 0 && failed === 0 && total === 0 && gate === null;
    case 'run.waiting.mid-procedure':
      // WP-50's ruling: `&& total !== null && total > 0` REMOVED, to match the
      // amended ratified guard. Neither of this class's sentences reads
      // `{total}`, and the clause withheld the designer's own row from the sheet
      // that drew it. **A guard may condition only on facts its sentence's claim
      // depends on** — gating on an unstated fact is how a TRUE sentence gets
      // withheld, and a withheld sentence is invisible, which makes it worse
      // than a false one. `total` is deliberately no longer read here; the
      // agreement pin over the shared case table is what keeps this copy and
      // the fixture's one rule.
      return kind === 'run' && done === 0 && failed === 0 && gate !== null;
    case 'run.waiting.part-changed':
      return kind === 'run' && (done > 0 || failed > 0) && gate !== null;
    case 'incident.no-run':
      // `memberCount === 1` is the designer's own clause, and it is what keeps
      // this class and `incident.coalesced` mutually exclusive now that both
      // guard a run-less incident. A row that folded nothing is a situation of
      // one, so an absent count reads as 1.
      return kind === 'incident' && input.runId === null && (input.memberCount ?? 1) === 1;
    case 'agent.stuck':
      return kind === 'agentFailure';
    default:
      return false;
  }
}

/**
 * The class that composes this row, or null.
 *
 * Null has TWO causes and they are different facts, both honest:
 *  - no guard held (a class the ratified set does not cover), or
 *  - a guard held but the headline carries a slot the record cannot fill —
 *    an incident with no symptom and no fact, a capability with no ratified
 *    run noun. Rendering the template anyway would print a sentence with a
 *    hole in it; the derived sentence, which states only what is recorded, is
 *    the honest fallback and the row reports `headlineTemplate: null` so the
 *    fallback is visible rather than mistaken for ratified copy.
 */
export function selectSituationTemplate(
  input: SituationClassInput,
  bag: SlotBag,
): SituationTemplate | null {
  for (const template of SITUATION_TEMPLATES) {
    if (!guardHolds(template, input)) continue;
    if (slotsOf(template.headline).some((slot) => bag[slot] === undefined)) return null;
    return template;
  }
  return null;
}

/**
 * THE ONE CLASS THIS PACKET DECLINES, AND WHY — raised at the gate, not smoothed.
 *
 * MEASURED against the developer's live ledger, 2026-08-20: of seven waiting
 * rows, one is a `cap.bulk_plugin_update` run stopped at `cp.backup`, **4 of
 * 8**, with nothing written. Guard 1 selects it, and guard 1's ratified ask
 * says *"It never received a target list, so it cannot start. Give it one, or
 * close it."* That is false about that row: it received a procedure and it is
 * four checkpoints into it. It is the designer's CLASS 2, and class 2 cannot
 * fire.
 *
 * **WP-50: THE PARAGRAPH BELOW IS HISTORY, AND IT IS KEPT AS HISTORY.** It
 * describes the world before WP-48's ruling and before WP-50's amendment.
 * `{total}` is no longer `places.total` (WP-48 rebound it to the arming's own
 * scope), and guard 2 no longer reads `total` at all (WP-50 dropped the clause,
 * because neither class-2 sentence claims anything about a target set). Class 2
 * fires on the real cp.backup row now. The refusal below still cannot be reached
 * through `selectSituationTemplate` — guard 1 carries `gate === null` — so it
 * remains a tripwire, directly pinned, exactly as the WP-48 ruling made it
 * permanent.
 *
 * WHY CLASS 2 COULD NOT FIRE, structurally, AT THE TIME. Guard 2 needed
 * `total > 0` with nothing written, and `{total}` was `row.places.total`, which
 * `foldOneSession` derives from `outcomes.succeeded` + `outcomes.failed` and
 * from nothing else. So
 * `done === 0 && failed === 0` FORCES `total === 0`, guard 2 is unreachable by
 * construction, and every one of its real instances lands in guard 1. The fold
 * carries no intended-target set for a run that has not acted yet — there is no
 * field on `SessionRow` that could hold one, and inventing a count would be the
 * fabrication this layer forbids outright.
 *
 * WHAT THIS DOES ABOUT IT, and its limits. It declines guard 1 for a GATED row
 * and falls back to the derived sentence, which is true and is what the surface
 * already showed. The row keeps its gate lines — "Waiting at cp.backup — 4 of 8"
 * and "Needs your approval" — so the reader loses no information relative to
 * today; what they are spared is a ratified sentence that contradicts the
 * record. `headlineTemplate` reports `null`, so the fallback is visible rather
 * than mistaken for ratified copy.
 *
 * RULED PERMANENT (WP-48 gate, 2026-08-20): **this stays forever, and it is now
 * deliberately redundant.** The ruling took BOTH remedies — guard 1 gained
 * `&& gate === null` in the ratified fixture, and `{total}` was rebound to the
 * arming record's scope — so no input can reach this refusal through
 * `selectSituationTemplate` any more. It is kept as a TRIPWIRE, not as
 * scaffolding: a ratified sentence that contradicts the record must refuse
 * loudly and fall back derived, whatever a future amendment does to the guards.
 *
 * Because nothing reaches it through the composer, it is pinned DIRECTLY — a
 * guard nothing can reach is a guard nothing can check, which is this packet's
 * own rule turned on itself.
 */
export function contradictedByTheRecord(
  template: SituationTemplate | null,
  gate: PendingGate | null,
  bag: SlotBag = {},
): boolean {
  if (template?.id === 'run.waiting.nothing-written') return gate !== null;
  // WP-54a · THE SECOND ARM, and it is the first one that fires in production.
  //
  // `agent.stuck`'s ask STATES a timeout — "It timed out after {timeout}." —
  // and the class's guard is only `row.kind === "agentFailure"`, which every
  // agent failure satisfies including the ones that did not time out at all.
  // Two ways the sentence goes wrong, and the second is worse than the first:
  //
  //   - the run ended in `error`, so nothing timed out. A FALSEHOOD.
  //   - the run DID time out but no duration is on record, so the sentence
  //     renders "It timed out after ." — a hole in a ratified sentence, which
  //     is the substitution defect the copy generator exists to prevent.
  //
  // `selectSituationTemplate`'s own fillability check cannot catch either: it
  // guards the HEADLINE, and this class's headline (`{agentId} could not finish
  // a run`) is true and fillable in both cases. So the refusal lives here, in
  // the function whose whole job is "the class's own sentence is false about
  // this row", and the row falls to the derived sentence with
  // `headlineTemplate: null` so the fallback is visible rather than mistaken
  // for ratified copy.
  //
  // NOTE THE DIRECTION OF THE WP-50 RULE. That ruling forbids WITHHOLDING a
  // true sentence on a fact it never states; this withholds a sentence that
  // STATES the missing fact. The two are the same rule read from its two ends.
  if (template?.id === 'agent.stuck') return bag.timeout === undefined;
  return false;
}

/** Everything a row renders, composed once. */
interface SituationCopy {
  headline: string;
  ask: string;
  chip: string;
  state: string;
  meta: string;
  /** WP-52 · the ratified rule, or the derived reason. See `Situation.rule`. */
  rule: string;
  headlineTemplate: string | null;
  /**
   * WP-54 · ITEM 2 — THE TIER, COMPOSED WITH THE SENTENCE THAT NAMES IT.
   *
   * The tier and the rule line leave this function TOGETHER, from one value, so
   * there is no window in which a caller can rank a row at one number and print
   * another. That window is what shipped: `situationOfIncident` assigned
   * `tier: 2` while the ratified `incident.no-run` rule line read the literal
   * string "Tier 1", every waiting row therefore landed at 2, `rankSituations`
   * fell through to `since`, and the owner's list degenerated to age order with
   * four Tier-1 security findings under a Tier-2 backup step.
   */
  tier: ConsequenceTier;
  door: RowDoor | null;
  signature: SituationSignature | null;
}

/**
 * A tier the comparator can hold, or the derived one.
 *
 * The generated templates type `tier` as `number` because the fixture is a
 * plain JS file and the generator will not narrow a value it read at runtime.
 * This is the one place that narrowing happens, and an out-of-range declaration
 * falls back to the DERIVED tier rather than being coerced: a tier nobody can
 * rank is not a ranking, and silently clamping it would put the copy and the
 * comparator back into disagreement through the door they came in by.
 */
function rankableTier(declared: number | null, derived: ConsequenceTier): ConsequenceTier {
  return declared === 1 || declared === 2 || declared === 3 || declared === 4
    ? (declared as ConsequenceTier)
    : derived;
}

/**
 * WP-54 · THE RECORD OUTRANKS THE CLASS, and says so by falling back.
 *
 * A class declares the tier its SENTENCE is written for: `run.waiting.
 * mid-procedure` says "Tier {tier} · the world is untouched", which is a claim
 * about the world, not only a number. §4a can derive a MORE urgent tier for the
 * same row — a write landed in scope, or the delay has a derivable deadline —
 * and when it does, the class's sentence is no longer true of that row.
 *
 * So the row falls back to the derived sentence and the derived reason, exactly
 * as `contradictedByTheRecord` does for the class whose ask is false. Ranking
 * the row at the derived tier while printing the class's reason would produce
 * "Tier 1 · the world is untouched" — a number and a reason from two different
 * facts, which is the shape this packet is removing, one line lower down.
 */
export function outrankedByTheRecord(
  template: SituationTemplate | null,
  derived: ConsequenceTier,
): boolean {
  // A class whose tier the fixture states in PROSE (`incident.coalesced`:
  // "the highest tier among the members") declares no number to be outranked,
  // so the record cannot contradict a claim it never made.
  return template !== null && template.tier !== null && derived < template.tier;
}

/**
 * A row whose class the ratified set does not cover, or cannot fill.
 *
 * The derived sentence, unchanged from what this fold has always produced. No
 * new sentence is authored here: the ratified set covers the classes it covers,
 * and inventing prose for the rest is exactly what the copy discipline forbids.
 */
function derivedCopy(
  headline: string,
  meta: string,
  state: string,
  rule: string,
  tier: ConsequenceTier,
  door: RowDoor | null,
  signature: SituationSignature | null = null,
): SituationCopy {
  return {
    headline,
    ask: '',
    chip: '',
    state,
    // WP-54 · ITEM 14 — THE IDENTIFIER IS PRINTED ONCE PER CARD.
    //
    // A derived run card's headline IS `runSummary(row)`, which reads "running
    // under rb.bulk-plugin-update — 0 done and standing, 0 failed", and its meta
    // line carried `rb.bulk-plugin-update` again. Measured on the owner's real
    // fleet: both derived rows printed their runbook id twice.
    //
    // The identifier is dropped from the META, never from the headline, and the
    // direction matters. Dropping it from the headline would leave the two
    // derived rows reading "running — 0 done and standing, 0 failed" and
    // "running — 0 done and standing, 0 failed" — identical sentences on two
    // different procedures, which is the OTHER half of the same finding: two
    // same-runbook rows must stay distinguishable. Keeping it where it already
    // distinguishes them, and dropping the repeat, satisfies both.
    //
    // A COMPARISON, not a rule about which slot wins (WP-50's precedent): the
    // day a derived headline stops naming the runbook, the meta line carries it
    // again with no edit here.
    meta: meta && headline.includes(meta) ? '' : meta,
    rule,
    headlineTemplate: null,
    tier,
    door,
    signature,
  };
}

/**
 * WP-54 · THE ROW DOOR, composed from ratified copy and the row's own facts.
 *
 * Two forms for a run and the split is the record's: a run standing at a gate
 * has a checkpoint to name, and a run with no cursor has none. Naming one
 * anyway would be the substitution defect in its politest form — a door that
 * says where it goes had better be right about where that is.
 */
function sessionDoor(row: SessionRow, gate: PendingGate | null): RowDoor {
  return {
    label: gate
      ? fillSituationSentence(DOORS.runAtGate, { checkpoint: gate.checkpointId })
      : DOORS.run,
    kind: 'session',
    target: row.id,
  };
}

/** A session row's verdict. */
function composeSessionCopy(
  row: SessionRow,
  column: TriageColumn,
  now: Date,
  since: string,
  /** WP-52 · the derived reason, for a row the ratified set does not cover. */
  tierReason: string,
  /** WP-54 · §4a's own answer, for the rows where the record outranks the class. */
  derivedTier: ConsequenceTier,
): SituationCopy {
  const done = row.outcomes.succeeded.length;
  const failed = row.outcomes.failed.length;
  // WP-48's ruling: `{total}` is THE ARMED TARGET SET, not the targets that
  // happen to have an outcome. See `SessionRow.targetSet` for why binding it to
  // `places.total` made two sentences wrong at once. `undefined` when the
  // record does not say — unknown is not zero, and every guard testing `total`
  // declines rather than reading an absence as a count.
  const total = row.targetSet;
  const gate = row.gate ?? null;
  const runbookId = row.runbookId ?? row.capability;

  const bag: SlotBag = {
    runNoun: RUN_NOUN[row.capability],
    done,
    failed,
    // `undefined` rather than `null` in the BAG: the fill guard's question is
    // "can this slot be filled", and an unknown target set cannot. The GUARD's
    // question is different — "was a target set recorded, and was it empty" —
    // which is why `input.total` keeps the null. Two representations of one
    // absence, for two different decisions, and neither is a default.
    total: total ?? undefined,
    age: ageLabel(since, now),
    checkpoint: gate?.checkpointId,
    position: gate ? `${gate.index} of ${gate.of}` : undefined,
    awaits: gate?.awaits,
    runbookId,
  };

  // A DOOR IS FOR A ROW THAT NEEDS SOMEONE. The changed column is read with no
  // interaction and no question asked (XD-26's absence list), and a finished run
  // belongs to the Record — which already exists, and is not this row's door.
  const door = column === 'waiting' ? sessionDoor(row, gate) : null;

  const selected =
    column === 'waiting'
      ? selectSituationTemplate({ kind: 'run', done, failed, total, gate, runId: row.id }, bag)
      : null;
  const template =
    contradictedByTheRecord(selected, gate) || outrankedByTheRecord(selected, derivedTier)
      ? null
      : selected;

  // A run has no signature: nothing in the Inbox is a run, so there is nothing
  // to be the same thing AS. Absent rather than empty — see `SituationSignature`.
  if (!template) return derivedCopy(runSummary(row), runbookId, '', tierReason, derivedTier, door);
  const tier = rankableTier(template.tier, derivedTier);
  return {
    headline: fillSituationSentence(template.headline, bag),
    ask: fillSituationSentence(template.ask, bag),
    chip: template.chip,
    state: template.state,
    meta: fillSituationSentence(template.meta, bag),
    // WP-52 item 3: the ratified rule, upright and tier-named. Read from the
    // template like every other field of a ratified card — never retyped.
    //
    // WP-54 item 2: and the tier in it is a SLOT, filled from the very value
    // this function returns as `tier`. The number the card shows and the number
    // it is sorted by are one value, not two that agree.
    rule: fillSituationSentence(template.rule, { ...bag, tier }),
    headlineTemplate: template.id,
    tier,
    door,
    signature: null,
  };
}

/** An orphan incident's verdict — a situation of one is still a situation. */
function composeIncidentCopy(
  incident: EventEnvelope,
  places: PlaceSet,
  derived: string,
  /** WP-52 · the derived reason, for a row the ratified set does not cover. */
  tierReason: string,
  column: TriageColumn,
  derivedTier: ConsequenceTier,
  /** WP-54 · what the target is CALLED, from the record. See `deps.nameOf`. */
  nameOf: ((entityId: string) => string | undefined) | undefined,
): SituationCopy {
  const payload = payloadOf(incident);
  const anchor = incident.entity?.environment ?? incident.entity?.site;
  // WP-54 · ITEM 4 — THE TARGET, RESOLVED TO WHAT IT IS CALLED.
  //
  // This slot used to be the raw entity id, and the comment above it argued
  // that nothing on this fold could name a site. That was true of
  // `describePlace`, which answers WHERE a target is, and false of the record:
  // the `site.core` twin fact carries the name for these very entities, and the
  // duplicate inbox card six inches below every one of those cards was already
  // printing it. Resolving here rather than in the surface keeps the name and
  // the door's label one derivation.
  //
  // THE FALLBACK IS THE ID, NOT A GUESS. An entity the twin does not name is
  // cited in full, which is the property the refusals and the Govern matrix
  // hold to — and the honest rendering of "the record does not say".
  // GUARDED AT THE CALL SITE, not only inside the default resolver. The twin
  // reader defends itself, but `nameOf` is an injectable port and an injected
  // one that throws would take the whole fold down — which the layer forbids
  // outright ("everything on this seam is non-fatal by construction"). Same
  // shape, and the same one-line comment, as `derivePlaces`'s describer guard:
  // a faulty resolver costs the NAME, never the row. Found by driving the
  // builder over its full input domain rather than through its current caller
  // (WP-46).
  let targetName: string | undefined;
  try {
    targetName = anchor ? nameOf?.(anchor) : undefined;
  } catch {
    targetName = undefined;
  }
  const target = targetName ?? anchor;
  const bag: SlotBag = {
    finding: str(payload.symptom) ?? str(payload.fact),
    target,
    producer: (incident.actor as { id?: string } | undefined)?.id,
  };

  // Same rule as the session path: a door is for a row that needs someone, and a
  // closed incident needs no one. And `null` when the record cannot name the
  // target — a door that cannot say where it goes is the string this item is
  // replacing, one iteration on.
  const door: RowDoor | null =
    column === 'waiting' && target
      ? { label: fillSituationSentence(DOORS.incident, { target }), kind: 'site', target }
      : null;

  // WP-54 · ITEM 1 — the identity, built from the three facts the record holds.
  // All three or none: a partial signature would match on fewer facts than the
  // rule requires, which is how a dedup starts folding two different findings
  // into one row.
  const producer = (incident.actor as { id?: string } | undefined)?.id;
  const fact = str(payload.fact);
  const signature: SituationSignature | null =
    producer && fact && target
      ? { producer: normalizeProducerId(producer), fact, target }
      : null;

  // An orphan is BY CONSTRUCTION a situation with no run: it reached this
  // function because nothing correlated it into a session. `runId: null` is
  // therefore the record's own answer, not a default standing in for one.
  //
  // WP-54 · SELECTED FOR THE WAITING COLUMN ONLY, which is the reading the
  // session path has always used and this one was missing. `incident.no-run`'s
  // guard reads `runId === null` and says nothing about resolution, so a CLOSED
  // incident was being handed "…and nothing is fixing it" plus, now that the
  // class declares its tier, tier 1 — a resolved incident ranked at the top of
  // a list of things needing a person. The templates select rows of the Now
  // list; the changed column is a different list.
  const template =
    column === 'waiting'
      ? selectSituationTemplate(
          { kind: 'incident', done: 0, failed: 0, total: places.total, gate: null, runId: null },
          bag,
        )
      : null;

  if (!template) {
    // The class's own `state`, READ from the ratified set rather than retyped —
    // an incident row that reached the fallback is still an incident with no run
    // attached, and that phrase is the designer's. Absent if the set ever drops
    // the class, which renders no state line rather than a stale one.
    const state = SITUATION_TEMPLATES.find((t) => t.id === 'incident.no-run')?.state ?? '';
    return derivedCopy(
      derived,
      fillSituationSentence('{producer}', bag),
      state,
      tierReason,
      derivedTier,
      door,
      signature,
    );
  }
  const tier = rankableTier(template.tier, derivedTier);
  return {
    headline: fillSituationSentence(template.headline, bag),
    ask: fillSituationSentence(template.ask, bag),
    chip: template.chip,
    state: template.state,
    meta: fillSituationSentence(template.meta, bag),
    // WP-52 item 3, on the incident card too: the ratified rule, upright — and
    // WP-54 item 2, with its tier filled from the tier this row is sorted by.
    rule: fillSituationSentence(template.rule, { ...bag, tier }),
    headlineTemplate: template.id,
    tier,
    door,
    signature,
  };
}

/**
 * WP-54a · An agent failure's verdict.
 *
 * The bag carries exactly two slots, both read from the payload the producer
 * wrote and neither recomputed: `{agentId}` (the headline and the meta line)
 * and `{timeout}` (the ask). `{timeout}` is ABSENT when the record has no
 * duration, and an absent one refuses the class rather than shortening its
 * sentence — see `contradictedByTheRecord`'s second arm.
 */
function composeAgentFailureCopy(
  payload: AgentFailurePayload,
  derived: string,
  /** WP-52 · the derived reason, for a row the ratified set does not cover. */
  tierReason: string,
): SituationCopy {
  const bag: SlotBag = {
    agentId: payload.agent_id,
    timeout: timeoutLabel(payload.timeout_ms),
  };

  const selected = selectSituationTemplate(
    // A failure that is on the list is by construction one nothing has closed,
    // and it was never armed under a procedure: no gate, no targets, nothing
    // written. Every field but `kind` is the record's own answer rather than a
    // default standing in for one.
    { kind: 'agentFailure', done: 0, failed: 0, total: null, gate: null, runId: null },
    bag,
  );
  const template = contradictedByTheRecord(selected, null, bag) ? null : selected;

  // WP-54 · THE THREE FIELDS THE MERGE HAD TO FILL, and the reason this
  // function is where the two packets met.
  //
  // WP-54a edited none of WP-54's eight named functions and WP-54 edited none
  // of WP-54a's — the locks were kept perfectly — and the two still collided,
  // because `SituationCopy` gained three required fields while this function
  // predated them. **Locks partition FILES; they do not partition TYPES.** The
  // type system caught it at compile time, loudly, in a form nothing could ship
  // past, with the badge/row equality pin standing behind it as the second net.
  //
  //  - `tier` comes from the class's own declaration, so the tier this row is
  //    RANKED at is the tier its rule line PRINTS. `situationOfAgentFailure`
  //    used to assign `tier: 3` at the call site; that second source is gone.
  //  - `door` is the ratified `agent.stuck` door — the agent's own page, which
  //    is where its permissions live.
  //  - `signature` is what lets the Inbox's copy of this failure ride ON this
  //    row instead of rendering beside it. The join is the Inbox's own:
  //    `recordRunToInbox` writes `source: agentId`, `code: failureCode(message)`,
  //    `scope: '*'`, and every one of those three is reproducible from the
  //    payload the producer already writes. Without it, `auth-probe could not
  //    finish a run` renders twice and the badge/row pin goes red — correctly.
  const door: RowDoor = {
    label: fillSituationSentence(DOORS.agent, bag),
    kind: 'agent',
    target: payload.agent_id,
  };
  // The message the Inbox hashed, reproduced from the record rather than
  // guessed: `recordRunToInbox` uses `run.error` when it has one and this exact
  // fallback when it does not, so the same two branches produce the same code.
  const hashed = payload.message ?? `The run ended with status "${payload.status}".`;
  const signature: SituationSignature = {
    producer: normalizeProducerId(payload.agent_id),
    fact: failureCode(hashed),
    // The Inbox's own fleet-level scope. An agent run that timed out did not
    // fail at a site, and `'*'` is what the store already writes for that.
    target: '*',
  };

  if (!template) {
    return derivedCopy(derived, payload.agent_id, '', tierReason, DERIVED_AGENT_TIER, door, signature);
  }
  return {
    headline: fillSituationSentence(template.headline, bag),
    ask: fillSituationSentence(template.ask, bag),
    chip: template.chip,
    state: template.state,
    meta: fillSituationSentence(template.meta, bag),
    // The rule line's tier is the tier this row is RANKED at — the same value
    // returned below, not the declaration read a second time.
    rule: fillSituationSentence(template.rule, {
      ...bag,
      tier: rankableTier(template.tier, DERIVED_AGENT_TIER),
    }),
    headlineTemplate: template.id,
    tier: rankableTier(template.tier, DERIVED_AGENT_TIER),
    door,
    signature,
  };
}

/**
 * WP-54a's own answer for a row the ratified class refuses: tier 3.
 *
 * It is the SAME number the class declares, and that is not redundancy — the
 * class's number is what a RATIFIED card ranks at, and this is what a DERIVED
 * one does. §4a has no arm for an agent failure (it ranks runs by what they
 * wrote and incidents by whether anything is fixing them), so the tier the
 * packet ruled for the class is the honest default for the class's fallback
 * too, and naming it once here is what stops a second literal appearing at a
 * call site.
 */
const DERIVED_AGENT_TIER: ConsequenceTier = 3;

/**
 * The recorded timeout, in the unit the designer's own specimen uses.
 *
 * `situation-headlines.js`'s slot table writes `timeout: '90s'`, and
 * `ageLabel` a few lines above renders `82h` — a bare number with a unit
 * suffix is this file's existing shape and the fixture's, so seconds is not a
 * choice made here. The live value is 300000ms, which renders `300s`; whether
 * the designer wants a minutes form above some threshold is a copy question
 * raised at the gate, not one answered by inventing a second scheme.
 *
 * `undefined` in, `undefined` out — the absence is carried, never rounded into
 * a zero.
 */
function timeoutLabel(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return undefined;
  return `${Math.round(ms / 1000)}s`;
}

/**
 * WP-54a · An open agent failure is a situation of one — the class the fold
 * could not emit.
 *
 * TIER 3, from the template's own rule line rather than from a second
 * judgement beside it: "the agent is asking, not the fleet … which is why it
 * sorts below both waiting classes however old it is." The live row is 82 hours
 * old and belongs last; a ranker that reached its own conclusion here would be
 * the architect's finding 1 in a new class.
 */
function situationOfAgentFailure(event: EventEnvelope): Situation {
  const payload = (event.payload ?? {}) as AgentFailurePayload;
  const agentId = payload.agent_id;
  const status = payload.status === 'timeout' ? 'timeout' : 'error';

  // The derived sentence for a row the ratified class refuses: the record's own
  // words, and no ratified copy retyped. The runner's message when it recorded
  // one, the status when it did not — never a verb this file invented.
  const derived = payload.message
    ? `${agentId}: ${payload.message}`
    : `${agentId}: a run ended in ${status}`;

  const tierReason = `the run ended in ${status} and the agent has not succeeded since`;
  const copy = composeAgentFailureCopy(payload, derived, tierReason);

  return {
    id: event.id,
    kind: 'agentFailure',
    // It needs you: the ask is "Retry it, or leave it stopped", which is a
    // decision only the user makes. A resolved failure never reaches here —
    // the fold filters it out rather than moving it to `changed`, because
    // "an agent ran fine today" is not a change to the fleet.
    column: 'waiting',
    // WP-54's merge: `tier`, `door` and `signature` arrive with `...copy`
    // below. This line used to read `tier: 3` — the class's number, assigned a
    // second time at a call site, which is the divergence WP-54 item 2 removes.
    // One declaration, in the ratified fixture, read by the composer.
    tierReason,
    // NO PLACES. An agent run that timed out did not fail at a site, and
    // `derivePlaces([])` reports a set of zero with an empty summary — the
    // honest rendering of an empty place set is no place clause at all.
    places: derivePlaces([]),
    since: event.observed_at,
    lastEventId: event.id,
    parts: [
      {
        kind: 'agentFailure',
        eventId: event.id,
        topic: event.topic,
        observedAt: event.observed_at,
        summary: derived,
      },
    ],
    ...copy,
    // Never armed under a procedure, so there is no target set at all — null,
    // not zero. `capability` is absent for the same reason it is absent on an
    // orphan incident: `''` would read as one the row could not name.
    written: { done: 0, failed: 0, total: null },
  };
}

/**
 * The agent failures that are still open, newest state per agent.
 *
 * The producer's resolution model is the incident producer's: a closing event
 * SUPERSEDES the one it closes rather than mutating it, so the newest event for
 * an agent IS that agent's current state. Read newest-first, first hit per
 * agent wins, and a hit that says `resolved` takes the agent off the list.
 */
function openAgentFailures(events: readonly EventEnvelope[]): EventEnvelope[] {
  const seen = new Set<string>();
  const open: EventEnvelope[] = [];
  for (const event of events) {
    const payload = (event.payload ?? {}) as AgentFailurePayload;
    const agentId = payload.agent_id;
    if (typeof agentId !== 'string' || !agentId) continue;
    if (seen.has(agentId)) continue;
    seen.add(agentId);
    if (payload.resolved === true) continue;
    open.push(event);
  }
  return open;
}

/**
 * A ROW OF THE LIST THAT THIS FOLD DOES NOT HOLD.
 *
 * An Inbox item matching no situation — on the owner's real fleet, `auth-probe
 * could not finish a run`, the ratified `agent.stuck` class no producer emits
 * yet. It renders in the Now list, so it is part of the list the verdict is
 * about, and the caller supplies it because **only the renderer can see it**.
 *
 * It is a SHAPE rather than the count WP-54 first passed, for two rulings that
 * arrived from different directions and need the same field to be a record —
 * see each field.
 */
export interface UnheldRow {
  /**
   * WP-54b — the written-state of a row the fold does NOT hold.
   *
   * The base decided `changedRuns` over `waiting` while counting
   * `waiting + alsoWaiting`, so the branch was chosen over a SUBSET of the rows
   * the sentence counts — and the fixture's ratified guard reads "allUnwritten
   * when EVERY waiting row has done === 0 && failed === 0". An unheld row is a
   * waiting row. A bare count cannot answer the guard's question, which is why
   * this is a shape.
   *
   * **MEASURED, and it is a fact rather than a default:** `InboxItem`
   * (`src/main/inbox/types.ts`) carries no outcome fields at all — it is a
   * FINDING, not a run — so every unheld row today is `{done: 0, failed: 0}`.
   * That is what an Inbox item IS, not a value invented to fill the field. If
   * Inbox items ever record outcomes, one call site changes and this sum does
   * not.
   */
  written: { done: number; failed: number };
  /**
   * WP-56 — deferred by the user.
   *
   * The collision's own addition: an unheld row can be deferred too, and **a
   * deferred Inbox card that still incremented the badge would be the deferral
   * deferring nothing** — this packet's argument turned on the term it could not
   * see while WP-54 held the file.
   *
   * **DISCLOSED: no caller can set this true yet.** A deferral names a SITUATION
   * id and the fold holds no unheld rows, so `applyDeferrals` can never reach
   * one. The renderer fills it from the SAME predicate the badge uses
   * (`rowIsDeferred`), so the day an Inbox card becomes deferrable the value
   * flows through one rule rather than a second one being written. Same honest
   * treatment as `wakeFired` and `deadlineFor`: the ruled input is implemented
   * and its absence is stated, never quietly dropped.
   */
  deferred?: boolean;
}

/**
 * THE LIST VERDICT — one sentence about the whole list.
 *
 * Read off the rows' own `written` counts, which are the numbers their
 * headlines were composed from, so the sentence cannot disagree with the rows
 * beneath it. Empty when nothing is escalating: a verdict about rows nobody is
 * being asked to act on is a claim about nothing.
 */
export function listVerdict(
  waiting: readonly Situation[],
  alsoWaiting: readonly UnheldRow[] = [],
): string {
  // THE MERGED EXPRESSION (ruled 2026-08-21, after a three-way collision on one
  // sum). Three packets edited this arithmetic through different doors and none
  // could see the others:
  //
  //   WP-54  added `alsoWaiting` — the Now screen renders situations PLUS every
  //          Inbox item matching none of them, and a verdict counting only what
  //          this fold holds would head eight rows with the word "7".
  //   WP-56  replaced `waiting.length` with the ESCALATING subset, so a deferred
  //          situation leaves the count the badge renders.
  //   WP-54b required the branch to be decided over the rows the sentence
  //          counts, not a subset of them.
  //
  // **Both bodies were correct and taking either whole was a silent
  // regression** — and every test on either branch passed under either
  // resolution, because neither branch had a case where both terms were
  // non-zero. That case is now pinned (`bothTermsNonZero`).
  //
  // LOCKS PARTITION FILES; THEY DO NOT PARTITION ARITHMETIC. Both locks here
  // were kept perfectly and the collision happened anyway.
  //
  // `needsYou` is the escalating situations PLUS the escalating unheld rows;
  // `changedRuns` is measured over that same union. **Neither term is a bare
  // count**, and that is the whole ruling: a count cannot say whether its rows
  // are deferred, and it cannot say whether they wrote anything.
  const held = escalating(waiting);
  const unheld = alsoWaiting.filter((row) => !row.deferred);
  const needsYou = held.length + unheld.length;
  // A list of nothing but deferrals says nothing, for the reason an empty list
  // does: a verdict about rows nobody is being asked to act on is a claim about
  // nothing. The accounting line still states the deferrals
  // (`TriageCounts.deferred`), so the silence is not a disappearance.
  if (needsYou === 0) return '';
  const wrote = (w: { done: number; failed: number }): boolean => w.done > 0 || w.failed > 0;
  const changedRuns =
    held.filter((s) => wrote(s.written)).length + unheld.filter((r) => wrote(r.written)).length;
  const bag: SlotBag = { needsYou, changedRuns };
  return changedRuns === 0
    ? fillSituationSentence(LIST_VERDICT.allUnwritten, bag)
    : fillSituationSentence(LIST_VERDICT.someChanged, bag);
}

function safeDeadline(deps: SessionRegistryDeps, row: SessionRow): DerivedDeadline | undefined {
  if (!deps.deadlineFor) return undefined;
  try {
    return deps.deadlineFor({ capability: row.capability, taskIds: row.taskIds, events: [] });
  } catch {
    return undefined; // a faulty derivation costs the deadline, not the row
  }
}

/**
 * §4a's tier rule, applied to one situation.
 *
 * The two T1 arms are the ruled ones and nothing else promotes: a halt does not
 * earn T1 for being a halt, and a gate does not earn T2 for being a gate. The
 * world behind them decides.
 */
function rankSession(
  row: SessionRow,
  column: TriageColumn,
  deadline: DerivedDeadline | undefined
): { tier: ConsequenceTier; tierReason: string } {
  if (column === 'changed') {
    return {
      tier: 4,
      tierReason: `the run is complete under ${row.runbookId ?? row.capability}; nothing is waiting on you`,
    };
  }
  if (row.outcomes.writeLanded) {
    return {
      tier: 1,
      tierReason:
        `a write has landed in scope — ${row.outcomes.succeeded.length} target(s) with a recorded ` +
        `successful gated act (${row.outcomes.writeEventId})`,
    };
  }
  if (deadline) {
    return { tier: 1, tierReason: `the delay has a derivable deadline — ${deadline.at} (${deadline.from})` };
  }
  return {
    tier: 2,
    tierReason:
      row.gate?.awaits === 'approval'
        ? 'awaiting consent, and nothing has been written in scope'
        : 'waiting, and nothing has been written in scope',
  };
}

/** An incident nothing links into a run is its own situation of one (tear 2). */
function situationOfIncident(incident: EventEnvelope, deps: SessionRegistryDeps): Situation {
  const payload = payloadOf(incident);
  // ONE target, by the anchor rule the incident producer itself uses
  // (`refs.site ?? refs.environment`). `Object.values(entity)` would count an
  // incident stamped with both roles as two targets and report "1 of 2", which
  // is a place set inflated by a schema artifact rather than by the world.
  const anchor = incident.entity?.environment ?? incident.entity?.site;
  const places = derivePlaces(anchor ? [anchor] : [], deps.describePlace);
  const resolved = payload.resolved === true;
  const derived = `${resolved ? 'incident closed' : 'incident open'}: ${
    str(payload.symptom) ?? str(payload.fact) ?? 'no symptom recorded'
  }`;
  const tierReason = resolved
    ? 'the incident is recorded closed; nothing is waiting on you'
    : 'an open incident with no run linked to it — nothing has been written under a procedure';
  // An incident nobody is waiting on is a thing that CHANGED; an open one is
  // waiting. Same rule the sessions use: the world's state, not the kind.
  const column: TriageColumn = resolved ? 'changed' : 'waiting';
  // WP-54 · ITEM 2. This line used to read `tier: resolved ? 4 : 2` while the
  // ratified `incident.no-run` card printed "Tier 1". The derived answer is
  // still computed — it is what a row the ratified set does not cover ranks at,
  // and what a CLOSED incident ranks at — but an open orphan incident now ranks
  // at the tier its own class declares, which is the tier its rule line prints.
  const derivedTier: ConsequenceTier = resolved ? 4 : 2;
  const copy = composeIncidentCopy(
    incident,
    places,
    derived,
    tierReason,
    column,
    derivedTier,
    deps.nameOf,
  );

  return {
    id: incident.id,
    kind: 'incident',
    column,
    // `tier` and `door` arrive with `...copy` below. See the session path.
    tierReason,
    places,
    since: incident.observed_at,
    lastEventId: incident.id,
    parts: [
      {
        kind: 'incident',
        eventId: incident.id,
        topic: incident.topic,
        observedAt: incident.observed_at,
        summary: derived,
      },
    ],
    ...copy,
    // An orphan incident was never armed under a procedure, so it has no target
    // set at all — null, not the size of its place set.
    written: { done: 0, failed: 0, total: null },
  };
}

/**
 * WP-51 · every incident row says how many events it folded and what linked
 * them.
 *
 * A separate helper rather than two fields set at two call sites, because the
 * pair is one fact: `memberCount: 4, linkKind: null` would claim a fold nothing
 * justified, and `memberCount: 1, linkKind: 'correlation'` would claim a link
 * did work it did not do. Setting them together is the shape that cannot say
 * either.
 */
function withFoldFacts(
  situation: Situation,
  memberCount: number,
  linkKind: SituationLink | null,
): Situation {
  return { ...situation, memberCount, linkKind };
}

/**
 * WP-51 item 2 · RUN-LESS INCIDENTS SHARING A CORRELATION ARE ONE SITUATION.
 *
 * The ruling: *"One orphan-grouping rule in the coalescer: run-less incidents
 * sharing a correlation coalesce into one situation with parts. This does NOT
 * breach 'record links, never payloads' — the link becomes a genuine record
 * link; the payload stays unread."*
 *
 * Read the emphasis: the doctrine did not move. This function keys on
 * `EventEnvelope.correlation` — a field the validator constrains to
 * `task_<ULID>` and the sentinel producer now fills with the id of an act it
 * emitted. Nothing here opens a payload to decide what belongs with what.
 *
 * THE ROW'S OWN VERDICT IS DERIVED FROM THE MEMBERS, NEVER BORROWED FROM ONE.
 * The ratified `incident.no-run` headline is one member's sentence
 * (`{finding} on {target}`), and Q3's guard is that a coalesced row *"can never
 * be one member's sentence with a parts chip bolted on"* — the prepending
 * defect one level up. So this takes the DERIVED path, reports
 * `headlineTemplate: null`, and the ratified `incident.coalesced` class the
 * designer has since drawn lands with WP-55, which owns the fixture and the
 * generator. The fold supplies the facts that class reads (`memberCount`,
 * `linkKind`); it does not write its words.
 *
 * THE SITUATION'S ID IS THE LINK. Naming the row after one of its members would
 * say that member is the situation, and would change identity every time the
 * oldest member resolved.
 */
function situationOfCoalescedIncidents(
  link: string,
  members: readonly EventEnvelope[],
  deps: SessionRegistryDeps,
): Situation {
  // Oldest first, by ULID — the order the parts happened in, and the same
  // ordering `runEvents` uses for a run's own events.
  const ordered = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // One anchor per member, by the incident producer's own rule
  // (`refs.site ?? refs.environment`), deduplicated by `derivePlaces`. A
  // sweep can span sites, so this is a set and not a single target.
  const anchors = ordered
    .map((event) => event.entity?.environment ?? event.entity?.site)
    .filter((id): id is string => !!id);
  const places = derivePlaces(anchors, deps.describePlace);

  const open = ordered.filter((event) => payloadOf(event).resolved !== true);
  const resolved = open.length === 0;

  const parts: SituationPart[] = ordered.map((event) => ({
    kind: 'incident',
    eventId: event.id,
    topic: event.topic,
    observedAt: event.observed_at,
    summary: incidentSummary(event),
  }));

  // A situation is not over while a part of it is open. The counts are stated
  // rather than the verdict inferred from the newest member.
  const column: TriageColumn = resolved ? 'changed' : 'waiting';
  const tierReason = resolved
    ? `${ordered.length} incidents share one record link and every one is recorded closed; nothing is waiting on you`
    : `${open.length} of ${ordered.length} incidents sharing one record link are open, with no run linked to them` +
      ' — nothing has been written under a procedure';

  return {
    id: link,
    kind: 'incident',
    column,
    // WP-51 wrote here: *"The same rank an orphan incident takes today, for the
    // same reason: this packet folds rows, it does not re-rank them. The
    // ratified sheet's own tier line and this fold's rank disagree for EVERY
    // incident row, coalesced or not; that is a sibling packet's finding and
    // its fix, and taking half of it here would leave the two halves in two
    // packets."*
    //
    // **WP-54'S MERGE IS WHERE THE TWO HALVES MEET.** `tier` now arrives with
    // `...coalescedCopy(...)` below, from the members' own class declaration —
    // which is also what the ratified `incident.coalesced` class states its
    // tier to be: *"the highest tier among the members."* One declaration, read
    // by the composer, filled into the rule line it prints.
    tierReason,
    places,
    since: oldestIso(ordered.map((event) => event.observed_at)),
    lastEventId: maxId(ordered.map((event) => event.id)),
    parts,
    ...coalescedCopy(ordered, open.length, tierReason),
    // A coalesced group of incidents was never armed under a procedure, so it
    // has no target set at all — null, not the size of its member set.
    written: { done: 0, failed: 0, total: null },
    memberCount: ordered.length,
    linkKind: 'correlation',
  };
}

/** One member's line, in the words the fold has always used for an incident. */
function incidentSummary(event: EventEnvelope): string {
  const payload = payloadOf(event);
  return `${payload.resolved === true ? 'incident closed' : 'incident open'}: ${
    str(payload.symptom) ?? str(payload.fact) ?? 'no symptom recorded'
  }`;
}

/**
 * The coalesced row's derived verdict — counts and the origin, and nothing a
 * member said.
 *
 * Two words are available for where the group came from and BOTH are read off
 * the record's `source.system`: a sentinel sweep is "one scan", anything else
 * reaching this function came from a procedure run and is "one run". Neither is
 * a guess, and a mixed group (which no producer can currently create, since a
 * correlation belongs to one act) takes the general word.
 */
function coalescedCopy(
  members: readonly EventEnvelope[],
  openCount: number,
  tierReason: string,
): SituationCopy {
  const origin = members.every((event) => event.source?.system === SENTINEL_SYSTEM) ? 'one scan' : 'one run';
  const total = members.length;
  const headline =
    openCount === total
      ? `${total} open incidents from ${origin}`
      : openCount === 0
        ? `${total} incidents from ${origin}, all recorded closed`
        : `${total} incidents from ${origin}, ${openCount} still open`;

  // The producer, when every member names the same one. Two producers under one
  // link is not a thing any current producer writes, and printing one of them
  // would be a claim about the other.
  const actors = new Set(members.map((event) => (event.actor as { id?: string } | undefined)?.id ?? ''));
  const meta = actors.size === 1 ? [...actors][0] : '';

  // The status phrase READ from the ratified set, exactly as the orphan
  // fallback reads it — a coalesced group of run-less incidents is still a set
  // of incidents with no run attached, and that phrase is the designer's.
  const state = SITUATION_TEMPLATES.find((t) => t.id === 'incident.no-run')?.state ?? '';
  // WP-54's merge · THE THREE FIELDS, and the one that is honestly absent.
  //
  // `tier` is the members' own class's, for the reason the caller states.
  // `door` is null: a group's members can sit on DIFFERENT targets — grouping
  // by a shared record link says nothing about a shared site — so there is no
  // one place this row leads to, and a door naming one member's site would be
  // the prepending defect in its navigation form.
  //
  // `signature` is null, AND THAT IS A REGISTERED RESIDUE RATHER THAN A
  // DECISION. A signature identifies ONE thing; a coalesced row is several, so
  // the Inbox's copies of its members cannot ride on it and render as their own
  // rows beside it. Nothing coalesces on the owner's ledger today (the four
  // findings carry no link), so nothing is affected yet — but the next sentinel
  // sweep mints one, and then a coalesced row of four shows four Inbox rows
  // beside it. The badge and the verdict stay honest, because both count what
  // is DRAWN; this is redundancy rather than a lie. The fix is a signature SET,
  // and it belongs with the packet that reconciles `incident.coalesced` into
  // the generated template set — WP-55 — because that is the same visit.
  return derivedCopy(headline, meta, state, tierReason, memberTier(), null, null);
}

/**
 * The tier every member of a run-less group carries — the `incident.no-run`
 * class's own declaration, read from the ratified set.
 *
 * The ratified `incident.coalesced` class states its tier as *"the highest tier
 * among the members"*, and every member of a run-less group is by construction
 * an `incident.no-run`, so the highest among them is that class's. Falls back
 * to the fold's historical answer if the set ever drops the class, which
 * renders a ranked row rather than a throw.
 */
function memberTier(): ConsequenceTier {
  const declared = SITUATION_TEMPLATES.find((t) => t.id === 'incident.no-run')?.tier;
  return declared === undefined ? 2 : rankableTier(declared, 2);
}

function oldestIso(values: readonly (string | undefined)[]): string {
  let oldest: string | undefined;
  for (const value of values) {
    if (!value) continue;
    if (!oldest || value < oldest) oldest = value;
  }
  return oldest ?? '';
}

function newestIso(values: readonly (string | undefined)[]): string {
  let newest: string | undefined;
  for (const value of values) {
    if (!value) continue;
    if (!newest || value > newest) newest = value;
  }
  return newest ?? '';
}

/**
 * The order, applied. Tier, then place-set, then age — oldest first.
 *
 * Sorting the whole list once and letting the columns be a filter over it is
 * deliberate: two comparators would be two orders, and §4a's whole point is
 * that there is one.
 */
export function rankSituations(situations: readonly Situation[]): Situation[] {
  return [...situations].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const place = placeRank(b.places.highest) - placeRank(a.places.highest);
    if (place !== 0) return place;
    if (a.since !== b.since) return a.since < b.since ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// WP-56 · Deferral — the post-pass that can only lower escalation
// ---------------------------------------------------------------------------

/** One deferral record as the ledger holds it, before supersession is resolved. */
interface DeferralEvent {
  act: 'defer' | 'end';
  situation: string;
  eventId: string;
  observedAt: string;
  reason: string;
  wake: DeferralWake | null;
}

/**
 * A rationale event that is a DEFERRAL record, or nothing.
 *
 * **The actor gate lives here, and it is the authoritative one.** "Only the user
 * defers — an agent quieting its own gate is the self-promotion power inverted."
 * The producer refuses a non-human actor too, but this is the enforcement that
 * matters: the fold is the thing that lowers an escalation, so a record that
 * somehow exists — written by an older build, a future caller, or a direct
 * emitter call in a test — still cannot quiet anything. A rule enforced only at
 * the write is a rule that holds until someone writes past it.
 */
function deferralEventOf(event: EventEnvelope): DeferralEvent | undefined {
  if (event.topic !== RATIONALE_RECORDED_TOPIC) return undefined;
  const payload = payloadOf(event);
  if (payload.source !== DEFERRAL_PAYLOAD_SOURCE) return undefined;

  const actor = event.actor as { kind?: unknown } | undefined;
  if (actor?.kind !== 'human') return undefined;

  const act = payload.act;
  if (act !== 'defer' && act !== 'end') return undefined;
  const situation = str(payload.situation);
  if (!situation) return undefined;

  return {
    act,
    situation,
    eventId: event.id,
    observedAt: event.observed_at,
    // TRIMMED HERE TOO, not only at the producer. The producer refuses a
    // whitespace-only reason, but this is the authoritative gate — a record
    // that reaches the ledger by any other route must meet the same bar, or
    // "a reason is recorded" is satisfied by three spaces.
    reason: (str(payload.reason) ?? '').trim(),
    wake: wakeOf(payload.wake),
  };
}

/** A wake condition the record actually holds. Anything else is unconditioned. */
function wakeOf(raw: unknown): DeferralWake | null {
  if (!raw || typeof raw !== 'object') return null;
  const wake = raw as Record<string, unknown>;
  if (wake.kind === 'time') {
    const at = str(wake.at);
    return at && Number.isFinite(Date.parse(at)) ? { kind: 'time', at } : null;
  }
  if (wake.kind === 'record') {
    const from = str(wake.from);
    return from ? { kind: 'record', from } : null;
  }
  return null;
}

/**
 * Has this deferral's condition fired?
 *
 * A `time` wake is decided against the fold's own clock — derivable, and the
 * only kind that works in production today. A `record` wake goes to the port;
 * absent, it has not fired, which is the honest answer rather than a guess in
 * either direction. See `WAKE_SOURCE_NOTE`.
 */
function wakeHasFired(
  deferral: SituationDeferral,
  situation: Situation,
  deps: SessionRegistryDeps,
  now: Date
): boolean {
  const wake = deferral.wake;
  if (!wake) return false; // unconditioned: permitted, and it never wakes
  if (wake.kind === 'time') return now.getTime() >= Date.parse(wake.at);
  if (!deps.wakeFired) return false;
  try {
    return deps.wakeFired({ wake, situation, now }) === true;
  } catch {
    return false; // a faulty derivation costs the wake, not the row
  }
}

/**
 * Attach standing deferrals to the situations they name.
 *
 * **THIS FUNCTION CAN ONLY ADD A FIELD.** It reads `situation.column` and writes
 * `situation.deferral`, and there is deliberately nothing else in reach: no
 * tier, no place, no order, no removal from any list. "A deferred situation
 * keeps its tier and its place and lowers escalation only — leaving the list is
 * a dismissal by another name, and the ruling refused that." That is the whole
 * ruling, enforced by the shape of the pass rather than by a reviewer noticing.
 *
 * **DEFERRAL APPLIES TO THE SITUATION, NEVER TO ITS PARTS** (XD-28). The lookup
 * is `byId`, keyed by SITUATION id — so a record naming a part's event id finds
 * nothing and is dropped, and the situation goes on escalating with every one of
 * its members. There is no code path here that could reach `situation.parts`.
 *
 * **THREE RECORDED ENDS, and all three are derived rather than stored:**
 *
 *  1. **The wake fires** — `wakeHasFired`. The condition is on the record and
 *     the clock is the fold's; nothing needs to write an "ended" event for a
 *     wake, and nothing should, because then a deferral's state would depend on
 *     a timer having run rather than on the record being read.
 *  2. **The user ends it early** — an `act: 'end'` record, superseding. Latest
 *     governs, so a later `defer` re-defers ("Defer again", as the sheet draws
 *     the woken state).
 *  3. **The situation is answered** — the row moves to the `changed` column, and
 *     a deferral is dropped there. A completed run is not something anyone is
 *     still being asked to quiet, and carrying the deferral across would put
 *     "deferred by you" on a row that is finished.
 *
 * Latest-governs is resolved in LEDGER ORDER (ascending event id), which is the
 * order `foldProcedureCursor` already uses for exactly this question. Ordering
 * supersession by `observed_at` instead would let a clock skew on one click
 * decide whether a deferral stands.
 */
function applyDeferrals(
  situations: readonly Situation[],
  ledger: LedgerLike,
  deps: SessionRegistryDeps,
  now: Date
): void {
  const byId = new Map(situations.map((s) => [s.id, s]));
  if (byId.size === 0) return;

  let events: EventEnvelope[];
  try {
    // Newest-first then reversed, like the manifest scan. NOTE the limit is
    // over the WHOLE rationale family — approvals share this topic — so a
    // ledger carrying more than `DEFERRAL_SCAN_LIMIT` recent rationale events
    // could push an older standing deferral out of the window, and that row
    // would return to the badge. There is no cheaper query: the discriminator
    // is a payload field, and the ledger indexes topics. Bounded and stated.
    events = ledger
      .query({
        topicPrefix: RATIONALE_RECORDED_TOPIC,
        limit: deps.deferralLimit ?? DEFERRAL_SCAN_LIMIT,
        order: 'desc',
      })
      .slice()
      .reverse();
  } catch {
    return; // an unreadable ledger costs the quieting, never the list
  }

  const standing = new Map<string, SituationDeferral>();
  for (const event of events) {
    const record = deferralEventOf(event);
    if (!record) continue;
    if (!byId.has(record.situation)) continue; // names no situation — a part, or gone
    if (record.act === 'end') {
      standing.delete(record.situation);
      continue;
    }
    if (!record.reason) continue; // a deferral with no reason is a dismissal
    standing.set(record.situation, {
      eventId: record.eventId,
      reason: record.reason,
      deferredAt: record.observedAt,
      wake: record.wake,
    });
  }

  for (const [situationId, deferral] of standing) {
    const situation = byId.get(situationId);
    if (!situation) continue;
    if (situation.column === 'changed') continue; // end 3: answered
    if (wakeHasFired(deferral, situation, deps, now)) continue; // end 1: woken
    situation.deferral = deferral;
  }
}

/** Situations currently ESCALATING — the badge's set. See `TriageCounts`. */
function escalating(situations: readonly Situation[]): Situation[] {
  return situations.filter((s) => !s.deferral);
}

/**
 * WP-56 · THE TURN A DEFERRAL ON THIS SITUATION IS RECORDED ON.
 *
 * Cycle two places the deferral ON THE RUN, which in this ledger means the
 * envelope's `correlation` — and **a surface holding a `Situation` cannot
 * supply one.** `Situation` carries `sessionId` and `capability`; the turn ids
 * live on `SessionRow.taskIds`, which the triage view does not hand over. The
 * exhibit measured the consequence: a deferral recorded straight from a
 * situation id landed with no correlation, joined to no run, and could not
 * answer "what did the user defer during this run".
 *
 * Resolving it HERE rather than widening `Situation` keeps a turn id off the
 * read contract, where nothing renders it and its only use would be this write.
 *
 * **The NEWEST turn, not the first.** The deferral is a statement about this
 * run AT THIS MOMENT, and the moment is the turn the user is looking at. The
 * first turn is the session's identity, which is a different question.
 *
 * `undefined` for an incident situation, and that is the held path rather than
 * a failure: an orphan incident was never armed under a procedure, so there is
 * no run for its deferral to be recorded on. See the incident-path measurement
 * in `deferral.test.ts`.
 */
export function runCorrelationFor(
  situationId: string,
  deps: SessionRegistryDeps = {}
): string | undefined {
  try {
    const row = foldSessionRegistry(deps).sessions.find((s) => s.id === situationId);
    return row?.taskIds[row.taskIds.length - 1];
  } catch {
    return undefined; // a deferral with no correlation beats no deferral at all
  }
}

// ---------------------------------------------------------------------------
// The reserved slot — ONE row, always, whatever the counts say
// ---------------------------------------------------------------------------

function deriveReserved(
  core: IntelligenceCore | undefined,
  injected: IntelligenceHealthReport | undefined,
  now: Date
): ReservedRow {
  let report = injected;
  if (!report) {
    try {
      report = collectIntelligenceHealth({ ...(core ? { core } : {}), now });
    } catch {
      report = undefined;
    }
  }
  if (!report) {
    return {
      headline: 'the record\'s own health could not be read',
      dark: [],
      staleCount: 0,
      verdict: 'DARK',
      degraded: true,
    };
  }

  // `countsTowardWorst: false` marks a source that was never in use here rather
  // than one that stopped — health's own distinction, and promoting it into the
  // reserved row would tell a user with no WP Engine account that the record is
  // going blind, forever.
  const counted = report.lines.filter((line) => line.countsTowardWorst !== false);
  const dark = counted
    .filter((line) => line.verdict === 'DARK')
    .map((line) => ({
      system: line.key,
      label: line.label,
      ...(line.detail ? { detail: line.detail } : {}),
    }));
  const staleCount = counted.filter((line) => line.verdict === 'STALE').length;

  return {
    headline: reservedHeadline(dark.length, staleCount),
    dark,
    staleCount,
    verdict: report.worst,
    degraded: report.errors.length > 0,
  };
}

/**
 * One sentence, derived from the counts.
 *
 * There is no branch here that emits more than one row, and there is no field
 * on `ReservedRow` that could hold a second — tear 3's "cannot grow" enforced by
 * the shape rather than by a rule someone has to remember.
 */
function reservedHeadline(darkCount: number, staleCount: number): string {
  // WP-54 · ITEM 11 — GOOD NEWS GETS ONE QUIET LINE.
  //
  // "the record is reporting — nothing dark, nothing late" is three facts and
  // two of them are our nouns. XD-23's guarantee is a SEAT, not a panel: the row
  // is still always here and still cannot grow or be scrolled away, and when
  // there is nothing to say it says the shortest true thing on the screen.
  // Ratified copy, read from the fixture like every other sentence here.
  if (darkCount === 0 && staleCount === 0) return RESERVED.quiet;
  if (darkCount === 0) return `the record is reporting late — ${staleCount} source(s) behind their SLO`;
  const tail = staleCount > 0 ? `, ${staleCount} more reporting late` : '';
  return `the record is going blind — ${darkCount} producer${darkCount === 1 ? '' : 's'} dark${tail}`;
}

// ---------------------------------------------------------------------------
// The query surface
// ---------------------------------------------------------------------------

/**
 * A registry over the live core.
 *
 * Every method re-folds. There is no cache to invalidate and no state to
 * rebuild on boot, which is what makes "the same answers re-derive from events
 * alone" a property of the construction rather than a claim about it.
 */
export function createSessionRegistry(deps: SessionRegistryDeps = {}): SessionRegistry {
  const fold = (): SessionRegistrySnapshot => foldSessionRegistry(deps);

  return {
    snapshot: fold,

    sessions: () => fold().sessions,

    session: (id: string) => fold().sessions.find((row) => row.id === id),

    triage: () => {
      const snapshot = fold();
      // WP-49a · rider 1. A run needing nothing is NOT among the things needing
      // you: it leaves the column, so the badge, the verdict and the rows all
      // count the same set. Composing the two independently is how a list and
      // the sentence about it start disagreeing.
      const working = workingRows(snapshot.sessions);
      const workingIds = new Set(working.map((w) => w.sessionId));
      const waiting = snapshot.situations.filter(
        (s) => s.column === 'waiting' && !(s.sessionId !== undefined && workingIds.has(s.sessionId)),
      );
      return {
        waiting,
        reserved: snapshot.reserved,
        changed: snapshot.situations.filter((s) => s.column === 'changed'),
        working,
        // Generated from `waiting` itself, not re-derived from the sessions:
        // the sentence and the rows have one source, so they cannot disagree.
        // It reads the FILTERED column, so a working run cannot be counted in a
        // verdict about rows nobody is being shown.
        verdict: listVerdict(waiting),
        // WP-56 · derived from the SAME rows the column is about to render, and
        // from nothing else. `needsYou + deferred === waiting.length` always
        // holds, which is what makes the pair auditable against the list: the
        // badge undercounts the list by exactly the number the accounting line
        // states, and never by anything it does not.
        counts: {
          needsYou: escalating(waiting).length,
          deferred: waiting.length - escalating(waiting).length,
        },
        cursor: snapshot.cursor,
      };
    },

    changedSince: (cursor?: string) => {
      const snapshot = fold();
      if (!cursor) {
        return {
          cursor: snapshot.cursor,
          sessions: snapshot.sessions,
          situations: snapshot.situations,
          cursorUnknown: false,
        };
      }
      const oldest = snapshot.horizon.oldestManifestId;
      return {
        cursor: snapshot.cursor,
        sessions: snapshot.sessions.filter((row) => row.lastEventId > cursor),
        situations: snapshot.situations.filter((s) => s.lastEventId > cursor),
        cursorUnknown: !!oldest && cursor < oldest && snapshot.horizon.truncated,
      };
    },
  };
}
