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
3. **Fleet Dashboard v2** - Enhanced overview with health distribution, action items, and group summaries
4. **MCP Fleet Intelligence Tools** - Expose Sprint 2+3 capabilities as MCP tools for AI assistants

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
OperationExecutor --> ContentPipeline / LocalServicesBridge / HealthScoreCalculator per site
       |
       v
Progress tracked --> streamed to UI via IPC events
```

### What Exists Today

**Backend (available from Sprint 1+2):**
- `SearchService` - Cross-site search with filters, facets, sorting
- `HealthScoreCalculator` - Per-site 5-factor health scores (0-100)
- `FilterEngine` - 8 smart filters returning matching site IDs
- `QueryStorage` - Saved query persistence (JSON)
- `GraphService` - Site metadata (plugins, themes, users, events)
- `IndexRegistry` - Index state per site (indexed/stale/error)
- `ContentPipeline` - `indexSite()` / `reindexSite()` per site
- `LocalServicesBridge` - Start/stop sites, WP-CLI, plugin management
- `ToolRegistry` - MCP tool registration with safety tiers
- `ChatService` - AI chat with tool calling via providers

**Frontend (available):**
- `FleetOverview` - Dashboard with tabs (Overview, Search, Sites, Chat, Visibility)
- `UnifiedSearchPanel` - Fleet-wide search with pagination + facets
- `SmartFiltersPanel` - Pre-built filter buttons with count badges
- `SiteHealthBadge` - Per-site health indicator (color-coded circle)
- `SavedQueriesPanel` - Create/run/pin/delete saved queries

### What We Need to Build

**Backend (New Services):**
1. `BulkOperationManager` - Queue, execute, track, cancel bulk operations
2. `GroupStorage` - Site group CRUD with JSON persistence
3. `HealthTrendTracker` - Record and query health snapshots over time
4. Fleet Intelligence MCP tools (8 new tools)

**Data Layer Extensions:**
1. `GraphService.getRecentActivity()` - Recent events across fleet for dashboard
2. Health snapshot table in SQLite (alongside graph DB)

**Frontend (New Components):**
1. `BulkOperationsPanel` - Operation picker + progress tracking
2. `SiteGroupsPanel` - Group list with CRUD
3. Enhanced `FleetOverview` Overview tab (Dashboard v2)

**Frontend (Modified):**
1. `FleetOverview` Sites tab - Group chips, group filter sidebar
2. `SmartFiltersPanel` - "Create Group from Filter" action
3. `FleetOverview` Overview tab - New dashboard cards

---

## Component Designs

### 1. BulkOperationsPanel Component

**Purpose:** Execute and track operations across multiple sites

**UI Design:**
```
┌─────────────────────────────────────────────────────────┐
│ Bulk Operations                                [History]│
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Selected: 5 sites from "Security Updates" filter         │
│                                                          │
│ Operation: [Reindex All ▼]                               │
│   Options:  Reindex All                                  │
│             Update Plugin...                             │
│             Start Sites                                  │
│             Stop Sites                                   │
│             Refresh Health                               │
│                                                          │
│ [Execute on 5 Sites]                                     │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ Running: Reindex 5 sites                    [Cancel]     │
│ ████████████░░░░░░░░ 3/5 (60%)                          │
│                                                          │
│ ✓ my-blog.local           completed  1.2s               │
│ ✓ client-a.local          completed  0.8s               │
│ ● staging.local           running...                     │
│ ○ production.local        pending                        │
│ ✗ broken-site.local       failed: Site not running       │
│                                                          │
│ Errors: 1 site failed                                    │
└─────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface BulkOperationsPanelProps {
  electron: any;
  /** Site IDs to operate on (from filter/search/manual selection) */
  siteIds: string[];
  /** Site name map for display */
  siteNames: Record<string, string>;
  /** Called when operation completes */
  onComplete?: () => void;
}
```

**State:**
```typescript
interface BulkOperationsPanelState {
  selectedOp: BulkOpType | null;
  pluginSlug: string;            // For plugin update op
  confirming: boolean;           // Show confirmation dialog
  activeOp: BulkOperationStatus | null;
  history: BulkOperationStatus[];
  showHistory: boolean;
  error: string | null;
}

type BulkOpType = 'reindex' | 'plugin-update' | 'start' | 'stop' | 'health-refresh';
```

**Key Features:**
- Operation type dropdown with descriptions
- Plugin slug input (only shown for plugin-update)
- Confirmation dialog showing affected site list
- Real-time progress bar with per-site status
- Cancel button for in-progress operations
- Error summary for failed sites
- History of recent operations (collapsible)

**IPC Calls:**
- `nexus-ai:bulk:execute` (type, siteIds, options) → { opId: string }
- `nexus-ai:bulk:status` (opId) → BulkOperationStatus
- `nexus-ai:bulk:cancel` (opId) → { success: boolean }
- `nexus-ai:bulk:list` → BulkOperationStatus[]
- `nexus-ai:bulk:progress` → stream events (via ipcRenderer.on)

**File Location:** `src/renderer/components/BulkOperationsPanel.tsx`

---

### 2. SiteGroupsPanel Component

**Purpose:** Organize sites into named, color-coded groups

**UI Design:**
```
┌─────────────────────────────────────────────────────────┐
│ Site Groups                                [+ New Group] │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ● Client Sites (5 sites)              [Edit] [Delete]   │
│   my-blog, client-a, client-b, demo, portfolio          │
│   Avg Health: 82                                         │
│                                                          │
│ ● Staging (3 sites)                   [Edit] [Delete]   │
│   staging-a, staging-b, staging-c                        │
│   Avg Health: 91                                         │
│                                                          │
│ ● Needs Attention (2 sites)           [Auto]            │
│   broken-site, old-project                               │
│   Avg Health: 38                                         │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ Create New Group:                                        │
│ Name: [________________]                                 │
│ Color: [●] [●] [●] [●] [●] [●] [●] [●]               │
│ Description: [________________________]                  │
│ [Create Group]                                          │
└─────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface SiteGroupsPanelProps {
  electron: any;
  /** All available site IDs for "Add to Group" */
  allSites: { id: string; name: string }[];
  /** Currently selected group filter (null = show all) */
  activeGroupId: string | null;
  /** Called when user clicks a group to filter sites */
  onGroupFilter?: (groupId: string | null) => void;
}
```

**State:**
```typescript
interface SiteGroupsPanelState {
  groups: SiteGroup[];
  loading: boolean;
  error: string | null;
  showCreateForm: boolean;
  editingGroupId: string | null;
  newGroupName: string;
  newGroupColor: string;
  newGroupDescription: string;
}
```

**Color Palette (8 preset colors):**
```typescript
const GROUP_COLORS = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#6b7280', // gray
];
```

**Key Features:**
- Group list with color dots and site counts
- Avg health score per group
- Click group to filter Sites tab
- Create form with name, color picker, description
- Edit/delete group actions
- Dynamic groups marked with [Auto] badge (non-deletable)
- Expand group to see member sites

**IPC Calls:**
- `nexus-ai:groups:list` → SiteGroup[]
- `nexus-ai:groups:create` (name, color, description) → SiteGroup
- `nexus-ai:groups:update` (id, changes) → SiteGroup
- `nexus-ai:groups:delete` (id) → { success: boolean }
- `nexus-ai:groups:add-site` (groupId, siteId) → { success: boolean }
- `nexus-ai:groups:remove-site` (groupId, siteId) → { success: boolean }

**File Location:** `src/renderer/components/SiteGroupsPanel.tsx`

---

### 3. Enhanced FleetOverview (Dashboard v2)

**Purpose:** Upgrade the Overview tab with actionable intelligence

**UI Design:**
```
┌──────────────── Fleet Health ─────────────────────────────┐
│                                                            │
│   12 healthy    5 warning    2 critical                    │
│   ████████████  █████        ██                            │
│   (63%)         (26%)        (11%)                         │
│                                                            │
└────────────────────────────────────────────────────────────┘

┌──────────────── Action Items ─────────────────────────────┐
│                                                            │
│  🔴 3 sites need security updates           [Fix All →]   │
│  🟡 2 sites running outdated PHP            [View →]      │
│  🟡 5 sites not indexed                     [Index All →] │
│  🔵 4 sites with no events in 7 days        [View →]      │
│                                                            │
│  ✅ All other checks passing                              │
│                                                            │
└────────────────────────────────────────────────────────────┘

┌──── Group Summaries ──────┐  ┌──── Recent Bulk Ops ───────┐
│                            │  │                             │
│ ● Client Sites  5  avg:82 │  │ ✓ Reindex 5 sites   2m ago │
│ ● Staging       3  avg:91 │  │ ✓ Update akismet    1h ago │
│ ● Needs Attn    2  avg:38 │  │ ✗ Start 3 sites     3h ago │
│                            │  │                             │
└────────────────────────────┘  └─────────────────────────────┘
```

**New Dashboard Cards (added to existing renderOverviewTab):**

```typescript
// New cards added to Overview tab
renderFleetHealthCard(stats: DashboardV2Stats): React.ReactNode
renderActionItemsCard(stats: DashboardV2Stats): React.ReactNode
renderGroupSummariesCard(stats: DashboardV2Stats): React.ReactNode
renderBulkOpHistoryCard(stats: DashboardV2Stats): React.ReactNode
```

**IPC Call:**
- `nexus-ai:dashboard:v2-stats` → DashboardV2Stats

**File Changes:** `src/renderer/components/FleetOverview.tsx` (modify existing)

---

### 4. FleetOverview Integration Points

**Sites Tab Enhancements:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Groups: [All Sites ▼] [Client Sites] [Staging] [+ Add Group]       │
├──────────┬────────┬────────┬───────┬──────┬────────┬───────┬───────┤
│ Site     │ Groups │ Health │ Status│ Index│ Docs   │ Last  │       │
├──────────┼────────┼────────┼───────┼──────┼────────┼───────┼───────┤
│ my-blog  │ ● ●    │  (92)  │ ●Run  │ ●idx │ 1,234  │ 2h ago│[Reidx]│
│ client-a │ ●      │  (67)  │ ●Run  │ ●stl │   890  │ 8d ago│[Reidx]│
│ staging  │   ●    │  (85)  │ ●Stop │ ●idx │   456  │ 1d ago│       │
├──────────┴────────┴────────┴───────┴──────┴────────┴───────┴───────┤
│ ☐ Select All (3 sites)                    [Bulk Action ▼]          │
└─────────────────────────────────────────────────────────────────────┘
```

**Changes to renderSitesTab():**
- Add group filter row above table
- Add "Groups" column with color dots
- Add checkbox column for multi-select
- Add "Bulk Action" button at bottom (opens BulkOperationsPanel)
- Filter sites by selected group

**Search Tab Enhancements:**

The Search tab already has a 2-column layout (UnifiedSearchPanel + SmartFiltersPanel + SavedQueriesPanel). Sprint 3 adds:
- "Bulk Action" button below search results (when results contain site IDs)
- "Create Group from Results" button
- BulkOperationsPanel appears below search results when bulk action is triggered

---

## Backend Implementation

### BulkOperationManager (New)

**File:** `src/main/bulk/BulkOperationManager.ts`

**Purpose:** Queue, execute, and track bulk operations across multiple sites with concurrency limiting and progress reporting.

**Class Design:**
```typescript
import type { ContentPipeline } from '../content/ContentPipeline';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { HealthScoreCalculator } from '../health/HealthScoreCalculator';
import type { BulkOperation, BulkOperationRequest, BulkOperationStatus, SiteOpResult } from './types';

export class BulkOperationManager {
  private operations = new Map<string, BulkOperation>();
  private readonly maxConcurrency = 3;

  constructor(
    private contentPipeline: ContentPipeline,
    private siteDataBridge: LocalServicesBridge,
    private healthCalculator: HealthScoreCalculator,
    private onProgress: (opId: string, status: BulkOperationStatus) => void
  ) {}

  /**
   * Start a bulk operation. Returns operation ID for tracking.
   */
  async execute(request: BulkOperationRequest): Promise<string> {
    const opId = `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const operation: BulkOperation = {
      id: opId,
      type: request.type,
      siteIds: request.siteIds,
      options: request.options || {},
      status: 'running',
      progress: { completed: 0, total: request.siteIds.length, errors: [] },
      results: new Map(),
      createdAt: Date.now(),
      completedAt: null,
      abortController: new AbortController(),
    };

    this.operations.set(opId, operation);
    this.emitProgress(operation);

    // Execute with concurrency limit (don't await — run in background)
    this.executeWithConcurrency(operation).catch(() => {});

    return opId;
  }

  /**
   * Execute sites in parallel with concurrency limit
   */
  private async executeWithConcurrency(op: BulkOperation): Promise<void> {
    const queue = [...op.siteIds];
    const executing = new Set<Promise<void>>();

    while (queue.length > 0 || executing.size > 0) {
      if (op.abortController.signal.aborted) {
        op.status = 'cancelled';
        this.emitProgress(op);
        return;
      }

      while (queue.length > 0 && executing.size < this.maxConcurrency) {
        const siteId = queue.shift()!;
        const promise = this.executeSingle(op, siteId).then(() => {
          executing.delete(promise);
        });
        executing.add(promise);
      }

      if (executing.size > 0) {
        await Promise.race(executing);
      }
    }

    op.status = op.progress.errors.length > 0 ? 'completed_with_errors' : 'completed';
    op.completedAt = Date.now();
    this.emitProgress(op);
  }

  /**
   * Execute operation on a single site
   */
  private async executeSingle(op: BulkOperation, siteId: string): Promise<void> {
    op.results.set(siteId, { status: 'running', startedAt: Date.now() });
    this.emitProgress(op);

    try {
      switch (op.type) {
        case 'reindex':
          await this.executeReindex(siteId);
          break;
        case 'plugin-update':
          await this.executePluginUpdate(siteId, op.options.pluginSlug!);
          break;
        case 'start':
          await this.siteDataBridge.startSite(siteId);
          break;
        case 'stop':
          await this.siteDataBridge.stopSite(siteId);
          break;
        case 'health-refresh':
          await this.executeHealthRefresh(siteId);
          break;
      }

      op.results.set(siteId, {
        status: 'completed',
        startedAt: op.results.get(siteId)!.startedAt,
        completedAt: Date.now(),
      });
      op.progress.completed++;
    } catch (err: any) {
      op.results.set(siteId, {
        status: 'failed',
        startedAt: op.results.get(siteId)!.startedAt,
        completedAt: Date.now(),
        error: err.message || 'Unknown error',
      });
      op.progress.completed++;
      op.progress.errors.push(`${siteId}: ${err.message}`);
    }

    this.emitProgress(op);
  }

  /**
   * Reindex a single site via ContentPipeline
   */
  private async executeReindex(siteId: string): Promise<void> {
    const site = this.siteDataBridge.resolveSiteObject(siteId) as any;
    if (!site) throw new Error('Site not found');

    const status = this.siteDataBridge.getSiteStatus(siteId);
    if (status !== 'running') throw new Error('Site not running');

    await this.contentPipeline.indexSite({
      siteId,
      siteName: site.name,
      mysqlHost: site.services?.mysql?.host || '127.0.0.1',
      mysqlPort: site.services?.mysql?.port || 3306,
      mysqlUser: 'root',
      mysqlPassword: 'root',
      mysqlDatabase: 'local',
      sitePath: site.path,
    });
  }

  /**
   * Update a specific plugin on a single site via WP-CLI
   */
  private async executePluginUpdate(siteId: string, pluginSlug: string): Promise<void> {
    const status = this.siteDataBridge.getSiteStatus(siteId);
    if (status !== 'running') throw new Error('Site not running');

    const result = await this.siteDataBridge.wpCliRun(siteId, [
      'plugin', 'update', pluginSlug, '--format=json',
    ]);
    if (!result.success) {
      throw new Error(`Plugin update failed: ${result.stdout || 'unknown error'}`);
    }
  }

  /**
   * Refresh health score for a single site
   */
  private async executeHealthRefresh(siteId: string): Promise<void> {
    const site = this.siteDataBridge.resolveSiteObject(siteId) as any;
    if (!site) throw new Error('Site not found');

    await this.healthCalculator.calculateScore(siteId, {
      domain: site.domain || '',
      phpVersion: site.phpVersion || '8.0',
    });
  }

  /**
   * Get current status of an operation
   */
  getStatus(opId: string): BulkOperationStatus | null {
    const op = this.operations.get(opId);
    if (!op) return null;
    return this.toStatus(op);
  }

  /**
   * Cancel a running operation
   */
  cancel(opId: string): boolean {
    const op = this.operations.get(opId);
    if (!op || op.status !== 'running') return false;
    op.abortController.abort();
    return true;
  }

  /**
   * List all operations (active + recent completed)
   */
  listAll(): BulkOperationStatus[] {
    return Array.from(this.operations.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map(op => this.toStatus(op));
  }

  private toStatus(op: BulkOperation): BulkOperationStatus {
    const siteResults: Record<string, SiteOpResult> = {};
    for (const [siteId, result] of op.results) {
      siteResults[siteId] = result;
    }

    return {
      id: op.id,
      type: op.type,
      siteIds: op.siteIds,
      status: op.status,
      progress: op.progress,
      siteResults,
      createdAt: op.createdAt,
      completedAt: op.completedAt,
    };
  }

  private emitProgress(op: BulkOperation): void {
    this.onProgress(op.id, this.toStatus(op));
  }
}
```

**Types:**
```typescript
// src/main/bulk/types.ts

export type BulkOpType = 'reindex' | 'plugin-update' | 'start' | 'stop' | 'health-refresh';

export interface BulkOperationRequest {
  type: BulkOpType;
  siteIds: string[];
  options?: {
    pluginSlug?: string;     // Required for plugin-update
    dryRun?: boolean;        // For plugin-update: check only
  };
}

export interface BulkOperation {
  id: string;
  type: BulkOpType;
  siteIds: string[];
  options: Record<string, any>;
  status: 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
  progress: { completed: number; total: number; errors: string[] };
  results: Map<string, SiteOpResult>;
  createdAt: number;
  completedAt: number | null;
  abortController: AbortController;
}

export interface SiteOpResult {
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface BulkOperationStatus {
  id: string;
  type: BulkOpType;
  siteIds: string[];
  status: 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
  progress: { completed: number; total: number; errors: string[] };
  siteResults: Record<string, SiteOpResult>;
  createdAt: number;
  completedAt: number | null;
}
```

---

### GroupStorage (New)

**File:** `src/main/groups/GroupStorage.ts`

**Purpose:** CRUD for site groups with JSON file persistence (same pattern as QueryStorage).

**Class Design:**
```typescript
import * as fs from 'fs';
import * as path from 'path';

export interface SiteGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  siteIds: string[];
  isDynamic: boolean;          // Dynamic groups auto-computed, not user-editable
  createdAt: number;
  updatedAt: number;
}

export class GroupStorage {
  private groups = new Map<string, SiteGroup>();
  private filePath: string;

  constructor(storagePath: string) {
    this.filePath = path.join(storagePath, 'nexus-ai-groups.json');
  }

  async load(): Promise<void> {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as SiteGroup[];
      this.groups.clear();
      for (const g of data) {
        this.groups.set(g.id, g);
      }
    } catch {
      // File doesn't exist yet, start empty
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.list(), null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  create(name: string, color: string, description?: string): SiteGroup {
    const group: SiteGroup = {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: description || '',
      color,
      siteIds: [],
      isDynamic: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.groups.set(group.id, group);
    this.persist();
    return group;
  }

  update(id: string, changes: Partial<Pick<SiteGroup, 'name' | 'color' | 'description'>>): SiteGroup | null {
    const group = this.groups.get(id);
    if (!group || group.isDynamic) return null;
    Object.assign(group, changes, { updatedAt: Date.now() });
    this.persist();
    return group;
  }

  delete(id: string): boolean {
    const group = this.groups.get(id);
    if (!group || group.isDynamic) return false;
    this.groups.delete(id);
    this.persist();
    return true;
  }

  addSite(groupId: string, siteId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group || group.isDynamic) return false;
    if (group.siteIds.includes(siteId)) return true;
    group.siteIds.push(siteId);
    group.updatedAt = Date.now();
    this.persist();
    return true;
  }

  removeSite(groupId: string, siteId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group || group.isDynamic) return false;
    group.siteIds = group.siteIds.filter(id => id !== siteId);
    group.updatedAt = Date.now();
    this.persist();
    return true;
  }

  get(id: string): SiteGroup | null {
    return this.groups.get(id) || null;
  }

  list(): SiteGroup[] {
    return Array.from(this.groups.values())
      .sort((a, b) => {
        // Dynamic groups first, then by name
        if (a.isDynamic !== b.isDynamic) return a.isDynamic ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  /** Get all groups a site belongs to */
  getGroupsForSite(siteId: string): SiteGroup[] {
    return this.list().filter(g => g.siteIds.includes(siteId));
  }
}
```

---

### HealthTrendTracker (New)

**File:** `src/main/health/HealthTrendTracker.ts`

**Purpose:** Record health score snapshots over time for trend visualization.

**Class Design:**
```typescript
import type Database from 'better-sqlite3';

export interface HealthSnapshot {
  siteId: string;
  score: number;
  timestamp: number;
}

export class HealthTrendTracker {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_health_site_time
        ON health_snapshots(site_id, timestamp);
    `);
  }

  /**
   * Record a health score snapshot. Deduplicates if same score
   * was recorded for the same site within the last hour.
   */
  record(siteId: string, score: number): void {
    const oneHourAgo = Date.now() - 3600_000;
    const recent = this.db.prepare(
      'SELECT score FROM health_snapshots WHERE site_id = ? AND timestamp > ? ORDER BY timestamp DESC LIMIT 1'
    ).get(siteId, oneHourAgo) as { score: number } | undefined;

    // Skip if score hasn't changed within the last hour
    if (recent && recent.score === score) return;

    this.db.prepare(
      'INSERT INTO health_snapshots (site_id, score, timestamp) VALUES (?, ?, ?)'
    ).run(siteId, score, Date.now());
  }

  /**
   * Get health trend for a specific site over N days
   */
  getSiteTrend(siteId: string, days: number): HealthSnapshot[] {
    const since = Date.now() - days * 86400_000;
    const rows = this.db.prepare(
      'SELECT site_id, score, timestamp FROM health_snapshots WHERE site_id = ? AND timestamp > ? ORDER BY timestamp ASC'
    ).all(siteId, since) as Array<{ site_id: string; score: number; timestamp: number }>;

    return rows.map(r => ({
      siteId: r.site_id,
      score: r.score,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Get fleet-wide average health trend over N days
   * Returns one data point per day (daily average across all sites)
   */
  getFleetTrend(days: number): { timestamp: number; avgScore: number }[] {
    const since = Date.now() - days * 86400_000;
    const dayMs = 86400_000;
    const result: { timestamp: number; avgScore: number }[] = [];

    for (let d = 0; d < days; d++) {
      const dayStart = since + d * dayMs;
      const dayEnd = dayStart + dayMs;

      const row = this.db.prepare(
        'SELECT AVG(score) as avg FROM health_snapshots WHERE timestamp >= ? AND timestamp < ?'
      ).get(dayStart, dayEnd) as { avg: number | null };

      if (row.avg !== null) {
        result.push({ timestamp: dayStart, avgScore: Math.round(row.avg) });
      }
    }

    return result;
  }

  /**
   * Prune snapshots older than N days to keep DB size manageable
   */
  prune(keepDays: number): number {
    const cutoff = Date.now() - keepDays * 86400_000;
    const info = this.db.prepare(
      'DELETE FROM health_snapshots WHERE timestamp < ?'
    ).run(cutoff);
    return info.changes;
  }
}
```

---

### MCP Fleet Intelligence Tools (New)

**Directory:** `src/main/mcp/modules/fleet-intelligence/`

**Purpose:** Expose Sprint 2+3 capabilities as MCP tools for AI assistants.

**Tool Definitions:**

#### 1. `fleet_health_summary` (Tier 1 - Read)
```typescript
// Input: { }
// Output: { sites: [{ siteId, siteName, score, status }], fleet: { avg, healthy, warning, critical } }

export const fleetHealthSummaryHandler: McpToolHandler = {
  definition: {
    name: 'fleet_health_summary',
    description: 'Get health scores for all sites in the fleet. Returns per-site scores and fleet-wide statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { title: 'Fleet Health Summary', readOnlyHint: true },
  },
  async execute(args, services) {
    const allSites = services.indexRegistry.listAll();
    const scores = await services.healthCalculator.calculateAllScores(
      allSites.map(s => s.siteId),
      Object.fromEntries(allSites.map(s => [s.siteId, { domain: '', phpVersion: '8.0' }]))
    );
    // ... format and return
  },
};
```

#### 2. `get_site_health` (Tier 1 - Read)
```typescript
// Input: { site_id: string }
// Output: HealthBreakdown (overall + 5 factors + issues + recommendations)
```

#### 3. `fleet_search` (Tier 1 - Read)
```typescript
// Input: { query: string, content_types?: string[], site_ids?: string[], limit?: number }
// Output: { results: UnifiedSearchResult[], total: number }
```

#### 4. `fleet_filter` (Tier 1 - Read)
```typescript
// Input: { filter_id: string }  (e.g., "security-updates", "outdated-php")
// Output: { filter: SmartFilter, matching_sites: [{ siteId, siteName }] }
```

#### 5. `bulk_reindex` (Tier 2 - Write)
```typescript
// Input: { site_ids: string[] }
// Output: { operation_id: string, message: string }
```

#### 6. `bulk_plugin_update` (Tier 3 - Destructive, requires confirmation)
```typescript
// Input: { site_ids: string[], plugin_slug: string, dry_run?: boolean }
// Output: { operation_id: string, message: string }
// Or with dry_run: { sites_affected: [{ siteId, currentVersion, availableVersion }] }
```

#### 7. `list_site_groups` (Tier 1 - Read)
```typescript
// Input: { }
// Output: { groups: SiteGroup[] }
```

#### 8. `manage_site_group` (Tier 2 - Write)
```typescript
// Input: { action: 'create' | 'add_site' | 'remove_site' | 'delete', ... }
// Output: { success: boolean, group?: SiteGroup }
```

**Registration:**
```typescript
// src/main/mcp/modules/fleet-intelligence/index.ts
export function registerFleetIntelligenceTools(registry: ToolRegistry): void {
  registry.register(fleetHealthSummaryHandler);
  registry.register(getSiteHealthHandler);
  registry.register(fleetSearchHandler);
  registry.register(fleetFilterHandler);
  registry.register(bulkReindexHandler);
  registry.register(bulkPluginUpdateHandler);
  registry.register(listSiteGroupsHandler);
  registry.register(manageSiteGroupHandler);
}
```

**Wire into main/index.ts:**
```typescript
import { registerFleetIntelligenceTools } from './mcp/modules/fleet-intelligence/index';
// ... in startup:
registerFleetIntelligenceTools(registry);
```

---

## IPC Handler Registration

**File:** `src/main/ipc-handlers.ts` (modify existing)

**New handlers to add:**

```typescript
// Bulk Operations
ipcMain.handle(IPC_CHANNELS.BULK_EXECUTE, async (_event, request) => {
  try {
    const opId = await bulkOpManager.execute(request);
    return { success: true, opId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle(IPC_CHANNELS.BULK_STATUS, async (_event, opId) => {
  const status = bulkOpManager.getStatus(opId);
  return status ? { success: true, ...status } : { success: false, error: 'Not found' };
});

ipcMain.handle(IPC_CHANNELS.BULK_CANCEL, async (_event, opId) => {
  return { success: bulkOpManager.cancel(opId) };
});

ipcMain.handle(IPC_CHANNELS.BULK_LIST, async () => {
  return { success: true, operations: bulkOpManager.listAll() };
});

// Groups
ipcMain.handle(IPC_CHANNELS.GROUPS_LIST, async () => {
  return { success: true, groups: groupStorage.list() };
});

ipcMain.handle(IPC_CHANNELS.GROUPS_CREATE, async (_event, name, color, description) => {
  const group = groupStorage.create(name, color, description);
  return { success: true, group };
});

ipcMain.handle(IPC_CHANNELS.GROUPS_UPDATE, async (_event, id, changes) => {
  const group = groupStorage.update(id, changes);
  return group ? { success: true, group } : { success: false, error: 'Not found or dynamic' };
});

ipcMain.handle(IPC_CHANNELS.GROUPS_DELETE, async (_event, id) => {
  return { success: groupStorage.delete(id) };
});

ipcMain.handle(IPC_CHANNELS.GROUPS_ADD_SITE, async (_event, groupId, siteId) => {
  return { success: groupStorage.addSite(groupId, siteId) };
});

ipcMain.handle(IPC_CHANNELS.GROUPS_REMOVE_SITE, async (_event, groupId, siteId) => {
  return { success: groupStorage.removeSite(groupId, siteId) };
});

// Health Trends
ipcMain.handle(IPC_CHANNELS.HEALTH_GET_TREND, async (_event, siteId, days) => {
  return { success: true, trend: healthTrendTracker.getSiteTrend(siteId, days || 30) };
});

ipcMain.handle(IPC_CHANNELS.HEALTH_GET_FLEET_TREND, async (_event, days) => {
  return { success: true, trend: healthTrendTracker.getFleetTrend(days || 30) };
});

// Dashboard v2
ipcMain.handle(IPC_CHANNELS.DASHBOARD_V2_STATS, async () => {
  // Aggregate from healthCalculator, filterEngine, groupStorage, bulkOpManager
  const allScores = await healthCalculator.calculateAllScores(...);
  const filters = await filterEngine.getFilterCounts();
  const groups = groupStorage.list();
  const recentOps = bulkOpManager.listAll().slice(0, 5);

  return {
    success: true,
    healthDistribution: computeDistribution(allScores),
    actionItems: filters.filter(f => f.count > 0),
    groupSummaries: computeGroupSummaries(groups, allScores),
    recentBulkOps: recentOps,
  };
});
```

**Service instantiation (inside registerIpcHandlers):**
```typescript
// Sprint 3 services
const bulkOpManager = new BulkOperationManager(
  contentPipeline,
  siteData,
  healthCalculator,
  (opId, status) => {
    // Stream progress to renderer
    mainWindow?.webContents.send(IPC_CHANNELS.BULK_PROGRESS, opId, status);
  }
);

const groupStoragePath = vectorDbPath.replace(/\/vectors\/?$/, '');
const groupStorage = new GroupStorage(groupStoragePath);
groupStorage.load().catch(err => localLogger.error('[NexusAI] Failed to load groups:', err.message));

const healthTrendTracker = new HealthTrendTracker(graphService.getDb());
```

---

## IPC Channel Summary

```typescript
// New Sprint 3 channels in constants.ts

// Bulk Operations
BULK_EXECUTE: `${ADDON_PREFIX}:bulk:execute`,
BULK_STATUS: `${ADDON_PREFIX}:bulk:status`,
BULK_CANCEL: `${ADDON_PREFIX}:bulk:cancel`,
BULK_LIST: `${ADDON_PREFIX}:bulk:list`,
BULK_PROGRESS: `${ADDON_PREFIX}:bulk:progress`,

// Site Groups
GROUPS_LIST: `${ADDON_PREFIX}:groups:list`,
GROUPS_CREATE: `${ADDON_PREFIX}:groups:create`,
GROUPS_UPDATE: `${ADDON_PREFIX}:groups:update`,
GROUPS_DELETE: `${ADDON_PREFIX}:groups:delete`,
GROUPS_ADD_SITE: `${ADDON_PREFIX}:groups:add-site`,
GROUPS_REMOVE_SITE: `${ADDON_PREFIX}:groups:remove-site`,

// Health Trends
HEALTH_GET_TREND: `${ADDON_PREFIX}:health:get-trend`,
HEALTH_GET_FLEET_TREND: `${ADDON_PREFIX}:health:get-fleet-trend`,

// Dashboard v2
DASHBOARD_V2_STATS: `${ADDON_PREFIX}:dashboard:v2-stats`,
```

---

## Type Summary

```typescript
// New Sprint 3 types in src/common/types.ts

export interface BulkOperationStatus {
  id: string;
  type: string;
  siteIds: string[];
  status: 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
  progress: { completed: number; total: number; errors: string[] };
  siteResults: Record<string, {
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt: number;
    completedAt?: number;
    error?: string;
  }>;
  createdAt: number;
  completedAt: number | null;
}

export interface SiteGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  siteIds: string[];
  isDynamic: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface HealthTrend {
  siteId: string;
  snapshots: { score: number; timestamp: number }[];
}

export interface DashboardV2Stats {
  healthDistribution: { healthy: number; warning: number; critical: number };
  actionItems: { filterId: string; label: string; count: number; severity: string }[];
  groupSummaries: { groupId: string; name: string; color: string; siteCount: number; avgHealth: number }[];
  recentBulkOps: BulkOperationStatus[];
}
```

---

## Implementation Plan (Day by Day)

### Week 1: Backend (Days 1-5)

#### Day 1: BulkOperationManager Core
- [ ] Create `src/main/bulk/types.ts` with all bulk operation types
- [ ] Create `src/main/bulk/BulkOperationManager.ts`
- [ ] Implement operation queue with concurrency limit (max 3)
- [ ] Implement `execute()` — creates operation, starts background execution
- [ ] Implement `executeWithConcurrency()` — processes queue in parallel batches
- [ ] Implement `executeSingle()` — runs one site, catches errors per-site
- [ ] Implement `getStatus()`, `cancel()`, `listAll()`
- [ ] Progress callback emission on each state change
- [ ] `tests/unit/bulk/bulk-operation-manager.test.ts`:
  - Queue creation and ID generation
  - Concurrent execution respects limit (3 at a time)
  - Per-site error isolation (one fails, others continue)
  - Cancel stops pending operations
  - Status transitions: running → completed / completed_with_errors
  - Progress callback called on each site completion
  - Empty siteIds array returns immediately
  - Duplicate operations get unique IDs
  - listAll returns sorted by createdAt desc
  - Completed operations retained in history (max 20)

#### Day 2: Bulk Operation Executors
- [ ] Implement `executeReindex()` — resolves site, calls contentPipeline.indexSite
- [ ] Implement `executePluginUpdate()` — calls wpCliRun with plugin update args
- [ ] Implement `executeHealthRefresh()` — calls healthCalculator.calculateScore
- [ ] Start/stop executors use siteDataBridge.startSite/stopSite
- [ ] Error messages include site-specific context
- [ ] `tests/unit/bulk/executors.test.ts`:
  - Reindex calls contentPipeline.indexSite with correct SiteConnectionInfo
  - Reindex throws if site not running
  - Plugin update calls wpCliRun with correct args
  - Plugin update throws on WP-CLI failure
  - Start/stop call correct LocalServicesBridge methods
  - Health refresh calls calculateScore with site info
  - Unknown operation type throws
  - Site not found throws descriptive error

#### Day 3: Site Groups
- [ ] Create `src/main/groups/types.ts`
- [ ] Create `src/main/groups/GroupStorage.ts`
- [ ] Implement CRUD: create, update, delete, get, list
- [ ] Implement addSite, removeSite
- [ ] Implement getGroupsForSite
- [ ] Atomic file writes (write temp → rename)
- [ ] Dynamic group flag (isDynamic) prevents user edits
- [ ] `tests/unit/groups/group-storage.test.ts`:
  - Create group with name, color, description
  - List groups sorted (dynamic first, then alphabetical)
  - Update group name and color
  - Delete group removes it from list
  - Cannot delete dynamic group
  - Cannot update dynamic group
  - Add site to group
  - Remove site from group
  - Add duplicate site is idempotent
  - getGroupsForSite returns all matching groups
  - Persistence: load after save returns same data
  - Empty storage returns empty list

#### Day 4: Health Trends + IPC Handlers
- [ ] Create `src/main/health/HealthTrendTracker.ts`
- [ ] SQLite table creation (health_snapshots)
- [ ] record() with deduplication (skip if same score within 1 hour)
- [ ] getSiteTrend(siteId, days)
- [ ] getFleetTrend(days) — daily averages
- [ ] prune(keepDays) — cleanup old data
- [ ] Add 14 Sprint 3 IPC channels to constants.ts
- [ ] Add Sprint 3 types to common/types.ts
- [ ] Register all Sprint 3 IPC handlers in ipc-handlers.ts
- [ ] Instantiate Sprint 3 services (bulkOpManager, groupStorage, healthTrendTracker)
- [ ] `tests/unit/health/health-trend-tracker.test.ts`:
  - Record creates snapshot in DB
  - Deduplication: same score within 1 hour skipped
  - Different score within 1 hour recorded
  - getSiteTrend returns chronological snapshots
  - getSiteTrend filters by days parameter
  - getFleetTrend returns daily averages
  - prune removes old snapshots
  - Empty DB returns empty arrays

#### Day 5: MCP Fleet Intelligence Tools
- [ ] Create `src/main/mcp/modules/fleet-intelligence/` directory
- [ ] `fleet-health-summary.ts` — Tier 1, calls healthCalculator.calculateAllScores
- [ ] `get-site-health.ts` — Tier 1, calls healthCalculator.calculateScore
- [ ] `fleet-search.ts` — Tier 1, calls searchService.searchFleet
- [ ] `fleet-filter.ts` — Tier 1, calls filterEngine.applyFilter
- [ ] `bulk-reindex.ts` — Tier 2, calls bulkOpManager.execute
- [ ] `bulk-plugin-update.ts` — Tier 3, calls bulkOpManager.execute with confirmation
- [ ] `list-site-groups.ts` — Tier 1, calls groupStorage.list
- [ ] `manage-site-group.ts` — Tier 2, calls groupStorage CRUD
- [ ] `index.ts` — registerFleetIntelligenceTools
- [ ] Wire into `src/main/index.ts`
- [ ] Update MCP server instructions with new tool documentation
- [ ] `tests/unit/mcp/fleet-intelligence.test.ts`:
  - fleet_health_summary returns scores for all sites
  - get_site_health returns breakdown for specific site
  - fleet_search delegates to SearchService
  - fleet_filter delegates to FilterEngine
  - bulk_reindex creates operation (tier 2 enforcement)
  - bulk_plugin_update requires confirmation (tier 3)
  - list_site_groups returns all groups
  - manage_site_group creates/deletes groups

### Week 2: Frontend (Days 6-10)

#### Day 6: BulkOperationsPanel Component
- [ ] Create `src/renderer/components/BulkOperationsPanel.tsx`
- [ ] Class-based, React.createElement pattern
- [ ] Operation type dropdown (reindex, plugin-update, start, stop, health-refresh)
- [ ] Plugin slug input field (shown only for plugin-update)
- [ ] Confirmation dialog showing affected site count and names
- [ ] Progress bar component (% complete)
- [ ] Per-site status list (checkmark/spinner/X icons)
- [ ] Cancel button (calls BULK_CANCEL)
- [ ] Error summary section
- [ ] Poll BULK_STATUS every 1s while operation is running
- [ ] `tests/unit/renderer/BulkOperationsPanel.test.tsx`:
  - Renders operation dropdown
  - Shows plugin slug input for plugin-update type
  - Hides plugin slug input for other types
  - Execute button triggers confirmation
  - Progress bar updates from status polling
  - Cancel button calls cancel IPC
  - Error display for failed sites

#### Day 7: SiteGroupsPanel Component
- [ ] Create `src/renderer/components/SiteGroupsPanel.tsx`
- [ ] Class-based, React.createElement pattern
- [ ] Group list with color dot, name, site count, avg health
- [ ] Create form: name input, color picker (8 preset colors), description
- [ ] Edit inline: click group name to edit
- [ ] Delete button with confirmation
- [ ] Click group to trigger onGroupFilter callback
- [ ] Dynamic groups show [Auto] badge, no edit/delete
- [ ] Empty state: "No groups yet. Create one to organize your sites."
- [ ] `tests/unit/renderer/SiteGroupsPanel.test.tsx`:
  - Renders group list with names and counts
  - Create form shows on button click
  - Color picker selects color
  - Delete removes group from list
  - Dynamic groups show auto badge
  - Click group triggers filter callback
  - Empty state displays when no groups

#### Day 8: Fleet Dashboard v2
- [ ] New method: `renderFleetHealthCard()` — distribution bar (healthy/warning/critical)
- [ ] New method: `renderActionItemsCard()` — list from smart filters with counts > 0
- [ ] New method: `renderGroupSummariesCard()` — per-group row with avg health
- [ ] New method: `renderBulkOpHistoryCard()` — recent operations with status
- [ ] Fetch DASHBOARD_V2_STATS on mount alongside existing dashboard stats
- [ ] Layout: 2-column grid for health + action items, then 2-column for groups + bulk ops
- [ ] `tests/unit/renderer/DashboardV2.test.tsx`:
  - Health distribution card shows counts
  - Action items card shows non-zero filters
  - Group summaries shows group names and health
  - Bulk op history shows recent operations
  - Loading state while fetching
  - Empty states for each card

#### Day 9: Integration & Polish
- [ ] **Sites tab**: Add group filter row (chips for each group, "All" default)
- [ ] **Sites tab**: Add "Groups" column with color dots per site
- [ ] **Sites tab**: Add checkbox column for multi-select
- [ ] **Sites tab**: Add "Bulk Action" button at bottom when sites selected
- [ ] **Sites tab**: Wire BulkOperationsPanel to appear when bulk action triggered
- [ ] **Search tab**: Add "Bulk Action" button below results
- [ ] **SmartFiltersPanel**: Add "Create Group" action per filter result
- [ ] Cross-component state: selected sites flow from Sites tab → BulkOperationsPanel
- [ ] Verify all IPC round-trips work end-to-end

#### Day 10: Testing & Documentation
- [ ] Run all Sprint 3 tests (target: ~62 new)
- [ ] Run full test suite to check regressions
- [ ] Build verification: `npx tsc --noEmit` + `npm run build`
- [ ] Write `docs/sprint-3-completion.md`
- [ ] Update user guide with bulk ops and groups documentation
- [ ] Commit all Sprint 3 work
- [ ] Merge to main

---

## Test Count Estimate

| Area | Tests |
|------|-------|
| BulkOperationManager core | 10 |
| Bulk operation executors | 8 |
| GroupStorage | 12 |
| HealthTrendTracker | 8 |
| MCP Fleet Intelligence Tools | 8 |
| BulkOperationsPanel (renderer) | 7 |
| SiteGroupsPanel (renderer) | 7 |
| Dashboard v2 (renderer) | 6 |
| **Total** | **~66** |

**Running total across sprints:** Sprint 1 (~80) + Sprint 2 (68) + Sprint 3 (~66) = ~214 tests

---

## Files Modified (Existing)

| File | Changes |
|------|---------|
| `src/common/constants.ts` | Add 14 new IPC channels |
| `src/common/types.ts` | Add BulkOperationStatus, SiteGroup, HealthTrend, DashboardV2Stats |
| `src/main/ipc-handlers.ts` | Add ~14 IPC handlers, instantiate Sprint 3 services |
| `src/main/index.ts` | Register fleet-intelligence MCP tools |
| `src/main/events/GraphService.ts` | Add `getDb()` accessor for HealthTrendTracker |
| `src/renderer/components/FleetOverview.tsx` | Dashboard v2 cards, Sites tab groups + bulk ops |
| `src/renderer/components/SmartFiltersPanel.tsx` | Add "Create Group" action |

## Files Created (New)

| File | Purpose |
|------|---------|
| `src/main/bulk/types.ts` | Bulk operation type definitions |
| `src/main/bulk/BulkOperationManager.ts` | Core bulk operation engine |
| `src/main/groups/types.ts` | Site group type definitions |
| `src/main/groups/GroupStorage.ts` | Group CRUD + persistence |
| `src/main/health/HealthTrendTracker.ts` | Health snapshot recording + querying |
| `src/main/mcp/modules/fleet-intelligence/index.ts` | Tool registration |
| `src/main/mcp/modules/fleet-intelligence/fleet-health-summary.ts` | MCP tool |
| `src/main/mcp/modules/fleet-intelligence/get-site-health.ts` | MCP tool |
| `src/main/mcp/modules/fleet-intelligence/fleet-search.ts` | MCP tool |
| `src/main/mcp/modules/fleet-intelligence/fleet-filter.ts` | MCP tool |
| `src/main/mcp/modules/fleet-intelligence/bulk-reindex.ts` | MCP tool |
| `src/main/mcp/modules/fleet-intelligence/bulk-plugin-update.ts` | MCP tool |
| `src/main/mcp/modules/fleet-intelligence/list-site-groups.ts` | MCP tool |
| `src/main/mcp/modules/fleet-intelligence/manage-site-group.ts` | MCP tool |
| `src/renderer/components/BulkOperationsPanel.tsx` | Bulk ops UI |
| `src/renderer/components/SiteGroupsPanel.tsx` | Group management UI |
| `tests/unit/bulk/bulk-operation-manager.test.ts` | 10 tests |
| `tests/unit/bulk/executors.test.ts` | 8 tests |
| `tests/unit/groups/group-storage.test.ts` | 12 tests |
| `tests/unit/health/health-trend-tracker.test.ts` | 8 tests |
| `tests/unit/mcp/fleet-intelligence.test.ts` | 8 tests |
| `tests/unit/renderer/BulkOperationsPanel.test.tsx` | 7 tests |
| `tests/unit/renderer/SiteGroupsPanel.test.tsx` | 7 tests |
| `tests/unit/renderer/DashboardV2.test.tsx` | 6 tests |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Bulk plugin update breaks a site | Medium | High | Dry-run mode first; tier 3 confirmation; per-site error isolation |
| Concurrency overwhelms Local | Low | Medium | Max 3 concurrent ops; queue remaining |
| Large fleet (50+ sites) slow health calc | Medium | Medium | Cache scores; lazy calculation; pagination |
| Group data loss on crash | Low | Medium | Atomic writes (temp + rename); load on startup |
| HealthTrendTracker grows DB indefinitely | Low | Low | Auto-prune snapshots older than 90 days |
| MCP tool abuse (bulk update all) | Low | High | Tier 3 safety with confirmation token |

---

## Success Criteria

- [ ] Bulk reindex across 5+ sites completes with progress tracking
- [ ] Bulk plugin update with dry-run mode, then real execution with tier 3 confirmation
- [ ] Per-site error isolation: one failed site doesn't abort the batch
- [ ] Cancel stops pending operations mid-batch
- [ ] Site groups create/edit/delete with persistent storage
- [ ] Group filter on Sites tab shows only group members
- [ ] Dashboard v2 shows health distribution, action items, group summaries
- [ ] Health trend tracker records and queries snapshots
- [ ] 8 new MCP tools registered, callable from chat and external MCP clients
- [ ] All ~66 new tests passing
- [ ] Clean build (tsc + webpack)

---

## Sprint 3 vs Sprint 4 Preview

**Sprint 3** (this sprint): Proactive fleet management — bulk ops, groups, dashboard v2, MCP tools

**Sprint 4** (next): Automation & Scheduling
- Scheduled health checks (cron-like intervals)
- Auto-reindex on content changes (event-driven triggers)
- Alert rules (notify when health drops below threshold)
- Webhook integrations (Slack, email notifications)
- Custom automation workflows (if X then Y)

---

**Last Updated:** 2026-03-06
**Status:** Planning Complete
**Ready to Start:** Day 1 - BulkOperationManager Implementation
