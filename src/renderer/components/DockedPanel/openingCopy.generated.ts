/**
 * GENERATED — DO NOT EDIT. `npm run fixtures:opening-copy`.
 *
 * WP-49 · the Now screen's chrome and the docked panel's opening state,
 * extracted verbatim from the designer's own sheet by
 * `scripts/generate-opening-copy.ts`:
 *
 *   docs/intelligence/from-designer/from-designer-11-now-screen.md
 *
 * Editing this file by hand is the defect the generator exists to prevent: it
 * would make the surface a SECOND place the ratified wording lives, free to
 * drift from the sheet that ratified it. `npm run fixtures:opening-copy:check`
 * fails closed on a stale copy.
 *
 * `{slot}` braces are HOST FIELD NAMES, filled by `fillSituationSentence` from
 * values the fold already derived — the same filler the row headlines use, so a
 * slot cannot mean one thing in a headline and another in an ask.
 */

export const OPENING_COPY_SHAPE_VERSION = 1;

/**
 * The sentence that FOLLOWS the opening line in §5's blockquote.
 *
 * The opening line itself is `TriageView.verdict` — composed once in
 * `sessionRegistry` (WP-48) and read here, never recomposed. §5's blockquote
 * paraphrases that verdict before inviting the question; only the invitation
 * is extracted, so the panel and the list cannot say the count differently.
 */
export const PANEL_INVITATION = 'Ask about any of them, or about the fleet.';

/**
 * THE OPENING ASKS THE SHEET SUPPLIES, keyed by the situation class that
 * selects them — `situation-headlines.js`'s own ids.
 *
 * ONE ENTRY, and the count is the finding rather than an oversight. §5 gives
 * three asks; two of them name a run noun and a site that `Situation` does not
 * carry, so they cannot be filled from the query contract and cannot be split
 * into templates out of the designer's own bytes. Those two are AUTHORED, in
 * `openingAsksModel.ts`, where every authored sentence on this surface is
 * declared in one gate-extractable place.
 */
export const OPENING_ASKS: Readonly<Record<string, string>> = {
  'run.waiting.mid-procedure': 'What does {checkpoint} need from me?',
  'run.waiting.nothing-written': 'Why has {runNoun} changed nothing?',
};

/**
 * The scope line beneath the composer, in the three spans the designer marked.
 *
 * "A question with no stated subject is the panel's most common failure, and
 * stating it is cheaper than asking." `FLEET` is the SCOPE VALUE — the span a
 * site name replaces when one is pinned — and `ACTION` is the control beside
 * it. Splitting on the sheet's own emphasis marks is what keeps all three
 * verbatim.
 */
export const SCOPE_LINE = {
  LEAD: 'Asking about',
  FLEET: 'the whole fleet',
  ACTION: 'Choose a site',
  SEP: ' · ',
} as const;

/**
 * The Now screen's own chrome.
 *
 * `NOTHING_NEEDED_HEAD` is §2's section — "a section, not a footnote" (§3) —
 * and the two answers are the Inbox cards' own, which §3 moves onto the rows
 * in place. They are extracted rather than retyped for the same reason every
 * other string here is: a hand-typed button label is a second place the
 * vocabulary lives.
 */
export const NOW_COPY = {
  NOTHING_NEEDED_HEAD: 'Nothing needed of you',
  APPROVE: 'Approve',
  NOT_NOW: 'Not now',
} as const;
