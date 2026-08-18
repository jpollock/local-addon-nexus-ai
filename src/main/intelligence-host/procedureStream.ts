/**
 * WP-26 · the procedure stream — what turns a folded cursor into three events
 * the Docked Panel can render.
 *
 * WP-20e shipped the shapes (`procedureView.ts`) with deliberate non-emission:
 * "the wiring belongs with the surface that consumes it." This is that wiring.
 * It sits on the same seam that folds the cursor (`chatAssembly.withCursor` →
 * `assembleForChatTurn`), because that is the one place the platform knows both
 * what is armed and what the ledger now says about it.
 *
 * THREE RULES, and the first is the whole reason this module exists rather than
 * a `core.emitter` subscription:
 *
 * **1. ONE EVENT PER CHECKPOINT-STATE TRANSITION, NEVER PER LEDGER EVENT.**
 * The renderer must not need to know the ledger exists (v6 Q1). A burst of
 * `task.*` events that folds to a single checkpoint change is ONE
 * `checkpoint_changed`; a turn that changes nothing emits nothing at all. The
 * memory below is what makes that true, and `procedureStream.test.ts` drives
 * the seam once per ledger event and counts emissions — the only shape of test
 * a per-event emitter fails.
 *
 * **2. THE DOCUMENT RIDES ONCE.** `procedure_armed` carries the WHOLE
 * `DeclaredProcedure`; everything after carries `diffCheckpointStates` output.
 * That is ADR-20's cadence at the UI seam — and it has an archival consequence
 * worth stating: because the declaration (with its `verifiableCount`) rides at
 * arm, every historical run's denominator is self-contained in its own stream
 * rather than depending on today's registry (v6 Q3).
 *
 * **3. A REFUSAL IS NOT A TRANSITION.** A disarmed or refused capability emits
 * nothing here — it renders through the four refusal vocabularies, which are
 * WP-20c's surface, not this one. Nothing armed ⇒ zero emissions and a
 * byte-identical renderer.
 *
 * Non-fatal by construction, like everything on this seam: every entry point
 * swallows its own faults, and a sink that throws never reaches the chat turn.
 */
import type { EventEnvelope, Ledger, ProcedureOutcome, Runbook, RunbookCheckpoint } from '../../intelligence';
import type { ProcedureRun } from './procedureCursor';
import { foldProcedureCursor, runEvents } from './procedureCursor';
import {
  checkpointChangedEvent,
  checkpointReason,
  deriveAbortGroups,
  deriveDeclaredProcedure,
  diffCheckpointStates,
  procedureAbortedEvent,
  procedureArmedEvent,
  CheckpointState,
  CheckpointChangedEvent,
  DeclaredProcedure,
  DEFAULT_BACKUP_TOOL,
  ProcedureAbortedEvent,
  ProcedureArmedEvent,
} from './procedureView';

export type ProcedureStreamEvent =
  | ProcedureArmedEvent
  | CheckpointChangedEvent
  | ProcedureAbortedEvent;

/** Where emissions go. The chat surface registers itself; nothing else may. */
export type ProcedureStreamSink = (sessionId: string, event: ProcedureStreamEvent) => void;

const RATIONALE_TOPIC = 'task.rationale.recorded';

let sink: ProcedureStreamSink | null = null;

/**
 * Register the surface that renders these events. Null unregisters.
 *
 * A single sink rather than a subscriber list, deliberately: the stream is
 * per-session and the chat surface is the only consumer ADR-19 names. A second
 * consumer is a packet, not a fan-out.
 */
export function setProcedureStreamSink(next: ProcedureStreamSink | null): void {
  sink = next;
}

/**
 * What the approval card is allowed to say about the run it is standing in.
 *
 * Everything here is READ off the declaration and the derived rail — the card
 * computes no checkpoint state of its own, which is the rule `procedureView.ts`
 * exists to hold (P7). `null` means "this approval is not a runbook checkpoint",
 * and the ordinary action card renders exactly as it did before this packet.
 */
export interface ProcedureApprovalContext {
  runbookId: string;
  version: string;
  strictness: 'strict';
  /** The checkpoint this approval would attest, from the runbook's own declaration. */
  checkpointId: string;
  /**
   * True only when the runbook DECLARES a canary checkpoint. A canary policy
   * offered on a runbook with no canary would be a choice about nothing — the
   * same fabricated-consent error as rendering the default as a decision.
   */
  offersCanaryPolicy: boolean;
  /**
   * The nearest NARRATIVE checkpoint the runbook puts before this approval —
   * the step the platform can never show happened (ratified at the WP-26 gate).
   *
   * The anchor's is `cp.dry-run`: the runbook asks for a plan before consent,
   * and `cp.dry-run` is narrative BY RULING, so nothing the platform records
   * can distinguish an approval of a presented plan from an approval of an
   * improvised one. Gating the card on plan-was-shown would be the platform
   * claiming a verification the ruled model says it cannot make (P4), so the
   * card SAYS the boundary instead. Absent when the runbook puts nothing
   * narrative before its approval — a caveat printed there would describe a gap
   * the document does not have.
   */
  unverifiablePrecedent?: { checkpointId: string; reason: string | null };
}

interface SessionMemory {
  /** Capability + document hash: an edited runbook is a different run (WP-20d). */
  runKey: string;
  checkpoints: CheckpointState[];
  aborted: boolean;
  approval: ProcedureApprovalContext | null;
}

const memory = new Map<string, SessionMemory>();

export interface NotifyProcedureStateArgs {
  sessionId: string;
  /** What the assembler's procedure plane did this turn. */
  outcome: ProcedureOutcome | null;
  /** The document behind it. Absent on a refusal. */
  runbook?: Runbook;
  /** The run whose events the cursor folds from. Absent ⇒ nothing to report. */
  run?: ProcedureRun;
  ledger?: Ledger;
}

/**
 * The seam's entry point — called once per assembled turn.
 *
 * Order of emission is arm → change → abort, and it is the reading order: a
 * surface that learns of an abort before it has the declaration has nothing to
 * render it against.
 */
export function notifyProcedureState(args: NotifyProcedureStateArgs): void {
  try {
    const { sessionId, outcome } = args;

    // Rule 3. Also the disarm case: a turn that delivers nothing ends the run,
    // exactly as `chatAssembly` ends the cursor's, so the next arming re-announces.
    if (!outcome || outcome.status !== 'delivered') {
      memory.delete(sessionId);
      return;
    }

    // THE FOLD HAPPENS HERE, not upstream, and the reason is the approval card.
    //
    // `chatAssembly` folds the cursor BEFORE the turn assembles, so the carrier
    // the model reads is one fold old — `cp.consult-history` attests from the
    // manifest that same turn emits, and the carrier cannot know it yet. The
    // SEQUENCE GUARD re-folds at call time and therefore does know. If the
    // stream reported the carrier's older view, the card for the very approval
    // the guard is demanding would arrive with no runbook behind it, on the
    // arming turn — the exact turn a strict run reaches its approval.
    //
    // So the stream agrees with the GATE, because the gate is what decides
    // whether the approval is required at all. The carrier catching up on the
    // next turn is ADR-20's cadence and is unchanged.
    if (!args.run || !args.runbook || !args.ledger) return;

    let cursor;
    try {
      cursor = foldProcedureCursor(args.run, args.runbook.checkpoints, args.ledger);
    } catch {
      return;
    }
    // A fold that could not run is not an empty rail — WP-20d's ruling, and the
    // one place a stream could quietly turn "unreadable" into "nothing yet".
    if (cursor.fault) return;

    const declared = deriveDeclaredProcedure({ outcome, runbook: args.runbook, cursor });
    if (!declared) return;

    const runKey = `${outcome.capability} ${outcome.hash}`;
    const previous = memory.get(sessionId);
    const approval = approvalContextOf(declared, args.runbook);

    if (!previous || previous.runKey !== runKey) {
      memory.set(sessionId, { runKey, checkpoints: declared.checkpoints, aborted: false, approval });
      emit(sessionId, procedureArmedEvent(declared));
    } else {
      const changed = diffCheckpointStates(previous.checkpoints, declared.checkpoints);
      memory.set(sessionId, { ...previous, checkpoints: declared.checkpoints, approval });
      // Rule 1: no transition, no event.
      if (changed.length > 0) {
        emit(sessionId, checkpointChangedEvent(previous.checkpoints, declared.checkpoints));
      }
    }

    maybeEmitAbort(sessionId, declared, args);
  } catch {
    // Nothing on this seam may break a chat turn.
  }
}

/** Drop a session's stream memory — a chat clear, a session delete, a disarm. */
export function forgetProcedureStream(sessionId: string): void {
  memory.delete(sessionId);
}

/**
 * The approval context for a session, or null.
 *
 * Read at the moment the approval card is emitted, so "the run is standing at
 * its approval checkpoint" is the platform's own derivation of the turn that is
 * happening, never the renderer's guess about it.
 */
export function procedureApprovalContext(sessionId: string): ProcedureApprovalContext | null {
  return memory.get(sessionId)?.approval ?? null;
}

// ---------------------------------------------------------------------------

function emit(sessionId: string, event: ProcedureStreamEvent): void {
  try {
    sink?.(sessionId, event);
  } catch {
    // A renderer that is gone, or one that throws, is not a reason to fail a turn.
  }
}

/**
 * The checkpoint an approval attests, from the runbook's DECLARATION — never
 * from the checkpoint's id.
 *
 * `evidence: { topic: task.rationale.recorded }` is what the author wrote to
 * mean "a human decision attests this step"; matching on the string `cp.approval`
 * would be matching the anchor runbook's spelling rather than its contract, and
 * would silently miss a runbook that names the same step differently.
 */
function approvalCheckpoint(runbook: Runbook | undefined): RunbookCheckpoint | undefined {
  return runbook?.checkpoints?.find(
    (c) => c.attest === 'event' && c.evidence?.topic === RATIONALE_TOPIC
  );
}

/**
 * Whether this runbook declares a canary.
 *
 * Matched on the authored checkpoint id, which IS the runbook's stable identity
 * for the step (ADR-17: "gateway attestation needs step identity"). The
 * alternative — reading the prose for the word — would be inference over an
 * author's sentence. A runbook that spells its canary differently offers no
 * policy control, which is the honest failure direction: no control is a missing
 * affordance, a control over a step that does not exist is a fabricated choice.
 */
function declaresCanary(runbook: Runbook | undefined): boolean {
  return !!runbook?.checkpoints?.some((c) => c.id === 'cp.canary');
}

function approvalContextOf(
  declared: DeclaredProcedure,
  runbook: Runbook | undefined
): ProcedureApprovalContext | null {
  if (declared.strictness !== 'strict' || !declared.runbookId || !declared.version) return null;
  const checkpoint = approvalCheckpoint(runbook);
  if (!checkpoint) return null;
  // ACTIVE, not merely unattested: `active` is `nextGatedCheckpoint`'s answer —
  // the same checkpoint the model's own turn block names — so the card and the
  // carrier can never disagree about where the run is standing.
  const state = declared.checkpoints.find((c) => c.id === checkpoint.id);
  if (state?.status !== 'active') return null;
  const precedent = unverifiablePrecedentOf(runbook, checkpoint.id);
  return {
    runbookId: declared.runbookId,
    version: declared.version,
    strictness: 'strict',
    checkpointId: checkpoint.id,
    offersCanaryPolicy: declaresCanary(runbook),
    ...(precedent ? { unverifiablePrecedent: precedent } : {}),
  };
}

/**
 * The nearest narrative checkpoint before the approval, with the runbook's own
 * authored reason for it.
 *
 * NEAREST, not "any": a document may declare several narrative steps, and the
 * one the approval directly rests on is the one a reader needs named. The
 * reason comes from the runbook body's own `## cp.x — reason` heading via
 * `checkpointReason`, so the caveat quotes the author rather than paraphrasing
 * them; a section with no reason yields `null` and the copy says less rather
 * than inventing more.
 */
function unverifiablePrecedentOf(
  runbook: Runbook | undefined,
  approvalId: string
): { checkpointId: string; reason: string | null } | undefined {
  const checkpoints = runbook?.checkpoints ?? [];
  const at = checkpoints.findIndex((c) => c.id === approvalId);
  if (at < 0) return undefined;
  for (let i = at - 1; i >= 0; i--) {
    if (checkpoints[i].attest !== 'narrative') continue;
    return {
      checkpointId: checkpoints[i].id,
      reason: runbook ? checkpointReason(runbook, checkpoints[i].id) : null,
    };
  }
  return undefined;
}

/**
 * The abort notice, once, on entry.
 *
 * **Emitted only when the ledger holds the record that ends the run.** Today
 * that is a denial at the approval checkpoint (`c.denial-is-final`), and the
 * abort id IS that event's id, so the notice is openable rather than named by
 * something invented. An aborted rail with no record behind it emits nothing:
 * the platform cannot say what stopped the run, and an abort notice carrying a
 * fabricated id would be claiming otherwise.
 */
function maybeEmitAbort(
  sessionId: string,
  declared: DeclaredProcedure,
  args: NotifyProcedureStateArgs
): void {
  const current = memory.get(sessionId);
  if (!current || current.aborted) return;

  const aborted = declared.checkpoints.find((c) => c.status === 'aborted');
  if (!aborted) return;
  if (!args.run || !args.ledger) return;

  let events: readonly EventEnvelope[];
  try {
    events = runEvents(args.run, args.ledger);
  } catch {
    return;
  }

  const record = abortRecord(events);
  if (!record) return;

  memory.set(sessionId, { ...current, aborted: true });
  emit(
    sessionId,
    procedureAbortedEvent({
      abortId: record,
      checkpointId: aborted.id,
      // Derived, not authored: this is the sentence `deriveCheckpointStates`
      // already wrote for the state the rail is in.
      reason: aborted.evidence?.summary ?? '',
      groups: deriveAbortGroups({
        events,
        updateTool: updateToolOf(args.runbook),
        backupTool: backupToolOf(args.runbook),
      }),
    })
  );
}

/**
 * The latest denial in the run — the ledger event that ends it.
 *
 * "Latest governs" is the fold's own rule (`foldProcedureCursor`): an approval
 * after a denial supersedes it, so a run that was denied and then approved has
 * no abort to report.
 */
function abortRecord(events: readonly EventEnvelope[]): string | undefined {
  let latest: string | undefined;
  for (const event of events) {
    if (event?.topic !== RATIONALE_TOPIC) continue;
    const decision = (event.payload as { decision?: unknown } | undefined)?.decision;
    if (decision === 'denied') latest = event.id;
    else if (decision === 'approved') latest = undefined;
  }
  return latest;
}

/** The tools a runbook's event-attested checkpoints name, in declared order. */
function attestingTools(runbook: Runbook | undefined): string[] {
  return (runbook?.checkpoints ?? [])
    .filter((c) => c.attest === 'event' && typeof c.evidence?.tool === 'string')
    .map((c) => c.evidence!.tool!);
}

/** The tool whose outcomes mean "this site was changed": the LAST one the runbook gates on. */
function updateToolOf(runbook: Runbook | undefined): string {
  const tools = attestingTools(runbook);
  return tools.length > 0 ? tools[tools.length - 1] : '';
}

/** The backup act the "done" rows may rest on: the FIRST one, when the runbook declares two. */
function backupToolOf(runbook: Runbook | undefined): string {
  const tools = attestingTools(runbook);
  return tools.length > 1 ? tools[0] : DEFAULT_BACKUP_TOOL;
}
