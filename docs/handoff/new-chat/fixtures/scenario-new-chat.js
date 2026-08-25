/**
 * The new chat — what an empty session says before anything is asked.
 *
 * The shipped version put a situation report where an invitation belongs, floated it in
 * the top third of an empty canvas, and pinned the composer to the bottom edge — so the
 * one thing you came to do was the furthest thing from what you were reading.
 *
 * Three rules this fixture is written against:
 *
 *   1. On an EMPTY session the composer is the centre of gravity. It moves to the bottom
 *      on the first turn, because then there is a transcript to sit under.
 *   2. The headline invites; it does not report. "10 things need you" is Now's verdict,
 *      and a second home for it here is the defect the Now collapse removed.
 *   3. Suggestions are QUESTIONS derived from what is true right now — never actions.
 *      An offer to ask is not a decision to make, which is what keeps this off Now's turf.
 *
 * The suggestion subjects are the live fleet's; their phrasing is the user's own words,
 * per the design system's rule for suggested prompts.
 */
(function () {
  window.NEXUS_NEWCHAT = {
    // "What do you need?" is the design system's ratified composer prompt — four words,
    // Geist, and the product's whole posture. Promoted to the invitation; the field then
    // says what kind of thing to type instead of repeating it.
    // Amended by owner ruling, 2026-08-25 16:09: the composer-prompt four
    // words read as a support greeting on this surface; the invitation names
    // the session's actual frame — work, now.
    headline: 'What do you want to work on now?',

    // What the product actually differs on, said once. This is the corroboration
    // doctrine arriving where a person decides whether to trust the answer.
    promise: 'Answers come from what Nexus has read, each one dated and linked to the record it came from. Where it cannot verify something, it says so rather than guess.',

    placeholder: 'Ask about a site, or describe what you want done',

    // Derived from live situations, phrased as questions. Never more than three, and
    // never carrying an action — the door to acting is Now.
    suggestions: [
      { text: 'Why is checkout failing on Charlie?', from: 'an open incident, 14h' },
      { text: 'What is behind on WooCommerce?', from: '5 cells behind newest' },
      { text: 'What changed while I was away?', from: 'one run finished, 5h' },
    ],

    // The one line about consequence, because a session is not a chat log here.
    footnote: 'What gets done is filed against the runbook that did it, in Record.',

    // The scope row survives: what a question is about is a real fact.
    scope: { label: 'Asking about the whole fleet', action: 'Choose a site' },

    // P0-5, the privacy disclosure. The provider and the payload are the disclosure —
    // they name who receives what. The model VERSION is the part a person cannot act on,
    // so it moves to the tooltip that already carries it rather than being removed.
    disclosure: {
      visible: 'Anthropic \u00b7 sends site data',
      tooltip: 'anthropic/claude-sonnet-5 \u00b7 site names, versions and plugin lists are sent with your question. Destructive actions still need your confirmation.',
    },

    // The needs-you count stays available as a door, at ambient weight. It is one line,
    // it is not the headline, and it carries no action.
    ambient: { line: '9 things need you', door: 'Open Now' },

    // Board D — the session list. Nine sessions typed the same first message, so the
    // list titles them identically. A title should say what the session DID.
    list: {
      broken: [
        { title: 'Update my plugins on t1, t2', when: '6d ago' },
        { title: 'Update my plugins on t1, t2', when: '6d ago' },
        { title: 'Update my plugins on t1, t2', when: '6d ago' },
        { title: 'Update plugins', when: '6d ago' },
        { title: 'Update plugins', when: '5d ago' },
      ],
      fixed: [
        { title: 'Updated WooCommerce on t1 and t2', meta: 'rb.bulk-plugin-update · 2 sites verified', when: '6d ago' },
        { title: 'Halted updating t1 — a verify failed', meta: 'rb.bulk-plugin-update · 1 done, 1 untouched', when: '6d ago' },
        { title: 'Asked about plugin versions on t1, t2', meta: 'no run armed', when: '6d ago' },
        { title: 'Refused: plugin updates on production', meta: 'needs a grant', when: '6d ago' },
        { title: 'Diagnosed t2 after a slow response', meta: 'rb.diagnose-site · 5 steps', when: '5d ago' },
      ],
    },
  };
})();
