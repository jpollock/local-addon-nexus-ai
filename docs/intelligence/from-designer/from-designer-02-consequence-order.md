---
title: Design position §2 — The consequence order, tested
author: designer (Nexus AI UX)
source: Consequence order.dc.html (design component, project "UX Prototyping for Intelligence Docs")
committed_by: architect, verbatim
date: 2026-08-18
answers: the architect's five-tier consequence order (moments-model 1.2 §4a)
status: all six fixes adopted; model moved to 1.3; deferral ruled a session act
---

# The consequence order, tested

*Five tiers pressure-tested against the list they produce. The tiers are right about items and wrong about lists, and the difference is visible in one rendered morning.*

18 August 2026 · answers the moments response §3 and model 1.2 §4a · composes with §0 and §1

## The part that is right

What the delay costs and who can pay it is the correct axis, and the tier-1-over-tier-2 distinction is the ruling I would have got wrong: a half-changed world compounding against an untouched world keeping is exactly the asymmetry between what an abort stops and what it cannot undo. Tier 3's cost being epistemic rather than operational, and compounding, is also right, and it is the tier I would not have thought to place above finished work.

Every input being derived means the sort can be pinned end to end, which is the property that matters most and the one the row has never had.

Six tears follow. Five are about the difference between ordering items and composing a list; one is a case the tiers already own by their own definitions and have not noticed.

## 1 · Where it tears

### Tear 1 · scope — The five tiers span two columns and one thing that belongs in neither

Return was ruled as two columns of one verdict: waiting and changed. Tiers 1 to 3 are the waiting column. Tier 4 is the changed column. Tier 5 needs nothing of the user at all — a fact past its SLO is not an item of work, it is a property of a fact.

A single comparator across all five compares things that are not alternatives to each other. Nobody chooses between resolving a halt and reviewing a finished purge; they are answering two different questions, and forcing one sort makes the ordering of the boundary rows meaningless while giving the list a false shape.

**Fix:** The order runs WITHIN a column, not across the list. Tiers 1 to 3 order the waiting column; tier 4 orders the changed column; tier 5 leaves the list and lives on the fact it describes, as the date on its chip. Drift is a rendering rule for facts, not a row in a triage.

### Tear 2 · granularity — It orders events, and the user has situations

Charlie's halt, the checkout verify that failed, and the incident that opened are one thing that happened. All three are tier 1, all three touch production, all three are within an hour of each other, so the comparator will faithfully produce three adjacent rows describing one situation from three angles — and the situation itself, which is the thing she needs, appears in none of them.

This is the same failure as the abort panel's lead line counting rather than asserting, one level up: a correct list of parts is not a verdict about the whole. Ranking cannot fix it because ranking's inputs are already too small.

**Fix:** The comparator sorts SITUATIONS. Where a causal link exists in the record — the halt that produced the failing verify that opened the incident — they coalesce into one row, ranked at the highest tier of its members, expandable to its parts. Coalescing is derived from the links, so it stays a computed verdict. Uncoalesced events remain their own situations of one.

### Tear 3 · structure — Tier 3 is not a tier, and if it stays one it will flood the place it is guaranteed

Two special rules ride on tier 3: it can never interrupt, and it can never be sorted below the fold. A comparator with a can-never-be-below-the-fold exception is no longer a sort — it is a sort plus a pin, and the two rules can contradict each other whenever tiers 1 and 2 are numerous enough to fill the fold. An implementation forced to choose will choose by accident.

The other half is worse. Going blind is not one item. Twelve dark producers under a visibility guarantee become twelve rows in the list they were promised a place in, and the epistemic tier evicts the operational one it was ranked below.

**Fix:** Make it structure rather than rank: the ambient list has one RESERVED epistemic slot, always rendered, holding exactly one derived row — the record's own health, folded and counted. It cannot be scrolled away and it cannot grow. Tier 3 then stops being a tier and becomes what the special rules were already saying it was.

### Tear 4 · a case the tiers already own — A canary gate is tier 1 by tier 1's own definition, and the list puts it in tier 2

Tier 2's justification is that the world is untouched. But the canary exists precisely so that one site is changed before the rest, which means every gate after a canary write sits on a part-changed fleet. By tier 1's own words — the world is mid-change and only you can move it — that gate is tier 1, and the tier list has not noticed because it classified by the event's name rather than by the state it is in.

The same logic covers a gate with a deadline: a maintenance window closing, a plan whose dry-run is about to go stale, an update whose CVE is being exploited. There the cost of delay is not linear and the tier's arithmetic does not hold.

**Fix:** Classify a gate by the state of the world behind it, not by its kind: a gate is tier 1 when any write has already landed in its scope, or when its cost of delay has a derivable deadline. Otherwise tier 2. The dry-run's own staleness clock makes the second condition derivable rather than a judgement.

### Tear 5 · time — Age as the tiebreaker manufactures furniture

Oldest first is right about accrual and wrong about attention. A tier-1 halt she has consciously decided not to resolve this week will climb, hold the top, and be looked past — and the row she has learned to look past is the row that teaches her the top of the list is not worth reading. The prohibition-loses-to-a-deadline problem, one layer up: a warning with no way to be answered gets answered by ignoring it.

The order has no concept of a consequence the user has already weighed. It cannot get one from the record, because the record contains no such act today.

**Fix:** Add deferral: tier and place kept, escalation intensity lowered, a reason recorded on the run. Never a dismissal, never a change of tier, never removal from the list. Where that act lives is the one thing I cannot rule — §4 below.

### Tear 6 · derivation — Place is a set, and the rule reads it as a value

Production above staging above local orders a row by the place it touches, but a fleet run's affected set spans places — production on two sites, staging on three. Read as a value, place becomes the one input in the comparator that somebody has to author, which is the failure the whole order was built to avoid.

It is also information the user wants on the row rather than only inside the sort.

**Fix:** An item's ordering place is the highest-consequence place in its derived affected set, and the row shows the set rather than the winner: touches production on 2 of 5. Sort key and rendered fact come from the same derivation, so the sort is inspectable in the place it is used.

## 2 · One morning, both ways

The same overnight state, rendered twice. Eight live things: the halt at Charlie, the failing checkout verify that halted it, the incident it opened, an approval waiting inside a canary that has already written to Bravo, three producers gone dark, a finished cache purge across twelve sites, and forty-one facts past their SLO.

**The order as written · 8 rows**

| Tier | Row | Meta |
|---|---|---|
| T1 | Run halted at Charlie — 2 done and standing, 2 untouched | prod · 14h |
| T1 | Verify failed on Charlie: checkout | prod · 14h |
| T1 | Incident open: checkout 500 on Charlie | prod · 13h |
| T2 | Approval waiting: remediate Bravo | prod · 3h |
| T3 | Producer dark: plugin-inventory | — · 9h |
| T3 | Producers dark: health, content-age | — · 6h |
| T4 | Finished: cache purge across 12 sites | mixed · 5h |
| T5 | 41 facts past their freshness SLO | mixed · 2d |

Charlie's one situation occupies three of the top four rows and none of them says what is true — that the fleet is part-changed and a checkout is down. The canary gate sorts below three rows that are all its own consequence. The two epistemic rows are correct by tier and present by exception. Two of the eight rows need nothing of her at all.

**Under the six fixes · 2 waiting, 1 reserved, 1 changed**

| Column | Row | Detail | Meta |
|---|---|---|---|
| Waiting · 1 | Charlie is part-changed and its checkout is down | Halted at Charlie · 2 done and standing, 2 untouched · verify failed on checkout · incident open · 3 parts | production · 14h |
| Waiting · 1 | Bravo is waiting on you mid-change | Canary already written · approval gate 3 of 8 in remediate · dry-run stale in 41m | production · 3h |
| Reserved | The record is going blind — 3 producers dark | plugin-inventory 9h, health 6h, content-age 6h · verdicts about 47 sites unverifiable | oldest 9h |
| Changed | Changed while you were away — cache purge across 12 sites | Filed against its runbook · 12 of 12 verified | 5h |

Same inputs, same comparator, same derivations. One situation is one row that names where she is needed; the canary gate is in tier 1 where its own definition puts it; going blind holds its reserved place as one folded row that cannot flood it; the finished run is in the other column; drift is on the facts, where the date already lives.

## 3 · What the fixes change in the rule, stated for adoption

- **The order runs within a column.** Tiers 1 to 3 order waiting; tier 4 orders changed; tier 5 leaves the list for the facts it describes.
- **The unit is the situation.** Causally linked events coalesce into one row at the highest tier of its members, expandable to its parts, coalescing derived from the record's links.
- **Tier 3 becomes a reserved slot.** One always-rendered folded row for the record's own health. Cannot be scrolled away, cannot grow, cannot interrupt.
- **Gates classify by world state.** Tier 1 when a write has landed in scope or the delay has a derivable deadline; tier 2 otherwise.
- **Place is a set.** Ordered by the highest-consequence place in the derived affected set; the row shows the set.
- **Deferral, pending the §4 ruling.** Tier and position kept, escalation lowered, reason recorded. Never a dismissal.

None of these touches the axis. The order still ranks by what the delay costs and who can pay it, and the column still changes hands only by the user's promotion.

## 4 · What I am asking, and it is one ruling

Deferral. A standing tier-1 halt the user has consciously decided not to resolve today will hold the top of the list for as long as it stands, and age-oldest-first will keep pushing it up. Within a week it is furniture, and a row you have learned to look past is worse than no row, because the list's own credibility is what makes the top of it worth reading.

So I want a deferral that is not a dismissal: the item keeps its tier, keeps its place in the list, and loses only its escalation intensity, with the reason recorded on the run. What I cannot rule is where the act lives. It is not a widening, so §7 does not obviously send it to Settings — but it is a statement about consequence that the platform will honour later, which smells like something that has to be recorded at a control rather than said in passing.

My reading is that it is a session act, on the same footing as approving a plan under an existing grant: it is about this halt, at this moment, and the record is the run's own. If that is right, the ambient list needs one affordance I have not designed yet and the escalation has a second input. If it is wrong, deferral belongs in Govern and the list stays honest by never forgetting anything, which I could also defend — but then we should say plainly that furniture is the price and design the row to survive being ignored.

## 5 · What I will do next either way

Cycle one proceeds as amended: M4's two densities with selection-becomes-scope in the arming. The rendering above is not that cycle's work and should not be read as the needs-you design — it is the argument in the only form that could carry it. When cycle two arrives with the incident producer behind it, that row gets designed properly, against the order as ratified, with the coalescing rule and the reserved slot as constraints rather than as opinions.

One note on J-Refusal and the live incident. The eval predicting the failure that had already happened is not the method working on my side — the eval is a restatement of the doctrine you had already written down, applied to a walk nobody had written a test for. What made it land was that the doctrine was specific enough to be turned into a test by someone who did not know the incident. That is worth keeping in mind for the consequence order, which is now the newest and least tested thing in the stack, and which I would not want ratified on the strength of one designer's morning.
