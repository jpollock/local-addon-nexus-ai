/**
 * The checkpoint cursor (WP-20d · design note §4, P4; ADR-20's procedure
 * amendment).
 *
 * WP-20c delivers a procedure and renders whatever cursor it is handed. This
 * module is what hands it one, and what the sequence guard reads before letting
 * a gated call through. Two rules govern everything below.
 *
 * **1. AN ATTESTATION IS A LEDGER EVENT OR IT IS NOTHING (P4).** A model saying
 * "backups complete" attests nothing. A `task.action.executed` for
 * `wpe_backup_and_verify` with a successful `task.outcome.recorded` attests it.
 * Nothing here reads model prose, and nothing here can be attested by asking.
 *
 * **2. THE GATEWAY ENFORCES SEQUENCE AND PRESENCE, NEVER QUALITY.** The fold
 * answers "did the thing that would prove this happen", never "was it done
 * well". A `narrative` checkpoint is one the platform CANNOT prove, and it is
 * reported as narrative — never as attested, and never as merely pending. Those
 * are different facts and P7's supplied/quoted/neither distinction is exactly
 * this distinction applied to progress.
 *
 * WHY THE RUN, AND NOT THE TURN — the measurement that shaped this file.
 *
 * §4 says the cursor is "folded from `task.*` events by `correlation`", and
 * `correlation` is the TaskId. But `chatAssembly` mints a TaskId **per turn**,
 * while a procedure spans many turns: cp.approval happens on turn 3 and
 * cp.backup on turn 4. A fold keyed on one correlation would report the
 * approval as never given, refuse the backup, and be right about nothing.
 *
 * So the fold is scoped to the **procedure run** — the turn TaskIds since the
 * capability armed — held here, in host memory, for the same ADR-10 reason
 * `sessionProcedureHash` is held in `chatAssembly`: the assembler is stateless,
 * so "what has this actor already done" lives on this side. Still derived,
 * still nothing stored: no new topic, no new envelope field, no table. What
 * changes is the key, not the substrate.
 *
 * A process restart empties the map, which is the correct failure direction:
 * the next armed turn re-arms the run and the cursor starts empty, so the
 * gateway refuses rather than assuming an approval it cannot see.
 */
import type { Ledger } from '../../intelligence';
import type { EventEnvelope } from '../../intelligence';
import type { RunbookCheckpoint } from '../../intelligence';

/** One armed procedure, and the turns it has spanned so far. */
export interface ProcedureRun {
  sessionId: string;
  capability: string;
  runbookId: string;
  /** The hash the grant pinned, carried so a re-arm on an edited document is a new run. */
  runbookHash: string;
  /** Turn TaskIds since arming, oldest first. */
  taskIds: string[];
}

/**
 * The cursor, as the renderer and the guard read it.
 *
 * `attested` / `narrative` / `denied` are three different answers and none of
 * them is the absence of another: attested means the ledger proved it,
 * narrative means the platform cannot prove it at all, denied means the proof
 * exists and says no.
 */
export interface ProcedureCursorState {
  attested: string[];
  narrative: string[];
  denied: string[];
  /** True when the ledger could not be read. Fail-closed for the sequenced capability only. */
  fault: boolean;
}

/** Sessions → their current run. Host state, cleared on disarm or session end. */
const runsBySession = new Map<string, ProcedureRun>();
/** Turn TaskId → the run it belongs to, so the guard can resolve from `task.id` alone. */
const runByTask = new Map<string, ProcedureRun>();

/**
 * Start (or restart) a session's run. Idempotent for the same capability AND
 * the same document: re-arming the same procedure keeps the turns already
 * collected, so a multi-turn run is not reset by every armed turn.
 *
 * A different capability, or the same one at a different hash, is a DIFFERENT
 * run and starts empty — the second case matters because an edited runbook is
 * not the document whose checkpoints were attested.
 */
export function armProcedureRun(args: {
  sessionId: string;
  capability: string;
  runbookId: string;
  runbookHash: string;
}): ProcedureRun {
  const existing = runsBySession.get(args.sessionId);
  if (
    existing &&
    existing.capability === args.capability &&
    existing.runbookHash === args.runbookHash
  ) {
    return existing;
  }
  if (existing) for (const taskId of existing.taskIds) runByTask.delete(taskId);
  const run: ProcedureRun = { ...args, taskIds: [] };
  runsBySession.set(args.sessionId, run);
  return run;
}

/** Add this turn to the session's run. A turn before arming belongs to no run. */
export function registerProcedureTurn(args: { sessionId: string; taskId: string }): void {
  const run = runsBySession.get(args.sessionId);
  if (!run) return;
  if (!run.taskIds.includes(args.taskId)) run.taskIds.push(args.taskId);
  runByTask.set(args.taskId, run);
}

/** Drop a session's run — a disarm, a chat clear, a session delete. */
export function forgetProcedureRun(sessionId: string): void {
  const run = runsBySession.get(sessionId);
  if (!run) return;
  for (const taskId of run.taskIds) runByTask.delete(taskId);
  runsBySession.delete(sessionId);
}

/** The run a turn belongs to, or nothing. The guard's only entry point. */
export function runForTask(taskId: string | undefined): ProcedureRun | undefined {
  return taskId ? runByTask.get(taskId) : undefined;
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

const MANIFEST_TOPIC = 'task.context.assembled';
const RATIONALE_TOPIC = 'task.rationale.recorded';
const ACTION_TOPIC = 'task.action.executed';
const OUTCOME_TOPIC = 'task.outcome.recorded';

/** Per-run event cap. Generous: a long procedure is dozens of events, not thousands. */
const RUN_EVENT_LIMIT = 500;

interface LedgerLike {
  query(opts: { correlation?: string; limit?: number; order?: 'asc' | 'desc' }): EventEnvelope[];
}

function payloadOf(event: EventEnvelope): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>;
}

/**
 * Fold one run's events into a cursor.
 *
 * Ordering is by event id (ULID, so lexicographic order IS time order) across
 * every turn of the run — not by turn, because the turns are separate
 * correlations and "the latest decision" has to mean the latest in the RUN.
 */
export function foldProcedureCursor(
  run: ProcedureRun,
  checkpoints: RunbookCheckpoint[],
  ledger: Ledger | LedgerLike
): ProcedureCursorState {
  const narrative = checkpoints.filter((c) => c.attest === 'narrative').map((c) => c.id);

  let events: EventEnvelope[];
  try {
    events = run.taskIds
      .flatMap((correlation) => ledger.query({ correlation, limit: RUN_EVENT_LIMIT }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  } catch {
    // §4's fail-behaviour: an unreadable ledger is fail-CLOSED for the
    // sequenced capability. Nothing is attested, the fault is reported, and the
    // guard turns that into a refusal of this capability's calls only.
    return { attested: [], narrative, denied: [], fault: true };
  }

  // Successful actions, by tool. The join is by causation: an outcome names the
  // action it belongs to, and a FAILED outcome must not attest anything (the
  // anchor runbook's ab.backup-failed is "not waivable").
  const actionsById = new Map<string, string>(); // action event id → tool
  const succeeded = new Set<string>(); // tool names with at least one successful outcome
  for (const event of events) {
    const payload = payloadOf(event);
    const tool = typeof payload.tool === 'string' ? payload.tool : undefined;
    if (event.topic === ACTION_TOPIC && tool) actionsById.set(event.id, tool);
    if (event.topic === OUTCOME_TOPIC && payload.result === 'success') {
      const actionTool = event.causation ? actionsById.get(event.causation) : undefined;
      if (actionTool) succeeded.add(actionTool);
    }
  }

  // The LATEST decision per tool governs. `.some(approved)` would let a run
  // proceed after a denial simply because an earlier turn had approved
  // something — the exact shape ab.approval-denied forbids.
  const latestDecision = new Map<string, string>();
  for (const event of events) {
    if (event.topic !== RATIONALE_TOPIC) continue;
    const payload = payloadOf(event);
    if (typeof payload.tool === 'string' && typeof payload.decision === 'string') {
      latestDecision.set(payload.tool, payload.decision);
    }
  }
  const decisions = [...latestDecision.values()];

  // The assembler's own retrieval — the SUPPLY side, which is all a manifest
  // attestation ever claims. `returned: 0` still attests: the query ran, and an
  // empty history is a finding rather than a failure to consult.
  const ranEpisodicRetrieval = events.some((event) => {
    if (event.topic !== MANIFEST_TOPIC) return false;
    const retrieval = payloadOf(event).retrieval;
    return (
      Array.isArray(retrieval) &&
      retrieval.some((r) => (r as { store?: string })?.store === 'ledger')
    );
  });

  const attested: string[] = [];
  const denied: string[] = [];

  for (const checkpoint of checkpoints) {
    if (checkpoint.attest === 'narrative') continue;

    if (checkpoint.attest === 'manifest') {
      if (ranEpisodicRetrieval) attested.push(checkpoint.id);
      continue;
    }

    const evidence = checkpoint.evidence ?? {};
    if (evidence.topic === RATIONALE_TOPIC) {
      const wanted = evidence.decision ?? 'approved';
      if (decisions.includes(wanted)) attested.push(checkpoint.id);
      else if (decisions.length > 0) denied.push(checkpoint.id);
      continue;
    }
    if (evidence.topic === ACTION_TOPIC && evidence.tool) {
      if (succeeded.has(evidence.tool)) attested.push(checkpoint.id);
      continue;
    }
    // An `event` checkpoint whose evidence names a topic this fold cannot
    // verify is left unattested rather than assumed. The registry already
    // refuses `attest: event` with no topic at all (WP-20a); this is the
    // narrower case of a topic no reader implements yet.
  }

  return { attested, narrative, denied, fault: false };
}
