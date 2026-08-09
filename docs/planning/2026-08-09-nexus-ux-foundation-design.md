# Nexus UX rework — foundation (specs 1 + 2)

Date: 2026-08-09
Branch: `new-ux-v2` (worktree, branched from `feat/non-wpe-host-support`)
Source material: `docs/handoff-ux/handoff_nexus_ux/` — README, BUILD-ORDER, DECISIONS, two HTML prototypes

## Scope

The full six-step rework in `BUILD-ORDER.md` is committed to, but it is too large for one
spec. It decomposes as:

| # | Spec | Depends on |
|---|---|---|
| 1 | Honest health + legible failures | — |
| 2 | One vocabulary, one number | — |
| 2.5 | `NexusOverview.tsx` decomposition (fan-out prerequisite) | 1, 2 |
| 3 | Panel: Insights tab + three sizes | 1, 2, 2.5 |
| 4 | Inbox | 2 |
| 5 | Sites table (External surfaces) | 2 |
| 6 | Settings merge + agent cards | 2, 4 |

**This document covers specs 1 and 2 together.** They share most of their decisions and
both define contracts that 3–6 consume. Specs 3–6 are intended to be farmed out to parallel
agents once this lands, which is only safe after two things are true: the shared contracts
exist, and `NexusOverview.tsx` (3,002 lines, edited by every one of the six steps) has been
decomposed into per-surface components.

## Decisions taken

- **Nexus stays a destination inside Local, with a strong panel.** The panel carries the
  continuous "what needs me" job; the destination carries the agency-fleet job, which needs a
  table. This resolves the open question named in both the review ("the decision underneath
  all of it") and `DECISIONS.md` ("Destination or panel").
- **The install is the canonical fleet unit**, labelled honestly. Every operation targets an
  install; counting anything else makes the number and the actions disagree. The WPE
  site grouping stays visible in the Sites table.
- **Health rolls up all four available signals**: agent run failures, sync staleness,
  credential failures, and event-queue failures.
- **The knowledge ladder has four rungs, not three** (see Vocabulary).
- **The rail badge is pulled out** into its own later spec (see Deferred).

## Audit: what the six numbers actually are

`DECISIONS.md` lists the six site counts as unaudited. Measured on this machine, 2026-08-09:

| Figure | Value | Source |
|---|---|---|
| Local sites | 37 | Local's own store (`sites.json`) |
| WPE installs | 330 active | graph `source='wpe'`, `is_active=1`; 24 more soft-deleted |
| WPE sites | 242 | distinct `wpe_site_id` — 178 with 1 install, 40 with 2, 24 with 3 |
| External | 3 | graph `source='external'` |
| WPE accounts | 13 | graph `account_id`; CAPI reports "11 of 14" |

**Finding: the headline number is correct.** `367 = 37 local + 330 WPE` follows the CLAUDE.md
rule exactly — local counted from Local's store, WPE from the graph. The Remote Sites `330`
is the same figure from the same source. The six numbers are not six wrong answers; most are
different populations, correctly computed and dishonestly labelled. This makes spec 2
substantially smaller than "reconcile six broken numbers", and matches the review's own fix
("say so in the label, never silently").

Two real bugs fell out of the audit and are in scope:

1. **22 of the 56 `source='local'` graph rows are `sentinel-*` sandbox sites that no longer
   exist in Local.** All 22 are sentinel-prefixed; 3 live local sites also have no graph row.
   Any local count taken from the graph over-reports by ~60%. The leak is the
   `nexus:sentinel:execute-sandbox` path writing sandboxes into the graph without cleanup. It
   is not in CLAUDE.md's known-gaps list.
2. **External is missing from the headline.** 367 should read 370 today.

## Architecture

Two new main-process modules. Everything reads from them; nothing else adds up sites.

### `src/main/fleet/FleetCounts.ts`

The single definition of the fleet. Returns:

- install totals — `local` from Local's store, `wpe` and `external` from the graph with
  `is_active = 1`
- the WPE site grouping (distinct `wpe_site_id`)
- per-population subtotals, each carrying its own scope label so a differently-scoped number
  can never be rendered without saying so

### `src/main/fleet/FleetHealth.ts`

The rollup. Returns `ok | degraded | failing | unknown` per input **and** overall, with the
contributing reason attached to each.

Inputs and their sources:

| Input | Source |
|---|---|
| Agent run failures | `lastRunStatus` / `lastRunAt` per agent (GraphQL schema) |
| Sync staleness | `sites.last_sync_at` vs the refresh interval **for that site's source** — `wpeRefreshIntervalHours` for `wpe`, `externalRefreshIntervalHours` for `external`, `haltedSiteRefreshIntervalHours` for halted local. A site whose source has its scheduler disabled reports `unknown`, not stale. |
| Credential failures | `CREDENTIAL_STATUS` IPC — WPE auth, Google OAuth, S3, AI provider key |
| Event queue failures | `getEventStats()` failed/pending counts |

### Why main-process, not a renderer selector

The addon has three surfaces (CLI, MCP, UI) reading one transport layer, and the count bug is
not renderer-only — `fleet_overview` printed "1 of 0" to an MCP agent for exactly this reason.
A renderer selector fixes one surface of three. A SQL view cannot work at all, because the
canonical local count comes from `sites.json`, which is not in the database.

### What collapses onto them

`DASHBOARD_V2_STATS` (`src/main/ipc-handlers.ts`), `nexusFleetSummary`, `fleet_overview`, and
`src/main/mcp/modules/fleet-intelligence/fleet-health-summary.ts` stop computing and start
reading. This also retires the three duplicated `|| '8.0'` PHP-version fabrications CLAUDE.md
flags as unfixed, since they live in exactly those call sites.

## Health semantics

- `unknown` is **per-input and never swallowed**. An input that cannot be read reports
  `unknown`, and the overall pill degrades to `unknown` rather than green.
- **Green requires every input to have actually answered.** A missing input can never
  produce green.
- The `event_queue` signal may contribute red but can **never produce green on its own** — it
  only ever covers Local sites, because its only writer is the MU-plugin webhook.

Today's implementation (`ipc-handlers.ts:1799`) computes `healthStatus` from three lines over
`event_queue` alone: `failed > 0 → error`, `pending > 10 → warning`, else `good`. Since
`event_queue` holds roughly 4 rows and only ever sees Local sites, "All Systems Healthy"
currently means *"no failed WordPress webhook events on local sites."* It is structurally
incapable of seeing an agent failure. That is the bug behind review finding 09.

## Vocabulary

The two current vocabularies map cleanly onto each other:

| `DASHBOARD_V2_STATS` | `FleetCompletenessWidget` | New ladder |
|---|---|---|
| `none` | — | **Nothing yet** |
| `filesystem` | Scanned | **Basic** |
| `metadata` | Configured | **Detailed** |
| `indexed` | Searchable | **Searchable** |

**Four rungs, not the three in the README.** `none` is real, is tracked as
`neverScannedCount`, and is the most actionable state — it is the state behind the review's
own worked example of good copy, *"77 sites we haven't looked inside yet — Sync now."* Three
rungs cannot express it.

External hosts cap at **Detailed**, never Searchable, per `DECISIONS.md`. Freshness stays a
separate `last_sync_at` timestamp and is never a rung.

### A third instance of the coverage bug

`FleetCompletenessWidget` divides by its own `data.total`, while `DASHBOARD_V2_STATS` computes
completeness over **local twins only** (`ipc-handlers.ts:765,778`) yet sets `total` to local +
WPE + external (`:762`). That is the same numerator/denominator mismatch CLAUDE.md documents
for `fleet_overview`, in a third copy, and it is what produces "370/370" next to "367 sites".
`FleetCounts` fixes all three by construction.

## Behaviour changes (spec 1)

- Aggregate identical agent failures into one row with a count and a time range; raw command
  or stack behind a disclosure.
- Auto-pause an agent after **3** consecutive identical failures, and raise it.
- Filter auto-drafts and revisions out of the event timeline.
- Omit the actor field when unresolvable rather than printing `UNKNOWN`.
- Sort Operations by what is stale or failing, not arrival order.
- Delete the Ask/Tell tab and the dashboard prompt box.

## Testing

The renderer has 27 test files, which is the safety net for the later fan-out. For this spec:

- Unit tests for `FleetCounts` and `FleetHealth` written **before** the modules, per the
  project's test-driven principle. `FleetHealth` needs explicit cases for each input
  returning `unknown`, and for `event_queue` alone never yielding green.
- A regression test pinning that the local count excludes `sentinel-*` rows.
- A regression test pinning that a coverage metric's numerator and denominator span the same
  source set.
- Existing `EventStatsCards.test.tsx`, `TopIssuesPanel.test.tsx` and `SettingsTab.test.tsx`
  will need updating as health and counts change shape.

## Deferred

- **The rail badge.** BUILD-ORDER puts "put the pending-review count on the rail badge" in
  step 1, and the README sources its styling from `SidebarBadgeManager.ts`. That file injects
  per-site "WPE" badges into Local's *site list*; the Nexus nav item comes from
  `NavItemInjector.ts`, a MutationObserver DOM injection with no badge support. This is new,
  fragile work against Local's markup and gets its own small spec.
- **`NexusOverview.tsx` decomposition** is a prerequisite for the specs 3–6 fan-out, and
  therefore cannot live inside any of them. It is its own step, sequenced between this spec
  and the fan-out: extract each tab into a per-surface component so specs 3–6 own disjoint
  files. Scoped as spec 2.5.

## Open questions carried forward

- **Where settings live.** Review finding 02 says everything configuration-shaped moves *to*
  Preferences → Nexus AI and the Settings tab disappears. The README and prototype do the
  opposite — Settings becomes a tab inside Nexus and Preferences → Nexus AI goes away. That
  reversal is not in `DECISIONS.md`'s "changed on contact" list, and commit `b0794469` on this
  branch moved External SSH Hosts *into* Local's native Preferences page. Choosing
  "destination" implies the prototype's direction, but this must be settled explicitly in
  spec 6.
- **Fleet volume for the Inbox.** Every number in the prototype is synthetic and tuned light
  (10 items, 5 decisions); the screenshots showed 31 pending actions. `DECISIONS.md` flags
  this as needing measurement before the Inbox is built. Spec 4 should open with that
  measurement.
- **Staging and revert.** Named across the handoff as the precondition for letting
  non-developers act, and deliberately not designed. Not in scope for any of the six specs
  as currently cut.
