---
title: The permissions pane — two panes become one surface, two layers
author: designer (Nexus AI UX)
source: Permissions pane.dc.html (design component, project "UX Prototyping for Intelligence Docs")
fixtures: fixtures/scenario-permissions.js
date: 2026-08-25
answers: item 4 of the addon redesign order (merge the permission panes), read against the two shipped Settings panes
status: proposed
---

# The permissions pane

*A grant is a decision about one capability. A bound is a limit across all of them. They did not merge because they were being flattened into one table.*

## 1 · Why this is urgent: the two panes contradict each other

Read off the shipped screens, not inferred:

| Capabilities agents may use | What agents may do | The reading |
|---|---|---|
| Pull a site from WP Engine — **Denied** | Copy a site down — **Allowed** everywhere | Two surfaces answer one question with opposite words, and nothing says which wins. |
| Promote one environment to another — **Never by default** | Delete or promote an environment — **Blocked** everywhere | One prohibition stated twice, in two vocabularies. Changing one leaves the other standing. |
| Granted · Denied · Never by default | Allowed · Blocked | Two words for one concept, so a reader cannot tell whether they are the same thing. |

A person reading both cannot tell whether an agent may pull a site. That is not a wording problem — it is two surfaces answering one question with no rule about which is authoritative.

## 2 · Why the merge stalled, and the fix

They are not the same kind of thing:

- A **grant** is per-capability, recorded as an act (`control.grant.issued · evt_… · 18 Aug, 14:11`), cited by refusals, and what a door lands on. **A decision.**
- A **bound** is fleet-wide, applies across every capability, and is recorded as no act about any one of them. **A limit.**

Flattened into one grid, they would need a cell that is both an act and a state. **Stacked, they merge:** the bound is the outer limit, and each grant states the bound's consequence on itself.

## 3 · The structure

**One pane. Bound above, grants below.**

**Layer 1 — the bound.** *Where agents may write at all.* Operation × place, with each operation naming its transport. Reading is always allowed and is stated once at the top, not as a row, because it is not a decision. The account scope sits at the foot of this card and **binds both layers**, and says so.

**Layer 2 — the grants.** One row per capability: the v1.3 label with its id and procedure kind, the grant state with its `Switch` and the act that made it, the document and hash it is pinned to, and what granting it gates.

## 4 · The line that makes the merge worth it

| Two panes, today | One pane, merged |
|---|---|
| Update plugins across sites — Granted | Update plugins across sites — Granted |
| *(and, on the other pane)* Install or update things — Blocked on production | **Runs on your machine and staging. Blocked on production by the write bound.** |

Both statements are true today; neither says the other exists, so the reader must find the interaction themselves. The merged line is **derived from bound × capability, never authored per row** — so the day the bound changes, every clipped line moves with it.

This is the split-scope rule applied to a grant: state what runs, state what is barred, name what bars it. And it makes the grant-gates-nothing state visible on the surface that grants it — *Contain an incident* is granted, needs an operation blocked on production, and can verify none of its own checkpoints. That row was previously readable only by cross-referencing two screens and a law review.

## 5 · The pins

- One pane, two layers: a bound above, the grants below. Flattening them into one table is why the merge stalled.
- **One vocabulary per layer, each used in one place only.** Granted / denied for a grant, because a grant is an act with a record. Allowed / blocked for the bound, because a bound is a state. Different words because they are different things — not two words for one thing.
- Every grant states the bound's consequence on itself, **derived from bound × capability and never authored per row**.
- **A bound clips only what was granted.** A denied capability is stopped by its denial, and naming a second reason would imply two.
- A grant renders the act that made it: the event id and the moment. A grant with no act is not granted, whatever a document exists.
- The document and its hash stay on the row, because a grant is pinned to a version and an edited document disarms it.
- What granting it gates is derived from the document's own checkpoints, so a capability that can verify none of them says *the grant itself and nothing after it* — on the surface that grants it, not in a law review.
- The account scope binds both layers, and says so. A scope that was silent about one layer is the defect this merge removes.
- Reading is always allowed and is stated once, at the top of the bound. It is not a row, because it is not a decision.

## 6 · Absent on purpose

- No second permissions pane. Two surfaces answering one question is the defect, not the layout.
- No operation-level control per capability. The bound is fleet-wide by definition; per-capability overrides would make every row a policy engine.
- No merged table. A grant and a bound in one grid would need a cell that is both an act and a state.
- No inferred agent. Nothing names whose grants these are, because guessing would put a second editable home under every grant.
- No green tick column. A tick beside the state chip and the `Switch` is a third statement of one fact.
- No prose about what a capability is for. The document it is pinned to is the answer, and it is on the row.

## 7 · Two gaps the merge exposes, stated rather than guessed

**Whose grants are these?** Agents carry their own permissions in their own context, so a grant's address is **(agent, capability)** — and nothing on this pane names an agent. Either this list says whose grants it holds, or it is the fleet-wide read-only view and the editable control lives inside each agent. Drawn as a stated absence with a door to Agents, because guessing wrong would put a second editable home under every grant.

**Does the account scope cover grants too?** The scope was a control on the bound pane only, so it was silent about grants. Merged, it cannot be: three accounts are excluded, and a granted capability either reaches them or does not. **Drawn as covering both, and stated on the scope itself.** If that reading is wrong, the scope must say which layer it binds — an unstated scope is the one thing a permissions surface cannot have.

## 8 · On column naming

The document column head is **"The document it is pinned to"**, not "Runbook". Deliberate: what the customer needs to know is that the grant is pinned to a specific version of a specific document, so an edit disarms it. That phrasing carries the consequence; "Runbook" says only that we have a name for the file. The id (`rb.bulk-plugin-update · 1.2.0`) already says runbook, in mono, on the row.

**"Runbook" earns its keep in the authoring surface**, where a person is writing one and needs a noun for the thing they are making.

One item to confirm: the rows carry **`strict procedure` / `guided procedure`** under each capability id, and that distinction is doing real work — a guided document has no checkpoints to verify, which is why two rows read "8 steps, none of them a checkpoint". Those two phrases should be ratified vocabulary rows if they are not already.

## 9 · Design-system notes

- The grant control is the bundle's `Switch` at `size=md` — a 36×20 track with the knob at left 2 or left 18, every colour from `--control-bg-control-*`. Fully usable; nothing about it is authored. **An earlier draft of this sheet hand-drew it seven times with hardcoded blues**, which is the defect this note exists to prevent.
- `Chip` renders `strong` everywhere: the `subtle` fill pins its border overlay at a fixed 48px and truncates longer labels, so fill weight is unusable as an encoding and loudness comes from colour alone.
- Nothing else on this sheet is an authored control. Both tables are plain flex rows sharing one column geometry, which is layout rather than a component the system ships.
