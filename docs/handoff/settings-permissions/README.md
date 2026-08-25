# The permissions pane — ready to build

One sheet, one fixture. Merges the two Settings panes ("What agents may do" and
"Capabilities agents may use") into one surface with two layers.

| Position document | Sheet | Fixture |
|---|---|---|
| `from-designer-20-permissions-pane.md` | Permissions pane | `scenario-permissions.js` |

## Start here: the two shipped panes contradict each other

- `cap.wpe_pull` reads **Denied** while "Copy a site down" reads **Allowed** everywhere.
- `cap.promote_environment` reads **Never by default** while "Delete or promote an
  environment" reads **Blocked** everywhere — one prohibition, two vocabularies.
- Granted / Denied / Never-by-default vs Allowed / Blocked — two words for one concept.

A person reading both cannot tell whether an agent may pull a site. Fixing that is the
point of this merge, not the layout.

## The one structural idea

A **grant** is per-capability and recorded as an act. A **bound** is fleet-wide and
recorded as no act. Flattened into one grid they would need a cell that is both an act
and a state — which is why the merge stalled. Stacked, they compose:

    bound (fleet-wide limit, its accounts stated beneath it)
      └── grants (per-agent decisions, each stating the bound's effect on itself)

## Both open questions are ruled — build against these

**A grant belongs to an agent, so this pane READS and does not edit.** The address is
(agent, capability); a refusal comes from one agent's run and its door must land where the
decision can be changed. So: no switch on any row, a row states the *set* of agents that
hold the grant, and every row's door leads to the agent that owns it.

**The account scope is part of the bound**, not a third thing binding two layers. Places
are the bound's columns, accounts are too many to be, so they are stated beneath it. A
grant reaches an account only if the bound does — the scope reaches grants *through* the
bound. State it once; do not repeat it per grant.

## Build order

1. **One pane, two cards.** Bound above (operation × place, transports named, account
   scope at its foot), grants below (one row per capability). Delete the second pane.
2. **One vocabulary per layer.** granted/denied on grants; allowed/blocked on the bound.
   Never mixed, never both for one thing.
3. **The clipped line**, derived from bound × capability — never a per-row string. Highest
   value item: it makes the grant-gates-nothing state visible where the grant is shown.
4. **A bound clips only what was granted.** A capability no agent holds shows no clipped
   line; that is the reason, and a second reason would imply two.
5. **Grants read-only, stating the set of holders**, with the door to the owning agent.
6. **The account scope stated once**, at the foot of the bound.

## Vocabulary to confirm

`strict procedure` and `guided procedure` appear under every capability id and carry
real weight — a guided document has no checkpoints to verify, which is why two rows read
"8 steps, none of them a checkpoint". Ratify those two phrases as vocabulary rows if they
are not already.

The document column stays **"The document it is pinned to"**, not "Runbook" — the grant is
pinned to a version, and an edit disarms it. That phrasing carries the consequence; the id
on the row already says runbook.

## Design-system note

Nothing on this sheet is an authored control. The bundle's `Switch` is fully usable at
`size=md` — it is absent because the pane does not edit, not because the component was
unavailable. Do not hand-draw one if an editable variant is ever built.
