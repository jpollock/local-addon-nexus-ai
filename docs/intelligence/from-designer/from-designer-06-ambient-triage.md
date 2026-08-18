---
title: Cycle two — The ambient triage and the deferral affordance
author: designer (Nexus AI UX)
source: Ambient triage.dc.html (design component, project "UX Prototyping for Intelligence Docs")
committed_by: architect, verbatim
date: 2026-08-18
answers: cycle two as framed in moments-companion-for-designer.md §3; renders the consequence order (moments model 1.3 §4a) against §2's golden fixture
status: ratified — nine pins inherited by the triage packet; XD-23 registered
---

# The ambient triage, and the deferral affordance

*M6 Return + M1 Glance · the consequence order 1.3 §4a rendered · 1440×1024*

The golden fixture from design position §2, rendered as the surface it was an argument about: two waiting situations, one reserved epistemic row, one changed row, drift nowhere. Each row states the rule that placed it, because a sort that cannot be read is a sort nobody can check. Then the deferral affordance in three states — offered, recorded, woken.

The scenario file is the §2 fixture verbatim. When the triage derivation ships, that fixture becomes its expected output and this file becomes generated; until then it may not drift from the ratified fixture by a word.

## 3a · The morning after

**Waiting on you** — two situations, ordered by what the delay costs.

- *Tier 1 · mid-change, only you can move it* — **Charlie is part-changed and its checkout is down.** Needs you at cp.approval — restore, or continue without Charlie. Halted at Charlie · 2 done and standing, 2 untouched · verify failed on checkout · incident open. Chip: 3 parts · one situation. Touches production on 2 of 5 · 14h.
- *Tier 1 · a write has landed in scope* — **Bravo is waiting on you mid-change.** Needs you at cp.approval — 3 of 8 in remediate. Canary already written · dry-run stale in 41m. Production · 3h.

**Reserved · the record's own health** — *The record is going blind — 3 producers dark.* plugin-inventory 9h · health 6h · content-age 6h. "Verdicts about 47 sites cannot be trusted while this stands." One row, always present, and it cannot grow: twelve dark producers would still be this row with a larger count.

**Changed while you were away** — Cache purge across 12 sites finished. Filed against its runbook · 12 of 12 verified. Staging on 9, production on 3 · 5h.

**Not in this list** — 41 facts are past their freshness window. Nothing is needed of anyone, so nothing is here; each fact carries its own date where it lives, and the gateway already refuses to act on a stale one.

Each row carries the rule that placed it, from the same derivation that sorted it. Charlie's halt, its failing verify and its incident are one row because the record links them — the row names what is true rather than counting its parts, and the chip says how many it folded.

## 3b · Deferral — offered, recorded, woken

**Offered**, on the row: "This stays where it is and keeps its tier. Say why, so the record carries it." A reason field, then the wake condition — wake me when the incident is closed (record condition) · wake me Monday morning (time) · no wake condition, stay quiet until I come back (none) — and the note: "Recorded on the run, against this halt. Not a dismissal: the row keeps its tier and its place." Buttons: *Record the deferral* / *Never mind*.

**Recorded.** Same tier, same rule line now reading *deferred by you — tier and place unchanged*, and a recorded block: "Deferred by you 4h ago — waiting on the payment gateway vendor · Wakes when the incident is closed." Affordances: *Open where you are needed* and *End the deferral*. The header then reads: 1 needs you · 1 deferred by you · 1 changed overnight · three checks dark.

**Woken.** The rule line reads *the wake condition fired — full escalation returns*, and the row says which: "Deferral ended — the incident you were waiting on is closed." Affordances: *Open where you are needed* and *Defer again*.

## The pins this surface owes · J-Return

- Waiting and changed are two columns of one verdict, each ordered within itself. Tier 5 renders nowhere in the list, and the panel states where drift went instead.
- A waiting row names the gate it is waiting at, not just the run it belongs to — the where, not only the that.
- Causally linked events render as one situation, at the highest tier of its members, with the count of parts it folded stated on the row.
- Every row shows the rule that placed it, from the same derivation that sorted it — the sort is inspectable where it is used.
- The reserved epistemic row is always rendered, holds exactly one derived row, cannot grow with the number of dark producers, and cannot be scrolled away.
- Place renders as the set it is, from the affected-set derivation, on every row that touches more than one.
- A deferral keeps tier and position, lowers escalation only, and is recorded on the run with its reason. Only the user may defer; nothing the agent does can quiet its own gate.
- A wake condition ends the deferral and returns full escalation, naming which condition fired. A deferral ends three ways and each is recorded: the wake fires, the user ends it early, or the situation is answered.
- The badge is an instrument, not an inventory: it counts situations currently escalating, so a deferred one leaves it. The accounting line states the deferral in the same breath as the count, so the count can never read as the whole truth.

## What is absent, and on purpose

- No dismiss. Nothing leaves this list except by being answered — a deferral is quieter, never gone.
- No agent-side quieting. An agent that lowers the escalation of its own gate is eliciting inattention, which is the self-promotion power inverted.
- No count of everything. The rail carries the needs-you count only; changed and going-blind have their own places and neither inflates the badge.
- No drift rows. 41 stale facts need nothing of anyone, so they live on the facts they describe.
- No prose digest of the night. Every row is a derived verdict about one situation, and the transcript is not the re-entry.
- No sessions list as the triage. Sessions sort by consequence elsewhere; this surface answers what is waiting and what changed, which is a different question.

## Design-system notes, for the record

Three controls are the bound system's own: `Textarea` for the recorded reason, `Radio` inside each wake row, `Badge` for the ambient count. Two constraints found while mounting them, both left as the system has them rather than worked around:

- `Textarea` is a fixed 320px at every level of its own tree, so the card was sized to the component (356px) rather than the component overridden.
- `Badge` implements only `size=md`, and no solid negative variant at any radius; the strongest negative it ships is red with a stroke, which is what the count renders. Whether that is loud enough for §0 §9's "impossible to miss" is an empirical question for J-Glance's judged half, not a reason to hardcode a red outside the system.
