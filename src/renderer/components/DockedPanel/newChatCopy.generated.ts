/**
 * GENERATED — DO NOT EDIT. `npm run fixtures:new-chat-copy`.
 *
 * The new chat's ratified wording, extracted verbatim from the designer's own
 * fixture by `scripts/generate-new-chat-copy.ts`:
 *
 *   docs/handoff/new-chat/fixtures/scenario-new-chat.js
 *
 * Editing this file by hand is the defect the generator exists to prevent — it
 * would make this surface a SECOND place the ratified wording lives, free to
 * drift from the sheet that ratified it. `npm run fixtures:new-chat-copy:check`
 * fails closed on a stale copy.
 */

/** The invitation. The design system's ratified composer prompt, promoted. */
export const NEW_CHAT_HEADLINE = "What do you need?";

/**
 * What the product differs on, said once, where a person decides whether to
 * trust what follows.
 */
export const NEW_CHAT_PROMISE = "Answers come from what Nexus has read, each one dated and linked to the record it came from. Where it cannot verify something, it says so rather than guess.";

/**
 * The companion drops the promise's SECOND clause rather than shrinking it —
 * a refusal states its own reason when it happens, so it is the clause a
 * 380px column can afford to lose.
 */
export const NEW_CHAT_PROMISE_SHORT = "Answers come from what Nexus has read, each one dated and linked to the record it came from.";

export const NEW_CHAT_PLACEHOLDER = "Ask about a site, or describe what you want done";
export const NEW_CHAT_PLACEHOLDER_SHORT = 'Ask about a site';

/** The one line about consequence — a session here is not a chat log. */
export const NEW_CHAT_FOOTNOTE = "What gets done is filed against the runbook that did it, in Record.";

/**
 * Suggestions are QUESTIONS derived from what is true now, never actions: an
 * offer to ask is not a decision to make, which is what keeps this surface off
 * Now's turf. At most three, sized to content, never full-width.
 */
export const NEW_CHAT_SUGGESTIONS: ReadonlyArray<{ text: string; from: string }> = [
  { text: "Why is checkout failing on Charlie?", from: "an open incident, 14h" },
  { text: "What is behind on WooCommerce?", from: "5 cells behind newest" },
  { text: "What changed while I was away?", from: "one run finished, 5h" },
];

export const NEW_CHAT_SCOPE = {
  label: "Asking about the whole fleet",
  action: "Choose a site",
} as const;

/**
 * P0-5, amended 2026-08-25. The PROVIDER and the PAYLOAD are the disclosure —
 * they name who receives what — so they stay visible. The model VERSION moves
 * to the tooltip: it is the part a person cannot act on, and it changes
 * without them. An earlier draft of the sheet said "no model identifier in the
 * footer", which read as "no disclosure" and would have overridden a ratified
 * privacy line; this split is the correction.
 */
export const NEW_CHAT_DISCLOSURE = {
  visible: "Anthropic · sends site data",
  tooltip: "anthropic/claude-sonnet-5 · site names, versions and plugin lists are sent with your question. Destructive actions still need your confirmation.",
} as const;

/** The needs-you count as a DOOR at ambient weight — never the subject. */
export const NEW_CHAT_AMBIENT = {
  line: "9 things need you",
  door: "Open Now",
} as const;
