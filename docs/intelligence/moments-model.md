# The moments model — a working taxonomy of the Nexus experience

*(Architect draft 1, 2026-08-18. The genre of the original intelligence
concept doc, for the same job: name the material before building more of
it. The intelligence layer became systematic the day work could be asked
"which of the five types are you moving, from which source, to where?"
This document exists so every surface, packet, and design cycle can be
asked "which moment does this serve, and what does that moment need?" —
and so complexity has a unit of account. DERIVED, not invented: every
moment below cites the evidence it was compiled from. For pressure-test
by the owner and the designer; what survives becomes the fourth law
beside the vocabulary, the rank model, and derived-never-authored.)*

## 1 · The claim

Complexity is total surface; experienced simplicity is per-moment
surface. A product can be deep and feel simple if each moment a person
is in shows only what that moment needs — and a product can be shallow
and feel bewildering if every capability is present in every moment.
The unit of design is therefore not the screen, the feature, or the
session. It is the **moment**: a recognizable state of user intent and
attention, with its own center, its own edge, and its own exits.

A moment is to the experience what an intelligence type is to the
substrate. The rank model says how much screen a session gets; the
moments model says what belongs on it and what would be noise.

## 2 · The six moments, and the seventh that governs them

**M1 · Glance** — *"Am I okay? Where am I?"*
Orientation without investigation. Seconds, not minutes; often the whole
visit.
Evidence: the where-am-I session (S1); the site-context strip and
content-age chip in daily use; the health line's one-glance verdict; the
designer's needs-you row; "203 sites · 367 environments · 284 checked in
the last day."
Center: state, pre-answered — counts, ages, verdicts, the needs-you row.
Edge: one route deeper per fact (the door, per rank-model §5).
Intelligence in, unasked: freshness (per-class SLOs), health, the
needs-you fold.
Never shows: procedure ceremony, transcripts, anything requiring a
decision.
Rank affinity: ambient; companion at most.

**M2 · Inspect** — *"How do these differ? What changed?"*
Comparison and drill-down; the answer is a shape, not a sentence.
Evidence: the site-at-places matrix ruling (divergence = comparator
verdict); the change report with hold durations; E-01's fleet-picture
tables — every sitting run BUILT one before acting; the designer's §6:
"orientation is not a question… prose flattens shapes."
Center: the matrix, the change report, the audit record — data surfaces
chat points at and never contains.
Edge: the ask ("why does staging differ?") and the act (the act-big
this inspection is about to become).
Intelligence in, unasked: lineage explaining a disagreeing cell;
history badges on components with incidents.
Never shows: an AI summary INSTEAD of the shape; unlinked claims.
Rank affinity: primary is the data; chat is companion.

**M3 · Act-small** — *"Change this one thing."*
One site, one deliberate change, ceremony proportional to consequence —
which for a read is none and for a write is the full gate, every time,
no decay (the adopted §2 law).
Evidence: the five-turn session (two reads quiet, write loud); wp-tools
daily use; the designer's rule "a second write gets the same full gate
treatment as the first."
Center: the thing being changed and its gate.
Edge: the fact that motivated it (linked), the record it will leave.
Intelligence in, unasked: staleness re-check before acting (the
freshness constraint); the one-line history flag if the component has
bitten before.
Never shows: act-big machinery — a canary for one site is noise.
Rank affinity: companion.

**M4 · Act-big** — *"Do this across the fleet — show me the plan and
the process."*
Many targets, a declared procedure, plan-approve-watch. The owner's own
words: "I'll be keen to know the plan and the process."
Naming note: draft 1 said "Campaign", renamed at owner review — in the web world that word means marketing, and a moment must not borrow a domain word its users already own.
Evidence: B-03 whole — three sittings of it; the procedure surfaces
shipped at phase 1; the halted-sites live run; the abort groups;
RB-A2's folding.
Center: THE RUN — declared block, checkpoint marks, the card, per-site
outcomes. The procedure outranks the transcript (rank-model §4).
Edge: the transcript as margin; the data each decision cites.
Intelligence in, unasked: consult-history shaping the plan; the canary
reason; per-site attestation.
Never shows: raw tool rows as the primary narrative; a container for an
empty run.
Rank affinity: companion while watching; stage while deciding.

**M5 · Investigate** — *"Something is wrong. Walk the evidence."*
Symptom to cause to fix, with the record as the trail.
Evidence: D-02's shape (sentinel findings → containment → remediation);
the incident fixture's story (checkout 500, correlated, resolved); the
diagnose-site runbook; the corroboration render ruling (v6 Q10) — the
investigate moment is WHY corroboration is load-bearing.
Center: the evidence chain — findings, incidents, the claims-linked-to-
records rendering.
Edge: the acts it licenses (contain, remediate — each an act-big with
its own grant, per the split runbooks).
Intelligence in, unasked: episodic history FIRST (consult-before-risk is
this moment's law); correlation candidates; what changed just before.
Never shows: a cheerful summary where the chain should be.
Rank affinity: stage — this is conversational work by nature.

**M6 · Return** — *"What happened while I was away? What needs me?"*
Delegated or long-running work, re-entered. The co-work moment proper:
the agent worked; the human returns to consequence, not to a scrollback.
Evidence: sessions-sorted-by-consequence; the needs-you list; the
record rank ("filed, against its runbook"); the abort groups' four
honest counts; scheduled agents running overnight in the real product.
Center: what is WAITING (gates, halts) and what CHANGED (outcomes,
folds) — never the transcript first.
Edge: each item's session, one promotion away; the record for what is
finished.
Intelligence in, unasked: the triage itself — rank by consequence is a
derived verdict.
Never shows: everything-since-you-left as prose.
Rank affinity: ambient → wherever the wait lives.

**M7 · Govern** — *"Change what the agent may do."* *(the meta-moment)*
Grants, policy, environment links, restore, autonomy. Deliberately NOT
a session (rank-model §7, ratified): consent that has to be recorded is
made at a control, not elicited in conversation. Chat walks you to the
door and says plainly what is behind it.
Evidence: the grants story (WP-20b, the deny-flip's mandatory ruling);
c.denial-is-final; the permissions matrix verified against the shipped
model; the self-promotion ruling (a gate escalates ambient rank, never
takes the screen — autonomy changes are grants, made where grants are
made).
Center: the matrix, the grant list, each widening visible and revocable.
Edge: the record of every change (control.grant.\*), and the refusals
that sent you here.
Never shows: a conversational shortcut around a recorded consent.

## 3 · The walk — moments connect, and the connection carries context

Real work is a walk, and the handoff artifact is what makes the product
feel like one mind rather than seven rooms:

Glance → Inspect: the disagreeing cell / the needs-you row IS the
doorway; arrive with the fact in hand (rank-model §5's "a route, not a
destination").
Inspect → Act-big: the behind-set becomes the plan's scope — the
matrix's selection is the dry-run's target list.
Act-big → Investigate: the abort or the failed verify carries its
evidence (per-site outcome, backup id) into the trail.
Investigate → Act-big: the confirmed fix becomes a rollout under its
own runbook (containment hands off to remediation — the split runbooks
already encode this walk as an enforceable precondition).
Any refusal → Govern: the instructive refusal names the missing grant
and the door; Govern → back, with the widening recorded.
Away → Return → any: the needs-you item promotes into its session with
nothing lost (the promotion pins).

The test of the model is the walks, not the rooms: if a transition
drops its artifact and the user must re-establish context, two moments
have been built as two products.

## 4 · The routing table for attention

| Moment | Center stage | At the edge | Intelligence rides in | Never shows | Rank affinity |
|---|---|---|---|---|---|
| Glance | pre-answered state | one door per fact | freshness, health, needs-you | ceremony, decisions | ambient/companion |
| Inspect | the shape (matrix, report) | ask + act | lineage, history badges | prose instead of shape | data primary |
| Act-small | the change + its gate | motivating fact, record | staleness re-check, history flag | act-big machinery | companion |
| Act-big | the run | transcript as margin | history→plan, canary reason, attestation | tool rows as narrative | companion↔stage |
| Investigate | the evidence chain | licensed acts | episodic first, correlation | summary instead of chain | stage |
| Return | waiting + changed | sessions, record | consequence triage | scrollback first | ambient→anywhere |
| Govern | controls + grants | the change record | the refusals that routed here | conversational consent | its own pages |

## 5 · The laws this composes with — and the budget it adds

The vocabulary says what words mean. The rank model says how much
screen. Derived-never-authored says what a surface may claim. The
moments model adds the fourth: **what a moment may contain** — and with
it the complexity budget: (a) a feature that serves no named moment is
complexity by definition and is not built; (b) every addition to a
moment names what it retires or folds within that moment; (c) the walk
list is closed — a new transition is a design decision, recorded, not
an emergent accident.

## 6 · Journey evals — the B-03 pattern, applied to experience

Each moment gets one golden journey defined BEFORE its surfaces are
built or revised, with must/must-nots, split exactly like B-03: the
programmatic half (the route exists; the promotion loses nothing; every
claim links; the never-shows list is absent — these become pins) and
the judged half (owner sittings, watching a real walk). Three exist in
embryo already: J-Act-big IS B-03; J-Investigate IS D-02; J-Glance is
the where-am-I contract plus "from cold open to 'anything wrong?' in
one look, zero questions asked." The remaining four want writing at the
same eleven-criteria discipline. The eval registry treats them like any
spec: BLOCKED until their surfaces exist, never green by assumption.

## 7 · What this decides right now

Phase 1.5's densities serve M4 (Act-big) — the run view is that
moment's center, at two ranks. WP-29 serves the same moment at stage.
The matrix serves M2 and feeds M1. The incident producer (WP-25)
unblocks M5's substrate and M6's needs-you. The corroboration render is
M5's center. Settings-after-the-flip is M7 built once, honestly. The
sequencing we ruled by substrate-readiness turns out to be a walk
through the moments — which is the reassurance the step-back deserves:
the plan was already converging on this shape; now it has the name.

## 8 · Open for pressure-test, named

(1) Is Act-small real, or is it a act-big of one — does collapsing
them cost the low-ceremony read path or save a moment? (2) Does
Investigate need surfaces of its own beyond stage-chat plus the
corroboration render and the record? (3) Where does CONTENT work live —
the strategist scenario (drafts, the safe split's content half) walks
Glance→Inspect→Act-small but touches none of the fleet machinery; is it
a resident of these moments or a missing seventh working moment? (4) Is
Return one moment or two (returning-to-waiting vs reviewing-the-
finished — the rank model's Record suggests the split)? (5) The count
itself: six working moments is a claim about users, not about us — the
designer's session inventory and real usage (the ledger can measure
which walks actually happen) should confirm or amend it.
