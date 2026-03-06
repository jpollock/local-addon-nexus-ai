# Phase 1: UI Component - Detailed Plan

## Overview

The **Nexus AI Dashboard** is a tab in the SiteInfo screen that shows:
- Event processing statistics
- Recent events timeline
- Context search interface
- Storage health metrics
- Snapshot management

This follows the same TDD approach: contracts → tests → implementation.

---

## 1. UI Contracts

### 1.1 IPC API (Renderer ↔ Main Communication)

**File:** `src/main/mcp/contracts/ipc-api.ts`

```typescript
/**
 * IPC endpoints for Nexus AI Dashboard
 * Renderer process calls these, main process handles them
 */

export interface NexusIpcApi {
  // Event statistics
  'nexus:getEventStats': {
    request: { siteId: string };
    response: EventStats;
  };

  // Recent events
  'nexus:getRecentEvents': {
    request: { siteId: string; limit?: number };
    response: RecentEvent[];
  };

  // Storage health
  'nexus:getStorageStats': {
    request: { siteId: string };
    response: StorageStats;
  };

  // Context search
  'nexus:searchContent': {
    request: { siteId: string; query: string; limit?: number };
    response: SearchResult[];
  };

  // Snapshot management
  'nexus:createSnapshot': {
    request: { siteId: string; reason: string };
    response: Snapshot;
  };

  'nexus:listSnapshots': {
    request: { siteId: string };
    response: Snapshot[];
  };

  // Processing control
  'nexus:pauseProcessing': {
    request: { siteId: string };
    response: { paused: boolean };
  };

  'nexus:resumeProcessing': {
    request: { siteId: string };
    response: { resumed: boolean };
  };
}

export interface EventStats {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  queueSize: number;
  lastEventTime: string | null;
  eventsByType: Record<string, number>;
  processingRate: number; // events per minute
}

export interface RecentEvent {
  id: string;
  eventType: string;
  timestamp: string;
  description: string;
  processed: boolean;
  error?: string;
}

export interface StorageStats {
  dbSizeMb: number;
  eventCount: number;
  embeddingCount: number;
  oldestEventDate: string | null;
  newestEventDate: string | null;
  retentionDays: number;
  capacityUsedPercent: number;
}

export interface SearchResult {
  postId: number;
  title: string;
  excerpt: string;
  relevance: number;
  topics: string[];
  updatedAt: string;
}

export interface Snapshot {
  id: string;
  siteId: string;
  reason: string;
  createdAt: string;
  eventCount: number;
  storageSize: number;
}
```

### 1.2 Component Props Interfaces

**File:** `src/renderer/components/nexus-ai/types.ts`

```typescript
import { Site } from '../../../main/capi/client';

export interface NexusAIDashboardProps {
  site: Site;
  siteStatus: string;
  match: {
    params: {
      siteID: string;
    };
  };
}

export interface StatsCardProps {
  title: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: React.ReactNode;
  loading?: boolean;
}

export interface EventTimelineProps {
  events: RecentEvent[];
  loading?: boolean;
  onRefresh?: () => void;
}

export interface ContextSearchProps {
  siteId: string;
  onResultClick?: (result: SearchResult) => void;
}

export interface StorageHealthProps {
  stats: StorageStats;
  onPrune?: () => void;
}

export interface SnapshotManagerProps {
  siteId: string;
  snapshots: Snapshot[];
  onCreateSnapshot: (reason: string) => void;
  onRestoreSnapshot: (snapshotId: string) => void;
}
```

### 1.3 UI State Management

**File:** `src/renderer/components/nexus-ai/hooks/useNexusData.ts`

```typescript
/**
 * Custom hook for fetching and managing Nexus AI data
 * Handles IPC communication, loading states, and auto-refresh
 */

export interface UseNexusDataOptions {
  siteId: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

export interface UseNexusDataResult {
  stats: EventStats | null;
  recentEvents: RecentEvent[];
  storageStats: StorageStats | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useNexusData(options: UseNexusDataOptions): UseNexusDataResult;
```

---

## 2. UI Test Structure

### 2.1 Component Tests (React Testing Library)

```
tests/ui/
├── components/
│   ├── NexusAIDashboard.test.tsx
│   ├── StatsCard.test.tsx
│   ├── EventTimeline.test.tsx
│   ├── ContextSearch.test.tsx
│   └── StorageHealth.test.tsx
│
├── hooks/
│   └── useNexusData.test.ts
│
└── integration/
    └── dashboard-ipc.int.test.tsx
```

### 2.2 Component Test Examples

**File:** `tests/ui/components/StatsCard.test.tsx`

```typescript
import React from 'react';
import { render, screen } from '@testing-library/react';
import { StatsCard } from '../../../src/renderer/components/nexus-ai/StatsCard';

describe('StatsCard', () => {
  it('should render title and value', () => {
    render(<StatsCard title="Total Events" value={1234} />);

    expect(screen.getByText('Total Events')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(<StatsCard title="Total Events" value={0} loading />);

    expect(screen.getByTestId('stats-card-skeleton')).toBeInTheDocument();
  });

  it('should render trend indicator', () => {
    render(
      <StatsCard
        title="Processing Rate"
        value={45}
        trend="up"
        trendValue="+12%"
      />
    );

    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByTestId('trend-up-icon')).toBeInTheDocument();
  });

  it('should format large numbers', () => {
    render(<StatsCard title="Total Events" value={1234567} />);

    expect(screen.getByText('1.23M')).toBeInTheDocument();
  });
});
```

**File:** `tests/ui/components/NexusAIDashboard.test.tsx`

```typescript
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ipcRenderer } from 'electron';
import { NexusAIDashboard } from '../../../src/renderer/components/nexus-ai/NexusAIDashboard';

jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn(),
  },
}));

describe('NexusAIDashboard', () => {
  const mockSite = {
    id: 'test-site-123',
    name: 'Test Site',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch and display event stats', async () => {
    (ipcRenderer.invoke as jest.Mock).mockResolvedValue({
      totalEvents: 1234,
      processedEvents: 1200,
      failedEvents: 34,
      queueSize: 5,
    });

    render(<NexusAIDashboard site={mockSite} siteStatus="running" />);

    await waitFor(() => {
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('nexus:getEventStats', {
      siteId: 'test-site-123',
    });
  });

  it('should show error state when IPC fails', async () => {
    (ipcRenderer.invoke as jest.Mock).mockRejectedValue(
      new Error('IPC error')
    );

    render(<NexusAIDashboard site={mockSite} siteStatus="running" />);

    await waitFor(() => {
      expect(screen.getByText(/error loading nexus data/i)).toBeInTheDocument();
    });
  });

  it('should auto-refresh data every 10 seconds', async () => {
    jest.useFakeTimers();

    (ipcRenderer.invoke as jest.Mock).mockResolvedValue({
      totalEvents: 100,
    });

    render(<NexusAIDashboard site={mockSite} siteStatus="running" />);

    // Initial fetch
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1);

    // Advance 10 seconds
    jest.advanceTimersByTime(10000);

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledTimes(2);
    });

    jest.useRealTimers();
  });

  it('should render all dashboard sections', () => {
    render(<NexusAIDashboard site={mockSite} siteStatus="running" />);

    expect(screen.getByText('Event Statistics')).toBeInTheDocument();
    expect(screen.getByText('Recent Events')).toBeInTheDocument();
    expect(screen.getByText('Context Search')).toBeInTheDocument();
    expect(screen.getByText('Storage Health')).toBeInTheDocument();
  });
});
```

### 2.3 IPC Integration Tests

**File:** `tests/ui/integration/dashboard-ipc.int.test.tsx`

```typescript
import { ipcMain } from 'electron';
import { GraphService } from '../../../src/main/graph/GraphService';
import { registerNexusIpcHandlers } from '../../../src/main/mcp/ipc-handlers';

describe('Dashboard IPC Integration', () => {
  let graphService: GraphService;

  beforeEach(async () => {
    graphService = new GraphService(':memory:');
    await graphService.initialize();
    registerNexusIpcHandlers(graphService);
  });

  afterEach(async () => {
    await graphService.close();
  });

  it('should return event stats via IPC', async () => {
    // Insert test events
    await graphService.insertEvent({
      site_id: 'test-site',
      event_type: 'post_updated',
      timestamp: new Date().toISOString(),
      data: { post_id: 1 },
    });

    // Simulate IPC call
    const handler = ipcMain.listeners('nexus:getEventStats')[0];
    const result = await handler({ siteId: 'test-site' });

    expect(result).toEqual({
      totalEvents: 1,
      processedEvents: 0,
      failedEvents: 0,
      queueSize: 0,
      lastEventTime: expect.any(String),
      eventsByType: {
        post_updated: 1,
      },
      processingRate: 0,
    });
  });
});
```

---

## 3. UI Implementation Roadmap

### Phase 1a: Write Failing UI Tests (RED)

**Order:**

1. **Component unit tests** (isolated, fast)
   - StatsCard (4 tests)
   - EventTimeline (5 tests)
   - ContextSearch (4 tests)
   - StorageHealth (3 tests)
   - NexusAIDashboard (6 tests)

2. **Hook tests** (custom hooks)
   - useNexusData (5 tests)

3. **IPC integration tests** (renderer ↔ main)
   - IPC handlers registered correctly (3 tests)
   - Stats endpoint returns correct data (1 test)
   - Recent events endpoint works (1 test)
   - Search endpoint works (1 test)

**Total:** 0/32 UI tests passing ❌

### Phase 1b: Implement UI Components (GREEN)

**Implementation order:**

1. **IPC Handlers in Main Process** (needed by everything)
   ```typescript
   // src/main/mcp/ipc-handlers.ts
   export function registerNexusIpcHandlers(
     graphService: GraphService,
     eventProcessor: EventProcessor,
     vectorDb: LanceDBService
   ) {
     ipcMain.handle('nexus:getEventStats', async (event, { siteId }) => {
       return await graphService.getEventStats(siteId);
     });

     // ... other handlers
   }
   ```

2. **Base Components** (building blocks)
   - StatsCard (simple, no dependencies)
   - EventTimeline (uses date formatting)
   - StorageHealth (displays metrics)

3. **Complex Components** (use base components)
   - ContextSearch (calls IPC, displays results)
   - SnapshotManager (CRUD operations)

4. **Custom Hook** (data fetching logic)
   - useNexusData (manages IPC calls, loading, refresh)

5. **Main Dashboard** (orchestrates everything)
   - NexusAIDashboard (uses all components + hook)

6. **Tab Registration** (wires into Local)
   ```typescript
   // src/renderer.tsx
   getServiceContainer().cradle.hooks.addContent(
     'SiteInfo_TabNav_Items',
     (site) => (
       <NavLink to={`/main/site-info/${site.id}/nexus-ai`}>
         Nexus AI
       </NavLink>
     )
   );

   getServiceContainer().cradle.hooks.addContent(
     'routes[site-info]',
     ({ routeChildrenProps }) => (
       <RoutePlus
         path="/main/site-info/:siteID/nexus-ai"
         component={NexusAIDashboard}
         componentProps={routeChildrenProps}
       />
     )
   );
   ```

**Expected:** 32/32 UI tests passing ✅

---

## 4. UI File Structure

```
src/
├── main/
│   └── mcp/
│       ├── ipc-handlers.ts           (NEW - IPC endpoint implementations)
│       └── contracts/
│           └── ipc-api.ts            (NEW - IPC type definitions)
│
└── renderer/
    └── components/
        └── nexus-ai/                 (NEW - all UI components)
            ├── NexusAIDashboard.tsx  (Main dashboard component)
            ├── NexusAIDashboard.scss (Styles)
            ├── StatsCard.tsx
            ├── StatsCard.scss
            ├── EventTimeline.tsx
            ├── EventTimeline.scss
            ├── ContextSearch.tsx
            ├── ContextSearch.scss
            ├── StorageHealth.tsx
            ├── StorageHealth.scss
            ├── SnapshotManager.tsx
            ├── SnapshotManager.scss
            ├── types.ts              (Component prop interfaces)
            └── hooks/
                └── useNexusData.ts   (Custom hook for data fetching)

tests/
└── ui/
    ├── components/
    │   ├── NexusAIDashboard.test.tsx
    │   ├── StatsCard.test.tsx
    │   ├── EventTimeline.test.tsx
    │   ├── ContextSearch.test.tsx
    │   ├── StorageHealth.test.tsx
    │   └── SnapshotManager.test.tsx
    ├── hooks/
    │   └── useNexusData.test.ts
    └── integration/
        └── dashboard-ipc.int.test.tsx
```

---

## 5. UI Checklist

### IPC Handlers (6 endpoints)
- [ ] nexus:getEventStats returns correct stats
- [ ] nexus:getRecentEvents returns events sorted by time
- [ ] nexus:getStorageStats returns storage metrics
- [ ] nexus:searchContent performs vector search
- [ ] nexus:createSnapshot creates snapshot record
- [ ] nexus:listSnapshots returns all snapshots

### Components (6 components)
- [ ] StatsCard renders title, value, trend
- [ ] StatsCard formats large numbers (1.23M)
- [ ] EventTimeline renders events in chronological order
- [ ] EventTimeline shows processing status indicators
- [ ] ContextSearch performs search on input
- [ ] ContextSearch displays results with relevance scores
- [ ] StorageHealth shows capacity bar chart
- [ ] StorageHealth warns when near capacity
- [ ] SnapshotManager lists snapshots
- [ ] SnapshotManager creates new snapshots
- [ ] NexusAIDashboard renders all sections
- [ ] NexusAIDashboard auto-refreshes every 10s

### Hook (5 tests)
- [ ] useNexusData fetches initial data
- [ ] useNexusData handles loading state
- [ ] useNexusData handles error state
- [ ] useNexusData auto-refreshes when enabled
- [ ] useNexusData cleanup on unmount

### Integration (5 tests)
- [ ] Tab appears in SiteInfo nav
- [ ] Route renders NexusAIDashboard
- [ ] IPC calls return real data
- [ ] Dashboard updates when events processed
- [ ] Search returns vector DB results

**Total:** 32 UI tests

---

## 6. UI Visual Design (Rough Wireframe)

```
┌─────────────────────────────────────────────────────────────┐
│ Nexus AI Intelligence                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Total Events │  │ Processed    │  │ Queue Size   │     │
│  │   1,234      │  │   1,200      │  │      5       │     │
│  │   ↑ +12%    │  │   97.2%      │  │   ━━━━━━     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Last Event   │  │ Storage Used │  │ Processing   │     │
│  │ 2 mins ago   │  │   45 MB      │  │  Rate        │     │
│  │              │  │   45%        │  │  45/min      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                             │
│  Recent Events                          [Refresh] [Pause]  │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ ● post_updated      "New Blog Post"     2 mins ago   │ │
│  │ ● plugin_activated  "Akismet"           5 mins ago   │ │
│  │ ⨯ post_updated      "Homepage" (error)  8 mins ago   │ │
│  │ ● user_login        "admin"            15 mins ago   │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  Context Search                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Search site content...                    [🔍]        │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  Storage Health                              [Prune Old]   │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Capacity: ████████████░░░░░░░░░░  45%                │ │
│  │ Events: 1,234  |  Embeddings: 856  |  Oldest: 28d    │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  Snapshots                                [Create Snapshot]│
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Before Plugin Update    2024-03-01  45MB  [Restore]   │ │
│  │ Daily Backup           2024-03-04  47MB  [Restore]   │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Updated Test Count

**Original Plan:** 40 backend tests
**UI Addition:** 32 UI tests
**New Total:** 72 tests

**Coverage Requirements:**
- Backend: 80% coverage
- UI Components: 80% coverage
- IPC Handlers: 100% coverage (critical path)

---

## 8. Updated Timeline

**Phase 1a (Write Tests):** 3-4 days
- Day 1: Backend API contracts + unit tests
- Day 2: Backend integration + E2E tests
- Day 3: UI contracts + component tests
- Day 4: UI integration tests

**Phase 1b (Implement):** 6-7 days
- Day 1: GraphService
- Day 2: EventProcessor
- Day 3: HttpInterface
- Day 4: Backend integration wiring
- Day 5: UI IPC handlers + base components
- Day 6: UI complex components + dashboard
- Day 7: E2E + UI polish

**Phase 1c (Coverage):** 1-2 days
- Backend coverage gaps
- UI coverage gaps
- Manual testing in Local

**Total: 10-13 days**

---

## Ready to Start?

The plan now includes:
- ✅ Backend API contracts
- ✅ Backend tests (unit + integration + E2E)
- ✅ UI contracts (IPC + component props)
- ✅ UI tests (component + hook + integration)
- ✅ Complete implementation roadmap
- ✅ 72 total tests (40 backend + 32 UI)

Should I proceed with Phase 1a and start creating the contracts and test files?
