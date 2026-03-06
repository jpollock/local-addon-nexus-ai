# Sprint 1: Enhanced Visibility - Detailed Design & Plan

**Sprint Goal:** Show users what's happening across their WordPress fleet in real-time

**Timeline:** 2 weeks
**Aha Moment Delivered:** #5 (Cross-Site Visibility)
**Current Date:** 2026-03-05

---

## Executive Summary

### What We're Building

A comprehensive visibility dashboard in FleetOverview that surfaces the event tracking system we've built. Users will see:

1. **Event Timeline** - Live stream of WordPress events across all sites
2. **Event Stats Cards** - At-a-glance metrics (total events, today's activity, health)
3. **Storage Health** - Database sizes, capacity usage, cleanup controls
4. **Top Issues Panel** - Actionable alerts ("3 sites need security updates")

### Why This Matters

**Current Problem:**
- We built a powerful event system (EventProcessor, GraphService, 10 event types)
- 43 events have been processed in testing
- **But users can't see ANY of it** — critical gap!

**After Sprint 1:**
- Users see "43 events processed, 3 sites need updates" immediately
- Event timeline shows plugin activations, content changes, user updates
- Health indicators surface problems proactively
- Storage visualization prevents "why is my disk full?" questions

---

## Architecture Overview

### Data Flow

```
WordPress Sites (event source)
       ↓
HttpEventInterface (port 13000) → EventProcessor → GraphService (SQLite)
       ↓                                                    ↓
   IPC Handlers (new)                                Event Queries (new)
       ↓                                                    ↓
   Renderer Process                                  Data Aggregation
       ↓                                                    ↓
FleetOverview (enhanced) → New Components → User sees events!
```

### What Exists Today

**Backend (✅ Complete):**
- `EventProcessor` - Queue, process, retry logic
- `GraphService` - SQLite storage with full schema
- `HttpEventInterface` - HTTP endpoint for WordPress
- Event types: 10 tracked (content, plugins, users, site)
- Data: 43 events processed in testing

**Frontend (⚠️ Partial):**
- `FleetOverview` component exists (class-based, no hooks)
- Shows: MCP stats, site list, basic search
- **Missing:** Any event visualization

### What We Need to Build

**Backend (New IPC Handlers):**
1. `nexus-ai:events:get-recent` → Recent events with filtering
2. `nexus-ai:events:get-stats` → Event statistics
3. `nexus-ai:events:get-timeline` → Paginated timeline
4. `nexus-ai:events:get-issues` → Detected issues
5. `nexus-ai:storage:get-health` → Storage metrics

**Data Layer (GraphService Extensions):**
1. `getRecentEvents(limit, filter)` - Query event_queue table
2. `getEventStats(timeRange)` - Aggregate event counts
3. `getIssues()` - Detect problems (failed events, stale data)
4. `getStorageHealth()` - DB sizes, row counts

**Frontend (New Components):**
1. `EventTimeline` - Visual event stream
2. `EventStatsCards` - Metrics dashboard
3. `StorageHealthPanel` - Storage visualization
4. `TopIssuesPanel` - Alert list
5. Enhanced `FleetOverview` - Integrate new components

---

## Detailed Component Design

### 1. EventTimeline Component

**Purpose:** Visual stream of recent WordPress events

**UI Design:**
```
┌─────────────────────────────────────────────────────────┐
│ Event Timeline (Last 50)          [Filter ▼] [Refresh] │
├─────────────────────────────────────────────────────────┤
│ ● Plugin Activated                           2 mins ago │
│   akismet/akismet.php on nexus-e2e-test.local          │
│   Status: ✓ Processed                                   │
│                                                          │
│ ● Post Updated                               5 mins ago │
│   "Hello World" (#1) on nexus-e2e-test.local           │
│   Status: ✓ Processed                                   │
│                                                          │
│ ● User Created                              12 mins ago │
│   editor@example.com on my-site.local                   │
│   Status: ⏱ Pending                                     │
│                                                          │
│ [Load More...]                                           │
└─────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface EventTimelineProps {
  electron: any;           // IPC bridge
  limit?: number;          // Default 50
  autoRefresh?: boolean;   // Default true, poll every 10s
}
```

**State:**
```typescript
interface EventTimelineState {
  events: EventTimelineEntry[];
  filter: 'all' | 'content' | 'plugins' | 'users' | 'site';
  loading: boolean;
  error: string | null;
}

interface EventTimelineEntry {
  id: number;
  siteId: string;
  siteName: string;
  eventType: string;
  timestamp: number;
  status: 'pending' | 'processed' | 'failed';
  summary: string;        // "Plugin Activated: akismet"
  details: any;           // Event payload
}
```

**Key Features:**
- Real-time updates (poll every 10s if autoRefresh=true)
- Filter by type (all, content, plugins, users, site)
- Click to expand details
- Status indicators: ✓ Processed, ⏱ Pending, ✗ Failed
- Relative timestamps ("2 mins ago")
- Visual event type icons

**IPC Calls:**
- `nexus-ai:events:get-timeline` → { events: EventTimelineEntry[], total: number }

**File Location:** `src/renderer/components/EventTimeline.tsx`

---

### 2. EventStatsCards Component

**Purpose:** At-a-glance event metrics

**UI Design:**
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Total Events │  │ Today        │  │ Health       │
│              │  │              │  │              │
│    43        │  │    12        │  │   ✓ Good     │
│              │  │  +3 vs yest. │  │   0 pending  │
│              │  │              │  │   0 failed   │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Props:**
```typescript
interface EventStatsCardsProps {
  electron: any;
  autoRefresh?: boolean;  // Default true, poll every 30s
}
```

**State:**
```typescript
interface EventStatsCardsState {
  stats: EventStats | null;
  loading: boolean;
  error: string | null;
}

interface EventStats {
  total: number;
  today: number;
  yesterday: number;
  pending: number;
  failed: number;
  byType: {
    content: number;
    plugins: number;
    users: number;
    site: number;
  };
  healthStatus: 'good' | 'warning' | 'error';
}
```

**Key Features:**
- 3 cards: Total, Today (with comparison), Health
- Health indicator: green (0 pending/failed), yellow (<10 pending), red (failed events)
- Comparison: "Today vs Yesterday"
- Click to expand by-type breakdown

**IPC Calls:**
- `nexus-ai:events:get-stats` → EventStats

**File Location:** `src/renderer/components/EventStatsCards.tsx`

---

### 3. StorageHealthPanel Component

**Purpose:** Visualize database storage and capacity

**UI Design:**
```
┌─────────────────────────────────────────────────────────┐
│ Storage Health                                          │
├─────────────────────────────────────────────────────────┤
│ Graph Database:       2.3 MB  [████░░░░░░] 12% used    │
│ Vector Database:     45.8 MB  [████████░░] 75% used    │
│                                                          │
│ Event Queue:         43 events (0 pending, 0 failed)    │
│ Oldest Event:        2026-03-04 14:23:12                │
│ Latest Event:        2026-03-05 16:42:08                │
│                                                          │
│ [Cleanup Old Events (30+ days)]  [Optimize Databases]  │
└─────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface StorageHealthPanelProps {
  electron: any;
  autoRefresh?: boolean;  // Default true, poll every 60s
}
```

**State:**
```typescript
interface StorageHealthPanelState {
  health: StorageHealth | null;
  loading: boolean;
  cleaning: boolean;
  optimizing: boolean;
  error: string | null;
}

interface StorageHealth {
  graphDb: {
    sizeBytes: number;
    path: string;
    eventCount: number;
    oldestEventTimestamp: number | null;
    newestEventTimestamp: number | null;
  };
  vectorDb: {
    sizeBytes: number;
    path: string;
    tableCount: number;
  };
  capacity: {
    total: number;      // Total disk space
    used: number;       // Used by Nexus AI
    percent: number;    // Percentage used
  };
  pendingEvents: number;
  failedEvents: number;
}
```

**Key Features:**
- Visual progress bars for storage usage
- Event queue status
- Timestamp range (oldest → newest)
- Action buttons:
  - Cleanup old events (30+ days)
  - Optimize databases (VACUUM)
- Warnings if storage >80% or failed events >0

**IPC Calls:**
- `nexus-ai:storage:get-health` → StorageHealth
- `nexus-ai:storage:cleanup` (retentionDays: number) → { deleted: number }
- `nexus-ai:storage:optimize` → { success: boolean }

**File Location:** `src/renderer/components/StorageHealthPanel.tsx`

---

### 4. TopIssuesPanel Component

**Purpose:** Proactive alerts for things needing attention

**UI Design:**
```
┌─────────────────────────────────────────────────────────┐
│ Top Issues (3)                                          │
├─────────────────────────────────────────────────────────┤
│ ⚠️ 2 Failed Events                          [View →]    │
│    Events failed to process, may need retry             │
│                                                          │
│ 🔒 3 Sites with Security Updates Available  [View →]    │
│    nexus-e2e-test.local, my-site.local, demo.local      │
│                                                          │
│ 💾 Storage at 75% Capacity                  [Cleanup →] │
│    Vector database is growing large                     │
└─────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface TopIssuesPanelProps {
  electron: any;
  autoRefresh?: boolean;  // Default true, poll every 60s
}
```

**State:**
```typescript
interface TopIssuesPanelState {
  issues: Issue[];
  loading: boolean;
  error: string | null;
}

interface Issue {
  id: string;
  type: 'failed_events' | 'security_updates' | 'storage_warning' | 'stale_sites';
  severity: 'warning' | 'error';
  title: string;
  description: string;
  count: number;
  actionLabel: string;
  actionHandler: () => void;
}
```

**Issue Detection Logic:**

1. **Failed Events** (severity: error)
   - Condition: EventStats.failed > 0
   - Action: "Retry Failed Events" → calls `nexus-ai:events:retry-failed`

2. **Security Updates** (severity: warning)
   - Condition: Sites with plugin updates available (requires wp_plugin_list query)
   - Action: "View Sites" → navigate to sites tab with filter

3. **Storage Warning** (severity: warning)
   - Condition: StorageHealth.capacity.percent > 75
   - Action: "Cleanup Old Events" → calls storage cleanup

4. **Stale Sites** (severity: warning)
   - Condition: Sites indexed >7 days ago
   - Action: "Reindex Stale Sites"

**Key Features:**
- Auto-sorts by severity (error > warning)
- Max 5 issues shown
- Click to expand details
- Action button per issue
- Empty state: "✓ All systems healthy"

**IPC Calls:**
- `nexus-ai:issues:detect` → Issue[]
- `nexus-ai:events:retry-failed` → { retried: number, success: number }

**File Location:** `src/renderer/components/TopIssuesPanel.tsx`

---

### 5. Enhanced FleetOverview Integration

**Changes to FleetOverview.tsx:**

```typescript
// Add new state fields
interface FleetOverviewState {
  // ... existing fields ...
  visibilityTab: 'events' | 'storage' | 'issues';  // New sub-tab
}

// Add new tab to activeTab
activeTab: 'overview' | 'search' | 'sites' | 'chat' | 'visibility';  // Added 'visibility'

// Render new components in visibility tab
renderVisibilityTab() {
  return (
    <div>
      <EventStatsCards electron={this.props.electron} />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        <div>
          <EventTimeline electron={this.props.electron} />
        </div>
        <div>
          <TopIssuesPanel electron={this.props.electron} />
          <StorageHealthPanel electron={this.props.electron} />
        </div>
      </div>
    </div>
  );
}
```

**Tab Navigation:**
```
Overview | Search | Sites | Visibility | Chat
                            ^^^^^^^^^^^
                            (New Tab)
```

**File Changes:** `src/renderer/components/FleetOverview.tsx` (modify existing)

---

## Backend Implementation

### GraphService Extensions

**File:** `src/main/events/GraphService.ts`

**New Methods:**

```typescript
/**
 * Get recent events from event_queue
 */
async getRecentEvents(options?: {
  limit?: number;           // Default 50
  filter?: EventType;       // Filter by event type
  status?: 'pending' | 'processed' | 'failed';
  siteId?: string;          // Filter by site
}): Promise<EventQueueEntry[]> {
  // SELECT * FROM event_queue
  // WHERE (filter conditions)
  // ORDER BY created_at DESC
  // LIMIT ?
}

/**
 * Get event statistics
 */
async getEventStats(timeRange?: {
  startTimestamp?: number;
  endTimestamp?: number;
}): Promise<EventStatsData> {
  // Aggregate queries:
  // - Total events
  // - Events today vs yesterday
  // - Pending/failed counts
  // - Group by event_type
}

/**
 * Get storage health metrics
 */
async getStorageHealth(): Promise<StorageHealthData> {
  // Return:
  // - DB file sizes (fs.statSync)
  // - Row counts (SELECT COUNT(*))
  // - Oldest/newest event timestamps
  // - Capacity estimation
}

/**
 * Detect issues requiring attention
 */
async detectIssues(): Promise<IssueData[]> {
  // Check:
  // - Failed events count
  // - Stale sites (last_sync_at > 7 days ago)
  // - Storage warnings
}
```

**New Types (add to types.ts):**

```typescript
export interface EventQueueEntry {
  id: number;
  site_id: string;
  event_type: EventType;
  payload: any;
  status: 'pending' | 'processed' | 'failed';
  created_at: number;
  processed_at: number | null;
  error: string | null;
  retry_count: number;
}

export interface EventStatsData {
  total: number;
  today: number;
  yesterday: number;
  pending: number;
  failed: number;
  by_type: Record<EventType, number>;
}

export interface StorageHealthData {
  graph_db: {
    size_bytes: number;
    path: string;
    event_count: number;
    oldest_event: number | null;
    newest_event: number | null;
  };
  vector_db: {
    size_bytes: number;
    path: string;
    table_count: number;
  };
  pending_events: number;
  failed_events: number;
}

export interface IssueData {
  id: string;
  type: string;
  severity: 'warning' | 'error';
  title: string;
  description: string;
  count: number;
}
```

---

### IPC Handler Registration

**File:** `src/main/index.ts`

**New IPC Handlers:**

```typescript
import { ipcMain } from 'electron';
import { GraphService } from './events/GraphService';
import { EventProcessor } from './events/EventProcessor';

// Register event-related IPC handlers
function registerEventHandlers(
  graphService: GraphService,
  eventProcessor: EventProcessor
) {

  // Get recent events with filtering
  ipcMain.handle('nexus-ai:events:get-timeline', async (_event, options) => {
    const events = await graphService.getRecentEvents(options);

    // Enrich with site names
    const enriched = await Promise.all(
      events.map(async (event) => {
        const site = await graphService.getSite(event.site_id);
        return {
          ...event,
          site_name: site?.name || 'Unknown',
          summary: generateEventSummary(event),
        };
      })
    );

    return { events: enriched, total: events.length };
  });

  // Get event statistics
  ipcMain.handle('nexus-ai:events:get-stats', async () => {
    const stats = await graphService.getEventStats();

    // Determine health status
    const healthStatus =
      stats.failed > 0 ? 'error' :
      stats.pending > 10 ? 'warning' :
      'good';

    return { ...stats, healthStatus };
  });

  // Get storage health
  ipcMain.handle('nexus-ai:storage:get-health', async () => {
    return await graphService.getStorageHealth();
  });

  // Detect issues
  ipcMain.handle('nexus-ai:issues:detect', async () => {
    return await graphService.detectIssues();
  });

  // Cleanup old events
  ipcMain.handle('nexus-ai:storage:cleanup', async (_event, retentionDays = 30) => {
    const result = await graphService.cleanupOldData(retentionDays);
    return { deleted: result.sites + result.content };
  });

  // Retry failed events
  ipcMain.handle('nexus-ai:events:retry-failed', async () => {
    const retried = await eventProcessor.retryFailed();
    return { retried, success: retried }; // Simplified for now
  });
}

// Helper function
function generateEventSummary(event: EventQueueEntry): string {
  const payload = JSON.parse(event.payload);

  switch (event.event_type) {
    case 'plugin_activated':
      return `Plugin Activated: ${payload.plugin_slug}`;
    case 'post_created':
      return `Post Created: "${payload.post_title}" (#${payload.post_id})`;
    case 'user_created':
      return `User Created: ${payload.user_email}`;
    // ... other event types
    default:
      return event.event_type.replace(/_/g, ' ');
  }
}
```

**Register in onReady():**

```typescript
export async function onReady(readyPromise: Promise<void>) {
  await readyPromise;

  const { graphService, eventProcessor } = serviceContainer.cradle;

  registerEventHandlers(graphService, eventProcessor);

  // ... existing code ...
}
```

---

## Testing Strategy

### Unit Tests

**1. EventTimeline Component**
- **File:** `tests/unit/renderer/EventTimeline.test.tsx`
- **Tests:**
  - Renders event list correctly
  - Filters events by type
  - Formats timestamps as relative ("2 mins ago")
  - Shows status indicators (pending/processed/failed)
  - Handles empty state
  - Handles error state
  - Auto-refreshes when enabled

**2. EventStatsCards Component**
- **File:** `tests/unit/renderer/EventStatsCards.test.tsx`
- **Tests:**
  - Renders all 3 cards
  - Shows correct total count
  - Shows "today vs yesterday" comparison
  - Calculates health status correctly
  - Handles loading state
  - Handles error state

**3. StorageHealthPanel Component**
- **File:** `tests/unit/renderer/StorageHealthPanel.test.tsx`
- **Tests:**
  - Renders storage bars correctly
  - Shows warning when >75% capacity
  - Cleanup button triggers IPC call
  - Optimize button triggers IPC call
  - Handles loading/error states

**4. TopIssuesPanel Component**
- **File:** `tests/unit/renderer/TopIssuesPanel.test.tsx`
- **Tests:**
  - Renders issue list
  - Sorts by severity
  - Shows empty state when no issues
  - Action buttons trigger handlers
  - Handles loading/error states

**5. GraphService Extensions**
- **File:** `tests/unit/events/graph-service-queries.test.ts`
- **Tests:**
  - `getRecentEvents()` returns correct events
  - Filtering by event type works
  - Filtering by status works
  - `getEventStats()` aggregates correctly
  - `getStorageHealth()` returns accurate sizes
  - `detectIssues()` identifies problems

### Integration Tests

**1. Event Timeline End-to-End**
- **File:** `tests/integration/event-timeline-flow.test.ts`
- **Tests:**
  - Event processed → appears in timeline
  - Timeline updates on poll
  - Filter persists across refreshes
  - IPC handler returns enriched data

**2. Storage Health Flow**
- **File:** `tests/integration/storage-health.test.ts`
- **Tests:**
  - Storage health reflects actual DB sizes
  - Cleanup removes old events
  - Optimize reduces DB size

**3. Issue Detection**
- **File:** `tests/integration/issue-detection.test.ts`
- **Tests:**
  - Failed event → issue detected
  - High storage → warning issued
  - Stale sites → issue detected
  - Retry failed events works

### E2E Tests

**1. Visibility Dashboard**
- **File:** `tests/e2e/19-visibility-dashboard.e2e.test.ts`
- **Tests:**
  - Navigate to Visibility tab
  - Stats cards show event counts
  - Timeline shows recent events
  - Filter timeline by type
  - Issues panel shows problems
  - Storage panel shows capacity
  - Cleanup old events works
  - All auto-refresh mechanisms work

**2. Event Processing Visibility**
- **File:** `tests/e2e/20-event-visibility.e2e.test.ts`
- **Tests:**
  - Activate plugin in WordPress → event appears in timeline
  - Create post → event appears
  - Update user → event appears
  - Failed event → appears in issues panel
  - Stats update in real-time

### Manual Testing Checklist

**Pre-flight:**
- [ ] npm run build
- [ ] Local app running
- [ ] nexus-e2e-test site running
- [ ] WordPress plugin installed

**Test Scenarios:**

1. **Event Timeline**
   - [ ] Navigate to Visibility tab
   - [ ] See recent events (if any)
   - [ ] Activate plugin in WP Admin
   - [ ] Wait 10s, event appears in timeline
   - [ ] Filter by "plugins" → only plugin events
   - [ ] Expand event → see details

2. **Event Stats**
   - [ ] Total events count matches reality
   - [ ] Today count updates after new event
   - [ ] Health shows "Good" (green)
   - [ ] Create failed event → health shows "Error" (red)

3. **Storage Health**
   - [ ] Graph DB size shows ~2-5 MB
   - [ ] Vector DB size shows actual size
   - [ ] Event count matches total
   - [ ] Click "Cleanup" → old events removed
   - [ ] Click "Optimize" → DB size reduced

4. **Top Issues**
   - [ ] No issues → "All systems healthy"
   - [ ] Create failed event → issue appears
   - [ ] Click "Retry" → event retried
   - [ ] Issue disappears after resolution

5. **Auto-Refresh**
   - [ ] Leave tab open for 30s
   - [ ] Create event in WordPress
   - [ ] Timeline auto-updates without manual refresh

---

## Implementation Tasks

### Week 1: Backend & Foundation

**Day 1-2: GraphService Extensions**
- [ ] Add `getRecentEvents()` method
- [ ] Add `getEventStats()` method
- [ ] Add `getStorageHealth()` method
- [ ] Add `detectIssues()` method
- [ ] Add new types to `types.ts`
- [ ] Write unit tests for all methods

**Day 3: IPC Handlers**
- [ ] Register `nexus-ai:events:get-timeline` handler
- [ ] Register `nexus-ai:events:get-stats` handler
- [ ] Register `nexus-ai:storage:get-health` handler
- [ ] Register `nexus-ai:issues:detect` handler
- [ ] Register `nexus-ai:storage:cleanup` handler
- [ ] Register `nexus-ai:events:retry-failed` handler
- [ ] Write integration tests for IPC handlers

**Day 4: IPC Constants & Types**
- [ ] Add IPC channel constants to `common/constants.ts`
- [ ] Add shared types to `common/types.ts`
- [ ] Update TypeScript definitions

### Week 2: UI Components

**Day 5-6: EventStatsCards + EventTimeline**
- [ ] Build `EventStatsCards` component
- [ ] Build `EventTimeline` component
- [ ] Write unit tests for both
- [ ] Manual testing

**Day 7: StorageHealthPanel**
- [ ] Build `StorageHealthPanel` component
- [ ] Implement cleanup action
- [ ] Implement optimize action
- [ ] Write unit tests
- [ ] Manual testing

**Day 8: TopIssuesPanel**
- [ ] Build `TopIssuesPanel` component
- [ ] Implement issue detection UI
- [ ] Implement action handlers
- [ ] Write unit tests
- [ ] Manual testing

**Day 9: FleetOverview Integration**
- [ ] Add "Visibility" tab to FleetOverview
- [ ] Integrate all 4 components
- [ ] Layout and styling
- [ ] Test tab navigation
- [ ] Test auto-refresh behavior

**Day 10: E2E Tests & Polish**
- [ ] Write E2E test: visibility dashboard
- [ ] Write E2E test: event processing visibility
- [ ] Manual testing checklist
- [ ] UI polish (colors, spacing, icons)
- [ ] Error handling improvements
- [ ] Loading states refinement

---

## Acceptance Criteria

### Must Have (Sprint 1 Complete)

1. **Visibility Tab Exists**
   - [ ] Tab appears in FleetOverview
   - [ ] Tab loads without errors
   - [ ] Tab shows all 4 components

2. **Event Timeline Works**
   - [ ] Shows last 50 events
   - [ ] Filters by event type
   - [ ] Auto-refreshes every 10s
   - [ ] Displays event status correctly
   - [ ] Shows "2 mins ago" timestamps

3. **Event Stats Accurate**
   - [ ] Total events count correct
   - [ ] Today vs yesterday comparison works
   - [ ] Health status reflects reality (green/yellow/red)
   - [ ] Auto-refreshes every 30s

4. **Storage Health Visible**
   - [ ] Shows Graph DB size
   - [ ] Shows Vector DB size
   - [ ] Shows event count and date range
   - [ ] Cleanup button removes old events
   - [ ] Optimize button works

5. **Top Issues Detected**
   - [ ] Failed events → issue appears
   - [ ] Storage >75% → warning appears
   - [ ] Action buttons work
   - [ ] Empty state shows "All healthy"

6. **Tests Pass**
   - [ ] All unit tests pass (10+ new tests)
   - [ ] All integration tests pass (3+ new tests)
   - [ ] All E2E tests pass (2+ new tests)
   - [ ] Manual testing checklist complete

### Nice to Have (Post-Sprint 1)

- [ ] Export timeline as CSV
- [ ] Event detail modal (instead of inline expand)
- [ ] Custom date range selector
- [ ] Event search within timeline
- [ ] Notification badges for new events
- [ ] Dark mode styles

---

## Risks & Mitigation

### Risk 1: Performance with Many Events
**Impact:** Timeline slow with 10,000+ events
**Mitigation:**
- Default limit: 50 events
- Pagination with "Load More"
- Database indexes on created_at
- Query optimization (LIMIT + ORDER BY indexed)

### Risk 2: Auto-Refresh Overhead
**Impact:** Polling every 10s could slow UI
**Mitigation:**
- Configurable refresh intervals
- Pause refresh when tab not visible
- Use requestIdleCallback for background polls
- Batch multiple IPC calls

### Risk 3: Class Component Complexity
**Impact:** FleetOverview already 900 lines
**Mitigation:**
- Keep new components small and focused
- Extract shared logic to utility functions
- Document state management clearly
- Consider refactor to hooks post-Sprint 1

### Risk 4: Event Data Migration
**Impact:** Existing graph.db may not have event_queue
**Mitigation:**
- GraphService.initialize() creates tables if missing
- Migration is automatic (CREATE TABLE IF NOT EXISTS)
- No data loss risk

---

## Success Metrics

### Quantitative
- [ ] All 4 components render in <1s
- [ ] Event timeline updates in <100ms
- [ ] Auto-refresh doesn't block UI
- [ ] Storage health accurate within 1%
- [ ] Zero console errors in production

### Qualitative
- [ ] Users see "43 events processed" immediately
- [ ] Users can identify problem sites at a glance
- [ ] Users understand what's happening across fleet
- [ ] Dashboard feels "alive" (real-time updates)
- [ ] UI is visually polished (not a prototype)

---

## Files to Create/Modify

### New Files (13)

**Components (4):**
1. `src/renderer/components/EventTimeline.tsx`
2. `src/renderer/components/EventStatsCards.tsx`
3. `src/renderer/components/StorageHealthPanel.tsx`
4. `src/renderer/components/TopIssuesPanel.tsx`

**Unit Tests (4):**
5. `tests/unit/renderer/EventTimeline.test.tsx`
6. `tests/unit/renderer/EventStatsCards.test.tsx`
7. `tests/unit/renderer/StorageHealthPanel.test.tsx`
8. `tests/unit/renderer/TopIssuesPanel.test.tsx`

**Integration Tests (3):**
9. `tests/integration/event-timeline-flow.test.ts`
10. `tests/integration/storage-health.test.ts`
11. `tests/integration/issue-detection.test.ts`

**E2E Tests (2):**
12. `tests/e2e/19-visibility-dashboard.e2e.test.ts`
13. `tests/e2e/20-event-visibility.e2e.test.ts`

### Modified Files (5)

1. `src/main/events/GraphService.ts` - Add query methods
2. `src/main/events/types.ts` - Add new interfaces
3. `src/main/index.ts` - Register IPC handlers
4. `src/renderer/components/FleetOverview.tsx` - Add Visibility tab
5. `src/common/constants.ts` - Add IPC channel constants

---

## Next Steps After Sprint 1

**Sprint 2 Preview:**
- Unified search UI
- Smart filters ("Sites with outdated PHP")
- Saved queries
- Site health scores (0-100)

**Documentation:**
- Update COMPREHENSIVE_ROADMAP.md with Sprint 1 completion
- Add screenshots to README
- Update user guide with Visibility tab instructions

**Beta Testing:**
- Ship to 5-10 beta users
- Gather feedback on visibility features
- Iterate on UI/UX

---

**Last Updated:** 2026-03-05
**Next Review:** End of Week 1 (Day 4 retrospective)
