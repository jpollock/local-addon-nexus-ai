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
 * THE MEASUREMENT BEHIND `AUTHORED`, and why it is three sentences rather than
 * none. §5 supplies three asks. Only one of them — "What does cp.backup need
 * from me?" — carries a value the query contract can supply (`cp.backup` is
 * `PendingGate.checkpointId`), so only that one could be split into a template
 * out of the designer's own bytes; it is, in `openingCopy.generated.ts`. The
 * other two name facts `Situation` does not carry:
 *
 *  - "Why has **the update run** changed nothing?" needs the run noun, which is
 *    `RUN_NOUN[capability]` — and `Situation` carries no `capability`. Rendering
 *    the specimen unchanged would name an update run beside a containment run's
 *    row, which is the false-sentence class WP-48 built a tripwire for.
 *  - "Are the four findings on **theawfulpm-test** related?" needs the incident's
 *    target entity id. `Situation.places` answers WHERE a target is, not what it
 *    is called; the id reaches the row's headline through the fold's own bag and
 *    is not carried as a field.
 *
 * Both are escalated at the gate as contract gaps, not routed around. Until they
 * are ruled, the generalised sentences below are AUTHORED and gate-held.
 */
import type { Situation, TriageView } from '../../../main/intelligence-host/sessionRegistry';
import { fillSituationSentence } from '../../../main/intelligence-host/sessionRegistry';
import type { SlotBag } from '../../../main/intelligence-host/sessionRegistry';
import { OPENING_ASKS, PANEL_INVITATION } from './openingCopy.generated';

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
   * Generalised from §5's "Why has the update run changed nothing?" — the run
   * noun replaced by the runbook id, because the noun is not on the contract.
   * The question the specimen asks is unchanged; only its subject is one the
   * row can prove.
   */
  'run.waiting.nothing-written': 'Why has {runbookId} changed nothing?',
  /**
   * Generalised from §5's "Are the four findings on theawfulpm-test related?" —
   * the count and the site both dropped rather than guessed. The class means
   * exactly "an open finding with no run attached", so the question the row
   * raises can be asked without naming either.
   */
  'incident.no-run': 'Why is nothing fixing the open findings?',
  /**
   * NOT SUPPLIED BY THE POSITION DOCUMENT AT ALL. §5 draws a morning with no
   * part-changed row in it, and this is the class whose row matters most when it
   * appears — a part-changed world compounding against an untouched one.
   */
  'run.waiting.part-changed': 'What has {runbookId} already changed?',
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
    done: situation.written.done,
    failed: situation.written.failed,
    total: situation.written.total ?? undefined,
  };
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
export function askTemplateFor(classId: string): string | null {
  if (Object.prototype.hasOwnProperty.call(OPENING_ASKS, classId)) return OPENING_ASKS[classId];
  const authored = AUTHORED as Readonly<Record<string, string>>;
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
export function openingState(triage: TriageView | null | undefined): OpeningState | null {
  if (!triage) return null;
  const asks = openingAsks(triage.waiting);
  if (!triage.verdict && asks.length === 0) return null;
  return { verdict: triage.verdict, invitation: PANEL_INVITATION, asks };
}
