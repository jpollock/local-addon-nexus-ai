/**
 * GENERATED — DO NOT EDIT. `npm run fixtures:situation-copy`.
 *
 * WP-48 · the ratified Now sentence set, extracted verbatim from the designer's
 * own file by `scripts/generate-situation-copy.ts`:
 *
 *   docs/intelligence/from-designer/fixtures/situation-headlines.js
 *
 * Editing this file by hand is the defect the generator exists to prevent: it
 * would make the composer a SECOND place the ratified wording lives, free to
 * drift from the file that ratified it. `npm run fixtures:situation-copy:check`
 * fails closed on a stale copy.
 *
 * `{slot}` braces are HOST FIELD NAMES, filled by `sessionRegistry`'s composer
 * from values the fold already derived. Nothing in this file computes anything,
 * which is the property that makes it copy rather than logic.
 */

export const SITUATION_COPY_SHAPE_VERSION = 3;

/**
 * Controlled Vocabulary v1.4 — the run-noun column.
 *
 * A second column on the capability rows v1.3 ratified as LABELS: same
 * referent, subject form. "Update plugins across sites" names an act and does
 * not nominalise into a headline's subject; "A plugin update run" does.
 */
export const RUN_NOUN: Readonly<Record<string, string>> = {
  'cap.bulk_plugin_update': 'A plugin update run',
  'cap.diagnose_site': 'A diagnosis',
  'cap.incident_containment': 'A containment run',
  'cap.incident_remediation': 'A remediation run',
  'cap.promote_environment': 'A promotion',
  'cap.promotion_preflight': 'A promotion check',
  'cap.wpe_pull': 'A site pull',
};

/** One ratified class: the guard that selects it, and every field it renders. */
export interface SituationTemplate {
  /** The class, as the designer names it. Reported on the row it composed. */
  id: string;
  /**
   * The selecting condition, in the designer's own words.
   *
   * Carried as TEXT, never evaluated in production — a composer that ran a
   * string from a file would be a code-execution surface in the main process.
   * `situationHeadlines.test.ts` evaluates each of these over a shared case
   * table and asserts the TypeScript selector agrees, which is this repo's
   * established way of pinning two copies of one rule together
   * (`resolveAgentCron`/`effectiveCadenceExpression`, `localDay`).
   */
  guard: string;
  /** The verdict. World state first. */
  headline: string;
  /** What is being asked of the reader, and what stopping costs. */
  ask: string;
  /**
   * ONE WORD, or empty. A badge never carries a sentence.
   *
   * ALWAYS EMPTY SINCE WP-54: the Waiting chip was cut as the designer's own
   * template error — chip-presence told the user which of OUR code paths ran —
   * and the cycle-seven sheet carries no chip on any class. The field survives
   * so every consumer is unchanged; a class that wants a badge again declares
   * one in the fixture and this stops being a constant.
   */
  chip: string;
  /**
   * THE ROW'S DOOR, and it names where it goes.
   *
   * "Open where you are needed" was ratified and failed its first contact with
   * a person. `{slot}` braces are filled by the same composer that fills a
   * headline's, and no door carries a terminal full stop — enforced for the
   * class in `scripts/control-label.ts`, because the period that shipped was
   * APPENDED by an extraction rather than written by anyone.
   */
  door: string;
  /** A status phrase for the meta line, or empty. */
  state: string;
  /** The meta line's identifier slot. */
  meta: string;
  /** The tier and why, in the designer's words. See the composer for why the
   * rendered rule line reads this on a ratified card (WP-52 item 3) and
   * `Situation.tierReason` on a derived one. The tier itself is the `{tier}`
   * SLOT, filled from the tier the row was RANKED at — see `tier` below. */
  rule: string;
  /**
   * WP-54 · THE CONSEQUENCE TIER THIS CLASS RANKS AT, declared once.
   *
   * The ranker reads this and the rule line renders the ranked value into its
   * own `{tier}` slot, so the tier a card DISPLAYS is the tier it was SORTED
   * BY — not by agreement between two derivations, but because there is one
   * number. The generator refuses a template whose rule line does not open
   * with that slot, which is what stops a literal tier creeping back in.
   */
  tier: number | null;
}

/**
 * The five classes, IN THE FIXTURE'S OWN ORDER.
 *
 * Selection is first-match, but the five guards are MUTUALLY EXCLUSIVE — no
 * input satisfies two, which `situationHeadlines.test.ts` proves by brute
 * force over the whole domain rather than by inspection. So the order does
 * not change which sentence a row gets. The generator refuses to emit a
 * reordered set anyway, because this array is the ratified artifact and a
 * change to it must reach a human rather than regenerate in silence.
 */
export const SITUATION_TEMPLATES: readonly SituationTemplate[] = [
  {
    id: 'run.waiting.nothing-written',
    guard: 'row.kind === "run" && done === 0 && failed === 0 && total === 0 && gate === null',
    headline: '{runNoun} has waited {age} and changed nothing',
    ask: 'It never received a target list, so it cannot start. Give it one, or close it.',
    state: 'nothing written yet',
    meta: '{runbookId}',
    rule: 'Tier {tier} · the world is untouched',
    door: 'Open the run',
    chip: '',
    tier: 2,
  },
  {
    id: 'run.waiting.mid-procedure',
    guard: 'row.kind === "run" && done === 0 && failed === 0 && gate !== null',
    headline: 'A {checkpoint} step is waiting on your {awaits}',
    ask: 'Waiting at {checkpoint}, {position}. Nothing has been written yet, so stopping here costs nothing.',
    state: 'nothing written yet',
    meta: '{runbookId}',
    rule: 'Tier {tier} · the world is untouched',
    door: 'Open the run at {checkpoint}',
    chip: '',
    tier: 2,
  },
  {
    id: 'run.waiting.part-changed',
    guard: 'row.kind === "run" && (done > 0 || failed > 0) && gate !== null',
    headline: '{done} of {total} are changed and the rest are waiting on you',
    ask: 'Waiting at {checkpoint}, {position}. {failed} failed. Continue, or stop and keep what is standing.',
    state: '',
    meta: '{runbookId}',
    rule: 'Tier {tier} · mid-change, only you can move it',
    door: 'Open the run at {checkpoint}',
    chip: '',
    tier: 1,
  },
  {
    id: 'incident.no-run',
    guard: 'row.kind === "incident" && row.runId === null && memberCount === 1',
    headline: '{finding} on {target}, and nothing is fixing it',
    ask: 'Contain it now, or say why not. Nothing has been written under a procedure.',
    state: 'No run attached',
    meta: '{producer}',
    rule: 'Tier {tier} · nothing is holding it back but you',
    door: 'Open {target}',
    chip: '',
    tier: 1,
  },
  {
    id: 'agent.stuck',
    guard: 'row.kind === "agentFailure"',
    headline: '{agentId} could not finish a run',
    ask: 'It timed out after {timeout}. Retry it, or leave it stopped.',
    state: '',
    meta: '{agentId}',
    rule: 'Tier {tier} · the agent is asking, not the fleet',
    door: 'Open {agentId}',
    chip: '',
    tier: 3,
  },
];

/**
 * The list verdict — one sentence about the whole list, which no single row
 * can say. Derived from the same rows the columns render, so it structurally
 * cannot disagree with them.
 */
export const LIST_VERDICT = {
  allUnwritten: '{needsYou} things need you, and none of them has changed anything yet',
  someChanged: '{needsYou} things need you, and {changedRuns} of them have already written somewhere',
} as const;

/**
 * The freshness line. `now` replaces the packet-authored paragraph that
 * explained the pipeline to a customer; `then` is the designer's existing
 * second sentence, which follows it unchanged.
 */
export const FRESHNESS = {
  now: 'Freshness is not being reported yet.',
  then: '',
} as const;

/**
 * WP-54 · THE DOORS. Every row has one, and every one names where it goes.
 *
 * "Open where you are needed" was ratified and failed its first contact with
 * a person. These name the destination from a fact the row already carries,
 * so a reader knows what the click costs before making it. `{slot}` braces
 * are filled by the same composer that fills a headline's.
 *
 * NONE CARRIES A TERMINAL FULL STOP, and that is enforced in the generator
 * for the class rather than checked for these five: the period that shipped
 * was APPENDED by an extraction, so a door added tomorrow would have taken
 * one too.
 */
export const DOORS = {
  runAtGate: 'Open the run at {checkpoint}',
  run: 'Open the run',
  incident: 'Open {target}',
  agent: 'Open {agentId}',
  backToNow: 'Back to Now',
} as const;

/**
 * WP-54 · THE SEVERITY STRIPE'S COLOURS, and the door's.
 *
 * Three pixels on a row's left edge: red at tier 1, orange at tier 2, grey at
 * tier 3. **There is no tier-4 colour and that is the ratified encoding** —
 * tier 4 takes no stripe, because the section it renders in already says what
 * it is. The guard that rides with the stripe: it encodes TIER and must never
 * drift into a severity scale.
 *
 * `link` is the door's colour. A door is a link; brand green is the product's
 * own mark and not a destination.
 */
export const COLOURS = {
  tier1: 'rgb(221,18,67)',
  tier2: 'rgb(255,97,25)',
  tier3: 'rgb(198,205,208)',
  link: 'rgb(0,107,214)',
} as const;

/**
 * WP-54 · THE RESERVED ROW, IN THE USER'S WORDS.
 *
 * "Reserved · the record's own health" was our noun for a thing the user
 * recognises as "is the platform watching my sites". The row's purpose is
 * untouched — XD-23's guaranteed seat, one row, unable to grow or be
 * scrolled away — and only its name and its good-news line changed.
 */
export const RESERVED = {
  head: 'Watching your sites',
  quiet: 'Everything is reporting.',
} as const;

/**
 * WP-54 · THE ACCOUNTING CLAUSES, each rendered only when its count is real.
 *
 * The needs-you count is NOT here: it is the verdict's, stated once. A zero
 * is never enumerated — "0 checks dark" was contradicted two lines below by
 * the reserved row saying nothing was dark.
 */
export const ACCOUNTING = {
  changed: '{count} changed overnight',
  dark: '{count} checks haven’t reported',
} as const;
