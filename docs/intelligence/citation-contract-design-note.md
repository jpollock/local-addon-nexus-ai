# The citation contract — design note for owner review (ADR-24 candidate)

*(Architect, 2026-08-18. The WP-25 pattern: positions to ratify or amend
before any packet exists. This is the second of the two architecture
pieces the moments model exposed — the substrate for M5's corroboration
render, the surface both the designer (rank-model §5, v6 Q10) and the
sitting practice (the judge's slowest verb was "corroborate") have
independently asked for.)*

## 0 · The gap, stated

The corroboration render's promise: every factual claim in a reply is
linked to the record that supplied it, and an unlinked claim is
visually loud. Today that link is NOT derivable. R3 established
supplied-vs-quoted at the SOURCE level (the manifest knows what rode
the turn), but joining a specific sentence to a specific record is
per-CLAIM, and nothing in the pipeline carries that join. A renderer
that guessed the join by textual similarity would be a plausibility
matcher — the exact dishonesty the surface exists to prevent. The join
must be authored by the only party who knows it: the model, at the
moment it makes the claim.

Evidence it can: in all nine sitting transcripts the model quoted
`evt_` ids and named its tools unprompted when the carrier showed them.
The behavior exists; it lacks a contract.

## 1 · Positions

**P1 · Citations are model-authored spans, platform-verified for
EXISTENCE, never for support.** The model marks factual claims with the
id of the supplying record: a ledger event id (`evt_…`), a tool call of
the current task (by tool name + call index), or the carrier itself
(the policy set / procedure / freshness lines, each addressable). The
platform verifies the cited record EXISTS in this task's supply (the
manifest + trace are the universe) and renders the link. Whether the
record actually SUPPORTS the sentence is a quality claim — P4 says the
platform never verifies quality, so adherence is judged by evals and
sittings (the fabrication cross-check, mechanized), never by the
gateway. A citation of a record that does not exist in the task's
supply renders as the loudest state of all.

**P2 · The span format is minimal and rides inside prose.** One
inline marker per claim, referencing the supply by id — exact syntax to
be fixed at the packet (the constraint: cheap for the model to emit,
invisible-or-elegant when rendered, impossible to confuse with user
content). The format is an OUTPUT convention, not a new event topic, a
new envelope field, or a carrier change: the ids it cites all exist
today. The carrier gains one instruction block telling the model the
convention — which makes the convention itself versioned policy,
re-asserted by hash like everything else on the carrier.

**P3 · Unlinked is a state, not an error.** Conversational glue,
reasoning, and hedged inference ("this SUGGESTS…") are legitimately
uncited. The render distinguishes three states: cited-and-resolves
(quiet link), cited-but-unresolvable (loud — the P1 failure), and
uncited-factual-claim (loud in M5/Investigate contexts, quiet
elsewhere — the moment decides the strictness, per the moments model:
Investigate is where an unlinked claim is the failure; Glance never
renders citations at all). The classifier for "factual claim" is the
eval's judgement, not the renderer's — the renderer renders what the
model marked and what it didn't, and the EVAL judges whether the
marking was honest. No NLP in the render path.

**P4 · The eval half precedes the surface, per the B-03 discipline.**
A new criterion family on existing specs (E-01, B-03, D-02 when it
runs): every historical/stateful specific in the reply carries a
citation that resolves; a citation that resolves to a record that does
not contain the cited fact is fabrication-with-a-costume — a FAIL more
damning than an honest omission. The sitting judge's cross-check
becomes: follow the links, spot-check the joins. The fabrication check
drops from an hour to minutes — which was v6 Q10's ask.

**P5 · The judge and the user read the same joins.** The eval sheet
imports the same claim→record resolution the renderer uses (the
PROCEDURE_AUDIT_COLUMNS precedent — column-for-column consistency as a
compile-time fact). One join, two consumers, no drift.

## 2 · What this is NOT

Not RAG-style citations of external documents — every citable id is a
record the platform itself supplied this task. Not gateway enforcement —
an uncited reply is never refused. Not retroactive — old transcripts
render without citations and say so. Not a new trust class — the
citation inherits the cited record's trust label, which the carrier
already carries.

## 3 · Sequencing

The convention + carrier instruction + eval criteria are one packet
(model-facing); the render is the M5 surface packet after it (designer
cycle 3 in the companion). The convention packet can run a sitting
BEFORE any UI exists — three runs judging citation adherence — which is
the evals-before-surfaces discipline applied to the contract itself.
After WP-25 (incidents give M5 its content) and alongside WP-30 (the
session registry gives the render its task universe cheaply).

## 4 · Escalations pre-answered

The carrier instruction block is a carrier change → gate hold as
always. If the packet finds the model needs a structured channel
BEYOND inline spans (a citations array on the reply), that is a chat
protocol change → escalate before building. Anything wanting the
gateway to judge citation quality: refused by this note, P4 governs.
