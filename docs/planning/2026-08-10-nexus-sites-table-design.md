# Spec 5 — Sites: one table, three host types, selection-scoped actions

Date: 2026-08-10
Branch: `spec-5-sites` (worktree, branched from `new-ux-v2` at `0b2bed3e`)
Predecessors: `2026-08-09-nexus-ux-foundation-design.md`, `2026-08-10-nexus-overview-decomposition-design.md`

## Why this exists

The handoff asks for "one table replacing the Operations list and the dashboard fleet cards, the
External host type end to end, bulk actions on a selection, and Operations retires."

Today a user answering "what do I have, and what state is it in?" reads three unrelated surfaces:
`SystemTab` inside Operations, `FleetCompletenessWidget` on the dashboard, and the Fleet Summary
card beside it. None of them lists all three host types together.

## What Operations actually is

The handoff calls it "the Operations list". It is not a list — it is three unrelated zones, and
only one of them is a list. This distinction decides the whole scope:

| Zone | Contents | Disposition |
|---|---|---|
| 1 — Keep data current | 4 buttons: Local `Refresh metadata` / `Index content`, WPE `Sync metadata` / `Index content` | Become selection-scoped actions on the table |
| 2 — Site status | `SystemTab` (566 lines), the per-site list | **This is "the Operations list."** Replaced by the table |
| 3 — Advanced (collapsed) | Factory Reset, Reset Content Index, Database Health, Housekeeping | **Stays. See below.** |

Plus, on the dashboard: `FleetCompletenessWidget` (193 lines) and `renderFleetSummaryCard`.

## Operations does not fully retire in this spec, and that is deliberate

Zone 3 is app-level maintenance. Factory Reset and Housekeeping are not things you do "to a
selection of sites" — they have no per-site meaning, so they cannot become bulk actions. Their
destination is the Advanced section that **spec 6** builds (`BUILD-ORDER.md`: "Move MCP, ports,
index internals and reset to Advanced").

Retiring Operations wholesale here would make all four **unreachable from the UI** for the entire
gap between this spec and spec 6.

So: **this spec moves zones 1 and 2 out and leaves Operations as a thin shell containing only
zone 3.** The tab stops being a destination and becomes a holding pen. Spec 6 empties it and
deletes the tab. No capability disappears at any point in the sequence, and this spec does not
reach into spec 6's territory to build a Settings section it does not own.

This is the sequencing cost of the handoff's "Operations retires" line, which assumed the tab held
one kind of thing.

## The External correction

`DECISIONS.md` states: *"External sites cap at **Detailed** knowledge, never Searchable — an
honest reflection of what a generic SSH connection yields, and it is stated at connect time."*

**That is no longer true, and building it would ship a false statement.**

- `ipc-handlers.ts:2296` already computes `externalSearchable` from the index registry.
- `ExternalContentIndexScheduler` is imported and instantiated (`src/main/index.ts:59`, `:471`).
- CLAUDE.md documents external content indexing as shipped, with `nexus host index <alias>` as the
  manual path.

The stale comment at `ipc-handlers.ts:2286` — *"Until Spec 4b there is no external content
indexing, so searchable will read 0"* — predates that work and is what the handoff was written
against. **Delete it as part of this spec**; it is actively misleading.

The real situation is different and more actionable: external hosts **can** be Searchable, but
`externalContentIndexAutoEnabled` defaults to **false** and has **zero references in
`src/renderer/`**. The only ways to turn it on are `nexus settings set
externalContentIndexAutoEnabled true` and `nexus host index <alias>`. So most external hosts will
read 0 Searchable — not because of a cap, but because the switch is invisible.

**Decision: report honestly and add the missing switch.** The table shows an external host's real
knowledge level, and this spec adds the two affordances that let a user change it:

1. A per-host **"Index content"** row action, routed through the existing `nexus host index` path.
2. A renderer row for `externalContentIndexAutoEnabled`, alongside the `externalRefreshAutoEnabled`
   row that already exists in `SettingsTab.tsx`.

Fixing the cause is a smaller change than describing the symptom as a limitation.

## Architecture

### A. One row model, three sources

A row is a **site**, whatever hosts it. The three sources already exist and are already
reconciled by `collectFleetCounts` (`src/main/fleet/FleetCounts.ts`): Local's own store for local
sites, and the graph (`source IN ('wpe','external')`) for the rest. **Do not re-derive this** —
counting local from the graph undercounts badly, and counting everything from the graph
double-counts. That reconciliation is the foundation spec's deliverable and this is its consumer.

Every population the table displays renders with its `PopulationCount.scope` string, never as a
bare number. Third render site for that rule, after the panel's Insights tab and the Inbox.

### B. Knowledge level is derived per row, from data that exists

`Scanned` → `Configured` → `Searchable`, the same ladder `FleetCompletenessWidget` already uses
(`Scanned / Configured / Searchable`) and `SiteNexusSection.tsx:729` already labels. Derivation is
identical for all three host types: `Configured` when the row has a `wp_version`, `Searchable`
when an `IndexRegistry` entry exists. No host type is special-cased, and no host type is capped.

### C. Bulk actions reuse `BulkOperationManager`

`src/main/bulk/BulkOperationManager.ts` exists, with `BULK_EXECUTE` / `BULK_STATUS` /
`BULK_CANCEL` / `BULK_LIST` / `BULK_PROGRESS` already wired, and
`BulkOpType = 'reindex' | 'plugin-update' | 'start' | 'stop' | 'health-refresh' | 'setup-ai' |
'sync-graph'` already covering all four of zone 1's actions. **Do not build a second bulk path.**
Per-site plugin updates through this manager are already audited; keep that.

**The behaviour change to name:** zone 1's buttons act on *every* site of a type. The table's act
on the *selection*. An empty selection must disable the action, never silently mean "all" — a
button that quietly fans out to 367 installs because nothing was ticked is the worst version of
this feature.

### D. What gets deleted, and when

Deleted in this spec: `SystemTab` usage from Operations, `FleetCompletenessWidget` and the Fleet
Summary card from the dashboard, and zones 1 and 2 of `renderOperationsTab`.

Kept deliberately: zone 3, and the `Operations` tab shell around it.

## Testing

`serializeTree` (`tests/unit/renderer/helpers/serializeTree.ts`) is available.

The properties worth pinning, none of which a snapshot alone catches:

1. **All three host types appear in one list**, and the count matches `collectFleetCounts`. A table
   that silently omits external hosts is the exact defect CLAUDE.md records for `nexus_list_sites`.
2. **An empty selection disables every bulk action.** Directly guards §C's failure mode.
3. **A bulk action dispatches only the selected site ids** — not all of them, not the visible page.
4. **External rows are not capped.** An external host with an index entry renders `Searchable`.
   This is the regression test for the handoff's stale claim; without it, someone re-reads
   `DECISIONS.md` and "fixes" the table back.
5. **Every rendered population carries its scope string.**
6. **Zone 3 survives.** Factory Reset, Reset Content Index, Database Health and Housekeeping are
   still reachable after Operations is gutted — the sequencing guarantee above, asserted rather
   than assumed.

**What no test covers:** whether a 367-row table is usable, and whether the knowledge ladder reads
clearly to someone who did not build it. `DECISIONS.md` is candid that this table is "agency
furniture" a marketing PM will never open; that is accepted, not solved.

## Global constraints

- React 16, `React.createElement`, class components, inline style objects — no JSX, no hooks.
- No hardcoded colours; `--nxai-*` variables only, verified to exist in `theme.ts`, light and dark.
- Every population renders with its `scope` string, never a bare number.
- Counts come from `collectFleetCounts`. Do not re-derive local counts from the graph.
- Bulk work goes through `BulkOperationManager`. No second path, and no loss of its audit trail.
- An empty selection disables bulk actions; it never means "all".
- No host type is capped at a knowledge level.
- Primary buttons use `#0a8189`, not `#0ECAD4` — the brand cyan fails WCAG AA at button sizes
  (2.96:1 vs 4.65:1).

  **No accent variable exists yet.** `theme.ts` has no `--nxai-accent`/`primary`/`btn` variable,
  and the two hex values appear as literals **39 times** across `src/renderer/`. This spec adds
  `--nxai-accent` (and its on-accent text colour) to `theme.ts` in both modes and uses it for the
  table's own controls. **Migrating the other 39 literals is out of scope** — that is a
  branch-wide sweep, it collides with spec 3's panel theme migration, and doing it here would bury
  the table in an unrelated diff. Record it as follow-up work; do not start it.

## Build order

| Step | Delivers | Verified by |
|---|---|---|
| 1 | Row model + knowledge derivation, main-side, all three sources | property 1, unit tests |
| 2 | The table: columns, host-type filter, scope labels | properties 4–5, snapshots |
| 3 | Selection + bulk actions via `BulkOperationManager` | properties 2–3 |
| 4 | External: per-host "Index content", settings row, stale comment deleted | external opt-in reachable from the UI |
| 5 | Retire zones 1–2; Operations becomes the zone-3 shell | property 6 |

## Notes for whoever picks this up

- **`fetchAll` uses a positional `Promise.all` destructuring**, and spec 4 has already appended
  `GET_INBOX` at the end of it. Append anything new at the **end** too. This file is the known
  merge conflict between specs 4 and 5; resolve it by keeping both additions at the end, in either
  order, and re-checking that every destructured name still lines up with its `invoke`.
- This branch is based at `0b2bed3e` and does **not** contain specs 3 or 4.
- `SiteNexusSection.tsx:723` already derives `isSearchable` from `indexEntry.state` being
  `'indexed'` or `'stale'`. Reuse that definition rather than inventing a second one — `'stale'`
  counting as searchable is deliberate.
- Do not trust `DECISIONS.md` on External. See the correction above; the spec 4 build lost two
  Criticals to exactly this failure mode — a design document's factual claim about the codebase,
  assumed true by every task and encoded into every fixture.
