/**
 * WP-27 · the renderer's half of the procedure seam.
 *
 * `src/main/intelligence-host/procedureView.ts` is the ONLY source of derivations
 * for procedure surfaces. This module does not compute a single fact: it reads
 * what that seam emits, folds the three stream events into panel state, and holds
 * the COPY rules (which mark, which noun, which sentence) that turn those facts
 * into a rail a human reads. If a number appears on screen, it arrived in an
 * event; the one arithmetic here is a complement of two numbers that both did.
 *
 * WHY THE TYPES COME ACROSS AND THE VALUES DO NOT.
 *
 * Measured on this branch: `require('…/procedureView')` loads 77 modules,
 * thirteen of them `better-sqlite3` — the seam reaches the intelligence core,
 * and the core reaches a native module. The renderer runs in Electron, where
 * better-sqlite3 is built for a different ABI than the one jest uses, so a value
 * import here would throw NODE_MODULE_VERSION at panel load: an intelligence-layer
 * failure breaking a surface that predates the intelligence layer, which is the
 * one thing this seam may never do. So:
 *
 *   - shapes cross as `import type` (TypeScript elides them entirely), and
 *   - the four values a surface genuinely needs — `ATTEST_WORDS`, `BADGE_LABEL`,
 *     the tick predicate, and the badge builder — are MIRRORED here and pinned to
 *     the originals by `tests/unit/renderer/procedureModel.test.ts`.
 *
 * That is this repo's existing answer to "one rule, two bundles that cannot share
 * a runtime" — `localDay` and `resolveAgentCron`/`effectiveCadenceExpression` are
 * the precedents, each pinned by a shared case table. Do not replace the mirror
 * with a value import to "remove duplication": the duplication is the point, and
 * the test is what makes it safe.
 *
 * THE ONE RULE, restated because this is the surface that would break it:
 *
 *   > If the rail renders all eight checkpoints with the same green tick, the
 *   > product is lying.
 *
 * Controlled Vocabulary v1.1 governs every string below: a runbook is a
 * **runbook**, marked **strict**; strict runbooks have **checkpoints** and guided
 * ones have **steps**; a checkpoint is **attested**, never *verified* — "verify"
 * belongs to the live check alone.
 */
import type {
  AbortGroups,
  CheckpointBadge,
  CheckpointChangedEvent,
  CheckpointState,
  DeclaredProcedure,
  ProcedureAbortedEvent,
  ProcedureArmedEvent,
  SiteOutcomeRow,
} from '../../../main/intelligence-host/procedureView';

export type {
  AbortGroups,
  CheckpointBadge,
  CheckpointChangedEvent,
  CheckpointState,
  DeclaredProcedure,
  ProcedureAbortedEvent,
  ProcedureArmedEvent,
  SiteOutcomeRow,
};

/** The three shapes this surface consumes, and nothing else on the stream. */
export type ProcedureStreamEvent = ProcedureArmedEvent | CheckpointChangedEvent | ProcedureAbortedEvent;

type AttestClass = CheckpointState['attest'];
type Strictness = DeclaredProcedure['strictness'];
type ArmedBy = DeclaredProcedure['armedBy'];

// ---------------------------------------------------------------------------
// The mirror (pinned to procedureView by the shared case table — see the header)
// ---------------------------------------------------------------------------

/**
 * What each attest class MEANS. Verbatim from the seam, which took them verbatim
 * from `nexus_load_procedure`: the model is told "your account only, not verified"
 * about the same checkpoint a human sees on this rail, and two vocabularies would
 * let those two sentences drift apart.
 */
export const ATTEST_WORDS: Record<AttestClass, string> = {
  event: 'verified from records',
  manifest: 'verified as supplied',
  narrative: 'your account only, not verified',
};

/** The badge on every step a runbook contributed. */
export const BADGE_LABEL = 'runbook added this';

/** The seam's tick predicate, mirrored. */
export function isVerified(state: CheckpointState): boolean {
  return state.status === 'attested' && state.attest !== 'narrative';
}

/**
 * Whether THIS surface draws a tick.
 *
 * Both conditions, deliberately. `verified` is the seam's own answer and the field
 * its documentation names as the only one a tick may come from; `isVerified` is the
 * declaration's answer. Inside the host the two cannot disagree — but a stream
 * event is data that arrived from elsewhere, and a surface that trusted either
 * alone would tick a narrative checkpoint the day something upstream got it wrong.
 */
export function showsTick(state: CheckpointState): boolean {
  return state.verified === true && isVerified(state);
}

export function checkpointBadge(state: CheckpointState): CheckpointBadge {
  return { label: BADGE_LABEL, reason: state.reason };
}

// ---------------------------------------------------------------------------
// Copy rules
// ---------------------------------------------------------------------------

/** ADR-17 am. 2, via Controlled Vocabulary v1.1: strict has checkpoints, guided has steps. */
export function stepNoun(strictness: Strictness): 'checkpoint' | 'step' {
  return strictness === 'strict' ? 'checkpoint' : 'step';
}

/**
 * One mark per state, and never the same mark for two different truths. The tick
 * is reserved; everything else is distinguishable from it and from each other.
 */
export function checkpointMark(state: CheckpointState): string {
  if (showsTick(state)) return '✓';
  if (state.status === 'aborted') return '✕';
  if (state.status === 'attested') return '○'; // recorded, not proved — a narrative attestation
  if (state.status === 'active') return '▸';
  if (state.status === 'skipped') return '⋯';
  return '·';
}

/**
 * The honest denominator (§5b / P7): how many of the checkpoints the platform can
 * prove AT ALL are attested, and how many can never be proved by anyone but the
 * agent. "3 of 8 done" over a rail where four are unprovable is the half-adherence
 * lie wearing a progress bar.
 *
 * `verifiableCount` is READ, never recomputed — v6 Q3: it does not move under a
 * run, and a historical run is rendered against the denominator it armed with. The
 * narrative count is its complement, so the two halves of this sentence cannot
 * disagree with each other.
 */
export function denominatorLine(procedure: DeclaredProcedure): string | null {
  const total = procedure.checkpoints.length;
  if (total === 0) return null;

  const provable = procedure.verifiableCount;
  const narrative = total - provable;
  const attested = procedure.checkpoints.filter(showsTick).length;
  const noun = stepNoun(procedure.strictness);

  const head = `${attested} of ${provable} provable ${provable === 1 ? noun : `${noun}s`} attested`;
  return narrative > 0 ? `${head} · ${narrative} on the agent’s account only` : head;
}

/** RB-A2: a run with nothing still ahead of it folds to one row. */
export function runIsFinished(procedure: DeclaredProcedure): boolean {
  if (procedure.checkpoints.length === 0) return false;
  return procedure.checkpoints.every(
    (c) => c.status === 'attested' || c.status === 'skipped' || c.status === 'aborted',
  );
}

/** RB-A2: an attested checkpoint has nothing left to say, so it says it in one line. */
export function foldsToOneLine(state: CheckpointState): boolean {
  return state.status === 'attested';
}

/**
 * Why the ceremony appeared — "the first thing a surprised user asks" (§7). Null
 * when the platform recorded no reason: a plausible reason invented here is a
 * claim about how the platform decided, on the surface whose whole job is not
 * making those.
 */
export function armedByPhrase(armedBy: ArmedBy): string | null {
  switch (armedBy) {
    case 'predicate':
      return 'this kind of request always runs under this runbook';
    case 'model-request':
      return 'Nexus AI asked for this runbook by name';
    case 'late-gate':
      return 'a gated action reached the gateway without a runbook, so one was applied then';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The stream fold
// ---------------------------------------------------------------------------

export interface ProcedureStreamState {
  /** The whole declaration, as it arrived at arm and as diffs have moved it. */
  procedure: DeclaredProcedure | null;
  /** The abort notice for THIS run, when one halted it. */
  abort: ProcedureAbortedEvent | null;
}

export function emptyProcedureState(): ProcedureStreamState {
  return { procedure: null, abort: null };
}

/** Whether there is anything to render. False ⇒ the panel is exactly as it was. */
export function hasProcedureSurface(state: ProcedureStreamState): boolean {
  return state.procedure !== null || state.abort !== null;
}

/**
 * The one seam. WP-26's emitter and the local fake both produce these three
 * shapes and nothing else, so swapping the source is a change of subscription and
 * not a change of anything below it.
 *
 * Every other event on the chat stream returns the SAME state object — the panel
 * consumes one stream for tokens, tool rows and procedure alike, and a reducer
 * that reacted to `token` would rebuild the rail on every character.
 */
export function applyProcedureEvent(
  state: ProcedureStreamState,
  event: ProcedureStreamEvent | { type?: string } | null | undefined,
): ProcedureStreamState {
  switch (event?.type) {
    case 'procedure_armed': {
      // A new arm is a new run: the previous run's abort notice is not about it.
      return { procedure: (event as ProcedureArmedEvent).procedure, abort: null };
    }
    case 'checkpoint_changed': {
      // A diff with nothing armed cannot conjure a declaration. The declaration is
      // the document a human reviewed; only the armed event carries it.
      if (!state.procedure) return state;
      const changed = new Map(
        ((event as CheckpointChangedEvent).changed ?? []).map((c) => [c.id, c]),
      );
      const checkpoints = state.procedure.checkpoints.map((c) => changed.get(c.id) ?? c);
      // Declared order is preserved and undeclared ids are dropped: a step that
      // appears mid-run without having been declared is exactly the half-adherence
      // the declared-before-the-run structure exists to make visible.
      return { ...state, procedure: { ...state.procedure, checkpoints } };
    }
    case 'procedure_aborted': {
      return { ...state, abort: event as ProcedureAbortedEvent };
    }
    default:
      return state;
  }
}
