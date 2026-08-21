/**
 * WP-49 · ITEM 4 — the docked panel's opening state, drawn from the queue.
 *
 * "The highest-frequency surface in the product opens on a blank. Its asks
 * should come from the queue beside it" (addon audit §2, item 4). This module is
 * that derivation, and it is display shaping in `arrivalModel.ts`'s exact sense:
 * it reads a `TriageView` the fold already composed and picks sentences out of
 * it. It computes no verdict, ranks nothing, and re-derives nothing.
 *
 * THREE RULES LIVE HERE:
 *
 *  1. **The opening line is the fold's own list verdict.** `TriageView.verdict`
 *     is composed ONCE in `sessionRegistry` from the very rows the Now list
 *     renders (WP-48). The panel reads it. A second composition of the same
 *     sentence — even from the same numbers — is a channel the two can drift
 *     down, and the drift would be invisible: two true-looking sentences about
 *     one list, disagreeing.
 *  2. **The asks come from the VISIBLE ROWS, by situation class.** One ask per
 *     class, in the order the consequence order already put the rows in, capped
 *     at three (§5: "Three opening asks, each answerable from the queue on
 *     screen"). A class with no row on screen contributes no ask, so the panel
 *     can never offer a question about something the reader cannot see.
 *  3. **A slot the record cannot fill withholds the ask entirely.** Not a brace
 *     rendered as six literal characters, and not a shortened sentence with a
 *     hole where the subject was: `fillSituationSentence` would render the gap
 *     empty, so the check is made HERE, before the fill, and the ask is dropped.
 *
 * THE MEASUREMENT BEHIND `AUTHORED`, AND THE HALF OF IT WP-50 RETIRED. §5
 * supplies three asks. At WP-49 only one — "What does cp.backup need from me?" —
 * carried a value the query contract could supply (`cp.backup` is
 * `PendingGate.checkpointId`), so only that one was split into a template out of
 * the designer's own bytes. The other two named facts `Situation` did not carry,
 * and both were escalated at that gate rather than routed around:
 *
 *  - "Why has **the update run** changed nothing?" needs the run noun, which is
 *    `RUN_NOUN[capability]`. **RETIRED AT WP-50** — WP-49a put `capability` on
 *    `Situation`, so the ask is extracted from §5's own bytes again
 *    (`openingCopy.generated.ts`) and its authored stand-in is GONE. This is the
 *    retirement the WP-49 ruling named: "BOTH retire when WP-49a lands, because
 *    the run noun they actually want is derivable from ratified vocabulary."
 *  - "Are the four findings on **theawfulpm-test** related?" needs the incident's
 *    target entity id AND a count of siblings. `Situation.places` answers WHERE a
 *    target is, not what it is called, and the four real findings do not coalesce
 *    (WP-48a's registered debt), so nothing on the contract can supply the count
 *    either. **STILL AUTHORED, still gate-held**, and still escalated.
 *
 * So the authored set falls from three to two, and the two that remain are the
 * one §5 never supplied (`part-changed`) and the one the contract still cannot
 * fill (`incident.no-run`). Both now name the run in the RATIFIED vocabulary
 * where they name it at all — no `{runbookId}` stands in for a run noun anywhere
 * on this surface.
 */
import type { Situation, TriageView } from '../../../main/intelligence-host/sessionRegistry';
import { RUN_NOUN } from '../../../main/intelligence-host/situationCopy.generated';
import { fillSituationSentence } from '../../../main/intelligence-host/sessionRegistry';
import type { SlotBag } from '../../../main/intelligence-host/sessionRegistry';
import { OPENING_ASKS, PANEL_INVITATION } from './openingCopy.generated';
import { nowVerdict, type NowInboxRead } from '../return/arrivalModel';

/**
 * THIS SURFACE'S AUTHORED COPY, IN ONE PLACE AND NAMED — `arrivalModel.ts`'s
 * discipline, so a gate report extracts every sentence mechanically instead of
 * a human reading the tree for stray prose.
 *
 * Each entry is an opening ask for a situation class the position document does
 * not supply a fillable sentence for, and each is keyed by the class id
 * `situation-headlines.js` gives it. Every one is GATE-HELD: it renders on this
 * branch so the surface can be seen and driven, and it does not merge until it
 * is ruled.
 *
 * The slots are deliberately the narrowest the contract can guarantee.
 * `{runbookId}` is `Situation.meta` on a session row — the identifier the meta
 * line already prints, cited in full rather than trimmed for prose, which is the
 * property `gateLine` and the Govern matrix both hold to.
 */
export const AUTHORED = {
  /**
   * Generalised from §5's "Are the four findings on theawfulpm-test related?" —
   * the count and the site both dropped rather than guessed. The class means
   * exactly "an open finding with no run attached", so the question the row
   * raises can be asked without naming either.
   */
  'incident.no-run': 'Why is nothing fixing the open findings?',
  /**
   * WP-55 · THE SAME SENTENCE, FOR THE CLASS §5's BULLET WAS ACTUALLY ABOUT.
   *
   * `incident.coalesced` became reachable when its four host fields landed, and
   * the ask map is asserted to cover every reachable class. **No new sentence is
   * authored for it, and that is a reading rather than a shortcut.** §5's own
   * bullet is *"Are the four findings on theawfulpm-test related?"* — a COUNT
   * and a SITE, which is the coalesced case described exactly; the entry above
   * generalised it by dropping both so it could serve the singleton class that
   * existed at the time. The generalised sentence is true of both classes: an
   * open finding with no run attached raises the same question whether it stands
   * alone or with three siblings.
   *
   * Authoring a second sentence here would be a second place the same question
   * lives, and the copy discipline's whole content is that a class the ratified
   * set does not cover gets the derived form, never new prose.
   */
  'incident.coalesced': 'Why is nothing fixing the open findings?',
  /**
   * NOT SUPPLIED BY THE POSITION DOCUMENT AT ALL. §5 draws a morning with no
   * part-changed row in it, and this is the class whose row matters most when it
   * appears — a part-changed world compounding against an untouched one.
   *
   * WP-50: its subject moves from `{runbookId}` to `{runNoun}`. The sentence is
   * still authored — no §5 bullet supplies it — but it no longer puts a
   * PROCEDURE IDENTIFIER where a run noun belongs, which is what made the
   * interim form interim. The frame is this packet's; every word inside the
   * brace is the ratified vocabulary's.
   */
  'run.waiting.part-changed': 'What has {runNoun} already changed?',
} as const;

/**
 * `agent.stuck` is deliberately absent, and it is absent because it is
 * UNREACHABLE rather than because it was forgotten.
 *
 * The fold builds situations from sessions (`kind: 'run'`) and from orphan
 * incidents (`kind: 'incident'`); nothing constructs `kind: 'agentFailure'`, so
 * `guardHolds`'s fifth arm never selects and no row on any screen can report
 * `headlineTemplate === 'agent.stuck'`. An ask for it would be a sentence
 * written for a row that cannot exist — copy with no reader, and one more thing
 * to keep true.
 */
export const UNREACHABLE_CLASSES = ['agent.stuck'] as const;

/** One offered question: the sentence, and the row it was drawn from. */
export interface OpeningAsk {
  /** The situation class that supplied it — the ask's key and its audit trail. */
  classId: string;
  /** The row it was derived from, so a consumer can say which one it is about. */
  situationId: string;
  text: string;
}

/** §5: "Three opening asks, each answerable from the queue on screen." */
export const MAX_OPENING_ASKS = 3;

/**
 * The bag an ask's slots are filled from.
 *
 * EVERY VALUE IS A FIELD OF THE ROW, read and not recomputed. `runbookId` is
 * `meta` and only on a session row: on an incident row `meta` is the PRODUCER,
 * and filling a runbook slot from a producer would put one fact in another's
 * sentence — the name collision that cost WP-48 a gate round.
 */
export function askBag(situation: Situation): SlotBag {
  return {
    checkpoint: situation.gate?.checkpointId,
    position: situation.gate ? `${situation.gate.index} of ${situation.gate.of}` : undefined,
    runbookId: situation.kind === 'session' ? situation.meta || undefined : undefined,
    runNoun: runNounInSentence(situation.capability),
    done: situation.written.done,
    failed: situation.written.failed,
    total: situation.written.total ?? undefined,
  };
}

/**
 * The ratified run noun, mid-sentence — `RUN_NOUN[capability]` with ONE
 * mechanical transform and no new words.
 *
 * Controlled Vocabulary v1.4's nouns are written to HEAD a sentence ("A plugin
 * update run has waited 60 hours and changed nothing"), so they carry a capital
 * article. §5's ask puts the noun in the middle ("Why has the update run changed
 * nothing?"), where that capital is a rendering artifact rather than a word. The
 * transform is lowercasing the FIRST CHARACTER and nothing else — it invents no
 * vocabulary, and it is skipped when the second character is also uppercase so
 * an acronym is never damaged.
 *
 * A capability the vocabulary does not name returns `undefined`, and
 * `openingAsks` then WITHHOLDS the ask entirely rather than shortening it. That
 * is the module's third rule, unchanged: a sentence with its subject filled in
 * as empty is a different sentence.
 */
export function runNounInSentence(capability: string | undefined): string | undefined {
  if (!capability) return undefined;
  const noun = RUN_NOUN[capability];
  if (!noun) return undefined;
  if (noun.length > 1 && noun[1] === noun[1].toUpperCase() && noun[1] !== noun[1].toLowerCase()) {
    return noun;
  }
  return noun.charAt(0).toLowerCase() + noun.slice(1);
}

/** Every `{slot}` a template carries. */
function slotsOf(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]);
}

/**
 * The ask template for a class — the extracted one first, then the authored set.
 *
 * The order is the point: a sentence the designer's sheet supplies must never be
 * shadowed by one this packet wrote. If §5 ever grows an ask for a class that is
 * authored here, the generated entry wins on the next `fixtures:opening-copy`
 * run without anyone remembering to delete the authored one.
 */
export function askTemplateFor(
  classId: string,
  /**
   * The two sets, injectable — and injectable for one reason, which is the only
   * reason that justifies a seam like this.
   *
   * The rule this function encodes is a PRECEDENCE, and precedence is only
   * observable when both sides hold the same key. Today they never do: §5
   * supplies one class and the authored set covers three others, so swapping the
   * two lookups changes no output and a mutation that reversed them SURVIVED the
   * first battery — the rule was decoration. A render (or a caller) cannot pin a
   * guard it can never reach (WP-46), so the pin drives this directly with a
   * class in both, which no current data can supply.
   */
  extracted: Readonly<Record<string, string>> = OPENING_ASKS,
  authored: Readonly<Record<string, string>> = AUTHORED as Readonly<Record<string, string>>,
): string | null {
  if (Object.prototype.hasOwnProperty.call(extracted, classId)) return extracted[classId];
  if (Object.prototype.hasOwnProperty.call(authored, classId)) return authored[classId];
  return null;
}

/**
 * Up to three asks, drawn from the rows the reader can see.
 *
 * DEDUPED BY CLASS, in row order, so the panel offers three DIFFERENT questions
 * rather than the same question about three rows of one class — which is the
 * shape §5 drew: one ask about the update run, one about the findings, one about
 * the gate.
 *
 * A row whose `headlineTemplate` is null contributed no ratified class and gets
 * no ask: it is already rendering the fold's derived sentence because no
 * template's guard held or a headline slot could not be filled, and inventing a
 * question for it would be authoring at exactly the point the row is being
 * honest about not knowing.
 */
export function openingAsks(rows: readonly Situation[]): OpeningAsk[] {
  const asks: OpeningAsk[] = [];
  const seen = new Set<string>();
  for (const situation of rows) {
    if (asks.length >= MAX_OPENING_ASKS) break;
    const classId = situation.headlineTemplate;
    if (!classId || seen.has(classId)) continue;
    const template = askTemplateFor(classId);
    if (!template) continue;
    const bag = askBag(situation);
    // Withheld, not shortened: a sentence with its subject filled in as empty is
    // a different sentence, and a shorter one is not a safer one.
    if (slotsOf(template).some((slot) => bag[slot] === undefined)) continue;
    seen.add(classId);
    asks.push({ classId, situationId: situation.id, text: fillSituationSentence(template, bag) });
  }
  return asks;
}

/** What the panel opens on. Every field is read from the fold or extracted copy. */
export interface OpeningState {
  /** `TriageView.verdict` — the fold's, unchanged. Empty when nothing waits. */
  verdict: string;
  /** §5's invitation, which follows the verdict. */
  invitation: string;
  asks: OpeningAsk[];
}

/**
 * The panel's opening state, or null when there is nothing beside it to draw
 * from.
 *
 * Null is a real answer and not a failure: a triage with no waiting row produces
 * no verdict (`listVerdict` returns empty for an empty list — "a verdict about
 * an empty list is a claim about nothing") and no asks, and a panel that
 * announced an opening state anyway would be back to opening on a blank with
 * extra furniture around it.
 */
export function openingState(
  triage: TriageView | null | undefined,
  /**
   * WP-54 · ITEM 1 — the Inbox, so the panel's opening line counts the same rows
   * the list beside it draws.
   *
   * The panel and the Now list sit side by side on the designer's own sheet. If
   * the list heads eight rows and the panel opens "Seven things need you", the
   * screen contradicts itself in the space of one glance — which is item 1 again,
   * one surface over. Optional: a caller with no inbox gets the fold's own
   * sentence, unchanged.
   */
  inbox?: NowInboxRead,
): OpeningState | null {
  if (!triage) return null;
  const asks = openingAsks(triage.waiting);
  const verdict = nowVerdict(triage, inbox);
  if (!verdict && asks.length === 0) return null;
  return { verdict, invitation: PANEL_INVITATION, asks };
}
