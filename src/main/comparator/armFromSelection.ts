/**
 * WP-41 · THE WALK — a selection made at a comparator becoming an arming.
 *
 * This is the producer the WP-37 gate ruled in: **candidate A**. The comparator
 * surface is the scope's ratified provenance, `ScopeFrom.surface` stays typed
 * `'comparator'` and nothing widens. Candidate B — `nexus_load_procedure`
 * deriving a selection from a model-named site list — was REFUSED at the same
 * ruling, because a model-named selection is a different provenance and
 * widening a designer-ratified artifact by tool default would put words in it.
 * There is therefore exactly one way a scope enters this system, and it is here.
 *
 * WP-37 measured the hole this closes, in the worktree, and stated it plainly:
 *
 *     deriveScope(          production callers: ZERO
 *     recordArmingRequest(  production callers: ONE — load-procedure.ts:113,
 *                           `recordArmingRequest(capability)`, no scope argument
 *
 * The carrier was complete from `ArmingRequest.scope` to the renderer's
 * `opensContainer` and pinned end to end through the real `assembleForChatTurn`.
 * Nothing filled it. `deriveScope` gains its first production caller in
 * `armFromSelection` below, and the from-line resolves honestly to the matrix
 * selection that produced it rather than to a fixture.
 *
 * TWO ENTRY POINTS, AND THE SPLIT BETWEEN THEM IS DELIBERATE.
 *
 *   `previewScope`  — pure. Derives the split and returns it. Records NOTHING.
 *   `armFromSelection` — derives the same split and records the arming.
 *
 * They are two functions rather than one with a flag because the selection bar
 * renders the block CONTINUOUSLY as a user clicks (draft 2 §2: the same block,
 * the same wording, the same doors, in the selection bar and at the head of the
 * declaration), and a preview that armed on every click would queue an arming
 * per keystroke. A boolean parameter that switches a side effect is the shape
 * that eventually gets passed the wrong way; two names cannot be.
 *
 * BOTH DERIVE THROUGH THE ONE FUNCTION. `previewScope` is what `armFromSelection`
 * calls — the preview a user approved and the scope that arms are the SAME
 * object, not two derivations that tend to agree. That is the packet's own rule
 * applied to itself: a run that re-derives its own targets fails this journey,
 * and so would a surface that re-derived what it had already shown.
 *
 * THE SCOPE IS DERIVED HOST-SIDE, NEVER IN THE RENDERER. `procedureScope.ts` is
 * pure today, but `scopeModel.ts`'s header says why that does not license a
 * value import: purity is one careless import away from being false, the seam
 * reaches the intelligence core, and the core reaches better-sqlite3 with the
 * wrong ABI for Electron. So the renderer sends a selection and receives a
 * split; it never computes one.
 *
 * NON-FATAL throughout. A refusal to arm is an answer; a throw into the panel is
 * not.
 */
import { getIntelligenceCore } from '../intelligence-host/coreRegistry';
import { getCapabilityGrants } from '../intelligence-host/capabilityGrants';
import { recordArmingRequest } from '../intelligence-host/procedureArming';
import { deriveScope } from '../intelligence-host/procedureScope';
import type { ProcedureScope, ScopeRunbook, ScopeSelection } from '../intelligence-host/procedureScope';

/**
 * Why a selection could not become a scope. Each value is a different sentence
 * with a different remedy, and they are kept apart for the reason every absence
 * on this seam is: collapsing them would tell a user whose core is dark the same
 * thing it tells a user who has not granted the capability.
 */
export type ArmRefusal =
  | 'core-dark'
  | 'no-document'
  | 'empty-selection';

export interface ScopeOutcome {
  scope?: ProcedureScope;
  refused?: ArmRefusal;
}

/**
 * The split, WITHOUT arming. What the selection bar renders.
 *
 * `catalogue` is handed the whole registry so the barred group's "no runbook
 * version declares it" is ANSWERED rather than assumed — `deriveScope` reads it
 * to say whether some other document covers the place, and an omitted catalogue
 * silently degrades that sentence to its weakest form.
 */
export function previewScope(capability: string, selection: ScopeSelection): ScopeOutcome {
  try {
    if (!capability) return { refused: 'no-document' };
    if (!selection?.cells?.length) return { refused: 'empty-selection' };

    const core = getIntelligenceCore();
    if (!core?.law) return { refused: 'core-dark' };

    const runbook = core.law.runbooks.byCapability(capability);
    if (!runbook) return { refused: 'no-document' };

    const catalogue: ScopeRunbook[] = [...core.law.runbooks.runbooks()].map(pick);

    return {
      scope: deriveScope({
        selection,
        runbook: pick(runbook),
        grants: getCapabilityGrants(),
        catalogue,
      }),
    };
  } catch {
    // A derivation fault costs the preview, never the panel.
    return { refused: 'core-dark' };
  }
}

/**
 * The walk, completed: derive the split and hand it to the carrier.
 *
 * **A ZERO-RUNNABLE SCOPE STILL ARMS.** This is WP-37's rule 3, and it is the
 * whole of this packet's acceptance. The plausible wrong implementation is
 * "record it only when something runs" — and it produces silence where the
 * ratified state is a turn with a plan and its door. A selection of two halted
 * sites must reach the declaration and render `0 cells eligible`, no container,
 * with both sites under `Excludes:` carrying the record that observed them
 * halted. Gating the arming on `scope.opensRun` would delete that state from
 * the product, which is exactly what "the empty-run state remains unreachable"
 * meant before this packet.
 *
 * `at` is injectable because the request is timestamped and a test that cannot
 * fix the clock cannot pin the timestamp.
 *
 * WP-51 · `answers` is the incidents this arming is being made IN ANSWER TO —
 * the designer's Q1, ratified: *"the containment run folds if and only if its
 * arming names the incidents it answers."* It is passed through untouched;
 * `recordArmingRequest` owns the format gate, because the queue is where a
 * caller's value first meets this system and two gates would be two rules.
 *
 * **The surface that supplies them is not built here.** A user contains an
 * incident from the row that reports it, and that row's door lives in
 * `src/renderer/`, which a sibling packet holds. So this parameter has exactly
 * one production caller today — the IPC handler, passing whatever the renderer
 * sends — and the renderer sends nothing yet. Stated rather than hidden,
 * because a complete carrier that nothing fills is the defect WP-48b measured
 * and this packet is repaying: the difference is that here the filling end is
 * behind a live lock rather than forgotten.
 */
export function armFromSelection(
  capability: string,
  selection: ScopeSelection,
  at: Date = new Date(),
  answers?: readonly string[]
): ScopeOutcome {
  const outcome = previewScope(capability, selection);
  if (!outcome.scope) return outcome;
  try {
    recordArmingRequest(capability, at, outcome.scope, answers);
  } catch {
    // The queue refusing costs the arming, not the answer. The caller still
    // receives the split it derived, so the surface can say what it found.
    return { scope: outcome.scope, refused: 'core-dark' };
  }
  return outcome;
}

/** Only the four fields the split reads. Keeps the catalogue cheap to build. */
function pick(rb: { id: string; version: string; capability: string; frontmatter: unknown }): ScopeRunbook {
  return {
    id: rb.id,
    version: rb.version,
    capability: rb.capability,
    frontmatter: rb.frontmatter,
  } as ScopeRunbook;
}
