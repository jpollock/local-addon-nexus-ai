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

    bound (fleet-wide limit)
      └── grants (per-capability decisions, each stating the bound's effect on itself)

## Build order

1. **One pane, two cards.** Bound above (operation × place, transports named, account
   scope at its foot), grants below (one row per capability). Delete the second pane.
2. **One vocabulary per layer.** granted/denied on grants; allowed/blocked on the bound.
   Never mixed, never both for one thing.
3. **The clipped line**, derived from bound × capability — never a per-row string. This is
   the highest-value item: it makes the grant-gates-nothing state visible where the grant
   is made.
4. **A bound clips only what was granted.** A denied row shows no clipped line; its
   denial is the reason, and a second reason would imply two.
5. **State the account scope's reach on the scope itself** — it binds both layers.
6. **Render the two gaps as stated absences**, not guesses: whose grants these are (the
   per-agent address), and confirmation that the scope binds grants too.

## Vocabulary to confirm

`strict procedure` and `guided procedure` appear under every capability id and carry
real weight — a guided document has no checkpoints to verify, which is why two rows read
"8 steps, none of them a checkpoint". Ratify those two phrases as vocabulary rows if they
are not already.

The document column stays **"The document it is pinned to"**, not "Runbook" — the grant is
pinned to a version, and an edit disarms it. That phrasing carries the consequence; the id
on the row already says runbook.

## Design-system constraint

The grant control is the bundle's `Switch` at `size=md` (36×20, knob at left 2 / left 18,
colours from `--control-bg-control-*`). Fully usable — do not hand-draw it.
