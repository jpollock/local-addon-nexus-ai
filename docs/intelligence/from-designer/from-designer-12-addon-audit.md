---
title: The addon audited against the intelligence docs
author: designer (Nexus AI UX)
source: Addon audit and redesign.dc.html (design component, project "UX Prototyping for Intelligence Docs")
date: 2026-08-20
answers: a deep review of the shipped addon UI against the ratified doctrine
status: proposed — items 5 and 6 are the two IA decisions
---

# The addon audited against the intelligence docs

*Ten screens of shipped addon read against the rank model, the moments model and the consequence order. Nothing here is a new feature; every item is a rearrangement of what the product already computes.*

## 1 · What the addon already gets right

- **The declared block, the checkpoint marks and the attest words** ship and are correct. The seam holds: the same wording renders wherever a run does.
- **Every fact carries its date.** No count on any screen is undated.
- **Refusals name the missing capability** and offer the door. J-Refusal's shape is in the product.
- **The record exists before anyone asks for it.** Runs are filed against their documents.

That is the doctrine's hard half already shipped. What follows is grammar and information architecture.

## 2 · The six-item order

| # | Item | Why |
|---|---|---|
| 1 | **The Now screen** — one front door | Three surfaces (Home, Inbox, Runs) answer one question. A decision with two homes is a decision nobody owns. |
| 2 | **The situation headline** | Composed in `sessionRegistry`, and it leads with the runbook id — which identifies a procedure and never said what happened. World state first, then the ask. |
| 3 | **One-word chips** | The system's own rule. Phrases move to the meta line, where they read better and fit. |
| 4 | **The panel's opening state** | The highest-frequency surface in the product opens on a blank. Its asks should come from the queue beside it. |
| 5 | **Collapse the three queues into Now** | Mostly deletion — the Inbox cards already carry *Approve* and *Not now*. An IA decision. |
| 6 | **Merge the permission panes, then fold Fleet into Sites** | Two panes decide what agents may do; two lists count one fleet with different totals. An IA decision. |

## 3 · Item 5 — collapsing the three queues

Home, Inbox and Runs are three renderings of one list. Home says what is happening, Inbox holds what needs approval, Runs holds what is in flight — but an agent's pending action, a run waiting at a gate, and an open incident are the same species of thing: something waiting on a person, with a cost of delay. The consequence order already ranks them against each other; only the UI keeps them apart.

**The ruling this needs:** whether the three tabs collapse to one, or Now becomes a fourth surface above them. I would collapse. A fourth surface that shows the same rows as the three below it teaches people that the top one is a summary and the real work is deeper — which is how Home became a summary nobody read. Nothing is deleted: every screen stays reachable, and the rows carry their own doors.

## 4 · Item 6 — the permission panes, and the two fleets

**The panes.** Two surfaces decide what agents may do, and they disagree about what a grant is. One is a capability matrix; the other is a per-agent toggle list. A grant is recorded as a control event either way, so the two panes are one pane with two renderings — and the matrix is the one that matches the Govern doctrine, because it renders what a grant would gate.

**The fleets.** 387 installs on one screen, 253 sites on another. Neither total was the fleet: both were counting the wrong noun. The unit is the **web property** — 203 sites, 367 environments — with each site's environments and your own copy nested inside its row. The Nexus-shell Sites screen already draws this: one row per property, *What Nexus knows* and *Waiting* as columns, *not yet linked* stated on the row rather than implied by a blank.

That resolves both numbers at once. 387 counted installs, 253 counted something else, and a person counts sites. The copy on this Mac stops being a separate inventory and becomes one of the places a site lives — which is why the two lists could never be reconciled at the top level. They were different units, not different filters.

**The ruling this needs:** none, if the Nexus-shell design is accepted as the target. This becomes a merge onto a design that already exists rather than a new screen.

## 5 · What this does not touch

No new data, no new producer, no contract change. Every item reads a fact the host already computes. Items 1, 3 and 4 need nothing from the host at all; item 2 needs the golden fixture's expected output re-ruled, since the fixture pins the current strings.
