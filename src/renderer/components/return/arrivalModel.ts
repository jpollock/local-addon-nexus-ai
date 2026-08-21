/**
 * WP-46 · M6's DISPLAY SHAPING — and the line it does not cross.
 *
 * XD-26's arrival and re-entry read WP-30's query contract and render it. The
 * contract's whole design is that THE HOST FOLDS AND THE SURFACE READS: tiers,
 * the consequence order, situation coalescing, the gate's checkpoint id and its
 * position, the attested set, the standing approvals, the place set and its
 * summary sentence all arrive derived. Nothing in this module recomputes any of
 * them, and nothing in the components does either.
 *
 * WHAT THIS MODULE IS FOR, then. Three jobs, and each is display shaping rather
 * than derivation:
 *
 *  1. **Counting what the columns are about to render.** `arrivalCounts` reads
 *     `waiting.length`, `changed.length` and `reserved.dark.length` off the very
 *     `TriageView` the columns render. XD-2 says a sentence about data where the
 *     data exists must be generated, and the accounting line is exactly that
 *     sentence — generated from the same three numbers, so it cannot disagree
 *     with the rows beneath it. A hand-typed "2 need you" is the defect.
 *  2. **Substituting derived values into ratified sentences.** Every word comes
 *     from `returnCopy.generated.ts`, which is extracted from the designer's own
 *     files. This module supplies the numbers and the moments.
 *  3. **Reconstituting a `DeclaredProcedure` from a `SessionRow`** so the
 *     re-entry's rail can call the SHIPPED densities' own functions —
 *     `checkpointMark`, `showsTick`, `ATTEST_WORDS`, `denominatorLine` — rather
 *     than a second implementation of the marks discipline. XD-26: "a difference
 *     between the densities and this sheet would be a defect in one of them."
 *     One derivation, imported, is how that is kept true rather than promised.
 *
 * THE AUTHORED COPY IS IN ONE PLACE AND IT IS NAMED. `AUTHORED` below holds
 * every sentence this packet wrote that the designer did not. It is a single
 * exported object so the gate report can extract it mechanically instead of a
 * human reading the tree for stray prose — the copy discipline's own rule.
 */
import type {
  ConsequenceTier,
  PendingApproval,
  PendingGate,
  ReservedRow,
  RowDoor,
  SessionRow,
  Situation,
  TriageView,
} from '../../../main/intelligence-host/sessionRegistry';
import {
  fillSituationSentence,
  listVerdict,
  normalizeProducerId,
} from '../../../main/intelligence-host/sessionRegistry';
import type { InboxItem } from '../../../main/inbox/types';
import type { DeclaredProcedure } from '../../../main/intelligence-host/procedureView';
import { RETURN_COPY, SEP } from './returnCopy.generated';
import {
  ACCOUNTING,
  COLOURS,
  DOORS,
  FRESHNESS,
} from '../../../main/intelligence-host/situationCopy.generated';
import { ageLabel } from '../../../main/intelligence-host/sessionRegistry';

/**
 * THIS SURFACE'S COPY, IN ONE PLACE. Gate-held, per XD-26's copy discipline.
 *
 * Each entry exists because the fact it states has NO ratified sentence and no
 * channel into the query contract, so the alternative to authoring it was
 * rendering a fabricated number or rendering nothing where something is true.
 * Both of the first two name a LIMIT OF THE PLATFORM, in 6c's own voice, rather
 * than inventing a state.
 *
 * WP-48 · ONE OF THE THREE IS NO LONGER AUTHORED. `DRIFT_NO_COUNT` was
 * replaced by a ratified sentence and now reads it from the generated module;
 * it keeps its key here so this object stays the one place a gate report has to
 * extract to see every sentence this surface renders. The object's name is
 * therefore a claim about its ROLE, not about the provenance of every value in
 * it — each entry says which it is.
 */
export const AUTHORED = {
  /**
   * The arrival's first ever open. There is no absence to measure, and
   * "You were away 0 hours" would be a claim about a person's morning.
   */
  AWAY_UNKNOWN: 'This surface has no record of when you last opened it, so the time away is not stated.',
  /**
   * WP-48 · NO LONGER AUTHORED — RATIFIED, and extracted rather than retyped.
   *
   * WP-30's contract still carries no count of facts past their freshness
   * window (`ReservedRow.staleCount` is producer liveness, a different
   * question, and the golden fixture pins it at 0 for a morning with 41 stale
   * facts in it), so this line still cannot state a count. What changed is WHO
   * wrote the sentence that says so. The packet authored a paragraph explaining
   * the pipeline to a customer; the designer replaced it with one clause and
   * the owner ratified it, so the bytes now come from
   * `situation-headlines.js` §4 through the generator, like every other
   * ratified string on this surface.
   *
   * THE KEY STAYS HERE ON PURPOSE. `AUTHORED` is the single gate-extractable
   * home for this surface's copy, and a report that extracts it must still find
   * the drift line — moving the key out would make the object one entry shorter
   * without making the surface one sentence more honest. It is one sentence
   * shorter, not one mechanism looser: the value is now ratified, and the
   * provenance is stated here rather than implied by the object's name.
   */
  DRIFT_NO_COUNT: FRESHNESS.now,
  /** WHAT is needed of the user, from `PendingGate.awaits`. J-Glance's key step. */
  NEEDS_YOUR: 'Needs your ',
} as const;

// ---------------------------------------------------------------------------
// The counts, and the accounting line generated from them
// ---------------------------------------------------------------------------

/**
 * The three numbers the arrival is about.
 *
 * `needsYou` IS the rail badge. XD-23: the ambient badge counts situations
 * currently escalating — an instrument, not an inventory — which is the waiting
 * column's length and nothing else. The changed column has no badge because
 * nothing in it needs anyone.
 */
export interface ArrivalCounts {
  needsYou: number;
  changed: number;
  dark: number;
}

export function arrivalCounts(triage: TriageView, inbox?: NowInboxRead): ArrivalCounts {
  return {
    // WP-54 · ITEM 1 — THE BADGE COUNTS THE ROWS. It counted `waiting.length`
    // while the surface rendered `waiting` PLUS every inbox item, deduplicated
    // against nothing: seven on the badge, twelve on the screen. It is now the
    // length of the one list, derived by the one function that builds it, so the
    // two cannot differ — there is nothing for them to differ ABOUT.
    needsYou: nowRows(triage, inbox).length,
    changed: triage.changed.length,
    dark: triage.reserved.dark.length,
  };
}

// ---------------------------------------------------------------------------
// WP-54 · ITEM 1 — ONE LIST, BUILT ONCE
// ---------------------------------------------------------------------------

/**
 * What this module needs of the Inbox. A subset of the surface's own prop, so a
 * caller that has the prop can pass it and a caller that has nothing passes
 * nothing.
 *
 * ABSENT IS A REAL STATE and it is not the same as empty (the rule this surface
 * inherited from the tab it replaced): a triage read without an inbox renders
 * the situation rows alone, which is what it did before the collapse. A FAILED
 * read is likewise not an empty one — it contributes no rows here and the
 * surface renders its own failure row, because "nothing needs you when we
 * simply could not look" is the worst thing this screen can say.
 */
export interface NowInboxRead {
  loaded: boolean;
  failed: boolean;
  items: InboxItem[];
}

/**
 * One row of the Now list.
 *
 * `situation` and `item` are not alternatives on every row: a situation row that
 * DEDUPLICATED an inbox item carries both, because the inbox item's affordances
 * — its evidence, and the fact that a decision is still open on it — belong on
 * the row the user actually sees. A row with only an item is one the fold does
 * not hold.
 */
export interface NowRow {
  key: string;
  situation: Situation | null;
  item: InboxItem | null;
  tier: ConsequenceTier | null;
  door: RowDoor | null;
}

/**
 * WP-54 · ITEM 1 — DOES THIS INBOX ITEM AND THIS SITUATION NAME ONE THING?
 *
 * THREE FACTS, ALL REQUIRED, and the host composed the situation's half (see
 * `SituationSignature`). Any two of them collide in the real data: every site
 * can carry `FS-01`, four findings sit on one site, and a producer is an agent
 * rather than an event. The Inbox's `scope` is namespaced (`name:<site>`), so
 * the target is compared against BOTH that value's tail and the label — the
 * label is what a person reads and the scope is what the store keys on, and a
 * match on either is a match on the same fact.
 *
 * A situation with no signature matches nothing, which is the correct answer for
 * every run row: nothing in the Inbox is a run.
 */
export function sameThing(situation: Situation, item: InboxItem): boolean {
  const signature = situation.signature;
  if (!signature) return false;
  if (signature.fact !== item.code) return false;
  if (signature.producer !== normalizeProducerId(item.source)) return false;
  const scoped = item.scope.includes(':') ? item.scope.slice(item.scope.indexOf(':') + 1) : item.scope;
  return signature.target === scoped || signature.target === item.scopeLabel;
}

/**
 * THE NOW LIST. Every row the screen draws, deduplicated, in order.
 *
 * The rule, in the owner's words: *an inbox item matching a situation
 * contributes its affordance to that row; one with no match is its own row.* So
 * a finding the platform recorded twice — once as a ledger incident, once as an
 * Inbox card — is ONE row carrying both records, and an Inbox item the fold
 * cannot yet represent still reaches the person it is addressed to.
 *
 * ORDER, AND ITS HONEST LIMIT. The situations arrive already ranked by the
 * consequence order; the unmatched inbox rows follow them, unranked, because the
 * fold does not hold them and nothing else may assign a tier to a row it did not
 * derive. On the owner's fleet that is exactly one row — `auth-probe could not
 * finish a run`, the ratified `agent.stuck` class no producer emits yet
 * (WP-54a). When that producer lands, the row arrives as a situation, this
 * function deduplicates the inbox card onto it, and the row takes its ratified
 * place in the order with no change here and no change in the count.
 */
export function nowRows(triage: TriageView, inbox?: NowInboxRead): NowRow[] {
  const items = inbox && inbox.loaded && !inbox.failed ? inbox.items : [];
  const matched = new Set<number>();

  const rows: NowRow[] = triage.waiting.map((situation) => {
    const item = items.filter((candidate) => sameThing(situation, candidate))[0] ?? null;
    if (item) matched.add(item.id);
    return { key: situation.id, situation, item, tier: situation.tier, door: situation.door };
  });

  for (const item of items) {
    if (matched.has(item.id)) continue;
    rows.push({
      key: `inbox-${item.id}`,
      situation: null,
      item,
      tier: null,
      // The agent that raised it is where it is answered. `source` is the agent
      // id, which is the destination's own name — nothing here invents one.
      door: {
        label: fillSituationSentence(DOORS.agent, { agentId: item.source }),
        kind: 'agent',
        target: item.source,
      },
    });
  }

  return rows;
}

/**
 * THE LIST VERDICT, over the list actually rendered.
 *
 * It calls the HOST'S OWN composer with the count of rows the fold does not
 * hold, so there is still exactly one place the sentence is composed and one
 * number in it. Recomposing it here with a template of its own would be the
 * second-place-the-wording-lives defect the generators exist to prevent; asking
 * the host for a sentence about seven rows and drawing eight would be item 1
 * again, one line higher.
 */
export function nowVerdict(triage: TriageView, inbox?: NowInboxRead): string {
  const unheld = nowRows(triage, inbox).filter((row) => row.situation === null).length;
  return listVerdict(triage.waiting, unheld);
}

/**
 * WP-54 · ITEM 3 — THE SEVERITY STRIPE. Three pixels, and it encodes TIER.
 *
 * Red at 1, orange at 2, grey at 3, and **nothing at 4** — the section a tier-4
 * row renders in already says what it is, so a stripe there would be decoration
 * competing with the only three that mean something.
 *
 * THE GUARD, RATIFIED WITH THE STRIPE: it must never drift into a severity
 * scale. This function's ONLY argument is the tier, which is the strongest form
 * that guard can take — there is no severity in scope for it to drift towards.
 * It matters more now that severity is confirmed present in the incident
 * payload: a coalesced headline may name its highest-SEVERITY member while the
 * stripe encodes the highest-TIER one, and those are different facts on purpose.
 *
 * Driven DIRECTLY across its whole domain by its pins, tier 3 included, which no
 * producer can currently reach — WP-46's rule that a render test cannot pin a
 * guard the render never reaches.
 */
export function stripeColour(tier: ConsequenceTier | null): string | null {
  if (tier === 1) return COLOURS.tier1;
  if (tier === 2) return COLOURS.tier2;
  if (tier === 3) return COLOURS.tier3;
  return null;
}

// ---------------------------------------------------------------------------
// WP-49 · XD-27 RIDER 1 — MEASURED, AND NOT BUILT. The finding is the delivery.
// ---------------------------------------------------------------------------
//
// The rider: "an in-flight run needing nothing goes to Nothing-needed-of-you as
// ONE LINE with its door, and PROMOTES ITSELF into the list when it stalls or
// reaches a gate — the consequence order doing its job, not a new mechanism."
//
// THE STARTING STATE IT DESCRIBES CANNOT BE PRODUCED BY THE FOLD. Measured
// against the real registry, 2026-08-20, three ways:
//
//  1. **A session with a document always has a gate.** `deriveGate` takes the
//     first checkpoint whose state is `active`; a run with no active checkpoint
//     is a run whose every checkpoint is attested or narrative, which
//     `deriveStatus` calls `complete` and the fold files under `changed`. So
//     "in flight, no gate" has no representation while a document is present.
//  2. **`awaits: 'evidence'` is not "needs nobody".** It is the designer's own
//     class 2 — "A backup step is waiting on evidence from you" — and it is
//     also what a HALTED run carries: the morning's Charlie is `status:
//     'halted'` at `cp.verify` with `awaits: 'evidence'`. One value, two
//     opposite meanings, and `Situation` carries no `status` to separate them.
//  3. **The one gateless waiting session is `documentUnavailable`** — XD-26's
//     6c, where the platform names its own limit. Filing that under "nothing
//     needed of you" would be the platform quietly deciding that a run it
//     cannot place needs no one, which is the opposite of what 6c is for. And
//     `documentUnavailable` is a `SessionRow` field the `Situation` does not
//     carry either, so a surface cannot even recognise it to refuse it.
//
// So the promotion has nothing to promote FROM, and every reachable session
// shape belongs in the list exactly where the fold already put it. Building the
// predicate anyway would have moved the 6c rows — the measurement's own third
// finding — into the section for things that need nobody.
//
// ESCALATED, NOT ROUTED AROUND (the launch instruction's own rule for a host
// fact the contract lacks). `needsNothingOfYou.test.ts` pins the three findings
// against the real fold so the day the contract gains the fact, the pin fails
// and says the rider is now buildable. `TriageView.verdict` is therefore
// rendered as the fold composed it — the purest form of "reuse the one
// composition", because nothing recomposes it at all.


/**
 * "2 need you · 1 changed overnight · 3 checks dark" — one breath, three counts.
 *
 * TWO DIVERGENCES FROM THE SHEET'S RENDERING, both deliberate and both raised at
 * the gate rather than smoothed over. (1) The designer's line spells the third
 * count as a word ("three checks dark") while spelling the first two as
 * numerals; a word for one arbitrary count needs a number-to-word table, which
 * is authored vocabulary by another name, so all three are numerals here.
 * (2) DEFERRALS ARE NOT STATED, because XD-23 asks the accounting line to state
 * them and the query contract carries no deferral field — there is nothing on
 * `Situation`, `SessionRow` or `TriageView` that could hold one. Rendering a
 * deferral count would be inventing it.
 */
export function accountingLine(counts: ArrivalCounts): string {
  return [
    // WP-54 · ITEM 9 — THE NEEDS-YOU COUNT IS NOT HERE ANY MORE. It was on the
    // badge, in this line and in the verdict: "7 need you · 0 changed overnight
    // · 0 checks dark" above "7 things need you, and none of them has changed
    // anything yet". The verdict is the one that says something, so it keeps the
    // number and this line stops repeating it.
    //
    // WP-54 · ITEM 9 — AND A ZERO IS NEVER ENUMERATED. "0 checks dark" was
    // contradicted two lines below by the reserved row saying nothing was dark.
    // A clause about nothing is a clause that should not be there, so each one
    // renders only when its own count is real — and on a quiet morning this line
    // is empty, which the header renders as no line at all.
    counts.changed > 0 ? fillSituationSentence(ACCOUNTING.changed, { count: counts.changed }) : '',
    // WP-54 · ITEM 10 — "checks dark" was jargon, and this is the plain
    // sentence. It states the count and stops: a DARK producer is one that has
    // NEVER reported, so there is no duration to put after it and the "in 9
    // hours" the review asked for would have to be invented. See the gate
    // report — the clause says what is true and nothing more.
    counts.dark > 0 ? fillSituationSentence(ACCOUNTING.dark, { count: counts.dark }) : '',
  ].filter(Boolean).join(SEP);
}

/**
 * "You were away 12 hours" — the headline about the USER's absence.
 *
 * The absence is the one fact on this surface the ledger cannot supply: it is
 * about when this person last looked at this surface, which is the surface's
 * own business. `awayMs` therefore comes from the component's own stamp, and
 * `null` — the first open — produces the honest sentence rather than a zero.
 */
export function awayHeadline(awayMs: number | null): string {
  if (awayMs === null || !Number.isFinite(awayMs) || awayMs < 0) return AUTHORED.AWAY_UNKNOWN;
  const hours = Math.floor(awayMs / 3_600_000);
  // WP-54 · ITEM 9 — NO AWAY-LINE AT ALL UNDER AN HOUR.
  //
  // "You were away 0 hours" was ruled against once and shipped anyway. The
  // reason it is an EMPTY STRING rather than a rounded-up "1 hour" or a
  // minutes-and-seconds sentence: an absence of under an hour is not news, and
  // the alternatives are a false number and a sentence about nothing. The
  // header renders no element for an empty headline, so the screen opens on the
  // verdict — which is what the person came for.
  if (hours < 1) return '';
  return `${RETURN_COPY.AWAY_PREFIX}${hours} ${RETURN_COPY.AWAY_UNIT}${RETURN_COPY.AWAY_SUFFIX}`;
}

/**
 * The drift line. Renders the count and where the facts live — when a count exists.
 *
 * T5 leaves the list (§4a tear 1) and this line is where it went. `count` is
 * `null` in the shipped product today; see `AUTHORED.DRIFT_NO_COUNT`.
 */
export function driftLine(count: number | null): string {
  const head = count === null
    ? AUTHORED.DRIFT_NO_COUNT
    : `${count} ${RETURN_COPY.DRIFT_COUNTED}`;
  return `${head} ${RETURN_COPY.DRIFT_REST}`;
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

/**
 * WHERE the user is needed — "Waiting at cp.approval — 3 of 8 in rb.remediate".
 *
 * J-Return's sharpest must-not is "a needs-you row that knows THAT but not
 * WHERE", so every field in this sentence is `PendingGate`'s and the checkpoint
 * id is rendered as an id, never softened into a description of one.
 *
 * DIVERGENCE FROM THE SHEET, raised at the gate: the designer's row reads
 * "in remediate", the runbook id with its `rb.` prefix dropped for prose. This
 * renders `runbookId` verbatim, because an id cited in full is the property the
 * refusals and the Govern matrix both hold to, and a trimmed id is a second
 * spelling of the same thing.
 */
export function gateLine(gate: PendingGate): string {
  return (
    `${RETURN_COPY.GATE_PREFIX}${gate.checkpointId}` +
    `${RETURN_COPY.GATE_POSITION_SEP}${gate.index}${RETURN_COPY.GATE_OF}${gate.of}` +
    `${RETURN_COPY.GATE_IN}${gate.runbookId ?? gate.capability}`
  );
}

/** What is needed of the user, from the gate's own `awaits`. */
export function needsLine(gate: PendingGate): string {
  return `${AUTHORED.NEEDS_YOUR}${gate.awaits}`;
}

/**
 * The standing approval's sentence, WRITABLE FROM THE PAYLOAD ALONE.
 *
 * That is XD-26's requirement on the contract and it is tested at this
 * function: the checkpoint id and the moment are the only inputs, so a
 * `PendingApproval` is sufficient and a boolean would not be. Returns null for
 * anything that is not a standing approval — a pending gate is asked at the
 * gate card, and a denial is not consent to render as standing.
 */
export function standingApprovalSentence(approval: PendingApproval): string | null {
  if (approval.state !== 'approved') return null;
  if (!approval.decidedAt) return null;
  return (
    `${RETURN_COPY.STANDING_APPROVAL_PREFIX}${approval.decidedAt}` +
    `${RETURN_COPY.STANDING_APPROVAL_SUFFIX}`
  );
}

/** Every approval that stands from before the excursion. Never re-asked. */
export function standingApprovals(row: SessionRow): PendingApproval[] {
  return row.approvals.filter((a) => a.state === 'approved');
}

// ---------------------------------------------------------------------------
// The re-entry's declared block
// ---------------------------------------------------------------------------

/**
 * A `SessionRow`'s checkpoints, in the shape the SHIPPED densities' own model
 * functions take.
 *
 * NOT A DERIVATION — a reconstitution, so that one implementation of the marks
 * discipline serves the companion, the stage and this sheet. `verifiableCount`
 * is computed here by the identical expression `procedureView` uses
 * (`attest !== 'narrative'`), over the identical `CheckpointState[]` the fold
 * handed over; it is arithmetic on supplied data, not a second opinion about
 * what the record says.
 *
 * THREE FIELDS THE QUERY CONTRACT DOES NOT CARRY, and they arrive null rather
 * than guessed: `version`, `strictness` and `armedBy`. `referenceLine` will
 * therefore render the runbook id alone where the shipped densities render
 * "rb.x · v1.2.0 · marked strict". That is an honest absence, and it is raised
 * at the gate as a measured limit of the contract rather than papered over with
 * a default.
 */
export function declaredFromSession(row: SessionRow): DeclaredProcedure {
  const checkpoints = row.checkpoints ?? [];
  return {
    capability: row.capability,
    runbookId: row.runbookId,
    version: null,
    strictness: null,
    hash: row.runbookHash,
    armedBy: null,
    checkpoints,
    verifiableCount: checkpoints.filter((c) => c.attest !== 'narrative').length,
    communication: [],
  };
}

/**
 * The checkpoint the cursor sits at, or null.
 *
 * Read from the GATE the fold supplied, then located in the declared list by
 * id. The position is never inferred from how many checkpoints are attested —
 * that is the inference XD-26's marks discipline exists to replace.
 */
export function cursorCheckpointId(row: SessionRow): string | null {
  return row.gate?.checkpointId ?? null;
}

/**
 * 6c · the arm cannot be established.
 *
 * TRUE FOR TWO SHAPES, and both are the platform's own limit rather than a
 * procedure state: the registry folded the session but holds no document
 * matching its pinned hash (`documentUnavailable`), or the registry has no such
 * session at all (`row === null` — the id resolved to nothing). Neither of them
 * is the label XD-26 forbids, which would name a thing that has no name here.
 */
export function armUnestablished(row: SessionRow | null | undefined): boolean {
  if (!row) return true;
  return row.documentUnavailable === true;
}

// ---------------------------------------------------------------------------
// Small readers the columns use
// ---------------------------------------------------------------------------

/** The reserved slot is ONE row, whatever the counts say (§4a tear 3). */
export function reservedDetail(reserved: ReservedRow): string {
  return reserved.dark
    .map((d) => (d.detail ? `${d.label} ${d.detail}` : d.label))
    .join(SEP);
}

/**
 * THE META LINE — every short fact about a row, in one breath, as text.
 *
 * WP-48 moved the status phrase and the parts chip here, off the badge: a badge
 * carries one word, and everything that is a phrase belongs on a line where a
 * phrase reads. `state` and `meta` arrive composed from the host; `ageLabel` is
 * the fold's own; `places.summary` is derived. Nothing here is authored.
 *
 * IT LIVES IN THE MODEL RATHER THAN IN THE COMPONENT for the reason `gateLine`
 * does: the eval that proves this surface renders no prose has to be able to
 * ask "could the surface have produced this string?", and it can only answer by
 * calling the same function the surface called. A composition inlined in the
 * component is a sentence-producing path the accounting cannot reach, which
 * reads to that check as authored prose — correctly, because a path nothing can
 * enumerate is a path that could contain anything.
 */
export function metaLine(situation: Situation, now: Date): string {
  return [
    situation.places.summary,
    ageLabel(situation.since, now),
    situation.state,
    situation.meta,
    situation.parts.length > 1 ? `${situation.parts.length} ${RETURN_COPY.PARTS_CHIP}` : '',
  ].filter(Boolean).join(SEP);
}

/** A situation's session id, when it has one. The re-entry's only input. */
export function promotableSessionId(situation: Situation): string | null {
  return situation.kind === 'session' ? (situation.sessionId ?? null) : null;
}
