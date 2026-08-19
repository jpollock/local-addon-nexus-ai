---
title: Cycle five — Return, the arrival and the re-entry
author: designer (Nexus AI UX)
source: Return arrival.dc.html (design component, project "UX Prototyping for Intelligence Docs")
committed_by: architect, verbatim
date: 2026-08-19
answers: cycle five's ask (M6 Return) in for-designer-cycle-five-bundle.md §4; the two open rulings in its §3
status: for ratification — fixtures attached (fixtures/scenario-return.js, fixtures/scenario-govern.js)
---

# Return — the arrival and the re-entry

*M6 · 1440×1024 · the §2 golden fixture as the morning arrived at*

Twelve hours away, and the way back in. The arrival is a verdict about the night, not a report of it — two columns sorted by the consequence order, each row naming the gate it waits at. Opening one resumes the session it belongs to: the approval given before leaving is still given, and the run is where it stopped.

## 6a · The arrival

Header: **You were away 12 hours** · *2 need you · 1 changed overnight · three checks dark*

**Waiting on you**

- *Tier 1 · mid-change, only you can move it* — **Charlie is part-changed and its checkout is down.** Waiting at cp.approval — restore, or continue without Charlie. Halted at Charlie · 2 done and standing, 2 untouched · verify failed on checkout · incident open. Chip: 3 parts · one situation. Touches production on 2 of 5 · 14h. Door: *Open where you are needed.*
- *Tier 1 · a write has landed in scope* — **Bravo is waiting on you mid-change.** Waiting at cp.approval — 3 of 8 in remediate. Canary already written · dry-run stale in 41m. Production · 3h.

**Reserved · the record's own health** — *The record is going blind — 3 producers dark.* plugin-inventory 9h · health 6h · content-age 6h. "Verdicts about 47 sites cannot be trusted while this stands."

**Changed while you were away** — *Tier 4 · changed, and it kept.* Cache purge across 12 sites finished. Filed against its runbook · 12 of 12 verified. Staging on 9, production on 3 · 5h. Beneath it: "Filed before you arrived — the record was written when the run finished, not when you opened this. Nothing here is composed on demand."

**Not in the list** — "41 facts are past their freshness window. Nothing is needed of anyone, so nothing is in this list — each one carries its own date where it lives."

The headline is what happened to *you*, not what the platform did. Every waiting row names the gate by its checkpoint id, because a row that knows something needs you but not where sends you looking, and the looking is the part that made re-entry feel like reading.

## 6b · The re-entry

**Update plugins across 5 sites** · Opened yesterday, 12:04 · from your matrix selection · *Resumed where it stopped · nothing re-derived, nothing re-asked*

The declared block renders from the document — rb.bulk-plugin-update 1.2.0, eight checkpoints in canonical order, three of four provable checkpoints attested. Marks are three and their assignment is seam-governed: the tick means attested, so it appears only on checkpoints the platform can verify; a reached narrative checkpoint takes the neutral recorded-not-proved dot; the cursor takes its numeral. Identical to RB-D and RB-E, because a difference between the densities and this sheet would be a defect in one of them.

**The standing approval**, rendered as its own block above the gate: *cp.approval · yesterday, 12:11 — "You approved this plan yesterday at 12:11. That approval still stands — you are not being asked again."*

**The gate now** — cp.verify-canary, with its attest words: "The canary wrote to Bravo and its check came back clean. Continue to the remaining four sites, or stop here and keep the canary." Actions: *Continue to the four* / *Stop here*.

### What the re-entry does not do

- It does not replay the night. The turns above the gate are the session's own, unchanged — not a summary written for your return.
- It does not ask for the approval again. The consent given yesterday is rendered as standing, with the time it was given.
- It does not re-derive the plan. The scope, the document and the checkpoint marks are the ones the run armed with.
- It does not scroll you to the bottom and call that re-entry. The gate is what opened, and the transcript is where it was.

## 6c · When the arm cannot be established

> **This session was running a procedure, and the platform can no longer say which.**
>
> The arming record for it is not in the ledger this session can reach, so the checkpoints, the document and the attest words cannot be shown. Nothing here is armed now: no write can be made under this session, and the run it belonged to is intact in the record.
>
> Doors: *Find this run in the record* · *Start a new run from the same selection*

It does not say "unknown procedure," which would name a thing; it says the platform cannot establish the arm, which is a fact about the platform.

## The two wordings owed, in their final form

**The class-derived absence line.** "This file is a drop-in, so no place records a version for it. The dashes are not missing data — there is nothing here that varies by place."

*The rule:* derived from the fact's own class, never from counting how many cells came back empty — a sentence produced by counting absences would say the same thing about a fact that merely has not been collected yet.

**The disarmed-band reason line.** "The document on disk is not the one this grant was made against. Not staleness — the review this grant carries happened against different text, so the capability behaves as though it were never granted."

*The rule:* it names the failure as integrity rather than age, and it says what the state does (behaves as though never granted) rather than what it is called. The grant itself is not described as revoked, because the user revoked nothing.

## The pins this surface owes · J-Return

- The arrival renders with no interaction and no question asked: two columns of one verdict, waiting and changed, each ordered within itself by the consequence order.
- Every waiting row names the gate it waits at by checkpoint id, from the session's own cursor — a row that knows something needs you but not where is the defect this moment exists to prevent.
- The arrival's headline is about the user's absence, and the accounting line under it states the count, the deferrals and the dark checks in one breath.
- Opening a row promotes the session it belongs to. Same session id, same cursor, same pending approvals — a promotion that loses anything is a defect, not a density.
- An approval given before the excursion renders as standing, with the moment it was given, and is never re-asked.
- The declared list, its order, its attest words and its denominator are read from the runbook document — the sheet authors none of them.
- The record for finished work exists before the user arrives. Nothing on the changed column is composed on demand.
- When the arm cannot be established, the session says the platform cannot establish it — never that the procedure is unknown, which would name a thing that has no name here. Nothing is armed, and the run is still in the record.
- The reserved health row is present on the arrival exactly as it is in the list: one derived row, unable to grow, unable to be scrolled away.

## What is absent, and on purpose

- No scrollback as the re-entry. A transcript is what the session said, not where you are needed.
- No everything-since-you-left prose. Each row is a derived verdict about one situation.
- No second approval, no confirm-you-are-back, no resume button that re-arms anything.
- No badge on the changed column. Nothing there needs the user, so nothing there escalates.
- No unknown-procedure label. The platform names its own limit rather than inventing a procedure state.
- No hand-drawn chrome: the rail mounts the design system's own logomark and glyphs. Where a glyph ships undecoded in the bundle (House2, Plus), the decoded member of the same family is mounted instead — never a shape drawn from memory.
- No drift rows in the list. 41 stale facts need nothing of anyone, and the arrival says where they went instead.

## What I need from WP-30's query contract

- **The cursor's gate id is the one fact this surface cannot render without you.** Every waiting row names it, so session × cursor gate must resolve to a checkpoint id, not to a run and an offset. If the registry can also say which checkpoints were attested before the excursion, the resumed declaration renders its marks from the record rather than from the cursor's position, which is stronger.
- **Pending approvals need to survive as a set, not a count.** The standing-approval block names the checkpoint and the time it was given; a boolean would make that sentence unwriteable.
- **I have assumed consequence rank arrives per situation**, with its coalesced parts and the rule that placed it, exactly as the triage sheet renders them. If rank arrives per event instead, the arrival has to coalesce in the surface — which would put a derivation in the render path, and I would rather not.

## Field note answered — the Govern sheet's law-review panel

The panel's prose was authored when four capabilities had no attestable checkpoint; the derived list moved with the fixture and the sentence did not. Both counts are now counted from the same rows the list renders, so the panel reads: *"One capability still gates nothing it can prove … one strict capability has no attestable checkpoint at all, and it is granted today: cap.incident_containment."* When containment gains a checkpoint, the panel says every strict capability has one, with no edit. The memorial version was the alternative and I did not take it — a panel that remembers a state the table no longer shows is the same defect one sentence later.
