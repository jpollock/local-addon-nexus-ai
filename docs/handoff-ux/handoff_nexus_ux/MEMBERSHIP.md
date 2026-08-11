# Membership — which job rows belong to which set

> **Ownership.** This file is authoritative for **UI semantics only**: which rows share a header,
> which feed which figure, which count toward the nav denominator, and which threshold applies.
>
> It is **not** authoritative for settings keys, row inventory, or scheduler behaviour. The repo is.
> An earlier revision of this file listed invented flag names and an eighth row; both were corrected
> in the codebase on 2026-08-10 and this file kept shipping the stale versions. That is a defect in
> how this doc was written, not a disagreement to reconcile — **where this file and the code differ
> about what exists, the code wins, without asking.**
>
> Rows below are therefore identified by their **UI label**, not by a settings key. Bind them to real
> keys in code; do not copy key names from any design document.

## The table

| Row (UI label) | Destination group | In switchable denominator? | Contributes to | Amber when |
|---|---|---|---|---|
| Check WP Engine sites | `wpe` | yes | WP Engine figure | ≤ 2h |
| Refresh site details | `wpe` | yes | WP Engine figure | ≤ 2h |
| Make content searchable | `wpe` | yes | **conditional — see below** | ≤ 2h *when contributing* |
| Check other hosts | `ext` | yes | Other-hosts figure | < 6h |
| Make other hosts searchable | `ext` | yes | Other-hosts figure | < 6h |
| Index sites on this Mac | `local` | yes | neither | never |
| Look over stopped local sites | `local` | yes | neither | never |
| *any row with no enable flag* | per its destination | **no** | per its destination | per its destination |

The last line is a **rule, not a row**. An earlier revision named a specific always-on row; whether
such a row exists is a question for the code. If one does, it renders a static `ALWAYS ON` label
rather than a disabled toggle, reads `not adjustable` in the interval column, and is excluded from
the denominator. If none does, the rule costs nothing.

The two `ext` rows exist only while at least one external host is connected. With none connected,
that group and its figure are not rendered at all — not rendered as zero.

## The conditional row

`Make content searchable` rides the connection another job already opened. Its cost is therefore a
function of that job's state, and the earlier flat claim that it "contributes to neither figure" was
wrong whenever the parent was off:

| Parent job | Row reads | Contributes | Amber |
|---|---|---|---|
| on | `2 passes a day · no extra connections` | nothing | never |
| off, and it opens its own connection | `2 passes a day · <n> connections` | WP Engine figure | ≤ 2h |
| off, and it cannot run | `needs "Check WP Engine sites" to be on` (`#9ca3af`), interval control disabled | nothing | never |

**Which of the last two applies is a scheduler fact, not a design choice.** Read the scheduler and
pick one. The general rule, which any future ride-along row inherits: **a ride-along row's cost
string and figure membership derive from its parent's enabled state — never from a constant.**

## The three subsets

**Switchable set** — every row that has an enable flag. Denominator for the nav note (`"4 of 6 on"`).
Rows without a flag are excluded: a count including an unswitchable row can never reach its own
maximum, so it would sit one short forever and read as something being off.

**WP Engine connections** — the rows that open a connection per install, plus the conditional row
when its parent is off. Group membership and cost contribution are **different predicates**: a row
can sit under the WP Engine header and contribute nothing. That is why they are separate columns.

**Other-hosts sessions** — both `ext` rows. Each opens its own session per host per cycle and neither
can share with the other, so with both enabled a shared host takes two independent sessions per
cycle. Both belong in the same figure.

## Rules that fall out of it

- A row's **group** decides which header it sits under. What it **opens** decides which figure it
  feeds. Neither implies the other.
- The **amber threshold comes from the destination, not the job.** Everything landing on WP Engine
  shares one threshold; everything landing on a third party shares another. Adding a job means
  choosing its destination, not inventing a threshold.
- **Minutes/day** sums only rows with a recorded duration. A row with no measurement contributes
  nothing and does not count as zero.
- **Never sum the two connection figures.** A blended total hides the load that matters most.
- Every derived label — both figures, both scope notes, the nav note, the next-pass value — reads
  from one module. No count is ever a string literal.
