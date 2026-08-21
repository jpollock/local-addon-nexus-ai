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
  OUTCOME_RECORDED_TOPIC,
  RATIONALE_RECORDED_TOPIC,
} from './actionProducer';
import { getIntelligenceCore } from './coreRegistry';
import type { IntelligenceCore } from './bootstrap';
import { collectIntelligenceHealth, type IntelligenceHealthReport } from './health';
import { INCIDENT_TOPIC } from './incidentProducer';
import { foldProcedureCursor, runEvents, type ProcedureRun } from './procedureCursor';
import { deriveCheckpointStates, type CheckpointState } from './procedureView';
import { placeLabel, placeToken, type ScopePlace } from './procedureScope';
import {
  LIST_VERDICT,
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
 * Tiers 1, 2 and 4. **There is deliberately no `3`**: tear 3 ruled tier 3 out of
 * the comparator and into structure, and a tier value nothing can hold is how
 * that ruling is enforced rather than merely documented.
 */
export type ConsequenceTier = 1 | 2 | 4;

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
  kind: 'run' | 'outcome' | 'incident';
  /** The ledger event this part is, when it is one. */
  eventId?: string;
  topic?: string;
  /** ISO, from the part's own record. */
  observedAt?: string;
  /** Derived from the part's own fields. Never composed prose. */
  summary: string;
}

/** The triage's unit. A situation of one is still a situation. */
export interface Situation {
  /** The session id, or the incident event id for a situation of one. */
  id: string;
  kind: 'session' | 'incident';
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
   * §4a's second T1 condition. Nothing supplies one in production; the port is
   * here so the rule is implemented and pinned rather than quietly dropped.
   */
  deadlineFor?: (input: {
    capability: string;
    taskIds: readonly string[];
    events: readonly EventEnvelope[];
  }) => DerivedDeadline | undefined;
  now?: Date;
  /** How many manifests to read, newest first. */
  manifestLimit?: number;
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

const CONCURRENCY_LIMIT_NOTE =
  'the ledger records no chat-session id, so two chats whose runs are BOTH IN FLIGHT at the same ' +
  'capability and the same document hash are ONE session here; sequential runs separate at the ' +
  'terminal cut. Closing the concurrent case means a session id on an event payload, which is ' +
  'escalation-grade (procedureArming.ts records the identical limit for its own queue)';

const DEADLINE_SOURCE_NOTE =
  'no producer records a dry-run staleness clock or a maintenance window, so §4a\'s deadline arm ' +
  'of T1 has no input in production and T1 is reached by the write-landed arm alone';

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
  if (!highest) return `nothing on record names where ${total === 1 ? 'the target is' : `the ${total} targets are`}`;
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
  };
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

  for (const manifest of manifests) {
    const turn = turnOf(manifest);
    if (!turn) continue;
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

  const attached = new Map<string, EventEnvelope[]>();
  const orphans: EventEnvelope[] = [];
  for (const incident of incidents) {
    const owner = incident.correlation ? sessionByTask.get(incident.correlation) : undefined;
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

  const situations = [
    ...split.map((row) => situationOfSession(row, attached.get(row.id) ?? [], deps)),
    ...orphans.map((incident) => situationOfIncident(incident, deps)),
  ];

  const cursor = maxId([
    ...split.map((row) => row.lastEventId),
    ...incidents.map((e) => e.id),
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
  const { tier, tierReason } = rankSession(row, column, deadline);

  const since = oldestIso([row.startedAt, ...incidents.map((e) => e.observed_at)]);
  const lastEventId = maxId([row.lastEventId, ...incidents.map((e) => e.id)]);
  const copy = composeSessionCopy(row, column, deps.now ?? new Date(), since, tierReason);

  return {
    id: row.id,
    kind: 'session',
    column,
    tier,
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
      return kind === 'incident' && input.runId === null;
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
): boolean {
  return template?.id === 'run.waiting.nothing-written' && gate !== null;
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
}

/**
 * A row whose class the ratified set does not cover, or cannot fill.
 *
 * The derived sentence, unchanged from what this fold has always produced. No
 * new sentence is authored here: the ratified set covers the classes it covers,
 * and inventing prose for the rest is exactly what the copy discipline forbids.
 */
function derivedCopy(headline: string, meta: string, state: string, rule: string): SituationCopy {
  return { headline, ask: '', chip: '', state, meta, rule, headlineTemplate: null };
}

/** A session row's verdict. */
function composeSessionCopy(
  row: SessionRow,
  column: TriageColumn,
  now: Date,
  since: string,
  /** WP-52 · the derived reason, for a row the ratified set does not cover. */
  tierReason: string,
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

  const selected =
    column === 'waiting'
      ? selectSituationTemplate({ kind: 'run', done, failed, total, gate, runId: row.id }, bag)
      : null;
  const template = contradictedByTheRecord(selected, gate) ? null : selected;

  if (!template) return derivedCopy(runSummary(row), runbookId, '', tierReason);
  return {
    headline: fillSituationSentence(template.headline, bag),
    ask: fillSituationSentence(template.ask, bag),
    chip: template.chip,
    state: template.state,
    meta: fillSituationSentence(template.meta, bag),
    // WP-52 item 3: the ratified rule, upright and tier-named. Read from the
    // template like every other field of a ratified card — never retyped.
    rule: template.rule,
    headlineTemplate: template.id,
  };
}

/** An orphan incident's verdict — a situation of one is still a situation. */
function composeIncidentCopy(
  incident: EventEnvelope,
  places: PlaceSet,
  derived: string,
  /** WP-52 · the derived reason, for a row the ratified set does not cover. */
  tierReason: string,
): SituationCopy {
  const payload = payloadOf(incident);
  const bag: SlotBag = {
    finding: str(payload.symptom) ?? str(payload.fact),
    // The anchor entity, cited as the id the record holds. Nothing on this fold
    // can name a site: `describePlace` answers WHERE a target is, not what it
    // is called, and softening the id into its place ("on production") would
    // drop the one word saying WHICH site. An id cited in full is the property
    // the refusals and the Govern matrix already hold to.
    target: incident.entity?.environment ?? incident.entity?.site,
    producer: (incident.actor as { id?: string } | undefined)?.id,
  };

  // An orphan is BY CONSTRUCTION a situation with no run: it reached this
  // function because nothing correlated it into a session. `runId: null` is
  // therefore the record's own answer, not a default standing in for one.
  const template = selectSituationTemplate(
    { kind: 'incident', done: 0, failed: 0, total: places.total, gate: null, runId: null },
    bag,
  );

  if (!template) {
    // The class's own `state`, READ from the ratified set rather than retyped —
    // an incident row that reached the fallback is still an incident with no run
    // attached, and that phrase is the designer's. Absent if the set ever drops
    // the class, which renders no state line rather than a stale one.
    const state = SITUATION_TEMPLATES.find((t) => t.id === 'incident.no-run')?.state ?? '';
    return derivedCopy(derived, fillSituationSentence('{producer}', bag), state, tierReason);
  }
  return {
    headline: fillSituationSentence(template.headline, bag),
    ask: fillSituationSentence(template.ask, bag),
    chip: template.chip,
    state: template.state,
    meta: fillSituationSentence(template.meta, bag),
    // WP-52 item 3, on the incident card too: the ratified rule, upright.
    rule: template.rule,
    headlineTemplate: template.id,
  };
}

/**
 * THE LIST VERDICT — one sentence about the whole list.
 *
 * Read off the waiting rows' own `written` counts, which are the numbers their
 * headlines were composed from, so the sentence cannot disagree with the rows
 * beneath it. Empty when nothing is waiting: a verdict about an empty list is a
 * claim about nothing.
 */
export function listVerdict(waiting: readonly Situation[]): string {
  if (waiting.length === 0) return '';
  const changedRuns = waiting.filter((s) => s.written.done > 0 || s.written.failed > 0).length;
  const bag: SlotBag = { needsYou: waiting.length, changedRuns };
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
  const copy = composeIncidentCopy(incident, places, derived, tierReason);

  return {
    id: incident.id,
    kind: 'incident',
    // An incident nobody is waiting on is a thing that CHANGED; an open one is
    // waiting. Same rule the sessions use: the world's state, not the kind.
    column: resolved ? 'changed' : 'waiting',
    tier: resolved ? 4 : 2,
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
  if (darkCount === 0 && staleCount === 0) return 'the record is reporting — nothing dark, nothing late';
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
