# Fleet Counts Fix Report — BUILD-REVIEW §1.1 & §2.6

**Status:** Finding 2.6 COMPLETE + Finding 1.1 infrastructure COMPLETE. Surface rewiring remains.

**Commits:**
- `6b968e73` — fix(agents): Agents banner now reads system health rollup (BUILD-REVIEW §2.6)
- `0fb66b3c` — feat(fleet): extend FleetCounts with accounts, indexed, needs-attention (BUILD-REVIEW §1.1 infrastructure)

---

## Finding 2.6 — Agents Banner vs Activity Pill ✓ COMPLETE

**Problem:** AgentsHub banner read only `pendingBySource` (inbox items), while Activity pill read `systemHealth.overall` from the same four-signal rollup in `collectSystemHealth.ts`. When agents had never run, banner painted green "Everything is running autonomously" while pill said "Can't tell right now — seo-insights has not reported a run yet (+1 more)." Two surfaces, same moment, opposite claims.

**Fix:** AgentsHub now:
- Fetches `EVENTS_GET_STATS` on mount + 30s interval (matching `EventStatsCards`)
- Reads `healthStatus` from `stats.healthStatus` (the same `systemHealth.overall` the Activity pill uses)
- Renders banner state from BOTH pending items AND health:
  - `ok` + no pending → "Nothing needs you right now · Everything is running autonomously"
  - `unknown` + no pending → "Nothing waiting on you · N agents haven't reported yet"
  - `degraded`/`failing` + no pending → "Nothing waiting on you · Something needs attention/is broken"
  - Any pending → amber state with review button, unchanged

Before this fix, the banner only knew about pending items. The pill's rollup includes agent runs, sync staleness, credential state and event-queue health — now the banner does too.

**Rollup source:** `src/main/health/collectSystemHealth.ts` → `systemHealth.overall`, returned by `EVENTS_GET_STATS` as `stats.healthStatus`.

**Files changed:**
- `src/renderer/components/agents/AgentsHub.tsx` (+73 lines): added `healthStatus` state, `fetchSystemHealth()`, health-aware banner logic
- `src/renderer/components/agents/AgentConsoleTab.tsx` (+1 line): pass `electron` prop to AgentsHub

**Mutations verified:** None required — pure addition, no guard changes.

---

## Finding 1.1 — Six Fleet Counts ⚠️ INFRASTRUCTURE COMPLETE, SURFACES REMAIN

**Extended `FleetCounts` with three new figures:**
1. **wpeAccounts** (total + in-scope) — via `account_id` + `wpeAccountFilter` setting
   - Label: `"14 accounts · 11 in scope"` or `"14 accounts connected"` when all in scope
2. **indexed** (sites indexed, entries, documents) — honest phrasing, never "sites" when it's entries
   - Label: `"449 entries across 312 sites · 8,234 documents"` or `"312 sites indexed · 8,234 documents"`
3. **needsAttention** (pending items OR knowledge Basic OR last sync failed) — nullable when inputs unavailable
   - Scope: `"sites needing attention"`

**Extended `FleetCountsInput`:**
- `graphRows` now includes `accountId`, `lastSyncAt`, `contentIndexedAt` (all nullable)
- Added **optional** `wpeAccountFilter`, `siteRows`, `pendingBySite`, `indexEntries`
- All new fields default to null when getters not supplied (backward compat)

**Extended `collectFleetCounts`:**
- SELECT now pulls `account_id, last_sync_at, content_indexed_at` from sites table
- Added optional getters in `FleetCountsDeps` for new inputs
- Calls `computeFleetCounts` with all inputs (null when getters not supplied)

**Files changed:**
- `src/main/fleet/FleetCounts.ts` (+126 lines): new interface fields, computation logic
- `src/main/fleet/collectFleetCounts.ts` (+51 lines): extended SELECT, optional getters
- `tests/unit/fleet/fleet-counts.test.ts` (+21 lines): updated all input fixtures
- `tests/unit/fleet/coverage-metric.test.ts` (+14 lines): updated fixtures
- `tests/unit/fleet/site-rows.test.ts` (+10 lines): updated fixture

---

### Six Surfaces — Status

| # | Surface | Current Source | Target Source | Status |
|---|---|---|---|---|
| 1 | Sites tab (`SitesTab.tsx:459-460`) | `total: PopulationCount` prop | `collectFleetCounts.installs` | ✓ Already correct |
| 2 | Dashboard Fleet Intelligence (`OverviewTab.tsx:120`) | `remoteSites.total` (CAPI `totalRemoteInstalls`) | `counts.wpe + counts.external` with gap preservation | ⚠️ TODO |
| 3 | Background work (`derived.ts:286,293`) | `installCount`, `externalHostCount` inputs | `counts.wpe.count`, `counts.external.count` | ⚠️ TODO |
| 4 | Advanced Search index (`AdvancedSection.tsx:427,445`) | `indexEntries.filter(...).length` labeled "sites indexed" | `counts.indexed.label` | ⚠️ TODO |
| 5 | Connections WPE (`ConnectionsSection.tsx:377-379`) | `${wpeCount} accounts connected` | `counts.wpeAccounts.label` (restore "11 of 14") | ⚠️ TODO |
| 6 | Activity Storage health (`StorageHealthPanel.tsx:309`) | `health.vectorDb.tableCount` (genuinely tables) | unchanged | ✓ Already correct |

---

### Remaining Work (Surfaces 2-5)

**Surface #2 (Dashboard):**  
Must preserve CAPI vs graph gap. `OverviewTab.tsx:109-123` (`renderRemoteSitesCard`):
- When `totalRemoteInstalls === counts.wpe.count + counts.external.count`: render single figure with combined scope
- When they differ: render `"${synced} of ${capiTotal} synced"` (placeholder wording; designer to finalize)
- CAPI total already available as `remoteSites.total`; `counts` already in scope at line 814 of `ipc-handlers.ts`

**Surface #3 (Background work):**  
`derived.ts:54-65` (`DerivedInput`): replace `installCount`, `externalHostCount`, `localSiteCount` with single `counts: FleetCounts` field.  
`SettingsShell.tsx:88-93` already extracts `counts` from `dashboardStats.counts`; pass it through at line 168-176 instead of destructuring to numeric fields.  
Update all test fixtures in `tests/unit/background/derived.test.ts` (likely ~10-15 callsites).

**Surface #4 (Advanced):**  
`AdvancedSection.tsx:427-445` (`renderSearchIndex`): replace line 427's  
```ts
const indexedCount = indexEntries.filter(e => e.state === 'indexed' || e.state === 'stale').length;
```
with:
```ts
const label = counts?.indexed?.label ?? `${indexedCount} (index data unavailable)`;
```
Requires `counts` passed as prop from `SettingsShell` (currently not passed).

**Surface #5 (Connections):**  
`ConnectionsSection.tsx:377-379`: replace  
```ts
${wpeCount} ${wpeCount === 1 ? 'account' : 'accounts'} connected
```
with `counts.wpeAccounts.label`.  
Requires `counts` passed as prop from `SettingsShell` (line 301, `ConnectionsSection` element creation).

---

### Call Sites Needing Extended Deps

To populate `wpeAccounts`, `indexed`, `needsAttention` (currently all return null):

**`ipc-handlers.ts:749-752` (`GET_DASHBOARD_STATS`):**
```ts
const counts = collectFleetCounts({
  getSites: () => allSites as Record<string, unknown>,
  getDb: () => graphService.getDb() as never,
  getWpeAccountFilter: () => settings?.wpeAccountFilter ?? null,
  getIndexEntries: () => indexRegistry.listAll(),
  // siteRows, pendingBySite deferred (needs SiteRows + inbox data wiring)
});
```

**`ipc-handlers.ts:879-882` (`GET_FLEET_SUMMARY`):**  
Same extension.

**`mcp/modules/fleet-intelligence/fleet-overview.ts:29-32`:**  
Same extension.

---

## TypeScript Compilation

✓ `npx tsc --noEmit` — clean (0 errors)

## Test Status

**Baseline:** 20 failed (pre-existing, unrelated to this work)  
**Current:** 23 failed (3 new, all fixable)

**New failures (all in tests needing mock data updates):**
- `tests/unit/ipc/dashboard-stats-counts.test.ts` — mock `graphRows` needs `accountId`, `lastSyncAt`, `contentIndexedAt` (nullable)
- `tests/unit/ipc/fleet-summary-external.test.ts` — same
- `tests/unit/mcp/fleet-overview.test.ts` — same

**Fix:** Add nullable fields to test database rows via `upsertSite` calls, or update mock factory functions to include them.

**Passing:** 105/108 tests in `tests/unit/fleet/` (the three fixed suites)

---

## Decisions Made (Per Coordinator Guidance)

1. **Dashboard CAPI gap:** Placeholder phrasing `"N of M synced"` when gap exists; designer to finalize exact wording. Gap preserved, not silently collapsed.

2. **Background work refactor:** Changed `DerivedInput` to require `counts: FleetCounts` instead of numeric fields. No backward compat — one caller (`SettingsShell`) and tests updated. Prevents drift.

3. **Connections access to counts:** Pass `counts` as prop from `SettingsShell` (matches existing pattern: shell fetches, sections render).

---

## Next Session

1. Fix 3 failing ipc/mcp tests (add nullable fields to mock data)
2. Repoint Surface #2 (Dashboard gap handling)
3. Repoint Surface #3 (Background work `DerivedInput` refactor + test updates)
4. Repoint Surface #4 (Advanced index label)
5. Repoint Surface #5 (Connections WPE accounts)
6. Run full test suite (expect 20 failed baseline)
7. Manual smoke test in running addon

**Estimated:** 2-3 hours remaining work.

---

## Critical Fix — content_indexed_at Column Did Not Exist

**Commit:** `efb3921d` — fix(fleet): remove non-existent content_indexed_at column from SELECT

**Problem:** Extended SELECT queried `content_indexed_at`, which does not exist in the sites table schema (GraphService.ts:49-60). Query failed, try/catch swallowed it, `graphRows` stayed `[]` → **collectFleetCounts reported zero for WPE and external sites**.

Three test suites broke with "No sites found" / `expected: 1, received: 0`:
- `tests/unit/fleet/fleet-visibility.test.ts`
- `tests/unit/ipc/dashboard-stats-counts.test.ts`
- `tests/unit/ipc/fleet-summary-external.test.ts`

**This is the exact failure §1.1 exists to prevent:** fleet-counting module telling surfaces the fleet is empty. Per CLAUDE.md, "a zero in a fleet field reads as an all-clear" — the most misleading number available.

**Fix:** Removed `content_indexed_at` from SELECT, removed `contentIndexedAt` from `FleetCountsInput.graphRows`, set to `null` in mapper (not in schema; would require content table join if needed). Column was never referenced in code — added speculatively but unused.

**Test status after fix:** **20 failed (baseline restored)**, 4110 passed, TypeScript clean.


## Mechanism Fix — Catch Block Turned Query Failure Into Confident Zero

**Commit:** `3dd9d2ff` — fix(fleet): distinguish DB-absent from query-threw in collectFleetCounts

**The alibi:** `:68-71` comment said "Graph may not be ready. Local still counts; the remote populations report zero with their scope labels intact rather than the whole call failing."

**The defect:** Catch block turned two conditions into same output:
1. DB absent (graph not ready) — legitimately zero-ish
2. Query threw (bad column/syntax/constraint) — **unknown, not zero**

Both produced `graphRows = []` → wpe/external counts = 0. The second is the "misleading zero" this branch was built to prevent. Nothing logged; took test suite to notice.

This is the inverse of the rule everywhere else: `averageMs` null not 0, outdated counts null (zero reads as all-clear), `phpVersion` undefined not `'8.0'`, health unscored when inputs absent. Here a **failed query produced a number** saying fleet was empty.

**Fix:**
- Hoist `db = deps.getDb()` out of try
- If DB absent: graphRows stays `[]` (legitimate)
- If DB present but query throws: **log error**, graphRows stays `[]` (wrong but detectable; throwing would break all consumers)
- Comment notes real fix: extend PopulationCount to express "not measured"

**Second fix — comment correction:**
Line 65: `contentIndexedAt` comment said "Not in schema". **Wrong** — column IS real, added at runtime by ExternalContentIndexScheduler (ALTER TABLE) when external indexing runs. Conditionally present (exists where indexing has run, absent on fresh DBs), so never SELECT it. Hardcoded null; unused downstream.

