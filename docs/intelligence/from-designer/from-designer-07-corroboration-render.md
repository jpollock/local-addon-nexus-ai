---
title: Cycle three — The corroboration render
author: designer (Nexus AI UX)
source: Corroboration render.dc.html (design component, project "UX Prototyping for Intelligence Docs")
committed_by: architect, verbatim
date: 2026-08-18
answers: ADR-24 · the citation contract (citation-contract-design-note.md); cycle three in moments-companion-for-designer.md §3
status: ratified — eight pins inherited by the M5 surface packet; XD-24 registered
---

# The corroboration render

*M5 Investigate at stage rank · ADR-24's three states rendered · 1440×1024*

The render draws what the model marked and nothing else: a citation that resolves is quiet, a citation that does not resolve is the loudest thing on the surface, and an uncited factual claim is loud here because Investigate is the moment where it matters. No similarity matching, no classifier, no confidence — the reply's honesty is the eval's question, not the renderer's.

## 4a · The evidence chain

One reply about Charlie's checkout, six spans, three states. The header tally is derived from the spans it counts: *3 claims linked · 1 citation that does not resolve · 1 fact with nothing offered*.

| Claim | State | Marker |
|---|---|---|
| Checkout has been returning 500s on Charlie since 02:14 this morning. | resolves | `evt_9c41` · ledger event · incident.opened |
| The WooCommerce update landed at 02:07, seven minutes before the first error. | resolves | `evt_8f21` · ledger event · task.action.executed |
| payment-gateway-x was updated on the same site forty minutes earlier. | unresolvable | `evt_8e90` · not in this task's supply |
| Both sites that broke on a WooCommerce update before were running that same gateway version. | uncited factual claim | *no record* · a fact with nothing offered for it |
| That points at the gateway rather than at WooCommerce itself, but I have not proved it. | uncited glue — legitimate | none |
| The backup taken before the update is verified and fourteen minutes older than the failure. | resolves | `wpe_backup_and_verify #2` · tool call of this task |

Each cited sentence carries its record's id where the sentence ends — a door, not a footnote, and never a copy of the record's contents. The unresolvable citation is the loudest state on the surface because a claim pointing at a record nobody supplied is worse than a claim pointing at nothing: it looks like evidence.

**The record peek** (side panel) shows identity, topic, time, the derived supply sentence, a one-line machine summary and the door — *Open in the record, against its runbook* — under the note: "A citation is a route, not a copy. The reply never renders the record's contents — this is identity, trust label, and the door."

**The unresolved panel** states it plainly: "No record with this id was supplied to this task. The claim above may still be true — the platform cannot say, and will not guess," with a door to search the ledger for the id.

## 4b · The same facts at other ranks

**Glance — no citations rendered.** The halt and the failing verify as a needs-you row: "Same facts, no citations. Glance renders none: every count here is derived and dated where it sits, and a glance that argues its sources is no longer a glance."

**Before the convention.** "This session predates the citation convention. Nothing in it is linked, and the platform cannot say now what supplied each sentence. Read it as a transcript, not as evidence." An old session must not render as though every sentence chose to go uncited.

## The pins this render owes · J-Investigate

- The render draws what the model marked, and nothing else: no textual similarity, no classifier, no inference about which sentence a record supports. A guessed join is a plausibility matcher wearing evidence's clothes.
- Existence is checked against this task's supply — the manifest and the trace are the universe. Support is never checked here; whether the record backs the sentence is the eval's question.
- Three states, and the unresolvable one is the loudest thing on the surface.
- Strictness comes from the moment, not the renderer: Investigate renders an uncited factual claim loudly, and Glance renders no citations at all.
- A citation is a route to the record where it lives — identity, its trust label, and a door. The reply never contains a copy of the record's contents.
- A citation inherits the cited record's trust label, verbatim. The render never invents a label, a score, or a confidence of its own.
- A session from before the convention says so, rather than rendering as though every sentence chose to go uncited.
- The judge and the user resolve through one join: the eval sheet's claim-to-record column is this render's link, asserted as a compile-time fact.

## What is absent, and on purpose

- No confidence numbers, no percentages, no traffic lights. The states are three and each one names what is true about the citation.
- No footnote list at the end of the reply. Doors sit where the claim is; a bibliography moves the evidence away from the sentence that needs it.
- No record contents inside the reply — the data is never inside the chat, and a copy is a second place a fact can be wrong.
- No NLP in the render path, so no sentence is ever reclassified after the model wrote it.
- No refusal: an uncited reply still renders. The gateway does not judge citation quality and this surface does not either.
- No retroactive citation. Old replies are not re-linked by matching text, which is the one thing that would make every link untrustworthy.

## Design-system note

The marker is the bound system's `Chip` at `size=xs`, whose implemented colours map one-to-one onto ADR-24's states: `neutral/subtle` for a citation that resolves, `error/strong` for one that does not, `warning/subtle` for a fact with nothing offered. No fill, ring or text colour is authored on the sheet. The guide's mono-for-identifiers convention and Chip's UI face disagree; the Chip is kept unmodified, and a mono marker variant would be a proposal through the vocabulary loop rather than a local override.
