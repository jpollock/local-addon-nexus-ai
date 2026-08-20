---
title: The Now screen — the front door, built
author: designer (Nexus AI UX)
source: Now screen.dc.html (design component, project "UX Prototyping for Intelligence Docs")
date: 2026-08-20
answers: item 1 of the six-item order in the addon audit; the shipped Home/Inbox/Runs read as one list
status: proposed — item 4's prompt copy is in §5
---

# The Now screen

*M6 Return + M1 Glance at addon rank · 1440 × 900 inside Local's chrome · the six situations from the shipped screens*

Every row is the same record the current Home reads, said as a verdict: what is true, what is being asked of you, and where. Nothing is invented — where a fact is missing the row says so in one clause and moves on.

## 1 · The verdict

**6 things need you, and none of them has changed anything yet.**
*Two runs are waiting on targets · four security findings are open on one site · one agent is stuck*

No single row can say this, and it is the most useful sentence the data produces: nothing is half-done, so nothing is expensive to stop. It is derived from the rows it heads — `done === 0 && failed === 0` across every waiting row — so it cannot disagree with them.

## 2 · The six rows

| Row | Ask | Meta |
|---|---|---|
| A backdoor plugin is active on theawfulpm-test and nothing is fixing it | Contain it now, or say why not. Nothing has been written under a procedure. | theawfulpm-test · security-sentinel · open 43h · *No run attached* · Tier 1 · nothing is holding it back but you |
| Three more findings on the same site have no run either | File manager plugins active, low-entropy plugin names, PHP in mu-plugins. Each needs the same decision. | opened within a minute, 43h ago · *3 findings, one site* · Not coalesced — the record does not link them |
| A backup step is waiting on evidence from you | Waiting at cp.backup, 4 of 8. Nothing has been written yet, so stopping here costs nothing. | rb.bulk-plugin-update · waiting 44h · *Waiting* · nothing written yet · Tier 2 |
| An update run has waited 60 hours and changed nothing | It never received a target list, so it cannot start. Give it one, or close it. | rb.bulk-plugin-update · waiting 60h · *Waiting* · Tier 2 · oldest of the untouched |
| A containment run is waiting and has changed nothing | No targets on record. The same fix as the update run above, on a different procedure. | rb.incident-containment · waiting 42h · *Waiting* · Tier 2 |
| auth-probe could not finish a run | It timed out after five minutes. Retry it, or leave it stopped. | auth-probe · last run just now · *Stuck* · Tier 3 · the agent is asking, not the fleet |

**Nothing needed of you** sits below as its own section: nothing finished while you were away; freshness is not being reported yet, so no facts are listed as stale; 31 WordPress events are recorded and none needs a decision.

## 3 · The decisions this screen makes

- The headline is a verdict about the whole list, not a count.
- Every row leads with world state and follows with the ask. "Nothing has been written yet" appears where it is true, because it is the fact that decides urgency.
- The runbook id moves to the meta line. It identifies a procedure; it never told anyone what happened, and it was carrying the headline on all three run rows.
- Rows answerable here get buttons — the Inbox's *Approve* and *Not now*, in place. Rows needing the session get one door and no buttons, so deciding and going somewhere look different before you click.
- The three sibling findings are one row that states its own limit: three findings, one site, not coalesced, and why. Honest without being four identical rows, and it becomes a real coalesced situation the day the record links them.
- Nothing-needed-of-you is a section, not a footnote. Freshness gets one clause instead of a paragraph about producers.

## 4 · Every row, and the record it came from

- *A backdoor plugin is active …* — `incident.opened` · security-sentinel · theawfulpm-test · 43h · no run id on the incident
- *Three more findings …* — 3 × `incident.opened` · same producer, same target, within 60s · no causal link recorded
- *A backup step is waiting …* — run cursor = cp.backup · 4 of 8 · writes in scope = 0
- *An update run has waited 60 hours …* — run armed 60h · targets = [] · writes in scope = 0
- *A containment run is waiting …* — run armed 42h · targets = [] · writes in scope = 0
- *auth-probe could not finish a run* — `agent.run.failed` · timeout 300000ms

Not one noun is authored. What changed is the grammar.

## 5 · The panel, and item 4's prompt copy

Chat is the docked panel on the right at 380px — not a bar under the content, which would be two composers for one thing. Its opening state is drawn from the list beside it rather than from a blank:

> Six things need you and none of them has written anything yet. Ask about any of them, or about the fleet.

Three opening asks, each answerable from the queue on screen:

- Why has the update run changed nothing?
- Are the four findings on theawfulpm-test related?
- What does cp.backup need from me?

Below the composer, the scope line: **Asking about** *the whole fleet* · *Choose a site*. A question with no stated subject is the panel's most common failure, and stating it is cheaper than asking.

## 6 · One open question, and one that answered itself

**Open:** do the four security findings share a causal link in the record? If they do, they coalesce into one situation with its parts; the row above is drawn for the honest case where they do not.

**Answered by reading the host:** writes-in-scope already exists. `sessionRegistry` composes the current headline from `done` and `failed`, so "has changed nothing" is derivable today — `done === 0 && failed === 0` is exactly that fact, and it is already on screen as two zeros.

## 7 · Design-system notes

The rail mounts Local's own components — `Avatar`, then `IconDashboard3Line`, `Connect`, `LocalBlueprints`, `NavigationHeadless24`, `Support` — recoloured by passing `style.color` through props, because each glyph re-declares its colour on its own wrapper and spreads `props.style` last, so the rail's inherited colour never reaches the paths. `NavigationSites24` is avoided on purpose: its outer frame is unclosed subpaths, extracted for stroking, so filling it silently drops the frame. `LocalSidenav` is avoided too — it renders its labels with text-fallback glyphs, which would put the word "Icon" in the rail five times.

Rail green is `var(--local-green)`; the active tab underline is `var(--local-teal)`. Chips are one word, per the system's own rule that a badge never carries a sentence — at 6px horizontal padding against a 10px radius, a second word starts inside the curve.
