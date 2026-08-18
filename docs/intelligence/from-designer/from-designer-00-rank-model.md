---
title: Design position §0 — The rank model
author: designer (Nexus AI UX)
source: Rank model.dc.html (design component, project "UX Prototyping for Intelligence Docs")
committed_by: architect, verbatim
date: 2026-08-18
answers: the two-chat-surfaces question; ratified as governing doctrine by architect & owner
status: ratified
---

# The rank model

*How the AI and the work share one screen — and the rules that keep Nexus AI from becoming a chat box with a WordPress theme.*

18 August 2026 · supersedes nothing · governs the panel and the main-app chat alike

## Why this page exists

Two chat surfaces ship today. The Docked Panel got the procedure surfaces — the declared block, the checkpoint marks, the approval card. The main-app chat, reached from the left menu, got none of them: a strict runbook arming there renders as prose and a tool row. Same ledger, same runbook, same three stream events.

That gap was read at first as a container problem in one surface. It is not. It is what happens when chat is treated as a place. Two places means two frames, two frames means two answers to every question the procedure surfaces ask, and the marks and the attest wording drift apart in a way the seam was built to prevent.

This page states the level the question actually lives at, so the panel and the main-app chat stop being competing designs and become two instances of one model.

## 1 · The unit is the session, not the surface

Sessions already sort by consequence. Take that one step further: consequence also decides how much screen a session gets. A question that is only a question sits low. A declared strict run with a gate waiting outranks whatever screen you are on, because it is blocked on you and the platform knows it.

Today rank is decided by which chrome the user happened to open. That is why the same run is rich in one surface and thin in the other. Chat is not a place in this product. It is a rank a session is currently at.

> Sometimes chat is primary. Sometimes it is secondary. It is never the application.

## 2 · Four ranks, one session

Every session is at exactly one of these. The rank changes; the session does not.

**Ambient** — the rail, the needs-you row.
You are not in the session. It is a count and a state — how many chats are waiting on a reply, whether anything is stuck. Enough to be impossible to miss and too little to read.
- Primary: whatever you were already doing
- One move away: the session itself, by opening it
- Promoted by: you. A gate may raise its urgency here without limit — see section 9 — but never past this rank on its own

**Companion** — the docked panel, 380px.
Chat is secondary and the work is in front of you. This is the rank for asking about the thing you are looking at, and for watching a run you have already approved. Space is the binding constraint: at this width the declaration and the decision cannot both be fully visible, so the declaration yields.
- Primary: the screen behind the panel
- One move away: the stage, by promoting the session
- Promoted by: you. A gate that needs you says so here in one line; opening it is your move

**Stage** — the main-app chat, full column.
Chat is primary. This is the rank for work that is conversational in nature — deciding, refusing, reading a run in full, going through an audit trail. When a procedure is armed the run is the document here and the transcript sits beside it, which is the shape the width was always right for.
- Primary: the session
- One move away: the data the answer points at, and the companion rank
- Promoted by: you, when a run needs more room than the dock has

**Record** — the audit view, against its runbook.
The session is over and what it did is filed — procedures against their runs, attested checkpoints, what was skipped and why. Not a transcript kept for sentiment: the record outlives the conversation, and the retention rules differ on purpose.
- Primary: the record
- One move away: the transcript, while it is still kept
- Promoted by: nothing — this rank is terminal, which is the point

## 3 · Promotion, not navigation

Moving a session between ranks is a promotion. It is the same session, the same ledger, the same scroll position, the same pending gate. Nothing re-renders from scratch and nothing is asked twice.

This is the rule most likely to be broken by accident, because two components rendering one session is the cheapest way to build it and the most expensive way to own it. The failures are specific and each one is testable: a run lifted from the companion to the stage that restates its declaration; an approval given at one rank that is still pending at another; a session whose transcript survives the move but whose armed procedure does not.

If a promotion loses anything, the user has learned that the two surfaces are two products, and will pick one and distrust the other.

## 4 · The procedure outranks the transcript

The first live run found a rich procedural surface floating as a card inside a chat scroll. The reading that matters: the conversation stopped being the subject the moment a runbook armed, and the frame kept insisting it was.

So the rule is not that a particular container becomes a session. It is that whenever a procedure is armed, the procedure is the primary object at whatever rank the session is at. In the companion the declared block owns the column and turns become annotations on it. On the stage the run is the document and the transcript is its margin. One rule, two densities — which is also what keeps one set of marks and one attest vocabulary rather than two.

When the run finishes it stops outranking anything. It folds to one row and the conversation gets the column back.

## 5 · The data is never inside the chat

The Sites matrix, the site at its four places, the audit view: chat points at them, it never contains them. A copy of a fact rendered inside an answer is a second place that fact can be wrong.

This is what makes the corroboration render load-bearing rather than a refinement. Every factual claim is linked to the record that supplied it, and an unlinked claim is visually loud. The effect is that an answer is a set of doors into the data with the fact already in your hand — a route, not a destination. It is also the difference between co-work and a transcript you are asked to trust.

## 6 · The test

> Every fact an answer asserts is inspectable where it lives. Every consequential or habitual capability has a route you can point at. The long tail is ask-only, and that is the point.

The two halves are deliberately not symmetric, because the earlier draft of this rule implied a UI on top of every WP Engine and WordPress tool. That would be unbuildable and it would also be the wrong product: the reason natural language earns its place here is that it collapses a combinatorial tool surface no menu could hold. A hundred flags on a WP-CLI command do not want a hundred controls. Asking is the interface for the tail.

Facts are the half that stays strict. A fact visible only inside an answer cannot be checked, and an unverifiable claim is the failure this whole design exists to prevent — so every claim links to the record that supplied it, and the source is a place in the app, not a citation.

Capabilities are ranked instead. Three things earn a pointing route:

- **It writes.** Consequence needs a control, a gate and a record. Section 7 already says a conversation is the wrong instrument for consent that has to be recorded.
- **You do it often.** Pointing beats retyping a sentence you have typed before. Habit is a measurable claim, so this one is answerable from usage rather than taste.
- **You need to see the set.** Orientation is not a question. Which sites are halted, how the four places disagree, what a runbook will do before it runs — these are surfaces because the answer is a shape, and prose flattens shapes.

Everything else stays ask-only, and the tool list stays a tool list. The cost of that choice is discoverability: a capability with no menu item is one nobody finds by looking. It is paid back not with a UI per tool but by the agent saying what it can do at the moment it is relevant — the alternatives it offers when it refuses, the procedure it names before it starts. That is the tail's substitute for a menu, and it is a design obligation, not a courtesy.

## 7 · What is never a session

Policy, capability grants, environment links, restore. These are where you change what the agent may do, and consent that has to be recorded is not something a conversation should elicit. A denial in conversation already ends a proposal for the session; it cannot also be the instrument that widens one.

Chat may walk you to the door and say plainly what is behind it. It is not the door.

One line needs drawing precisely, because this section could otherwise be read against the approval card. **Consent within a capability is a session act.** Approving a plan under a grant you already hold is exactly that: it happens at the gate, it is about this run, and the card records it on the run's own rationale event. **Consent about a capability is never a session act.** Widening what the agent may do — grants, policy, environment links, restore as a capability — is a settings act, recorded as one. The card and this section govern different consents, and both stand.

## 8 · What this decides

- **The two chat surfaces.** Not two designs. The companion and the stage are two ranks of one session, sharing the derivations, differing only in density.
- **The empty run.** A run with nothing in it has no consequence, so it earns no rank. The refusal stays a turn and carries the empty plan; a container pretending to be work is worse than a sentence.
- **Where the declared block lives.** Wherever the procedure is primary, which is everywhere it is armed. The question was never placement; it was rank.
- **The shell inversion argument.** Ask-first is defensible because the facts it states are inspectable and the consequential work it offers is also reachable by pointing — not because the IA is newer. That is a claim product can check.
- **How much UI the tool surface gets.** None by default. A tool earns a control by writing, by being habitual, or by having an answer that is a shape. The rest is reachable by asking, which is what natural language is for.

## 9 · Who promotes a session — ruled

A session is promoted by the user. Nothing promotes itself to the stage, and the default is not "not yet" — it is never.

A waiting gate may raise its ambient rank without limit: the needs-you count, its urgency, a one-line affordance in the companion saying a gate is waiting and where to open it. That is the pressure valve, and it should be designed to be genuinely impossible to miss. What it may not do is take the screen.

Three reasons, in order. Seizing the screen is the one power this model has granted nothing, and the gate doctrine — denial is final, pause is the canary default, refusal over quiet trimming — rests on the platform waiting at consequence rather than arriving with it. An agent that takes the stage at its own gate is eliciting its own approval, which is section 7's failure mode wearing section 2's clothes. And interruption is an autonomy question, so its answer belongs where autonomy changes are made and recorded.

If self-promotion is ever offered, it is offered as a grant, made in Settings, recorded like one. Until then the power stays unspent.
