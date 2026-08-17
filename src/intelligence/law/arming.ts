/**
 * Arming — how a turn acquires a procedure (WP-20b, design note §1 / P1).
 *
 * THREE PATHS, NONE OF WHICH IS A MODEL CALL. That is the whole design, and it
 * is the reason intent classification was rejected: a model call before the
 * model call doubles first-token latency on every turn, puts a probabilistic
 * component inside the gate that decides whether safety ceremony applies, and
 * leaves no auditable artifact behind. Everything in this file is a pure
 * function of text and the runbooks a grant already covers.
 *
 *   A · `armByPredicate` — the runbook's own authored `arms_on:` verb and
 *       subject sets, matched lexically over the user's turn text. Cost ≈ zero.
 *   B · `armByRequest`   — the model asks by capability name (the Tier-1
 *       `nexus_load_procedure` tool). A paraphrase the predicate misses is
 *       still recoverable, by asking rather than by guessing.
 *   C · `armAtGate`      — a gated call whose tool a granted STRICT runbook
 *       claims. Late arming does not rescue the sequence; it converts silent
 *       improvisation into an instructive refusal (`renderLateArmRefusal`).
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO.
 *
 * - **No stemming, no synonyms, no inference.** `updates` does not match a
 *   declared `update`. An under-firing predicate is a ruled-tolerable failure
 *   mode — paths B and C both remain — while a predicate that guesses is a gate
 *   nobody can reproduce. Authoring the inflections is the runbook's job, which
 *   is why `arms_on` is a set rather than a stem.
 * - **No picking between candidates.** Two granted runbooks arming on one turn
 *   arms NEITHER, and both are named. A coin toss between two strict
 *   procedures is worse than none: the same ruling `resolveTargetArgs` makes
 *   for an ambiguous bare name.
 * - **No delivery.** Arming decides WHICH procedure applies. Carrying it on the
 *   turn is WP-20c's, and the body never rides a tool result (R7) — hence the
 *   refusal text says the procedure arrives on the next turn rather than
 *   quoting it.
 */
import { Runbook, RunbookArmingPredicate } from './types';

/** Which of P1's three paths armed a procedure. Recorded, because "why did ceremony appear" is the first question a surprised user asks. */
export type ArmedBy = 'predicate' | 'model-request' | 'late-gate';

export interface ArmedProcedure {
  runbook: Runbook;
  armedBy: ArmedBy;
}

/**
 * Why nothing armed. Never an error — an unarmed turn is the ordinary case and
 * the parity floor (design note §1, parity risk).
 *
 * - `no-match`    — no granted runbook's predicate matched the turn text.
 * - `ambiguous`   — two or more matched, so none was chosen (`candidates`).
 * - `not-granted` — a capability was asked for that no grant covers
 *                   (`candidates` names what IS granted).
 * - `unclaimed`   — no granted strict runbook claims the tool at the gate.
 */
export type ArmingRefusalReason = 'no-match' | 'ambiguous' | 'not-granted' | 'unclaimed';

export interface ArmingOutcome {
  armed?: ArmedProcedure;
  reason?: ArmingRefusalReason;
  /** Runbook ids on `ambiguous`; granted capability names on `not-granted`. Never one of them, silently picked. */
  candidates?: string[];
}

/**
 * The turn text as words. Splits on anything that is neither a letter nor a
 * digit, in the Unicode sense: `\w` would treat every accented letter as a
 * separator and quietly split a French or German turn into fragments, so a
 * predicate could never match one.
 */
export function tokenizeTurnText(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Whether a declared term is present in the turn's token stream.
 *
 * Whole-token, in order, never a substring: `plugin` must not be found inside
 * `plugins`, and a term the author wrote with a space (`roll out`) is a phrase
 * whose words must be adjacent. Substring matching would arm on `updates` today
 * and on `no updates needed` tomorrow, which is the over-firing the ruled
 * failure-mode table tolerates only because it is *recorded and measurable*,
 * not because it is free.
 */
function hasTerm(padded: string, term: string): boolean {
  const wanted = tokenizeTurnText(term);
  if (wanted.length === 0) return false;
  return padded.includes(` ${wanted.join(' ')} `);
}

/** The two-clause match: at least one declared verb AND at least one declared subject. */
export function armsOnMatches(text: string, predicate: RunbookArmingPredicate): boolean {
  const padded = ` ${tokenizeTurnText(text).join(' ')} `;
  return (
    predicate.verbs.some((v) => hasTerm(padded, v)) &&
    predicate.subjects.some((s) => hasTerm(padded, s))
  );
}

/**
 * Path A. `granted` is the runbooks a live grant covers — never the whole
 * registry: arming a procedure nobody granted would deliver ceremony from a
 * document no one reviewed into a run no one authorised.
 */
export function armByPredicate(text: string, granted: Runbook[]): ArmingOutcome {
  const matched = granted.filter((rb) => rb.armsOn && armsOnMatches(text, rb.armsOn));
  if (matched.length === 0) return { reason: 'no-match' };
  // Rule 2: refuse to pick. Order is the registry's (deterministic: the loader
  // walks depth-first, alphabetically), so the named pair is reproducible.
  if (matched.length > 1) return { reason: 'ambiguous', candidates: matched.map((rb) => rb.id) };
  return { armed: { runbook: matched[0], armedBy: 'predicate' } };
}

/**
 * Path B. Asking for a capability no grant covers is NOT an error: the answer
 * names what is granted instead (design note §1, failure-mode table).
 */
export function armByRequest(capability: string, granted: Runbook[]): ArmingOutcome {
  const hit = granted.find((rb) => rb.capability === capability);
  if (hit) return { armed: { runbook: hit, armedBy: 'model-request' } };
  return { reason: 'not-granted', candidates: granted.map((rb) => rb.capability) };
}

/**
 * Every tool a runbook claims: the document-level list plus every checkpoint's.
 * The union is what makes the sequencer able to say that `bulk_plugin_update`
 * is a cp.roll-fleet act (design note §5, use 2) — a claim declared only on the
 * checkpoint that expects it is still a claim.
 */
export function claimsTool(runbook: Runbook, toolName: string): boolean {
  if (runbook.tools.some((t) => t.name === toolName)) return true;
  return runbook.checkpoints.some((cp) => cp.tools.some((t) => t.name === toolName));
}

/**
 * Path C. STRICT only, and that is not an oversight: a guided runbook licenses
 * the actor to adapt, so a guided claim must never turn into a refusal. An
 * unclaimed tool arms nothing at all — every call outside a granted strict
 * runbook's claim set reaches the registry exactly as it does today.
 */
export function armAtGate(toolName: string, granted: Runbook[]): ArmingOutcome {
  const claimants = granted.filter((rb) => rb.strictness === 'strict' && claimsTool(rb, toolName));
  if (claimants.length === 0) return { reason: 'unclaimed' };
  if (claimants.length > 1) return { reason: 'ambiguous', candidates: claimants.map((rb) => rb.id) };
  return { armed: { runbook: claimants[0], armedBy: 'late-gate' } };
}

/**
 * The refusal a late arm renders — instruction, not an error string.
 *
 * Three obligations, each pinned:
 *   1. Name the procedure that claims this tool, with its version and
 *      strictness, so the refusal is explainable without opening settings.
 *   2. Name where the procedure starts, so the reader knows what was skipped.
 *   3. Say how to arm it — by the tool a model can actually call.
 *
 * It carries no runbook prose. R7: the procedure never rides a tool result, so
 * this text points at the next turn rather than quoting the document. And no
 * internal machinery vocabulary appears, for the same reason the health surface
 * has none — a refusal is read by whoever is surprised by it.
 */
export function renderLateArmRefusal(runbook: Runbook, toolName: string): string {
  const first = runbook.checkpoints[0]?.id;
  return [
    `\`${toolName}\` is part of the procedure **${runbook.id} v${runbook.version}** (${runbook.strictness}), ` +
      `which governs \`${runbook.capability}\` on this machine. Nothing armed that procedure for this task, ` +
      'so the call is refused rather than run outside it.',
    first
      ? `The procedure begins at \`${first}\`, and the steps before this call have not been recorded.`
      : 'The procedure has no recorded starting step, so nothing before this call can be shown as done.',
    `To run it, call \`nexus_load_procedure\` with \`capability: "${runbook.capability}"\`. ` +
      'The procedure itself arrives on the next turn — it is never delivered inside a tool result, ' +
      'so it is not in this message.',
  ].join('\n\n');
}
