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
 */
import { getIntelligenceCore } from './coreRegistry';
import { foldProcedureCursor, runForTask, ProcedureCursorState } from './procedureCursor';
import type { Runbook, RunbookCheckpoint } from '../../intelligence';

export interface SequenceRefusal {
  capability: string;
  runbookId: string;
  /** The first unmet ATTESTABLE checkpoint — what the caller has to clear. */
  checkpoint: string;
  /** The checkpoint the tool itself belongs to. */
  claimedBy: string;
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

/** What the ledger would have to hold for this checkpoint to be attested. */
function remedyFor(checkpoint: RunbookCheckpoint): string {
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
    : ` What would attest it: ${remedyFor(checkpoint)}.`;

  return {
    capability,
    runbookId: runbook.id,
    checkpoint: checkpoint.id,
    claimedBy: claimedBy.id,
    message: `${head}${body} ${attestedSoFar}${narrativeNote(runbook)}`,
  };
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
    if (!run) return null;

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
    if (claimIndex < 0) return null; // rule: unclaimed tools are untouched

    const claimedBy = runbook.checkpoints[claimIndex];
    const prerequisites = runbook.checkpoints.slice(0, claimIndex).filter(isAttestable);
    if (prerequisites.length === 0) return null;

    const cursor = foldProcedureCursor(run, runbook.checkpoints, core.ledger);
    if (cursor.fault) {
      return {
        capability: run.capability,
        runbookId: runbook.id,
        checkpoint: prerequisites[0].id,
        claimedBy: claimedBy.id,
        message:
          `REFUSED by procedure ${runbook.id} (${run.capability}): the attestation ledger ` +
          `could not be read, so ${toolName} cannot be shown to be in sequence. This refusal ` +
          'is scoped to this capability — every other tool is unaffected. Retry once the ' +
          'intelligence layer is healthy; do not route around it.',
      };
    }

    const unmet = prerequisites.find((c) => !cursor.attested.includes(c.id));
    if (!unmet) return null;

    return refusal(runbook, run.capability, toolName, claimedBy, unmet, cursor);
  } catch {
    // Rule 4. An intelligence-layer fault must never take out the tool surface.
    return null;
  }
}
