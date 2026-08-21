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

export const SITUATION_COPY_SHAPE_VERSION = 1;

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
  /** ONE WORD, or empty. A badge never carries a sentence. */
  chip: string;
  /** A status phrase for the meta line, or empty. */
  state: string;
  /** The meta line's identifier slot. */
  meta: string;
  /** The tier and why, in the designer's words. See the composer for why the
   * rendered rule line reads this on a ratified card (WP-52 item 3) and
   * `Situation.tierReason` on a derived one. */
  rule: string;
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
    chip: 'Waiting',
    state: 'nothing written yet',
    meta: '{runbookId}',
    rule: 'Tier 2 · the world is untouched',
  },
  {
    id: 'run.waiting.mid-procedure',
    guard: 'row.kind === "run" && done === 0 && failed === 0 && gate !== null',
    headline: 'A {checkpoint} step is waiting on your {awaits}',
    ask: 'Waiting at {checkpoint}, {position}. Nothing has been written yet, so stopping here costs nothing.',
    chip: 'Waiting',
    state: 'nothing written yet',
    meta: '{runbookId}',
    rule: 'Tier 2 · the world is untouched',
  },
  {
    id: 'run.waiting.part-changed',
    guard: 'row.kind === "run" && (done > 0 || failed > 0) && gate !== null',
    headline: '{done} of {total} are changed and the rest are waiting on you',
    ask: 'Waiting at {checkpoint}, {position}. {failed} failed. Continue, or stop and keep what is standing.',
    chip: 'Mid-change',
    state: '',
    meta: '{runbookId}',
    rule: 'Tier 1 · mid-change, only you can move it',
  },
  {
    id: 'incident.no-run',
    guard: 'row.kind === "incident" && row.runId === null',
    headline: '{finding} on {target}, and nothing is fixing it',
    ask: 'Contain it now, or say why not. Nothing has been written under a procedure.',
    chip: '',
    state: 'No run attached',
    meta: '{producer}',
    rule: 'Tier 1 · nothing is holding it back but you',
  },
  {
    id: 'agent.stuck',
    guard: 'row.kind === "agentFailure"',
    headline: '{agentId} could not finish a run',
    ask: 'It timed out after {timeout}. Retry it, or leave it stopped.',
    chip: 'Stuck',
    state: '',
    meta: '{agentId}',
    rule: 'Tier 3 · the agent is asking, not the fleet',
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
  then: 'Nothing is needed of anyone, so nothing is in this list — each one carries its own date where it lives.',
} as const;
