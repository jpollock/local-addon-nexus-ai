---
title: Design position §1 — Moments, tested
author: designer (Nexus AI UX)
source: Moments response.dc.html (design component, project "UX Prototyping for Intelligence Docs")
committed_by: architect, verbatim
date: 2026-08-18
answers: moments-model.md draft 1.1 §8 and moments-companion-for-designer.md §4
status: ratified; model moved to 1.2 carrying these amendments
---

# Moments, tested

*The moments model adopted, torn at in four places, three open questions answered, and the four journey evals finished.*

18 August 2026 · answers moments-model.md draft 1.1 §8 and the companion's §4 · composes with §0, does not amend it

## Adopted, and what it does that §0 could not

The model holds. The claim that experienced simplicity is per-moment surface rather than total surface is the thing I could not derive from the rank model, because the rank model answers how much screen and is silent on what belongs on it. The two together are now a complete routing rule: consequence decides the rank, the moment decides the contents.

The audit is accepted as read, including the part that is uncomfortable. Three of the eight surfaces are strong because they were designed against a story; the two half-served ones — the audit view and the sessions list — are half-served precisely where no story was written. That is not a coincidence and I am treating it as the working method rather than as a finding.

Four objections follow. None of them is fatal and each one is a place where the model as written would let a bad design through.

## 1 · Where it tears

### Objection 1 · naming — Return is the only moment named for a circumstance rather than an intent

Glance, Inspect, Act, Investigate and Govern are all named for what the person is trying to do. Return is named for when they arrived. That asymmetry matters because a moment named for an arrival will get built as a screen you land on, and the model's own evidence says its center is a verdict — what is waiting and what changed — which is ambient by nature.

This also disposes of the model's own question four. Returning-to-waiting and reviewing-the-finished are not two moments; they are the two columns of one triage, and splitting them puts the same person in two different rooms depending on how the agent's night went. Whether a run halted or finished is the answer Return gives, not a fork in the road before it.

**Fix:** Keep Return, define it as arrival triage rather than as a destination, and refuse the split. One moment, two columns: waiting and changed. It earns a screen only when the triage does not fit in the ambient rank.

### Objection 2 · the budget — The complexity budget as written is a moat around what we have already built

Law (a) says a feature serving no named moment is complexity by definition and is not built. But the moment list was compiled from the surfaces that exist, so the budget will always ratify the status quo and always reject the genuinely unfamiliar. The first real idea nobody has a moment for gets refused for being new.

The audit result — no surface serves no moment — is evidence the discipline works, and also evidence the test cannot fail yet, because both sides were derived from the same material.

**Fix:** Make the rejection appealable in one direction only: a surface serving no moment is either cut, or it names a candidate moment with its own evidence and goes through the same ratification this document is going through. New moments are expensive and possible. The budget stays; it stops being unfalsifiable.

### Objection 3 · concurrency — Moments are written as if one is live at a time, and in this product several always are

She is in Investigate while a run sits halted at a gate and a freshness SLO quietly expires. The routing table tells each moment what to show, and says nothing about which moment holds the screen when three of them want it. That is the gap the rank model filled for sessions with promotion, and the moments model needs its equivalent or the never-shows lists will be violated by ordinary multitasking rather than by bad design.

The rule that fits both documents: at most one moment holds the column, every other live moment is represented in the ambient rank only, and no moment may promote itself out of ambient. That is the self-promotion ruling generalized from gates to moments, which is a good sign it is the right rule.

**Fix:** Add a concurrency clause to §4: the routing table governs the moment holding the column; all other live moments route to ambient. Ambient is therefore the only surface that must be able to represent every moment at once — which makes the needs-you row the most constrained thing we design, not the simplest.

### Objection 4 · enforcement — The never-shows are the best part of the model and the only part with no teeth

Prose instead of the shape, tool rows as narrative, a scrollback as the re-entry, a summary where the chain should be: those four lines are worth more than the rest of the table, because they name the exact ways each moment degrades into a chatbox. As written they are prohibitions, and a prohibition in a document loses every argument it has with a deadline.

Each of them is mechanically checkable against a rendered surface. Absence is easier to pin than presence.

**Fix:** Every never-shows entry becomes a pin in the journey eval for its moment, listed in the must-not half. That is why the four evals below are written with must-nots first-class rather than as a footnote.

## 2 · Q1 — Act-small is real, and the axis is not size

Collapsing Act-small into an act-big of one is the one collapse that would cost us most, and the five-turn session is the evidence. Ceremony is already per-write and does not decay, so an act-big of one would produce the same gate — the ceremony is not what distinguishes them. What distinguishes them is that one of them has a plan and the other does not.

Act-big's center is the run: a declared procedure, a scope, checkpoint marks, a canary reason, per-target attestation, and a dry-run whose whole job is to let you see the change before it exists. Act-small has none of those, and inventing them is the harm. A one-line change under a declared block either grows procedure ceremony it cannot justify, or it teaches the user that the declared block is decoration — and the declared block is the most load-bearing thing phase 1 shipped. The other tell: act-small needs no dry-run, because the change is its own preview.

So the boundary is not the number of targets. It is whether a procedure is declared.

> One site under a runbook is Act-big. Five sites changed by five separate asks is five Act-smalls. The moment is set by the presence of a declaration, not by a count of targets.

That reading also makes the moment boundary observable in the stream rather than a matter of judgement: the arming event is the transition. Keep both moments; rename the axis in §2 from many-targets to declared-procedure and the naming note about Campaign stops being the only thing separating them.

## 3 · Q3 — Content work is a resident, and it exposes a real gap in Inspect

The strategist walks Glance to Inspect to Act-small and touches no fleet machinery, and every law still binds: publishing is a write and gets the full gate, no claim about traffic may be authored where the traffic data lives, the draft's history is consulted before the risky part. Nothing about that walk needs a seventh moment, so I would not add one.

What it does expose is that we have designed exactly one shape for Inspect. The model says Inspect's center is the shape rather than the sentence, and then all its evidence is the matrix. The strategist's Inspect is a draft against its published version, or a proposed split against the traffic it is split from — same moment, same law, a different comparator.

Proposed amendment to §2: Inspect's center is a **comparator render**, of which the site-at-places matrix is one instance and the content diff another. Both owe the same three things — the shape before any prose, a verdict that comes from the comparator rather than from cell inequality, and a door on every cell. That amendment costs the model nothing and stops the next content surface being built as prose because the matrix did not fit it.

## 4 · Q5 — Six is defensible; two of the six are thin, and the count is the wrong thing to measure

The session inventory maps cleanly. Across the prototype's thirty-five sessions and the scenario set, every session lands in one of the seven and nothing is left over, which is the result that would have falsified the model. But the evidence is not evenly thick: Act-big has three sittings and a live run behind it, Inspect has the matrix ruling, Glance has the where-am-I contract. Act-small and Return each rest on a single session apiece. Five moments are evidenced; two are inferred.

I would not try to settle the count by inventory, because an inventory of our own sessions can only tell us which moments we have already imagined. The model's real claim is not the six rooms — it is the closed walk list, and walks are the thing the ledger can actually count. Instrument transitions rather than states: an arming event that follows a matrix selection is Inspect to Act-big; a resumed session at an unchanged gate is Return to Act-big; a refusal followed by a grant is anything to Govern.

> A moment whose inbound walks never fire is ours, not the user's. A walk that fires often and appears nowhere in the list is the missing moment announcing itself.

## 5 · The four journey evals, finished

Written to bind. Each has its steps, its must-nots as the moment's never-shows made testable, the programmatic half stated so it can become pins, and one judged sitting with a question a person can actually answer in the room.

### J-Glance · M1 · cold open to answered

App opens cold. The user asks nothing. Within one look they can say whether anything needs them and where it is.

**Must**
- A verdict is visible with no interaction and no question asked.
- Every count and age on screen is derived, and each one is dated or carries its freshness class.
- Exactly one door per fact, and the door arrives at the fact rather than at the section containing it.
- The needs-you row names what is needed of the user, not only that something is.

**Must not**
- Any ceremony: no approval, no confirmation, no plan.
- A fact with no date where its class has an SLO.
- A transcript or a session scroll anywhere in the first view.
- A count the user must open something to trust.

*Programmatic:* derivation pins on every rendered count; route-exists for each fact's door; a no-interaction render carrying zero authored numbers.
*Judged sitting:* Cold open, no briefing: can the person say what needs them, and point at where, within five seconds and no clicks?

### J-Inspect · M2 · divergence to scoped intent

A named divergence is opened from Glance, explained by its lineage, and turned into a scope the next act inherits.

**Must**
- The comparator render is on screen before any prose about it.
- The verdict on a disagreeing cell comes from the comparator, not from cell inequality.
- A disagreeing cell explains itself in place — lineage, and the history badge where the component has bitten before.
- The selection becomes the next act's scope with nothing retyped and nothing re-picked.

**Must not**
- A summary standing in for the shape.
- A dead-end fact: any cell with no door.
- A claim in the surrounding prose that no cell supplies.
- A scope the user must confirm by re-listing the targets they just selected.

*Programmatic:* shape-renders-first ordering; comparator-verdict provenance on each cell; scope identity — the ids in the dry-run equal the ids selected, asserted as a set.
*Judged sitting:* Given only the matrix, can the person say why staging differs and hand those exact sites to a run without typing a site name?

### J-Act-small · M3 · one change, one site, one motivating fact

A fact seen in Glance or Inspect motivates one deliberate write on one site. No procedure is declared.

**Must**
- The motivating fact is linked from the change, not restated beside it.
- The write gets the full gate, and the second write of the session gets the same gate as the first.
- A staleness re-check runs against the motivating fact before the write is offered.
- A one-line history flag appears if this component has failed here before.

**Must not**
- Any act-big machinery: no canary, no scope list, no per-target attestation, no declared block.
- A dry-run standing between the user and a change that is its own preview.
- Ceremony that decays across repeated writes in one session.
- A gate whose record cannot name the fact that motivated it.

*Programmatic:* gate-present on every write event regardless of ordinal; freshness re-check precedes the offer; the rationale event carries the motivating record id; absence of procedure events in the whole journey.
*Judged sitting:* Does the small change feel small while still feeling recorded? A user who has just done one should be able to say what it will leave behind.

### J-Return · M6 · away during a halt, resumed at the gate

The agent works overnight. A run halts at a gate; other work finishes. The user comes back and re-enters at consequence.

**Must**
- The triage shows waiting and changed as two columns of one verdict, sorted by consequence.
- A waiting item names where in the run it is waiting — the gate, not just the run.
- Opening it resumes the same session at the same gate: nothing re-asked, nothing re-derived, the approval already given still given.
- The finished portion is already filed at Record rank, procedure beside run.

**Must not**
- A scrollback as the re-entry.
- An approval that must be given a second time.
- A needs-you row that knows that but not where.
- Everything-since-you-left rendered as prose.

*Programmatic:* promotion identity — session id, gate id and pending-approval state unchanged across re-entry; gate-level addressing on every waiting row; the record exists before the user arrives, not on demand.
*Judged sitting:* Twelve hours away, no notes: can the person get from the app opening to the decision they owe, with no reading and no re-approving?

### J-Refusal · any → M7 → back · proposed, replaces J-Govern

An act needs a grant that was never made. The refusal names it, Settings makes it, the work resumes where it stopped.

**Must**
- The refusal names the missing capability in the vocabulary the Settings matrix uses, and offers the door.
- The door lands on the specific grant, not on the top of Settings.
- The grant is recorded as a control event, visible and revocable, and made at the control rather than in the conversation.
- Returning resumes the same session with the act still armed and its scope intact.

**Must not**
- A conversational shortcut that elicits the widening in chat.
- A refusal that says no without naming what would have made it yes.
- A re-ask of anything the session already established.
- A widening that is silent, unlisted, or hard to reverse.

*Programmatic:* refusal payload carries the capability id used by the matrix; deep-link resolves to that grant; control event written on the widening; session state identical either side of the excursion.
*Judged sitting:* After being told no, does the person believe the platform is on their side? Ask them what it stopped them from doing and whether they would trust it to stop them again.

## 6 · On J-Govern — the journey we are missing is not Govern's

Agreed that Govern's virtue is being boring, and a journey through the matrix would test a form. But the walk that runs through Govern is not boring at all, and no eval covers it: a refusal names a missing grant, the user crosses into Settings, widens, and comes back to work that has been waiting. Three surfaces, two products' worth of state, and the only place where the platform tells the user no and then has to be worth trusting again.

So I would add J-Refusal rather than J-Govern. It is above; it is the fifth of the four, and I think it is the most likely of the set to fail on first attempt.

## 7 · The three cycles, accepted with one addition

Cycles one to three as framed. The two densities are M4 at companion and stage, designed once and rendered twice, with the worked walk as the story and the promotion pins as the contract — that work exists and holds.

One addition to cycle one: the selection-becomes-scope handoff belongs here, not later. It is listed as a gap in Inspect, but the artifact it hands over is the run's scope, which means the failure lands in the arming — a dry-run whose target list the user has to restate is an Act-big defect, and it is cheapest to design while the declared block is on the table. It is also the one handoff the worked walk leans on hardest.

Everything else stands as issued. The phase-1.5 brief needs no re-reading; nothing in it changed, and reframing it as M4's two densities is the same design with a better name for why it has two.

## 8 · What I am now asking

One question back, and it is the arbitration one from objection three. If two moments are live and only one may hold the column, the platform has to choose — and that choice is a derived verdict about which consequence outranks which. The rank model says consequence decides rank; it does not say how two consequences compare. A halted gate against a failing verify against a stale fact is a comparator we have never written down, and every needs-you row is already secretly using one.

If that ordering is written as a rule, I can design the ambient escalation against it. If it stays implicit, the row's sort order becomes taste, and the one power the model has kept unspent starts leaking out through the ranking.
