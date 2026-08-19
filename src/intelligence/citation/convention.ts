/**
 * WP-34 · the carrier instruction block that teaches the citation convention.
 *
 * ADR-24: the span format is an OUTPUT convention carried as a carrier
 * instruction block — "versioned policy, re-asserted by hash" like everything
 * else on the carrier (ADR-20). So this file holds two things and nothing else:
 * the text the model reads, and the version hash that decides whether the text
 * rides in full this turn or is re-asserted in one line.
 *
 * CORE-ONLY, deliberately. `createHash` lives here and NOT in `resolve.ts`,
 * because the renderer imports the join and a node builtin in a renderer bundle
 * is a polyfill — a second implementation of the thing whose single
 * implementation is the whole point of P5.
 *
 * THE TEXT IS THE CONTRACT. It is a carrier change, so it went through the gate
 * as verbatim text before this packet's merge-path work continued, and its hash
 * changes the moment a word does — which is the mechanism, not a side effect: a
 * session already carrying version X is re-taught in full the first turn after
 * X becomes Y.
 */
import { createHash } from 'crypto';

/**
 * The instruction block, verbatim.
 *
 * Written to four constraints, all of them from the design note and the
 * designer's ratification:
 *
 *  - **Cheap to emit.** The common case — a ledger event — is four tokens of
 *    punctuation around an id the model can already see on the carrier. No
 *    kind word is required where the `evt_` prefix already is one.
 *  - **Impossible to confuse with user content.** The literal word `cite`
 *    inside `[[…]]`; retrieved site content rides this same turn wrapped as
 *    untrusted data, so the discriminator has to survive being echoed.
 *  - **Answerable to its consumer.** The record id and the citation kind are
 *    both recoverable from the marker alone, because the ratified render is a
 *    trailing door at the end of the claim and a door has to know what it
 *    points at and what kind of thing that is.
 *  - **Honest about its own limits.** The block says plainly that the platform
 *    checks existence and not support, and that no reply is refused for citing
 *    badly. A model told the platform verifies its citations would reasonably
 *    conclude a cited claim had been checked, which is the one belief this
 *    contract must never create.
 */
export const CITATION_CONVENTION_BODY = [
  'When you state a specific fact that came from a record above — something that',
  'happened, a current-state value, a number, a date, a version, an id — end the',
  'claim with a marker naming the record that supplied it. The marker goes at the',
  'END of the claim, after its final punctuation, never mid-sentence.',
  '',
  'Write exactly one of these four forms. No spaces inside the brackets:',
  '',
  '  [[cite:evt_01J9Z4KDQ8]]            a ledger event listed above, by its own id',
  '  [[cite:tool:wp_plugin_list#1]]     a tool call YOU made this task: the tool name,',
  '                                     then # and which call of that tool it was,',
  '                                     counting from 1',
  '  [[cite:carrier:freshness]]         a line of this platform context block. The',
  '                                     citable lines are: policy, procedure, routing,',
  '                                     freshness, retrieved',
  '  [[cite:none]]                      you are stating a fact and NOTHING above',
  '                                     supplies it',
  '',
  'Rules:',
  '- Cite only ids that appear above, and only tool calls you actually made this',
  '  task. Never invent an id, never adapt one, never cite a record you were not',
  '  given. A citation of a record nobody supplied is worse than no citation at',
  '  all: it looks like evidence.',
  '- Conversational glue, reasoning, and clearly hedged inference carry no marker.',
  '  "That points at the gateway, but I have not proved it" needs nothing.',
  '- A fact you cannot source takes [[cite:none]] rather than silence. Say the',
  '  fact if it is worth saying, and mark that nothing here backs it.',
  '- One claim may carry more than one marker. Put them side by side at the end.',
  '',
  'What the platform does with these: it checks that the record you named EXISTS',
  'in what this task was supplied, and links it. It does NOT check that the record',
  'supports the claim — that is not something it can know, and it will not guess.',
  'No reply is ever refused for citing badly. This convention changes how you',
  'attribute what you say; it changes nothing about what you are allowed to do.',
].join('\n');

/**
 * Version over the block's own text.
 *
 * The whole text and nothing but: the ADR-20 question is "is the actor already
 * carrying THIS instruction", and the answer must change when, and only when,
 * the instruction does. Hashing anything else (a hand-maintained number, the
 * file's mtime) would let an edited convention re-assert as unchanged, which is
 * the one failure the hash exists to prevent.
 */
export const CITATION_CONVENTION_VERSION = `cnv_${createHash('sha256')
  .update(CITATION_CONVENTION_BODY, 'utf8')
  .digest('hex')
  .slice(0, 12)}`;

/** Full assertion — the first turn of a session, and after any edit. */
export function renderCitationConventionBlock(): string {
  return [
    `## How to cite what you say — output convention ${CITATION_CONVENTION_VERSION}`,
    CITATION_CONVENTION_BODY,
  ].join('\n');
}

/**
 * The hash-only re-assert (ADR-20's amendment applied to this block).
 *
 * Deliberately NOT silence. A turn that says nothing about the convention is
 * indistinguishable from a turn where the platform forgot it, and the model has
 * no way to tell "still in effect" from "no longer asked for" — the same
 * reasoning that gives the policy set a one-line re-assert rather than an
 * absence.
 */
export function renderCitationConventionReassert(): string {
  return `Citation convention ${CITATION_CONVENTION_VERSION} remains in effect, unchanged.`;
}
