/**
 * The sequence guard (WP-20d · design note §4).
 *
 * One question, asked at the dispatch chokepoints before a gated call
 * executes: *does this tool belong to an armed strict runbook, and are the
 * checkpoints it depends on attested?* If yes it returns `null` and the call
 * proceeds exactly as it did before this packet existed. If no it returns a
 * refusal that names the runbook, the unmet checkpoint, and what would attest
 * it.
 *
 * FOUR RULES, all of them consequences of what the ledger can and cannot prove.
 *
 * 1. **A narrative checkpoint gates nothing.** Four of the anchor runbook's
 *    eight checkpoints have no attesting event and never will (§4: the dry-run
 *    tool does not exist; canary CHOICE is unprovable; "checkout renders" has
 *    no probe). If those were prerequisites, cp.roll-fleet would be
 *    unreachable forever — the gate would not be strict, it would be broken.
 *    The guard therefore requires the ATTESTABLE predecessors only, and the
 *    refusal SAYS which checkpoints it is not enforcing. A gate silent about
 *    its own reach implies a reach it does not have.
 *
 * 2. **A tool claimed by two checkpoints gates at the earlier one.**
 *    `bulk_plugin_update` is both the canary act and the fleet roll, and no
 *    event distinguishes them. Gating at the earlier position enforces
 *    approval-and-backup-before-any-update, which is the property the runbook
 *    exists to protect; gating at the later one would let the canary run
 *    unbacked.
 *
 * 3. **An unreadable ledger REFUSES, and only this capability's calls.**
 *    §4's fail-behaviour, stated exactly: the sequenced tool is refused, every
 *    other tool is untouched. ADR-7's warn-and-proceed does not apply — it
 *    governs policy staleness with a human present, and an unattested backup
 *    is not staleness, it is `ab.backup-failed`, which the runbook itself
 *    declares not waivable "by user insistence, urgency, or claimed
 *    authority".
 *
 * 4. **Any OTHER fault degrades to null.** A hostile registry, a missing core,
 *    a surface with no task frame: the guard is simply not in the path, and
 *    the call behaves as it did before WP-20. Refusing on an internal fault
 *    would let an intelligence-layer bug take out the tool surface, which is
 *    the seam invariant this layer is built on.
 *
 * TWO MORE, ADDED BY WP-31 AFTER THE 2026-08-18 INCIDENT.
 *
 * 5. **EXCLUSIVE TOOL SCOPE — an unclaimed WRITE is refused.** Rules 1–4 gate
 *    only tools a checkpoint DECLARES. On 2026-08-18 a live run reached the
 *    same effect through `wp_plugin_update`, which no checkpoint claims and the
 *    anchor runbook forbids only in prose: the guard never fired, and WP-26's
 *    approval card — which rides the guard's refusal — never rendered. So while
 *    a strict, exclusive-scope capability is armed with unmet gated
 *    checkpoints, a write tool the CURRENT checkpoint does not declare is
 *    refused. Exclusive subsumes the prose prohibition: unclaimed = refused,
 *    and "never wp_plugin_update" stops being narrative.
 *
 *    **Reads are untouched**, and "write" is not a new list — it is
 *    `getToolSafety(...).tier >= GATED_TIER_FLOOR`, the same classification the
 *    audit chokepoint uses to decide what reaches `operation-audit.log` and
 *    WP-19's producer uses to decide what is an act. A second opinion about
 *    which tools mutate is how two subsystems start disagreeing about the same
 *    call.
 *
 * 6. **THE ARMING GAP IS PART OF BEING ARMED.** Model-request arming delivers
 *    the body on the NEXT turn, so between the acknowledgement and the carrier
 *    there is no run for `runForTask` to find. The whole incident lived there.
 *    A pending arming request for a granted, strict, exclusive capability
 *    therefore closes the write door on its own, before any run exists —
 *    nothing is attested in the gap by definition, so the current checkpoint is
 *    the first gated one.
 *
 * A refusal under either new rule emits NO `task.action.executed` — WP-19's
 * producer is explicit that a refused call did not execute — and is written to
 * `operation-audit.log` by both chokepoints, exactly as WP-20d's refusals are.
 */
import { getIntelligenceCore } from './coreRegistry';
import { foldProcedureCursor, runForTask, ProcedureCursorState } from './procedureCursor';
import { peekArmingRequests } from './procedureArming';
import { getCapabilityGrants } from './capabilityGrants';
import { GATED_TIER_FLOOR } from './actionProducer';
import { getToolSafety } from '../mcp/safety';
import { nextGatedCheckpoint } from '../../intelligence';
import type { Runbook, RunbookCheckpoint } from '../../intelligence';

/**
 * WHY THE REFUSALS ARE DISCRIMINATED (WP-31).
 *
 * WP-26's approval card fires when the guard is already refusing THIS call on
 * exactly the checkpoint an approval would attest — a condition that can only
 * add a gate, never bypass one. Exclusive scope names the CURRENT checkpoint,
 * which for a run standing where the incident's run stood IS `cp.approval`. Left
 * undiscriminated, the card would have offered a human the chance to bless
 * `wp_plugin_update` itself: consent for the substitution, harvested by the
 * mechanism built to prevent it. So the card reads `reason`, not the checkpoint
 * alone.
 */
export type SequenceRefusalReason =
  /** WP-20d: a DECLARED tool whose attestable predecessors are not in the ledger. */
  | 'sequence'
  /** WP-20d: the ledger could not be read, so nothing can be shown to be in sequence. */
  | 'ledger-fault'
  /** WP-31 rule 5: a write the current checkpoint does not declare. */
  | 'exclusive-scope'
  /** WP-31 rule 6: a write between the acknowledgement and the procedure's delivery. */
  | 'arming-gap';

export interface SequenceRefusal {
  capability: string;
  runbookId: string;
  /**
   * What the caller has to clear. For `sequence` and `ledger-fault` this is the
   * first unmet ATTESTABLE checkpoint; for `exclusive-scope` and `arming-gap` it
   * is the CURRENT one — the checkpoint whose declared tools are the only writes
   * allowed right now.
   */
  checkpoint: string;
  /**
   * The checkpoint the tool itself belongs to. Under `exclusive-scope` and
   * `arming-gap` the tool belongs to none, and this carries the current
   * checkpoint too rather than an empty string that would read as a missing
   * value.
   */
  claimedBy: string;
  reason: SequenceRefusalReason;
  /** Rendered for the tool result: names the runbook, the checkpoint and the remedy. */
  message: string;
}

/** Checkpoints the ledger can prove. The others are recorded, never verified. */
function isAttestable(checkpoint: RunbookCheckpoint): boolean {
  return checkpoint.attest === 'event' || checkpoint.attest === 'manifest';
}

/** The EARLIEST checkpoint declaring this tool — rule 2. */
function claimingCheckpoint(runbook: Runbook, toolName: string): number {
  return runbook.checkpoints.findIndex((c) => c.tools.some((t) => t.name === toolName));
}

/**
 * What the ledger would have to hold for this checkpoint to be attested.
 *
 * Exported (WP-20e) because the audit view's SPEC column asks the same question
 * this refusal answers: *what would prove this step happened?* Two answers to
 * one question would let the refusal a model reads and the row a human reads
 * disagree about the same checkpoint.
 */
export function attestationRemedy(checkpoint: RunbookCheckpoint): string {
  const evidence = checkpoint.evidence ?? {};
  if (checkpoint.attest === 'manifest') {
    return `a ${evidence.topic ?? 'task.context.assembled'} manifest recording that the episodic history was retrieved for this task`;
  }
  const parts = [`a ${evidence.topic ?? 'task.*'} event`];
  if (evidence.tool) parts.push(`for ${evidence.tool}, completing successfully`);
  if (evidence.decision) parts.push(`carrying decision "${evidence.decision}"`);
  return parts.join(' ');
}

function narrativeNote(runbook: Runbook): string {
  const narrative = runbook.checkpoints.filter((c) => c.attest === 'narrative').map((c) => c.id);
  if (narrative.length === 0) return '';
  return (
    ` The platform cannot verify ${narrative.join(', ')} — those are narrative checkpoints, ` +
    'still required of you and still your responsibility to perform in order, but not gated here.'
  );
}

function refusal(
  runbook: Runbook,
  capability: string,
  toolName: string,
  claimedBy: RunbookCheckpoint,
  checkpoint: RunbookCheckpoint,
  cursor: ProcedureCursorState
): SequenceRefusal {
  const denied = cursor.denied.includes(checkpoint.id);
  const attestedSoFar = cursor.attested.length
    ? `Attested so far: ${cursor.attested.join(', ')}.`
    : 'Nothing has been attested for this run yet.';

  const head =
    `REFUSED by procedure ${runbook.id} (${capability}): ${toolName} belongs to checkpoint ` +
    `${claimedBy.id}, and ${checkpoint.id} is not attested.`;

  const body = denied
    ? ` ${checkpoint.id} was DENIED and no later approval was recorded. A denial ends the run: ` +
      'record it and stop — do not re-propose the same plan in this session, and do not reach ' +
      'the same effect through another tool.'
    : ` What would attest it: ${attestationRemedy(checkpoint)}.`;

  return {
    capability,
    runbookId: runbook.id,
    checkpoint: checkpoint.id,
    claimedBy: claimedBy.id,
    reason: 'sequence',
    message: `${head}${body} ${attestedSoFar}${narrativeNote(runbook)}`,
  };
}

// ---------------------------------------------------------------------------
// WP-31 · exclusive tool scope
// ---------------------------------------------------------------------------

/**
 * Does this tool WRITE?
 *
 * Not a new list, deliberately. `getToolSafety` is the tier table the audit
 * chokepoint reads to decide what reaches `operation-audit.log`, and
 * `GATED_TIER_FLOOR` is the same boundary WP-19's producer uses to decide what
 * counts as an act. Tier 1 is read-only by that table's own definition; anything
 * absent from `TIER_OVERRIDES` defaults to Tier 2, so a tool added tomorrow is
 * treated as a write until someone deliberately marks it a read — which is the
 * direction this gate must fail in.
 *
 * The AgentDispatcher chokepoint passes the QUALIFIED name (`agent/tool`), which
 * is absent from the table and therefore Tier 2. That is the same answer the
 * audit chokepoint gives for the same name, and it is the fail-closed one.
 */
function isWriteTool(toolName: string): boolean {
  return getToolSafety(toolName).tier >= GATED_TIER_FLOOR;
}

function isExclusive(runbook: Runbook): boolean {
  return runbook.strictness === 'strict' && runbook.toolScope === 'exclusive';
}

function declares(checkpoint: RunbookCheckpoint, toolName: string): boolean {
  return checkpoint.tools.some((t) => t.name === toolName);
}

/** What the current checkpoint permits, in words a refusal can use. */
function declaredList(checkpoint: RunbookCheckpoint): string {
  if (checkpoint.tools.length === 0) {
    // "declares: " with nothing after it reads as a rendering fault and teaches
    // nothing. The instruction the actor needs is that NO write belongs here.
    return `${checkpoint.id} declares no tool of its own, so no write belongs at this point in the procedure`;
  }
  const names = checkpoint.tools.map((t) => t.name).join(', ');
  return `${checkpoint.id} declares ${names} — that is the only write that belongs here`;
}

function exclusiveRefusal(
  runbook: Runbook,
  capability: string,
  toolName: string,
  current: RunbookCheckpoint
): SequenceRefusal {
  return {
    capability,
    runbookId: runbook.id,
    checkpoint: current.id,
    claimedBy: current.id,
    reason: 'exclusive-scope',
    message:
      `REFUSED by procedure ${runbook.id} (${capability}): ${toolName} is a write, and no ` +
      `checkpoint of this procedure declares it. The run is standing at ${current.id}, and ` +
      `${declaredList(current)}. Reaching the same effect through a tool the procedure does not ` +
      'name is not a way around the checkpoint — it is the thing the checkpoint exists to stop. ' +
      `Perform ${current.id} and use what it declares.${narrativeNote(runbook)}`,
  };
}

/**
 * The arming gap (rule 6): the model asked for a procedure and the platform has
 * not delivered it yet.
 *
 * Nothing is attested here, because the run has not started — so the current
 * checkpoint is the first gated one, and it is computed with an
 * always-false attested predicate rather than from a fold that has nothing to
 * fold.
 *
 * Fails CLOSED across the pending set: if any live request would refuse, the
 * call is refused. The queue is process-wide (`procedureArming`'s own stated
 * limitation — a tool handler has no session id), so two chats asking for
 * procedures in the same second cannot be told apart here. That was already
 * true of arming itself; the consequence this adds is that one chat's request
 * can refuse another chat's write, with an instructive message, until the next
 * turn drains it. A false refusal that says exactly why is the right side of
 * this trade.
 */
function armingGapRefusal(toolName: string): SequenceRefusal | null {
  if (!isWriteTool(toolName)) return null;

  const requests = peekArmingRequests();
  if (requests.length === 0) return null;

  const core = getIntelligenceCore();
  if (!core?.law) return null;

  const grants = getCapabilityGrants();
  for (const request of [...requests].reverse()) {
    // A queue is not an authority (WP-20b): an ungranted capability arms
    // nothing, so it may refuse nothing either.
    if (!grants.some((g) => g.capability === request.capability)) continue;

    const runbook = core.law.runbooks.byCapability(request.capability);
    if (!runbook || !isExclusive(runbook)) continue;

    const current = nextGatedCheckpoint(runbook.checkpoints, () => false);
    if (!current || declares(current, toolName)) continue;

    return {
      capability: request.capability,
      runbookId: runbook.id,
      checkpoint: current.id,
      claimedBy: current.id,
      reason: 'arming-gap',
      message:
        `REFUSED by procedure ${runbook.id} (${request.capability}): you asked for this procedure ` +
        'and it has not arrived yet. The platform places it in your turn context on your NEXT ' +
        'turn; the acknowledgement you just read is not the procedure and performs nothing. ' +
        `NO CHECKPOINT HAS BEEN PERFORMED, so ${toolName} — a write — cannot be in sequence. ` +
        `The run will start at ${current.id}, and ${declaredList(current)}. Read the procedure ` +
        'when it arrives, then work through its checkpoints in order.',
    };
  }
  return null;
}

/**
 * The guard. Returns `null` for "not sequenced, or sequence satisfied" — which
 * is every call on every surface until a strict capability is armed.
 */
export function checkCheckpointSequence(
  toolName: string,
  taskId: string | undefined
): SequenceRefusal | null {
  try {
    const run = runForTask(taskId);
    // WP-31 rule 6. No run does NOT mean no procedure: the model may have asked
    // for one whose body arrives next turn. That gap is where the 2026-08-18
    // incident happened, start to finish.
    if (!run) return armingGapRefusal(toolName);

    const core = getIntelligenceCore();
    if (!core) return null;

    const runbook = core.law?.runbooks.byCapability(run.capability);
    // A runbook that will not load cannot be sequenced against. WP-20c already
    // disarms the capability and says so on the turn carrier; refusing tools on
    // a document nobody can read would be a second, silent punishment.
    if (!runbook || runbook.strictness !== 'strict') return null;
    // The document changed under the run: 20c's integrity refusal governs, and
    // the checkpoints attested against the old text do not carry over.
    if (runbook.hash !== run.runbookHash) return null;

    const claimIndex = claimingCheckpoint(runbook, toolName);
    // WP-31 rule 5. `exclusive` is what turns "unclaimed" from untouched into
    // refused — but only for writes, and only on a strict document.
    const exclusive = isExclusive(runbook) && isWriteTool(toolName);

    // Unclaimed AND advisory: untouched, exactly as WP-20d shipped it. This is
    // also the parity floor — a read never reaches any of the work below.
    if (claimIndex < 0 && !exclusive) return null;

    const claimedBy = claimIndex >= 0 ? runbook.checkpoints[claimIndex] : undefined;
    const prerequisites =
      claimIndex >= 0 ? runbook.checkpoints.slice(0, claimIndex).filter(isAttestable) : [];
    // A claimed tool with nothing attestable in front of it was never sequenced;
    // under exclusive scope it is still asked whether it belongs HERE.
    if (claimIndex >= 0 && prerequisites.length === 0 && !exclusive) return null;

    const cursor = foldProcedureCursor(run, runbook.checkpoints, core.ledger);
    if (cursor.fault) {
      // Fail-CLOSED for this capability, on either rule: an unreadable ledger
      // cannot show a sequence, and it cannot show where the run is standing
      // either. The named checkpoint is the tool's own first unmet prerequisite
      // when it has one, and otherwise the procedure's first gated step.
      const named =
        prerequisites[0] ?? nextGatedCheckpoint(runbook.checkpoints, () => false) ?? claimedBy;
      if (!named) return null;
      return {
        capability: run.capability,
        runbookId: runbook.id,
        checkpoint: named.id,
        claimedBy: (claimedBy ?? named).id,
        reason: 'ledger-fault',
        message:
          `REFUSED by procedure ${runbook.id} (${run.capability}): the attestation ledger ` +
          `could not be read, so ${toolName} cannot be shown to be in sequence. This refusal ` +
          'is scoped to this capability — every other tool is unaffected. Retry once the ' +
          'intelligence layer is healthy; do not route around it.',
      };
    }

    const unmet = prerequisites.find((c) => !cursor.attested.includes(c.id));
    // The DECLARED-tool refusal keeps WP-20d's shape and its `sequence` reason,
    // because WP-26's approval card rides exactly this one.
    if (unmet && claimedBy) return refusal(runbook, run.capability, toolName, claimedBy, unmet, cursor);

    if (!exclusive) return null;

    // Where the run is standing — the same answer the turn carrier renders as
    // "Next gated checkpoint" and the rail marks active. Three surfaces naming
    // three different checkpoints is how a product contradicts itself about the
    // step it is on.
    const current = nextGatedCheckpoint(runbook.checkpoints, (c) => cursor.attested.includes(c.id));
    // No gated checkpoint left unmet: the ruling scopes exclusivity to "unmet
    // gated checkpoints", and a procedure whose enforceable part is complete
    // must not leave the tool surface permanently narrowed. A runbook whose
    // checkpoints are ALL narrative lands here too, which is right — nothing can
    // ever be attested, so nothing can ever be unmet, and a permanently closed
    // tool surface is WP-20d's broken-gate shape wearing a new hat.
    if (!current || declares(current, toolName)) return null;

    return exclusiveRefusal(runbook, run.capability, toolName, current);
  } catch {
    // Rule 4. An intelligence-layer fault must never take out the tool surface.
    return null;
  }
}
