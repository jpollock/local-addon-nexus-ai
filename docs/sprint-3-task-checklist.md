# Sprint 3 Task Checklist: Proactive Fleet Operations

## Week 1: Backend

### Day 1: BulkOperationManager Core
- [ ] `src/main/bulk/types.ts` - BulkOperation, BulkOperationRequest types
- [ ] `src/main/bulk/BulkOperationManager.ts` - Queue, execute, cancel, status
- [ ] Concurrency limiter (max 3 parallel site operations)
- [ ] Progress event emission via callback
- [ ] `tests/unit/bulk/bulk-operation-manager.test.ts` - 10+ tests
- [ ] Operation lifecycle: pending -> running -> completed/failed

### Day 2: Bulk Operation Executors
- [ ] Reindex executor - calls ContentPipeline.reindexSite per site
- [ ] Plugin update executor - calls wp_plugin_update per site
- [ ] Start/stop executor - calls Local start/stop per site
- [ ] Health refresh executor - calls HealthScoreCalculator per site
- [ ] Per-site error isolation (one failure doesn't abort batch)
- [ ] `tests/unit/bulk/executors.test.ts` - 8+ tests

### Day 3: Site Groups
- [ ] `src/main/groups/types.ts` - SiteGroup interface
- [ ] `src/main/groups/GroupStorage.ts` - CRUD + addSite/removeSite
- [ ] JSON file persistence with atomic writes
- [ ] Dynamic group generation (Running, WPE Connected, Needs Attention)
- [ ] `tests/unit/groups/group-storage.test.ts` - 10+ tests

### Day 4: Health Trends + IPC Handlers
- [ ] `src/main/health/HealthTrendTracker.ts` - Record + query snapshots
- [ ] SQLite table for health snapshots (in graph DB)
- [ ] Per-site and fleet-wide trend queries
- [ ] Register all Sprint 3 IPC handlers in ipc-handlers.ts
- [ ] Add Sprint 3 IPC channels to constants.ts
- [ ] Add Sprint 3 types to common/types.ts
- [ ] `tests/unit/health/health-trend-tracker.test.ts` - 8+ tests

### Day 5: MCP Fleet Intelligence Tools
- [ ] `src/main/mcp/modules/fleet-intelligence/` directory
- [ ] `fleet_health_summary` tool - all site health scores
- [ ] `get_site_health` tool - detailed breakdown for one site
- [ ] `fleet_search` tool - cross-site semantic search
- [ ] `fleet_filter` tool - apply smart filter
- [ ] `bulk_reindex` tool - reindex multiple sites (tier 2)
- [ ] `bulk_plugin_update` tool - update plugin across sites (tier 3)
- [ ] `list_site_groups` tool - list groups
- [ ] `manage_site_group` tool - CRUD groups (tier 2)
- [ ] Register with ToolRegistry in index.ts
- [ ] `tests/unit/mcp/fleet-intelligence.test.ts` - 8+ tests

## Week 2: Frontend

### Day 6: BulkOperationsPanel
- [ ] `src/renderer/components/BulkOperationsPanel.tsx`
- [ ] Operation type picker dropdown
- [ ] Confirmation dialog with site list
- [ ] Progress bar with per-site status icons
- [ ] Cancel button
- [ ] Error summary
- [ ] `tests/unit/renderer/BulkOperationsPanel.test.tsx` - 6+ tests

### Day 7: SiteGroupsPanel
- [ ] `src/renderer/components/SiteGroupsPanel.tsx`
- [ ] Group list with color badges
- [ ] Create group form (name, color picker, description)
- [ ] Edit/delete group actions
- [ ] "Add to Group" button on site rows
- [ ] Group filter dropdown on Sites tab
- [ ] `tests/unit/renderer/SiteGroupsPanel.test.tsx` - 6+ tests

### Day 8: Fleet Dashboard v2
- [ ] Fleet Health Summary card (healthy/warning/critical counts)
- [ ] Action Items card (top smart filter alerts)
- [ ] Group Summaries card (per-group health averages)
- [ ] Bulk Op History card (recent operations)
- [ ] Enhanced Overview tab layout
- [ ] `tests/unit/renderer/DashboardV2.test.tsx` - 6+ tests

### Day 9: Integration & Polish
- [ ] Wire BulkOperationsPanel into Search tab
- [ ] Wire SiteGroupsPanel as sidebar in Sites tab
- [ ] Group chips on site rows in Sites tab
- [ ] "Create Group from Filter" on SmartFiltersPanel
- [ ] Health trend sparklines on site rows (stretch goal)
- [ ] Cross-component navigation (filter -> bulk op flow)

### Day 10: Testing & Documentation
- [ ] Run all Sprint 3 tests (target: ~62 new)
- [ ] Run full test suite
- [ ] Build verification: `npx tsc --noEmit` + `npm run build`
- [ ] `docs/sprint-3-completion.md`
- [ ] Update user guide
- [ ] Commit all Sprint 3 work
- [ ] Merge to main

## Completion Criteria
- [ ] All ~62 new tests passing
- [ ] Clean TypeScript + webpack build
- [ ] Bulk reindex across multiple sites works end-to-end
- [ ] Site groups persist across restarts
- [ ] 8 new MCP tools callable from chat
- [ ] Dashboard v2 shows health distribution + action items
