/**
 * WP-27 · the renderer's half of the procedure seam.
 * WP-35 · plus the companion density's copy rules — the reference line, the
 * three-mark vocabulary, the checkpoint window and its stated range, the
 * zero-cell container predicate, and the derived plan a refusal carries. Same
 * rule as everything else here: these compose facts that arrived in an event
 * into sentences a human reads, and compute none of them.
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
 * from `nexus_load_procedure`: the model is told "the platform cannot verify
 * this" about the same checkpoint a human sees on this rail, and two
 * vocabularies would let those two sentences drift apart.
 *
 * WP-31 rewrote them in CAPABILITY tense. The old wording named the class and
 * read as a completion state; the 2026-08-18 incident is a live run that took
 * "verified from records" as a progress report and wrote without an approval.
 * On this rail the sentence appears only on a PENDING or ACTIVE checkpoint,
 * whose own status supplies the state.
 */
export const ATTEST_WORDS: Record<AttestClass, string> = {
  event: 'the platform can verify this from records',
  manifest: 'the platform can verify this from what it supplied',
  narrative: 'on your account only — the platform cannot verify this',
};

/** The badge on a step the user did not ask for. */
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

/**
 * The badge, or null (WP-28) — the seam's rule, mirrored.
 *
 * v0 returned a badge for every checkpoint, on the reasoning that a runbook is
 * the only source of steps. Live, that put "runbook added this" on cp.approval
 * and cp.backup: if everything is badged, nothing is. Which steps qualify is a
 * judgement about what the person asking had in mind, so it is AUTHORED in the
 * reviewed document (`unrequested:`) and read here — never inferred from the
 * step's shape, tool or attest class.
 */
export function checkpointBadge(state: CheckpointState): CheckpointBadge | null {
  if (!state.unrequested) return null;
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
 * THREE MARKS ONLY (WP-35 · the fold, pin 9): attested, recorded-not-proved,
 * not-yet. The set is closed, and it is closed because a mark vocabulary that
 * grows is a vocabulary nobody reads: the not-applicable dash died with 1a's
 * armed empty block for exactly that reason ("a fourth mark meaning
 * nothing-attests is vocabulary by drift"), and WP-27's provisional six were
 * five marks doing what words do better.
 *
 *  - `✓` — attested AND provable. The only tick, from `showsTick` alone.
 *  - `·` — recorded, not proved: a narrative checkpoint the agent attested.
 *  - the POSITION NUMERAL — not yet. Its own declared index, so eight
 *    unreached checkpoints read `1 · 2 · 3 …` rather than eight identical
 *    dots, and the digest's stated range ("Checkpoints 2 to 4 of 8") names
 *    numbers the rail itself is showing.
 *
 * WHAT THE NUMERAL DOES NOT SAY, and where that fact went instead. `aborted`
 * and `skipped` are not "not yet" — one ended and one was never reached — and
 * `active` is not "not yet" either. Those three facts are carried by the row's
 * own evidence sentence, which the seam derives and this surface renders
 * verbatim ("the run aborted here", "the run stopped before reaching this
 * step"), and the active row is distinguished typographically. A fact moved
 * from a glyph to a sentence is still on screen; a fourth glyph would be a
 * fourth word in a three-word vocabulary.
 *
 * `index` is the checkpoint's position in the DECLARED order — the caller's
 * loop index over `procedure.checkpoints`, never a filtered or windowed one.
 * The digest windows the list and still marks `cp.approval` as 3, because 3 is
 * what it is.
 */
export const MARK_ATTESTED = '✓';
export const MARK_RECORDED = '·';

export function checkpointMark(state: CheckpointState, index: number): string {
  if (showsTick(state)) return MARK_ATTESTED;
  if (state.status === 'attested') return MARK_RECORDED; // recorded, not proved
  return String(index + 1);
}

/**
 * THE RUNBOOK REFERENCE, and its one home (the fold, pin 4): the declared
 * block's header. Not in the card, not in the session header, not in a turn.
 *
 * One function rather than three spans composed at each site, because "appears
 * exactly once" is a property of a whole panel and the only way to hold it is
 * for there to be one thing that says it. WP-28 already caught this once, as a
 * doubled reference between the card and the platform's warning line.
 */
export function referenceLine(procedure: DeclaredProcedure): string {
  const parts = [procedure.runbookId ?? procedure.capability];
  if (procedure.version) parts.push(`v${procedure.version}`);
  if (procedure.strictness === 'strict') parts.push('marked strict');
  return parts.join(' · ');
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

// ---------------------------------------------------------------------------
// WP-35 · the companion density (the fold, ratified 2026-08-18)
// ---------------------------------------------------------------------------

/**
 * XD-21, as a predicate: a declared procedure whose plan is zero cells opens no
 * run and draws no checkpoint list. No consequence, no rank, no container.
 *
 * ABSENT SCOPE IS NOT AN EMPTY SCOPE. A declaration that carries no scope at
 * all is the ordinary case today — nothing on the stream sets one — and it
 * opens its container exactly as it did before this packet. Reading "no scope"
 * as "no cells" would silence every armed run in the product on the strength of
 * a field nobody populates.
 */
export function opensContainer(procedure: DeclaredProcedure): boolean {
  return procedure.scope ? procedure.scope.opensRun : true;
}

/**
 * The derived plan a refusal carries (the fold, pin 8: "the refusal stays a
 * turn, the derived plan attaches verbatim"). Null when no scope was carried —
 * there is no plan to attach, and a line invented from the declaration alone
 * would be a plan the platform never derived.
 *
 * WP-41 · THE MISSING SEGMENT IS NOW SERVED, AND CONSUMED HERE. WP-35 shipped
 * this line one segment short of the sheet's
 * `rb.bulk-plugin-update · v1.2.0 · marked strict · cp.dry-run — 0 cells
 * eligible`, because no served fact identified the checkpoint that PRODUCED the
 * plan: `cp.dry-run` cannot be the active one (it is narrative, so
 * `nextGatedCheckpoint` never names it), and the escalation refused to guess.
 * WP-37 derived it — `planCheckpointOf`, the nearest narrative checkpoint before
 * the consent gate, ratified at the WP-37 gate under its own name — and the
 * stream now carries it as `planCheckpoint`. This reads that field; it does not
 * infer, and it must never fall back to naming a checkpoint the document did not
 * identify.
 *
 * **ABSENT STAYS ABSENT.** A document with no consent gate, or nothing narrative
 * before it, serves no `planCheckpoint` — and the line then renders in its
 * three-segment form rather than borrowing a plausible id. That is the same rule
 * as everywhere else on this surface: the segment names a step the author wrote,
 * or it is not there.
 */
export function derivedPlanLine(procedure: DeclaredProcedure): string | null {
  const scope = procedure.scope;
  if (!scope) return null;
  const cells = scope.runnable.length;
  const gate = procedure.planCheckpoint?.checkpointId;
  const head = gate ? `${referenceLine(procedure)} · ${gate}` : referenceLine(procedure);
  return `${head} — ${cells} ${cells === 1 ? 'cell' : 'cells'} eligible`;
}

/**
 * How many checkpoint rows the digest shows. Three: the gate, and one row of
 * context on either side of it.
 *
 * The number is drawn, not measured. The ratified rule is the digest — "every
 * fact, a stated window centred on the gate, no inner scrollbar" — and 200px
 * was struck precisely because a number pretending to be a rule outlives the
 * geometry it described. This constant is the sheet's window, exported so a
 * test asserts against the same number the surface renders rather than a
 * second copy of it.
 */
export const CHECKPOINT_WINDOW = 3;

export interface CheckpointWindow {
  /** Declared index of the first row shown, zero-based. */
  offset: number;
  /** The rows, in declared order. */
  states: CheckpointState[];
  /** The whole list's length — the honest denominator of the range line. */
  total: number;
}

/**
 * The window, centred on the gate being decided.
 *
 * The gate is the checkpoint the pending approval attests, which the approval
 * context names. With none named the active checkpoint stands in — the same
 * one `nextGatedCheckpoint` chose — and with neither, the list's head.
 *
 * CLAMPED AT THE ENDS, NEVER SHRUNK. A gate at position 1 of 8 windows rows
 * 1–3, not rows 0–2 with one row missing: the window's size is what the sheet
 * drew, and a short window at an edge would silently show less than the density
 * promises while the range line said otherwise.
 */
export function checkpointWindow(
  procedure: DeclaredProcedure,
  gateCheckpointId: string | null | undefined,
): CheckpointWindow | null {
  const all = procedure.checkpoints;
  if (all.length === 0) return null;

  const named = gateCheckpointId ? all.findIndex((c) => c.id === gateCheckpointId) : -1;
  const active = all.findIndex((c) => c.status === 'active');
  const centre = named >= 0 ? named : active >= 0 ? active : 0;

  const size = Math.min(CHECKPOINT_WINDOW, all.length);
  const offset = Math.max(0, Math.min(centre - Math.floor((size - 1) / 2), all.length - size));
  return { offset, states: all.slice(offset, offset + size), total: all.length };
}

/**
 * "Checkpoints 2 to 4 of 8" — the honest part of a window (the fold response
 * §2: "a window that doesn't declare itself is a truncation pretending to be
 * the whole").
 *
 * Null when the window IS the whole list: there is no truncation to declare,
 * and "Checkpoints 1 to 3 of 3" would be a disclosure about nothing.
 */
export function windowRangeLine(
  procedure: DeclaredProcedure,
  window: CheckpointWindow,
): string | null {
  if (window.states.length >= window.total) return null;
  const noun = stepNoun(procedure.strictness);
  const plural = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}s`;
  return `${plural} ${window.offset + 1} to ${window.offset + window.states.length} of ${window.total}`;
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
