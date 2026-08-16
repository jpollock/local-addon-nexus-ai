# Intelligence layer: event spine, honest twin-backed readers, live re-check

*Branch: `poc/nexintelligence`. Verified against the branch state at WP-06
(2026-08-15); every count below was measured, not carried forward.*

## Scope note — this branch carries two bodies of work

Read this first, because the file count will otherwise surprise you. The
branch is **113 files** against `main`, and the intelligence layer is not all
of it:

| | commits | files | insertions |
|---|---|---|---|
| **Track 1** — fleet identity & provenance, BackupGate, Fleet tab | `e540fa6f`..`bc4880e7` | 44 | ~6,100 |
| **Intelligence layer** — everything below | `9dca99a3`..`HEAD` | 71 | ~7,710 |

Track 1 (`src/main/fleet/`, `src/main/mcp/modules/fleet-links/`,
`src/main/safety/BackupGate.ts`, `src/renderer/components/tabs/FleetTab.tsx`,
the `site_links` table) landed *before* the intelligence baseline and is
reviewed on its own terms; `docs/intelligence/reconciliation-entity-identity.md`
records how the two compose (the entity service is a **consumer** of
`site_links`, never a competitor). The rest of this document describes the
intelligence layer only.

## What this is

An event-sourced intelligence spine running alongside the existing caches —
not replacing them — so that every fact the system presents can answer three
questions the caches couldn't: **when was this last true, how do we know, and
how much should you trust it?**

The design argument lives in `docs/intelligence/architecture.md` (ADRs 1–19);
the one-paragraph version: fleet facts are observations with provenance, so
they're stored as immutable events in an append-only ledger, materialized
into rebuildable "twin" views, and surfaced to users with observation age,
trust class, and staleness flags — plus a live re-check tool that closes the
gap whenever a flag fires.

## What's in the branch

**The spine** (`src/intelligence/` — new, dependency-free, seam-locked):
event envelopes (nine source classes, nine trust classes, `observed_at` ≠
`recorded_at`), append-only SQLite ledger (WAL, idempotent monotonic-ULID
appends), emission middleware, fold workers producing `twin_facts`, freshness
SLOs, and an unwired entity-service draft (see `reconciliation-entity-identity.md`
for how it composes with Track-1's `site_links`).

The extraction seam (ADR-16) is enforced by a nested `.eslintrc.json`, not by
convention: nothing under `src/intelligence/` may import electron,
`@getflywheel/*`, react, or anything from `src/main`/`src/renderer`. WP-06
verified the rule *fires* rather than merely being present — a probe file
importing `electron` and `../main/index` produces two `no-restricted-imports`
errors.

**Producers** (`src/main/intelligence-host/` — new): WP webhook tap, a
change-deduped wrap of `GraphService.upsertSite/Plugin/Theme` (CAPI sync and
WP-CLI refresh emit observations as a side effect, without either caller
knowing), and a one-shot marker-guarded backfill of graph.db seeded with the
rows' *real* ages, not laundered as fresh. Everything on this seam is
non-fatal by construction: init failure leaves the legacy pipeline untouched.

**Readers** (6 fleet tools migrated, 1 new, plus 1 IPC surface):
`find_sites_with_plugin`, `find_sites_with_theme`, `find_outdated_sites`
(freshness overlay + ledger gap-fill for versions the cache lacks),
`compare_sites` (per-side observation ages + SLO-skew warning),
`fleet_summary` (population-level drift hint), `detect_drift` (classifies
legacy findings against ledger drift events, renders how long a divergence
has stood, queries newest-first so a row cap drops the oldest events rather
than the newest). Plus the **Site Finder** surface (`SITE_FINDER_APPLY`):
its plugin and version filters now carry `observedAt`/`observedStale` per row
and a `versionDrift` hint, with membership still decided by the graph
predicate alone.

New tool `verify_site_live`: re-observes a site through the real transport
(same permission gates), diffs against the twins, records fresh
provenance-stamped observations — **including removals**, because a plugin
that vanished is an observation, not an absence of one — and reports the
reconciliation.

All enrichment is **additive**. With the core absent every surface renders
byte-identically to before, pinned by parity assertions in each reader's
suite (strip the enrichment's own lines, assert the remainder *equals* the
pre-core baseline — `startsWith`/`toContain` don't catch mid-document
splices).

**User-visible effect:** "which of my sites have WooCommerce?" now answers
with observation ages and, when data is stale, says so and offers the live
check — e.g. *"the WPE data here is ~9h old (cached); I can run a live check
before you act."*

**Integration-point diffs** into pre-existing files, kept minimal — four, not
two: `src/main/index.ts` (+44: init, tap, backfill, shutdown drain),
`src/main/ipc-handlers.ts` (+39: the Site Finder enrichment call site; logic
lives in `siteFinderTwins.ts`), `src/main/mcp/modules/fleet/index.ts` (+2:
tool registration), `src/renderer/components/SidebarSearchPanel.tsx` (+21:
type widening so the payload's new per-row fields can be carried). Plus: jest
`roots` now include `src/` (intelligence suites run in `npm test` and
`test:ci` with no extra flag), a fixed vacuous `pretest` ABI guard, and
`tests/main/fleet-tools.test.ts`'s tool count 6→7.

**Docs** (`docs/intelligence/` + `INTELLIGENCE_ROADMAP.md` + a CLAUDE.md
section): architecture, eval design, anchor-slice specs, pattern runbooks,
work packets, and the multi-agent protocol this branch was built under.

## How it was built (relevant to reviewing it)

**Seven AI-agent work packets** — WP-01, WP-02, WP-03, WP-03b, WP-04, WP-05,
WP-06 — executed under a written protocol
(`docs/intelligence/PARALLEL_PROTOCOL.md`) with per-packet worktrees,
calibration findings fed back into the docs after every run, and escalation
rules that were exercised for real (core API changes and payload schema bumps
were escalated, decided, and recorded rather than improvised). The packet
notes in `WORK_PACKETS.md` are the audit trail — including every judgment
call, disclosed limitation, and the findings that amended the patterns.

## Verification

```bash
npm run typecheck        # clean
npm test                 # includes the intelligence suites
npx jest src/            # the intelligence suites alone: 14 suites, 34 tests
```

Live smoke: start Local, change a plugin on a running site, then

```bash
sqlite3 -header -column "$HOME/Library/Application Support/Local/nexus-ai/ledger.db" \
  "SELECT topic, json_extract(source,'\$.system') AS system, COUNT(*) FROM events GROUP BY 1,2;"
```

then ask the assistant "which of my sites have WooCommerce?" and check the
answer cites observation ages; say "verify <site> live" and watch the
reconciliation table.

**What that query returns on the author's machine (2026-08-15) — the layer is
running in production, not only in tests:**

| topic | system | count |
|---|---|---|
| `state.plugin.observed` | `graph-backfill` | 5,428 |
| `state.theme.observed` | `graph-backfill` | 1,116 |
| `state.site.observed` | `graph-backfill` | 468 |
| `state.plugin.observed` | `graph-sync` | 1,045 |
| `state.site.observed` | `graph-sync:wpe` | 228 |
| `state.drift.detected` | `fold:state-twin` | 328 |
| `state.plugin.observed` | `wp-webhook` | 1 |

8,614 events, 6,308 `twin_facts`. The backfill seeded 7,012 facts; the
**1,273 `graph-sync*` events are the live producer** — the `GraphService`
tap emitting through real CAPI/WP-CLI sync cycles after the backfill, which
is the evidence that the change gate works (a producer without dedup would
have written a multiple of this on every cycle). The 328 `drift.detected`
events are the fold's own detector firing on real disagreements.

**One honest weak spot in that table:** the `wp-webhook` producer has fired
**once**. It is unit-tested (`wiring.test.ts`) but effectively unexercised in
production, so treat it as the least-proven of the three producers.

## Known issues / explicitly out of scope

- ~~`tests/main/wpe-tools.test.ts › local_wpe_push` red on the base commit~~
  **RESOLVED** in `c9fbe423`: pre-existing, not caused by this branch. Root
  cause was the BackupGate (push now requires a verified remote backup; the
  fixture's `capiCreateBackup` mock resolved `undefined`, tripping the gate's
  backup-ID check) — not access-control defaults, which the fixture
  explicitly permits. Fixed in the test (backup create + status-poll mocks;
  the poll's real 2s interval is why that test now carries a 15s timeout).
  The same commit added the missing assertion to the vacuous "rejects halted
  site" test.
- **`src/**/__tests__` compiles into `lib/` and therefore ships** — 56 files,
  ~158 KB, in a package whose `files[]` includes `lib` wholesale. WP-06's
  ruling: **exclude them** (`"src/**/__tests__/**"` in `tsconfig.json`'s
  `exclude`). The trade this was held open for is largely illusory —
  `tsconfig.json` already excludes `tests/`, so `tsc --noEmit` has never
  covered the 5,000+ legacy tests, and ts-jest type-checks every test file it
  runs (diagnostics on, against `tsconfig.test.json`). Measured both
  directions: an injected `TS2322` in an intelligence test is missed by an
  excluded `tsc --noEmit` and caught by ts-jest. Not applied here — a build-
  config change is outside a review packet's edit scope.
- **A latent jest abort affecting two legacy CLI suites**, characterized in
  WP-06 with a reliable repro; see `WORK_PACKETS.md`. Not caused by this
  branch and not fixed here.
- Entity service is a reviewed draft, deliberately unwired (WP-07).
- The assembler, policy registry, and hub (M2/M3 of the roadmap) are not in
  this branch.

## Where to start reviewing

1. `src/intelligence/envelope/types.ts` — the whole model in one file.
2. `src/main/mcp/modules/fleet/find-sites-with-plugin.ts` — the reader
   template all migrations follow (enrich-don't-replace, drift-as-signal).
3. `src/main/intelligence-host/graphServiceTap.ts` — the chokepoint wrap +
   change gate.
4. `docs/intelligence/architecture.md` ADRs 1–10 — why each of the above is
   shaped the way it is.
