# Sprint 3: Proactive Fleet Operations - Detailed Design & Plan

**Sprint Goal:** Move from passive discovery to active fleet management with bulk operations, site grouping, and actionable intelligence.

**Timeline:** 2 weeks
**Current Date:** 2026-03-06
**Prerequisites:** Sprint 1 (Visibility) + Sprint 2 (Discovery) complete

---

## Executive Summary

### What We're Building

Sprint 3 transforms Nexus AI from a "look at your fleet" tool into a "manage your fleet" tool. Users will be able to:

1. **Bulk Operations** - Update plugins, reindex, and manage sites across the fleet in one action
2. **Site Groups & Tags** - Organize sites into named groups (e.g., "Client Sites", "Staging", "Needs Attention")
3. **Fleet Dashboard v2** - Enhanced overview with health trends, group summaries, and action items
4. **MCP Tool Expansion** - Expose Sprint 2 intelligence (health scores, filters, search) as MCP tools for AI assistants

### Why This Matters

**After Sprint 1+2:** Users can *see* their fleet health and *find* sites that need attention.

**After Sprint 3:** Users can *act* on what they find — update 15 plugins across 8 sites in one click, organize sites into logical groups, and let AI assistants leverage fleet intelligence.

### Key "Aha Moments"

- "I just updated all outdated plugins across my entire fleet in 30 seconds"
- "My AI assistant knows which of my sites need attention without me asking"
- "I grouped my sites by client and now I can manage each client's portfolio independently"

---

## Architecture Overview

### Data Flow

```
Smart Filter / Health Score / Search
       |
       v
BulkOperationManager (new) --> queues ops per site
       |
       v
OperationExecutor --> IPC to Local / WP-CLI per site
       |
       v
Progress tracked --> streamed to UI via IPC events
```

### What Exists Today

**Backend (available from Sprint 1+2):**
- `SearchService` - Cross-site search with filters
- `HealthScoreCalculator` - Per-site health scores
- `FilterEngine` - 8 smart filters returning site lists
- `QueryStorage` - Saved queries
- `GraphService` - Site metadata (plugins, themes, users)
- `IndexRegistry` - Index state per site
- `ToolRegistry` - MCP tool registration system
- `ChatService` - AI chat with tool calling

**Frontend (available):**
- `FleetOverview` - Dashboard with tabs (Overview, Search, Sites, Chat, Visibility)
- `UnifiedSearchPanel` - Fleet-wide search
- `SmartFiltersPanel` - Pre-built filter buttons
- `SiteHealthBadge` - Per-site health indicator

---

## Feature Breakdown

### Feature 1: Bulk Operations

**Goal:** Execute operations across multiple sites from filter results or manual selection.

#### Operations Supported

| Operation | Scope | Risk | Confirmation |
|-----------|-------|------|-------------|
| Bulk Reindex | Selected sites | Low | No |
| Bulk Plugin Update | Selected sites + plugin | Medium | Yes (list sites affected) |
| Bulk Start/Stop | Selected sites | Low | Yes |
| Bulk Health Refresh | All sites | Low | No |

#### BulkOperationManager

```typescript
// src/main/bulk/BulkOperationManager.ts

interface BulkOperation {
  id: string;
  type: 'reindex' | 'plugin-update' | 'start' | 'stop' | 'health-refresh';
  siteIds: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: { completed: number; total: number; errors: string[] };
  createdAt: number;
  completedAt: number | null;
}

class BulkOperationManager {
  // Queue and execute operations with concurrency limit
  async execute(op: BulkOperationRequest): Promise<string>  // returns opId
  async getStatus(opId: string): Promise<BulkOperation>
  async cancel(opId: string): Promise<void>
  listActive(): BulkOperation[]
}
```

#### IPC Channels

| Channel | Purpose |
|---------|---------|
| `BULK_EXECUTE` | Start a bulk operation |
| `BULK_STATUS` | Get operation status |
| `BULK_CANCEL` | Cancel running operation |
| `BULK_LIST` | List active/recent operations |
| `BULK_PROGRESS` | Stream progress events to renderer |

#### UI: BulkOperationsPanel

- Appears below search results or filter results
- "Apply to all X sites" button when filter/search has results
- Operation picker (reindex, update plugins, start/stop)
- Progress bar with per-site status (checkmark, spinner, X)
- Cancel button for in-progress operations
- History of recent bulk operations

---

### Feature 2: Site Groups & Tags

**Goal:** Let users organize sites into named groups for easier management.

#### Data Model

```typescript
// src/main/groups/types.ts

interface SiteGroup {
  id: string;
  name: string;
  description?: string;
  color: string;          // hex color for UI badge
  siteIds: string[];
  createdAt: number;
  updatedAt: number;
}
```

#### GroupStorage

- JSON file persistence (same pattern as QueryStorage)
- CRUD operations: create, update, delete, list, addSite, removeSite
- Pre-built groups auto-generated on first run:
  - "Running Sites" (dynamic, based on status)
  - "WPE Connected" (dynamic, based on host)
  - "Needs Attention" (dynamic, health < 50)

#### IPC Channels

| Channel | Purpose |
|---------|---------|
| `GROUPS_LIST` | List all groups |
| `GROUPS_CREATE` | Create a group |
| `GROUPS_UPDATE` | Update group (name, color, description) |
| `GROUPS_DELETE` | Delete a group |
| `GROUPS_ADD_SITE` | Add site to group |
| `GROUPS_REMOVE_SITE` | Remove site from group |

#### UI: SiteGroupsPanel

- Sidebar-style panel on Sites tab
- Color-coded group chips on site rows
- Drag-and-drop (or checkbox) to add sites to groups
- Group filter on Sites tab (show only "Client Sites")
- "Create Group from Filter" button on SmartFiltersPanel results

---

### Feature 3: Fleet Dashboard v2

**Goal:** Upgrade the Overview tab with actionable intelligence.

#### New Dashboard Cards

| Card | Content |
|------|---------|
| Fleet Health Summary | Distribution chart: X healthy, Y warning, Z critical |
| Action Items | Top 5 urgent items (from smart filters with count > 0) |
| Recent Activity | Last 10 events across all sites |
| Group Summaries | Per-group health average + site count |
| Bulk Op History | Recent bulk operations with status |

#### Health Trend Tracking

```typescript
// src/main/health/HealthTrendTracker.ts

interface HealthSnapshot {
  siteId: string;
  score: number;
  timestamp: number;
}

class HealthTrendTracker {
  record(siteId: string, score: number): void
  getTrend(siteId: string, days: number): HealthSnapshot[]
  getFleetTrend(days: number): { timestamp: number; avgScore: number }[]
}
```

- Snapshot health scores daily (triggered by dashboard poll)
- Store in SQLite (alongside GraphService DB)
- Display sparklines on site rows
- Fleet-wide trend line on Overview tab

---

### Feature 4: MCP Fleet Intelligence Tools

**Goal:** Expose Sprint 2+3 capabilities as MCP tools for AI assistants.

#### New MCP Tools

| Tool Name | Description | Tier |
|-----------|-------------|------|
| `fleet_health_summary` | Get health scores for all sites | 1 (read) |
| `get_site_health` | Get detailed health breakdown for one site | 1 (read) |
| `fleet_search` | Cross-site semantic search | 1 (read) |
| `fleet_filter` | Apply smart filter, return matching sites | 1 (read) |
| `bulk_reindex` | Reindex multiple sites | 2 (write) |
| `bulk_plugin_update` | Update plugin across sites | 3 (destructive) |
| `list_site_groups` | List all site groups | 1 (read) |
| `manage_site_group` | Create/update/delete site groups | 2 (write) |

#### Integration with ChatService

The AI chat already has tool calling via `ToolRegistry`. Adding these tools means the chat can:
- "Which of my sites have low health scores?" -> calls `fleet_health_summary`
- "Update akismet on all sites that need it" -> calls `fleet_filter` then `bulk_plugin_update`
- "Show me my client sites" -> calls `list_site_groups`

---

## Implementation Plan

### Week 1: Backend (Days 1-5)

#### Day 1: BulkOperationManager Core
- [ ] Create `src/main/bulk/BulkOperationManager.ts`
- [ ] Create `src/main/bulk/types.ts`
- [ ] Implement operation queue with concurrency limit (3 concurrent)
- [ ] Implement `execute()`, `getStatus()`, `cancel()`, `listActive()`
- [ ] Tests: 10+ unit tests
- [ ] Wire up progress event emission

#### Day 2: Bulk Operation Executors
- [ ] Implement reindex executor (calls ContentPipeline per site)
- [ ] Implement plugin-update executor (calls WP-CLI per site)
- [ ] Implement start/stop executor (calls Local services per site)
- [ ] Implement health-refresh executor (calls HealthScoreCalculator per site)
- [ ] Tests: 8+ tests for each executor
- [ ] Error handling: per-site errors don't abort the batch

#### Day 3: Site Groups
- [ ] Create `src/main/groups/GroupStorage.ts`
- [ ] Create `src/main/groups/types.ts`
- [ ] Implement CRUD + addSite/removeSite
- [ ] Auto-generate dynamic groups on first load
- [ ] Tests: 10+ tests
- [ ] JSON persistence (same pattern as QueryStorage)

#### Day 4: Health Trends + IPC Handlers
- [ ] Create `src/main/health/HealthTrendTracker.ts`
- [ ] Record snapshots on dashboard poll
- [ ] Trend query methods (per-site, fleet-wide)
- [ ] Register all Sprint 3 IPC handlers (bulk ops, groups, trends)
- [ ] Tests: 8+ tests
- [ ] Add IPC channels to constants.ts

#### Day 5: MCP Fleet Intelligence Tools
- [ ] Create `src/main/mcp/modules/fleet-intelligence/` module
- [ ] Register 8 new MCP tools with ToolRegistry
- [ ] Wire tools to SearchService, HealthScoreCalculator, FilterEngine, BulkOperationManager, GroupStorage
- [ ] Tests: 8+ tests
- [ ] Update MCP server instructions with new tool docs

### Week 2: Frontend (Days 6-10)

#### Day 6: BulkOperationsPanel Component
- [ ] Create `src/renderer/components/BulkOperationsPanel.tsx`
- [ ] Operation picker UI (dropdown + confirmation dialog)
- [ ] Progress bar with per-site status indicators
- [ ] Cancel button and error display
- [ ] Tests: 6+ renderer tests

#### Day 7: SiteGroupsPanel Component
- [ ] Create `src/renderer/components/SiteGroupsPanel.tsx`
- [ ] Group list with color badges
- [ ] Create/edit/delete group forms
- [ ] "Add to Group" context action on site rows
- [ ] Tests: 6+ renderer tests

#### Day 8: Fleet Dashboard v2
- [ ] Enhance Overview tab: Fleet Health Summary card
- [ ] Action Items card (from smart filters)
- [ ] Group Summaries card
- [ ] Bulk Op History card
- [ ] Tests: 6+ renderer tests

#### Day 9: Integration & Polish
- [ ] Wire BulkOperationsPanel into Search tab (below results)
- [ ] Wire SiteGroupsPanel into Sites tab (sidebar)
- [ ] Add group filter to Sites tab
- [ ] Add "Create Group from Filter" to SmartFiltersPanel
- [ ] Health trend sparklines on site rows (stretch)

#### Day 10: Testing & Documentation
- [ ] Run all Sprint 3 tests
- [ ] Build verification (tsc + webpack)
- [ ] Sprint 3 completion docs
- [ ] Update user guide with new features
- [ ] Commit and prepare for merge

---

## IPC Channel Summary

```typescript
// New Sprint 3 channels
BULK_EXECUTE: 'nexus-ai:bulk:execute',
BULK_STATUS: 'nexus-ai:bulk:status',
BULK_CANCEL: 'nexus-ai:bulk:cancel',
BULK_LIST: 'nexus-ai:bulk:list',
BULK_PROGRESS: 'nexus-ai:bulk:progress',

GROUPS_LIST: 'nexus-ai:groups:list',
GROUPS_CREATE: 'nexus-ai:groups:create',
GROUPS_UPDATE: 'nexus-ai:groups:update',
GROUPS_DELETE: 'nexus-ai:groups:delete',
GROUPS_ADD_SITE: 'nexus-ai:groups:add-site',
GROUPS_REMOVE_SITE: 'nexus-ai:groups:remove-site',

HEALTH_GET_TREND: 'nexus-ai:health:get-trend',
HEALTH_GET_FLEET_TREND: 'nexus-ai:health:get-fleet-trend',

DASHBOARD_V2_STATS: 'nexus-ai:dashboard:v2-stats',
```

## Type Summary

```typescript
// New Sprint 3 types in src/common/types.ts

interface BulkOperationStatus {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: { completed: number; total: number; errors: string[] };
  createdAt: number;
  completedAt: number | null;
}

interface SiteGroup {
  id: string;
  name: string;
  description?: string;
  color: string;
  siteIds: string[];
  createdAt: number;
  updatedAt: number;
}

interface HealthTrend {
  siteId: string;
  snapshots: { score: number; timestamp: number }[];
}

interface DashboardV2Stats {
  healthDistribution: { healthy: number; warning: number; critical: number };
  actionItems: { filterId: string; label: string; count: number; severity: string }[];
  recentActivity: { siteId: string; siteName: string; event: string; timestamp: number }[];
  groupSummaries: { groupId: string; name: string; color: string; siteCount: number; avgHealth: number }[];
  recentBulkOps: BulkOperationStatus[];
}
```

## Test Count Estimate

| Area | Tests |
|------|-------|
| BulkOperationManager | 18 |
| GroupStorage | 10 |
| HealthTrendTracker | 8 |
| MCP Fleet Intelligence Tools | 8 |
| BulkOperationsPanel | 6 |
| SiteGroupsPanel | 6 |
| Dashboard v2 | 6 |
| **Total** | **~62** |

**Running total across sprints:** Sprint 1 (~80) + Sprint 2 (68) + Sprint 3 (~62) = ~210 tests

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Bulk ops affecting running sites | Confirmation dialog + per-site error isolation |
| Plugin updates breaking sites | Dry-run mode first, then confirm |
| Concurrency issues in bulk ops | Queue with configurable concurrency limit (default 3) |
| Large fleet performance | Lazy loading, pagination, streaming progress |
| Group data loss | JSON persistence with atomic writes (write temp + rename) |

---

## Success Criteria

- [ ] Bulk reindex across 5+ sites completes successfully
- [ ] Plugin update across multiple sites with progress tracking
- [ ] Site groups create/edit/delete with persistent storage
- [ ] Dashboard shows health distribution + action items
- [ ] 8 new MCP tools registered and callable from chat
- [ ] All ~62 new tests passing
- [ ] Clean build (tsc + webpack)

---

## Sprint 3 vs Sprint 4 Preview

**Sprint 3** (this sprint): Proactive fleet management — bulk ops, groups, dashboard v2, MCP tools

**Sprint 4** (next): Automation & Scheduling
- Scheduled health checks (cron-like)
- Auto-reindex on content changes (event-driven)
- Alert rules (notify when health drops below threshold)
- Webhook integrations (Slack, email notifications)
- Custom automation workflows (if X then Y)

---

**Last Updated:** 2026-03-06
**Status:** Planning Complete
**Ready to Start:** Day 1 - BulkOperationManager Implementation
