# Sprint 3 Task Checklist: Proactive Fleet Operations

## Week 1: Backend

### Day 1: BulkOperationManager Core
- [ ] `src/main/bulk/types.ts` — BulkOpType, BulkOperationRequest, BulkOperation, SiteOpResult, BulkOperationStatus
- [ ] `src/main/bulk/BulkOperationManager.ts` — core class
- [ ] `execute(request)` — creates op, generates unique ID, starts background execution
- [ ] `executeWithConcurrency(op)` — processes queue with max 3 parallel
- [ ] `executeSingle(op, siteId)` — runs one site with try/catch isolation
- [ ] `getStatus(opId)` — returns current BulkOperationStatus
- [ ] `cancel(opId)` — signals abort via AbortController
- [ ] `listAll()` — returns last 20 operations sorted by createdAt desc
- [ ] Progress callback emission on every state change (site started, completed, failed)
- [ ] `tests/unit/bulk/bulk-operation-manager.test.ts` (10 tests):
  - [ ] Queue creation returns unique operation ID
  - [ ] Concurrent execution respects max=3 limit
  - [ ] Per-site error isolation: one fails, others continue
  - [ ] Cancel stops pending operations (already-running complete)
  - [ ] Status transitions: running → completed
  - [ ] Status transitions: running → completed_with_errors (when some fail)
  - [ ] Progress callback called on each site completion
  - [ ] Empty siteIds returns immediately as completed
  - [ ] listAll returns sorted desc by createdAt, max 20
  - [ ] Multiple operations tracked independently

### Day 2: Bulk Operation Executors
- [ ] `executeReindex(siteId)` — resolve site object, check running, call contentPipeline.indexSite
- [ ] `executePluginUpdate(siteId, pluginSlug)` — check running, call wpCliRun(['plugin','update',slug])
- [ ] `executeHealthRefresh(siteId)` — resolve site, call healthCalculator.calculateScore
- [ ] Start executor: call siteDataBridge.startSite(siteId)
- [ ] Stop executor: call siteDataBridge.stopSite(siteId)
- [ ] Error messages include site ID and operation context
- [ ] `tests/unit/bulk/executors.test.ts` (8 tests):
  - [ ] Reindex calls contentPipeline.indexSite with correct SiteConnectionInfo
  - [ ] Reindex throws "Site not running" if status !== 'running'
  - [ ] Plugin update calls wpCliRun with ['plugin','update',slug,'--format=json']
  - [ ] Plugin update throws on WP-CLI failure (result.success=false)
  - [ ] Start/stop call siteDataBridge.startSite / stopSite
  - [ ] Health refresh calls calculateScore with site info
  - [ ] Reindex throws "Site not found" for invalid siteId
  - [ ] Plugin update throws "Site not running" if halted

### Day 3: Site Groups
- [ ] `src/main/groups/types.ts` — SiteGroup interface (id, name, description, color, siteIds, isDynamic, timestamps)
- [ ] `src/main/groups/GroupStorage.ts` — GroupStorage class
- [ ] `load()` — read JSON file, populate map
- [ ] `persist()` — atomic write (tmp → rename)
- [ ] `create(name, color, description)` — generate ID, save
- [ ] `update(id, changes)` — reject dynamic groups
- [ ] `delete(id)` — reject dynamic groups
- [ ] `addSite(groupId, siteId)` — idempotent, reject dynamic
- [ ] `removeSite(groupId, siteId)` — reject dynamic
- [ ] `get(id)`, `list()` — sorted: dynamic first, then alpha
- [ ] `getGroupsForSite(siteId)` — all groups containing site
- [ ] `tests/unit/groups/group-storage.test.ts` (12 tests):
  - [ ] Create group with name, color, description returns SiteGroup
  - [ ] Create generates unique ID
  - [ ] List returns sorted: dynamic first, then alphabetical
  - [ ] Update changes name and color
  - [ ] Update sets updatedAt timestamp
  - [ ] Delete removes group from list
  - [ ] Cannot delete dynamic group (returns false)
  - [ ] Cannot update dynamic group (returns null)
  - [ ] addSite appends to siteIds
  - [ ] addSite is idempotent (no duplicate)
  - [ ] removeSite removes from siteIds
  - [ ] getGroupsForSite returns matching groups
  - [ ] Persistence: save then load returns same data
  - [ ] Empty storage returns empty list

### Day 4: Health Trends + IPC Handlers
- [ ] `src/main/health/HealthTrendTracker.ts` — HealthTrendTracker class
- [ ] SQLite table: health_snapshots (id, site_id, score, timestamp)
- [ ] Index: idx_health_site_time (site_id, timestamp)
- [ ] `record(siteId, score)` — insert with 1-hour dedup (skip if same score recently)
- [ ] `getSiteTrend(siteId, days)` — return chronological HealthSnapshot[]
- [ ] `getFleetTrend(days)` — return daily average { timestamp, avgScore }[]
- [ ] `prune(keepDays)` — delete old snapshots, return count deleted
- [ ] Add 14 Sprint 3 IPC channels to `src/common/constants.ts`
- [ ] Add Sprint 3 types to `src/common/types.ts` (BulkOperationStatus, SiteGroup, HealthTrend, DashboardV2Stats)
- [ ] Register all Sprint 3 IPC handlers in `src/main/ipc-handlers.ts`
- [ ] Instantiate BulkOperationManager, GroupStorage, HealthTrendTracker in ipc-handlers
- [ ] Wire BULK_PROGRESS to mainWindow.webContents.send for streaming
- [ ] `tests/unit/health/health-trend-tracker.test.ts` (8 tests):
  - [ ] record() creates snapshot in DB
  - [ ] Dedup: same score within 1 hour is skipped
  - [ ] Different score within 1 hour is recorded
  - [ ] getSiteTrend returns chronological snapshots
  - [ ] getSiteTrend filters by days parameter
  - [ ] getFleetTrend returns daily averages
  - [ ] prune removes old snapshots, returns count
  - [ ] Empty DB returns empty arrays

### Day 5: MCP Fleet Intelligence Tools
- [ ] Create `src/main/mcp/modules/fleet-intelligence/` directory
- [ ] `fleet-health-summary.ts` — Tier 1, all-site scores + fleet stats
- [ ] `get-site-health.ts` — Tier 1, single site HealthBreakdown
- [ ] `fleet-search.ts` — Tier 1, delegates to SearchService.searchFleet
- [ ] `fleet-filter.ts` — Tier 1, delegates to FilterEngine.applyFilter
- [ ] `bulk-reindex.ts` — Tier 2, delegates to BulkOperationManager.execute
- [ ] `bulk-plugin-update.ts` — Tier 3, requires confirmation token
- [ ] `list-site-groups.ts` — Tier 1, delegates to GroupStorage.list
- [ ] `manage-site-group.ts` — Tier 2, GroupStorage CRUD via action param
- [ ] `index.ts` — registerFleetIntelligenceTools(registry)
- [ ] Wire into `src/main/index.ts` alongside existing tool registrations
- [ ] Pass Sprint 2+3 services to NexusServices (or resolve via service container)
- [ ] Update `src/main/mcp/instructions/server-instructions.ts` with new tool docs
- [ ] `tests/unit/mcp/fleet-intelligence.test.ts` (8 tests):
  - [ ] fleet_health_summary returns scores for all indexed sites
  - [ ] get_site_health returns HealthBreakdown for valid site
  - [ ] fleet_search calls searchService.searchFleet with correct params
  - [ ] fleet_filter calls filterEngine.applyFilter, returns matching sites
  - [ ] bulk_reindex creates operation via BulkOperationManager
  - [ ] bulk_plugin_update has tier 3 safety (requires confirmation)
  - [ ] list_site_groups returns all groups
  - [ ] manage_site_group creates and deletes groups

## Week 2: Frontend

### Day 6: BulkOperationsPanel
- [ ] `src/renderer/components/BulkOperationsPanel.tsx` — class-based, createElement
- [ ] Operation type dropdown: reindex, plugin-update, start, stop, health-refresh
- [ ] Plugin slug input (only visible when type = plugin-update)
- [ ] "Execute on N Sites" button → shows confirmation dialog
- [ ] Confirmation: list affected site names, require explicit click
- [ ] Progress bar: % complete (completed / total)
- [ ] Per-site status list: checkmark (done), spinner (running), circle (pending), X (failed)
- [ ] Cancel button during execution (calls BULK_CANCEL IPC)
- [ ] Error summary at bottom (list of failed sites + error messages)
- [ ] Poll BULK_STATUS every 1 second while running
- [ ] Stop polling when completed/cancelled/failed
- [ ] `tests/unit/renderer/BulkOperationsPanel.test.tsx` (7 tests):
  - [ ] Renders operation type dropdown with all options
  - [ ] Shows plugin slug input only for plugin-update
  - [ ] Execute button shows confirmation with site count
  - [ ] Progress bar updates from mock IPC response
  - [ ] Cancel button calls cancel IPC channel
  - [ ] Error display shows failed site names
  - [ ] Completed state shows success summary

### Day 7: SiteGroupsPanel
- [ ] `src/renderer/components/SiteGroupsPanel.tsx` — class-based, createElement
- [ ] Group list: color dot + name + site count + avg health
- [ ] Click group → calls onGroupFilter(groupId)
- [ ] Active group highlighted with border
- [ ] "Show All" option to clear filter (onGroupFilter(null))
- [ ] Create form: name input, 8 color swatches, description textarea
- [ ] Edit: click pencil icon to inline-edit name/color
- [ ] Delete: click X icon, no confirmation (groups are lightweight)
- [ ] Dynamic groups show [Auto] badge, no edit/delete controls
- [ ] Expand group to see member site names
- [ ] Empty state when no groups
- [ ] `tests/unit/renderer/SiteGroupsPanel.test.tsx` (7 tests):
  - [ ] Renders group list with color dots and counts
  - [ ] Create form appears on button click
  - [ ] Color picker highlights selected color
  - [ ] Delete removes group from list
  - [ ] Dynamic groups show auto badge, no edit/delete
  - [ ] Click group triggers onGroupFilter callback
  - [ ] Empty state when no groups

### Day 8: Fleet Dashboard v2
- [ ] `renderFleetHealthCard()` — horizontal bar: green/yellow/red segments with counts
- [ ] `renderActionItemsCard()` — list from smart filter counts > 0, severity icons, "Fix All" links
- [ ] `renderGroupSummariesCard()` — table: color dot, group name, site count, avg health
- [ ] `renderBulkOpHistoryCard()` — list: status icon, description, time ago
- [ ] Fetch `DASHBOARD_V2_STATS` IPC on mount (alongside existing GET_DASHBOARD_STATS)
- [ ] Add DashboardV2Stats to FleetOverviewState
- [ ] Layout: row 1 = Fleet Health (full width), row 2 = Action Items (full width), row 3 = Groups + Bulk Ops (2 col)
- [ ] "Fix All" on action items opens Search tab with filter pre-applied
- [ ] `tests/unit/renderer/DashboardV2.test.tsx` (6 tests):
  - [ ] Health distribution card shows healthy/warning/critical counts
  - [ ] Action items card lists non-zero filters
  - [ ] Group summaries card shows group names and avg health
  - [ ] Bulk op history card shows recent operations
  - [ ] Loading state renders spinner
  - [ ] Empty action items shows "All clear" message

### Day 9: Integration & Polish
- [ ] **Sites tab**: Group filter chip row above table header
- [ ] **Sites tab**: New "Groups" column with colored dots (getGroupsForSite)
- [ ] **Sites tab**: Checkbox column for multi-select (track selectedSiteIds in state)
- [ ] **Sites tab**: "Bulk Action" button at bottom (appears when ≥1 site selected)
- [ ] **Sites tab**: BulkOperationsPanel slides in below table when triggered
- [ ] **Search tab**: "Bulk Action" button below search results
- [ ] **SmartFiltersPanel**: "Create Group" button on each filter (creates group from matching sites)
- [ ] Verify all 14 IPC channels work end-to-end (renderer → main → response)
- [ ] Test BulkOperationsPanel progress updates in real time
- [ ] Test group filter correctly filters Sites tab

### Day 10: Testing & Documentation
- [ ] Run all Sprint 3 tests: `npx jest tests/unit/bulk/ tests/unit/groups/ tests/unit/health/health-trend tests/unit/mcp/fleet tests/unit/renderer/BulkOp tests/unit/renderer/SiteGroups tests/unit/renderer/Dashboard`
- [ ] Run full test suite: `npx jest --no-coverage`
- [ ] TypeScript check: `npx tsc --noEmit`
- [ ] Full build: `npm run build`
- [ ] Write `docs/sprint-3-completion.md`
- [ ] Update `docs/user-guide.md` with bulk ops and groups sections
- [ ] Commit all Sprint 3 work
- [ ] Merge sprint-3-proactive-fleet-ops → main

## Completion Summary

| Layer | New Files | Tests |
|-------|-----------|-------|
| Backend: Bulk Ops | 2 | 18 |
| Backend: Groups | 2 | 12 |
| Backend: Health Trends | 1 | 8 |
| Backend: MCP Tools | 10 | 8 |
| Frontend: Components | 2 | 14 |
| Frontend: Dashboard v2 | (modify) | 6 |
| **Total** | **~17 new + 7 modified** | **~66** |

## Success Criteria
- [ ] Bulk reindex across 5+ sites with real-time progress
- [ ] Bulk plugin update with dry-run and tier 3 confirmation
- [ ] Per-site error isolation (one failure doesn't abort batch)
- [ ] Cancel stops pending operations mid-batch
- [ ] Site groups CRUD with persistent storage
- [ ] Group filter on Sites tab
- [ ] Dashboard v2 shows health distribution + action items + groups
- [ ] 8 new MCP tools callable from chat
- [ ] All ~66 new tests passing
- [ ] Clean build (tsc + webpack)
