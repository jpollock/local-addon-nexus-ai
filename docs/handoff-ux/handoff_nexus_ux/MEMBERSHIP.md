# Membership — which rows belong to which set

Three different subsets over the same rows, held in the one compute-once module. Tabulated
rather than inferred, because this is the exact shape of thing the review found broken six times.

> **Reconciled against code 2026-08-10.** The design's flag names were a mapping, and four of its
> eight rows did not match the real settings keys. Corrected below per the design's own instruction
> ("correct this table, not the design"). One correction changes both denominators. An eighth row
> turned out not to be a scheduled job at all and was **cut by the designer**, leaving seven. See
> "Corrections applied".

## The table

| # | Row | Setting flag | Destination group | In switchable denominator? | Contributes to | Amber when |
|---|---|---|---|---|---|---|
| 1 | Check WP Engine sites | `wpeRefreshAutoEnabled` | `wpe` | yes | WP Engine figure | ≤ 2h |
| 2 | Refresh site details | `wpeSyncAutoEnabled` | `wpe` | yes | WP Engine figure | ≤ 2h |
| 3 | Make content searchable | `wpeContentIndexAutoEnabled` | `wpe` | yes | neither — rides along | never |
| 4 | Check other hosts | `externalRefreshAutoEnabled` | `ext` | yes | Other-hosts figure | < 6h |
| 5 | Make other hosts searchable | `externalContentIndexAutoEnabled` | `ext` | yes | Other-hosts figure | < 6h |
| 6 | Index sites on this Mac | `localContentIndexAutoEnabled` | `local` | yes | neither | never |
| 7 | Look over stopped local sites | *(none — never switchable)* | `local` | **no** | neither | never |

Interval keys pair with the flags by the same stem: `wpeRefreshIntervalHours`,
`wpeSyncIntervalHours`, `wpeContentIndexIntervalHours`, `externalRefreshIntervalHours`,
`externalContentIndexIntervalHours`, `localContentIndexIntervalHours`,
`haltedSiteRefreshIntervalHours`. All are `min(1).max(168)` except
`localContentIndexIntervalHours`, which is `min(0)` — see "Division by zero" below.

Rows 4 and 5 exist only when at least one external host is connected.

## Corrections applied

| # | Design's name | Real key | Consequence |
|---|---|---|---|
| 1 | `metadataSyncAutoEnabled` | `wpeRefreshAutoEnabled` | rename only |
| 2 | `siteInfoAutoEnabled` | `wpeSyncAutoEnabled` | rename only |
| 3 | `contentIndexAutoEnabled` | `wpeContentIndexAutoEnabled` | rename only |
| 7 | `offlineScanAutoEnabled` | **no such key** | row 7 is the always-on row; both denominators drop by 1 |

Row 7 is `haltedSiteRefresh`. It has an interval and has never had an enable flag. The design had
assigned always-on status to row 8 instead and left row 7 switchable, which put one too many rows
in the denominator.

**Rows 7 and 8 were the same job, rendered twice.** The prototype's array carries
`{ key: 'scan', name: 'Look over stopped local sites' }` *and*
`{ key: 'halted', name: 'Notice when a local site stops', always: true }` — one real scheduler
(`HaltedSiteRefreshScheduler`) with its accurate description on one row and its always-on property
on the other. That split is also where `offlineScanAutoEnabled` came from: today's Settings labels
this job **"Offline site scan"**, so the name was inferred from the UI rather than the schema.
Merging them is what "cut row 8" means — row 7 keeps the description and inherits always-on.

**But its interval stays adjustable.** `haltedSiteRefreshIntervalHours` is `min(1).max(168)`,
defaults to 24, and has a working number input in today's Settings
(`src/renderer/components/SettingsTab.tsx:407`). Only the *on/off* is absent. The design's
*"not adjustable"* interval copy described row 8, which had no interval; carrying it onto row 7
would remove a control that currently works.

**A row 8 was cut.** "Notice when a local site stops" is the `siteStopped` event hook
(`src/main/content/lifecycle-hooks.ts:529`,
`src/main/agent-event-bus/bridges/local-lifecycle-bridge.ts:24`) — no interval, no cycle, no cost,
nothing to pause. It could not fill any of this table's columns, and Background work exists to show
what Nexus costs you on a timer. **Cut 2026-08-10.** Do not reintroduce it here; if the
running/stopped reassurance is wanted, it belongs wherever site status is displayed.

## The three subsets

**Switchable set** — rows 1–6. Denominator for the nav note. Row 7 is excluded: a count that
includes an unswitchable row can never reach its own maximum, so it would read `"6 of 7 on"`
forever and look like something is off.

- With at least one external host connected: **denominator 6** — `"5 of 6 on"`.
- With no external host: rows 4 and 5 disappear, leaving 1, 2, 3, 6 — **denominator 4**.

The design's table gave denominators of 7 and 5. Both were one too high, from row 7 being counted
as switchable. The prototype's verified `"4 of 5"` on a fleet with no external host should read
`"N of 4"`.

**WP Engine connections** — rows 1 and 2 only. Row 3 is in the `wpe` group but contributes nothing,
because it piggybacks the connection row 1 already opened. Group membership and cost contribution
are **not** the same predicate — that is why they are separate columns.

**Other-hosts sessions** — rows 4 and 5. Both. Each opens its own session per host per cycle and
neither can share with the other (no `ControlMaster` on external SSH — see
`ExternalContentIndexScheduler.ts:58`, which says so explicitly), so with both enabled a shared host
takes two independent sessions per cycle and both belong in the same figure.

## Rules that fall out of it

- A row's **group** decides which header it sits under. Its **`conn`** decides which figure it feeds.
  A row can have a group and no `conn`.
- The **amber threshold comes from the destination, not the job**: everything landing on WP Engine
  shares one threshold, everything landing on a third party shares another. Adding a job means
  choosing its destination, not inventing a threshold.
- **Minutes/day** sums only rows with a recorded duration (see README, run-duration note). A row
  with no measurement contributes nothing and does not count as zero.
- **Never sum the two connection figures.** A blended total hides the load that matters most.
- Every derived label — both figures, both scope notes, the nav note, the next-pass value — reads
  from this one module. No string literal anywhere restates a count.

## Division by zero

`per(h) = round(24 / h)` is the passes-a-day formula. Six of the seven intervals are `min(1)`, but
`localContentIndexIntervalHours` is `min(0)` and 0 is a legal stored value, where it means *off*.
`round(24 / 0)` is `Infinity`, which renders as `"Infinity passes a day"`. The derived module must
treat `h === 0` as off — the row reads `"nothing while off"` — before it divides.
