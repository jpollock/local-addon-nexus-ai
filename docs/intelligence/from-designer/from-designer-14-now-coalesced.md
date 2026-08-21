---
title: Now, coalesced — the situation rule drawn
author: designer (Nexus AI UX)
source: Now coalesced.dc.html (design component, project "UX Prototyping for Intelligence Docs")
fixtures: handoff/from-designer/fixtures/situation-headlines.js (updated), fixtures/scenario-now-coalesced.js
date: 2026-08-21
answers: the Now backlog groups A and B, and the six questions of 21 Aug
status: proposed
---

# Now, coalesced

*The photographed fleet state after both fixes, in the ratified order: dedupe, then coalesce.*

Eleven cards to seven was a bug. Seven to four is the situation rule. Every sentence on the sheet is composed from `situation-headlines.js` — templates, group label, deferred fields and header rules read from one file, so nothing is retyped into the composer.

## 1 · The screen — four rows

| Tier | Row | Age |
|---|---|---|
| 1 | theawfulpm-test has a known backdoor plugin, wp-compat, and 3 more findings | 65h |
| 2 | A plugin update run has waited 82 hours and changed nothing | 82h |
| 2 | A cp.backup step is waiting on your evidence | 66h |
| 2 | A containment run has waited 64 hours and changed nothing | 64h |

The order is the consequence order rather than age: the tier-1 situation leads at 65h, above three tier-2 runs at 82h, 66h and 64h. **The stripe is what makes that legible without reading** — red then orange; a screen sorted by age would show one colour band. That is the defect the missing stripe hid.

Header states the count once. No away-line, because the gap was under an hour. No zero clauses. The health line is one quiet sentence — "All 5 checks are reporting." — honouring the reserved seat without a panel that announces nothing is wrong.

## 2 · Coalesced — one bordered object, one verdict

**A part is a line, not a card.** No stripe, no chip, no ask of its own — the situation owns the tier and the decision, and a part carrying those would be a row inside a row. Each part keeps its own sentence, its own age, and a door to itself.

**Closed by default**, because the verdict is what the arrival needs. **Opening in place** rather than through the door, because someone checking whether a verdict is true should not have to leave the list to do it.

The template:

- **guard** — `row.kind === "incident" && memberCount > 1 && row.linkKind !== null`
- **headline** — `{target} has {leadFinding}, and {restCount} more findings`
- **fallback** — `{memberCount} security findings on {target}`, when no member carries a severity field
- **ask** — Contain it now, or say why not. Nothing has been written under a procedure.
- **disclosure** — `{memberCount} findings — show them` / Hide the findings
- **meta** — `{producer} · linked by {linkKind}`
- **rule** — the highest member's rule line
- **no chip** — the count is in the headline and the disclosure already

## 3 · Grouped — several objects under a caption that is not one

**The label is not a card.** No border, no fill, no stripe, no door — which is the entire visual difference, and it reads at a glance: coalescing produces one bordered object, grouping produces several under a caption. Nothing needs to be read to tell them apart.

Each row keeps its own stripe, age and door, because each is still its own situation. The label's second line states the limit: *The record does not link these, so they are listed separately.* A caption asserting a shared cause would be the laundering, drawn.

## 4 · Deferred

Tier and place unchanged, dimmed rather than moved, out of the badge, reason and wake condition on the row. **Deferral applies to the situation, never to its parts** — deferring one finding while its siblings escalate would split a situation the platform has just asserted is one thing, and the disclosure would then contradict the row above it.

## 5 · The pins

- A fold requires a record link. A shared payload origin, target or timestamp is not a link — the coalescer reads links and nothing else, and the row names the link it used.
- The coalesced headline is derived from the members: target, the consequential member, count of the rest. Never one member's sentence with a parts count bolted beside it.
- Where no member carries severity, the headline falls back to count-plus-kind-plus-target. It never guesses which finding leads.
- The coalesced row takes the highest tier among its members, and its rule line is that member's rule.
- A part is a line inside the card: no stripe, chip, ask or gate — its own sentence, age and door. Closed by default, opening in place.
- Grouping is a caption, not a card, with a second line stating that the record does not link the members. Each grouped row keeps its own stripe and door.
- The stripe encodes tier only — red 1, orange 2, grey 3 — and must never drift into a severity scale. Changed-column rows carry none.
- The count is stated once. Badge and verdict line are one derivation; a zero-count clause is omitted, not rendered as a zero.
- Every row has exactly one door, naming its destination. An incident with no run still has a site. Door strings carry no terminal punctuation and render in action blue.
- A deferred situation keeps its tier and place, leaves the badge, and shows its reason and wake condition.

## 6 · Absent on purpose

- No Approve / Not now on any row. A gate without its declaration is consent without context — the row's door leads to the gate, and the gate is where the decision is made.
- No parts chip. The count is already stated twice; a third is the defect the count-once rule just removed from the header.
- No severity colour, badge or score on a part. Ranking parts inside a situation the platform called one thing would invite acting on a part.
- No `agent.stuck` row on the artboard. It is a ratified class the fold cannot emit, and drawing it here would imply the dedup can ship without WP-54a. It cannot — auth-probe disappears from Now the day the duplicates go.
- No away-line and no zero clauses.
- No panel for the health line while nothing is dark.
- No lecture: both explanatory sentences under the old empty section are gone, and the section does not render when empty.

## 7 · The one thing the drawing needs and does not have

**Does the sentinel's finding payload carry a severity field?** The headline leads with the backdoor because a backdoor is the consequential finding of the four — and that choice is only derivable if severity is in the record. If it is not, the honest headline is the fallback. Both come from the same template; which renders is a fact about the payload, not a preference.

The Q1 answer stands on the same principle: the containment run folds into this situation if and only if its arming records the incident ids it answers. Same site an hour apart is a correlation a person reads instantly and the platform cannot assert. Four honest rows beat three where one join was inferred from a timestamp.
