---
title: The permissions pane — two panes become one surface, two layers
author: designer (Nexus AI UX)
source: Permissions pane.dc.html (design component, project "UX Prototyping for Intelligence Docs")
fixtures: fixtures/scenario-permissions.js
date: 2026-08-25
answers: item 4 of the addon redesign order (merge the permission panes), read against the two shipped Settings panes; plus the two questions the merge raised, both now ruled
status: BUILT 2026-08-26 (fixes-082526 phases 1-5) — both platform facts this sheet asserted were made true first: grants are (grantee, capability)-addressed with per-holder acts, and the account scope is a real write bound (wpeWriteExcludedAccounts, excluded-whole). Shipped as PermissionsPaneSection; editors door-reached.
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

**Layer 1 — the bound.** *Where agents may write at all.* Operation × place, with each operation naming its transport. Reading is always allowed and is stated once at the top, not as a row, because it is not a decision. The account scope sits at the foot of this card — see §6.

**Layer 2 — the grants.** One row per capability: the v1.3 label with its id and procedure kind, **which agents hold it**, the document and hash it is pinned to, and what granting it gates. **This layer reads and does not edit** — see §5.

## 4 · The line that makes the merge worth it

| Two panes, today | One pane, merged |
|---|---|
| Update plugins across sites — Granted | Update plugins across sites — granted to 2 of 3 |
| *(and, on the other pane)* Install or update things — Blocked on production | **Runs on your machine and staging. Blocked on production by the write bound.** |

Both statements are true today; neither says the other exists, so the reader must find the interaction themselves. The merged line is **derived from bound × capability, never authored per row** — so the day the bound changes, every clipped line moves with it.

This is the split-scope rule applied to a grant: state what runs, state what is barred, name what bars it. And it makes the grant-gates-nothing state visible on the surface that shows it — *Contain an incident* is held by two agents, needs an operation blocked on production, and can verify none of its own checkpoints. That row was previously readable only by cross-referencing two screens and a law review.

## 5 · Ruling one — a grant belongs to an agent, so this pane reads and does not edit

The address is **(agent, capability)**. A refusal comes from one agent's run, and its door has to land where the decision can actually be changed — which is inside that agent. A second editable list of the same grants would be two homes for one decision, and that is the defect this whole merge removes.

Three consequences:

- **No switch on any row.** An editable control on a read-only surface is a lie about what pressing it would do. (An earlier draft mounted one; it is gone.)
- **A row states the SET of agents that hold the grant**, never one state for all of them — the set-versus-average rule, applied to agents instead of places. One holder names itself; several name the count, and the door does the rest.
- **Every row's door leads to the agent that owns the decision.** Where several hold it, the door leads to Agents scoped to that capability.

## 6 · Ruling two — the account scope is part of the bound, not a third thing binding two layers

It is the bound's **other dimension**: places are its columns, accounts are too many to be, so they are stated beneath it. A grant reaches an account only if the bound does — which means the scope reaches grants **through** the bound rather than being applied to them separately. One mechanism, not two rules to remember.

- **Stated once**, at the foot of the bound. Not repeated per grant, because it is uniform across every operation.
- **The clipped line stays place-based, and stays accurate**: an excluded account is excluded whole, so it never changes which places a grant reaches within the accounts it does cover.
- An earlier draft said the scope "binds both layers". Nearly right, and it described one mechanism as two applications — which would have left an implementer looking for a second place to apply it.

## 7 · The pins

- One pane, two layers: a bound above, the grants below. Flattening them into one table is why the merge stalled.
- **One vocabulary per layer, each used in one place only.** Granted / denied for a grant, because a grant is an act with a record. Allowed / blocked for the bound, because a bound is a state. Different words because they are different things — not two words for one thing.
- Every grant states the bound's consequence on itself, **derived from bound × capability and never authored per row**.
- **A bound clips only what was granted.** A capability no agent holds is stopped by that, and naming a second reason would imply two.
- **A grant belongs to an agent, so this pane reads and does not edit** — no switch on any row.
- **A row states the set of agents holding a grant**, never one state for all of them.
- **Every row's door leads to the agent that owns the decision.**
- **The account scope is part of the bound** rather than a third thing binding two layers — stated once beneath it.
- A grant renders the act that made it: the event id and the moment. A grant with no act is not granted, whatever a document says.
- The document and its hash stay on the row, because a grant is pinned to a version and an edited document disarms it.
- What granting it gates is derived from the document's own checkpoints, so a capability that can verify none of them says *the grant itself and nothing after it* — on the surface that shows it, not in a law review.
- Reading is always allowed and is stated once, at the top of the bound. It is not a row, because it is not a decision.

## 8 · Absent on purpose

- No second permissions pane. Two surfaces answering one question is the defect, not the layout.
- No operation-level control per capability. The bound is fleet-wide by definition; per-capability overrides would make every row a policy engine.
- No merged table. A grant and a bound in one grid would need a cell that is both an act and a state.
- **No switch, and no editable control of any kind.** The grant is made inside the agent that holds it.
- **No single granted/denied state standing for every agent.** That would be an average over a set, and the set is what is true.
- **No repetition of the account scope per grant.** It is uniform across every operation, so stating it once is stating it.
- No green tick column. A tick beside the state chip is a second statement of one fact.
- No prose about what a capability is for. The document it is pinned to is the answer, and it is on the row.

## 9 · On column naming

The document column head is **"The document it is pinned to"**, not "Runbook". Deliberate: what the customer needs to know is that the grant is pinned to a specific version of a specific document, so an edit disarms it. That phrasing carries the consequence; "Runbook" says only that we have a name for the file. The id (`rb.bulk-plugin-update · 1.2.0`) already says runbook, in mono, on the row.

**"Runbook" earns its keep in the authoring surface**, where a person is writing one and needs a noun for the thing they are making.

One item to confirm: the rows carry **`strict procedure` / `guided procedure`** under each capability id, and that distinction is doing real work — a guided document has no checkpoints to verify, which is why two rows read "8 steps, none of them a checkpoint". Those two phrases should be ratified vocabulary rows if they are not already.

## 10 · Design-system notes

- `Chip` renders `strong` everywhere: the `subtle` fill pins its border overlay at a fixed 48px and truncates longer labels, so fill weight is unusable as an encoding and loudness comes from colour alone.
- **Nothing on this sheet is an authored control.** Both tables are plain flex rows sharing one column geometry, which is layout rather than a component the system ships.
- For the record: the bundle's `Switch` is fully usable at `size=md` (36×20 track, knob at left 2 / left 18, colours from `--control-bg-control-*`) — it is absent here because the pane does not edit, not because the component was unavailable. **Do not hand-draw one** if an editable variant is ever built.
