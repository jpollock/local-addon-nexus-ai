# Sprint 1: Task Checklist

**Sprint:** Enhanced Visibility
**Timeline:** 2 Weeks (10 working days)
**Start Date:** 2026-03-05

---

## Week 1: Backend & Foundation (Days 1-4)

### Day 1: GraphService Query Methods

**Goal:** Add data access methods to GraphService

**Tasks:**
- [x] **T1.1** Add `getRecentEvents()` method to GraphService.ts
  - Query event_queue table
  - Support limit, filter, status, siteId params
  - Return EventQueueEntry[]
  - Add SQL indexes if needed
  - **Estimated:** 2 hours

- [x] **T1.2** Add `getEventStats()` method to GraphService.ts
  - Aggregate total, today, yesterday counts
  - Count by status (pending, failed, processed)
  - Group by event_type
  - Support optional timeRange param
  - **Estimated:** 2 hours

- [x] **T1.3** Add `getStorageHealth()` method to GraphService.ts
  - Get graph.db file size (fs.statSync)
  - Get vector DB directory size
  - Count rows in event_queue
  - Get oldest/newest event timestamps
  - **Estimated:** 1.5 hours

- [x] **T1.4** Add `detectIssues()` method to GraphService.ts
  - Check for failed events
  - Check for storage >75%
  - Check for stale sites (last_sync_at > 7 days)
  - Return IssueData[]
  - **Estimated:** 2 hours

- [x] **T1.5** Write unit tests for new GraphService methods
  - `tests/unit/events/graph-service-queries.test.ts`
  - Test each method with fixtures
  - Test edge cases (empty DB, no events)
  - **Estimated:** 2 hours

**Day 1 Total:** ~9.5 hours ✅

---

### Day 2: Type Definitions & Event Processor

**Goal:** Add TypeScript types and EventProcessor helper

**Tasks:**
- [x] **T2.1** Add new types to `src/main/events/types.ts`
  - EventQueueEntry interface
  - EventStatsData interface
  - StorageHealthData interface
  - IssueData interface
  - **Estimated:** 1 hour

- [x] **T2.2** Add shared types to `src/common/types.ts`
  - EventTimelineEntry (renderer-safe version)
  - EventStats (renderer-safe version)
  - StorageHealth (renderer-safe version)
  - Issue (renderer-safe version)
  - **Estimated:** 1 hour

- [x] **T2.3** Add helper: `generateEventSummary()` utility
  - Parse event payload
  - Generate human-readable summary
  - Support all 10 event types
  - **Estimated:** 2 hours

- [x] **T2.4** Write unit tests for generateEventSummary
  - Test all event types
  - Test edge cases (missing fields)
  - **Estimated:** 1.5 hours

- [x] **T2.5** Add database indexes for query performance
  - Index on event_queue.created_at
  - Index on event_queue.status
  - Composite index on (site_id, created_at)
  - **Estimated:** 1 hour

**Day 2 Total:** ~6.5 hours ✅

---

### Day 3: IPC Handlers (Main Process)

**Goal:** Register IPC handlers for renderer communication

**Tasks:**
- [x] **T3.1** Add IPC channel constants to `src/common/constants.ts`
  - `NEXUS_AI_EVENTS_GET_TIMELINE`
  - `NEXUS_AI_EVENTS_GET_STATS`
  - `NEXUS_AI_STORAGE_GET_HEALTH`
  - `NEXUS_AI_ISSUES_DETECT`
  - `NEXUS_AI_STORAGE_CLEANUP`
  - `NEXUS_AI_EVENTS_RETRY_FAILED`
  - **Estimated:** 0.5 hours

- [x] **T3.2** Register `nexus-ai:events:get-timeline` handler
  - Call graphService.getRecentEvents()
  - Enrich with site names
  - Generate event summaries
  - Return { events, total }
  - **Estimated:** 1.5 hours

- [x] **T3.3** Register `nexus-ai:events:get-stats` handler
  - Call graphService.getEventStats()
  - Calculate health status (good/warning/error)
  - Return stats with healthStatus
  - **Estimated:** 1 hour

- [x] **T3.4** Register `nexus-ai:storage:get-health` handler
  - Call graphService.getStorageHealth()
  - Return storage metrics
  - **Estimated:** 0.5 hours

- [x] **T3.5** Register `nexus-ai:issues:detect` handler
  - Call graphService.detectIssues()
  - Return issue list
  - **Estimated:** 0.5 hours

- [x] **T3.6** Register `nexus-ai:storage:cleanup` handler
  - Call graphService.cleanupOldData()
  - Return deleted count
  - **Estimated:** 0.5 hours

- [x] **T3.7** Register `nexus-ai:events:retry-failed` handler
  - Call eventProcessor.retryFailed()
  - Return retry stats
  - **Estimated:** 0.5 hours

- [x] **T3.8** Write integration tests for IPC handlers
  - Test each handler with mock services
  - Test error handling
  - **Estimated:** 2 hours

**Day 3 Total:** ~7 hours ✅

---

### Day 4: IPC Testing & Backend Validation

**Goal:** Ensure backend is solid before building UI

**Tasks:**
- [x] **T4.1** Write integration test: Event timeline flow
  - Create events → query timeline → verify enrichment
  - Test filtering by event type
  - Test filtering by status
  - **Estimated:** 2 hours

- [x] **T4.2** Write integration test: Storage health flow
  - Create events → query storage health
  - Run cleanup → verify events deleted
  - Run optimize → verify DB shrunk
  - **Estimated:** 1.5 hours

- [x] **T4.3** Write integration test: Issue detection
  - Create failed event → verify issue detected
  - Fill storage → verify warning
  - Retry failed → verify issue resolved
  - **Estimated:** 2 hours

- [x] **T4.4** Manual testing: IPC handlers via scripts
  - Create `scripts/manual-testing/test-visibility-ipc.js`
  - Call each IPC handler
  - Verify responses
  - **Estimated:** 1 hour

- [x] **T4.5** Code review: Backend implementation
  - Review all GraphService methods
  - Review all IPC handlers
  - Check error handling
  - Check TypeScript types
  - **Estimated:** 1 hour

**Day 4 Total:** ~7.5 hours ✅

---

## Week 2: UI Components (Days 5-10)

### Day 5: EventStatsCards Component

**Goal:** Build event statistics dashboard

**Tasks:**
- [x] **T5.1** Create `src/renderer/components/EventStatsCards.tsx`
  - Class-based component (Local doesn't support hooks)
  - Props: electron, autoRefresh
  - State: stats, loading, error
  - **Estimated:** 2 hours

- [x] **T5.2** Implement stats fetching
  - IPC call to `nexus-ai:events:get-stats`
  - Auto-refresh every 30s if enabled
  - Error handling
  - **Estimated:** 1.5 hours

- [x] **T5.3** Implement 3-card layout
  - Card 1: Total Events
  - Card 2: Today (with comparison)
  - Card 3: Health Status
  - Responsive grid layout
  - **Estimated:** 2 hours

- [x] **T5.4** Add health status indicator
  - Green: 0 pending, 0 failed
  - Yellow: <10 pending
  - Red: >0 failed
  - Visual icon/color
  - **Estimated:** 1 hour

- [x] **T5.5** Write unit tests
  - Test rendering with mock data
  - Test health status calculation
  - Test auto-refresh
  - Test error handling
  - **Estimated:** 1.5 hours

**Day 5 Total:** ~8 hours ✅

---

### Day 6: EventTimeline Component

**Goal:** Build event stream visualization

**Tasks:**
- [ ] **T6.1** Create `src/renderer/components/EventTimeline.tsx`
  - Class-based component
  - Props: electron, limit, autoRefresh
  - State: events, filter, loading, error
  - **Estimated:** 2 hours

- [ ] **T6.2** Implement event fetching
  - IPC call to `nexus-ai:events:get-timeline`
  - Auto-refresh every 10s if enabled
  - Filter by event type
  - **Estimated:** 1.5 hours

- [ ] **T6.3** Implement event list UI
  - Event entry: icon, summary, timestamp, status
  - Relative timestamps ("2 mins ago")
  - Status badges (✓ Processed, ⏱ Pending, ✗ Failed)
  - Expand for details
  - **Estimated:** 3 hours

- [ ] **T6.4** Implement filter dropdown
  - Options: All, Content, Plugins, Users, Site
  - Update on change
  - Persist selection in state
  - **Estimated:** 1 hour

- [ ] **T6.5** Write unit tests
  - Test rendering event list
  - Test filtering
  - Test timestamp formatting
  - Test auto-refresh
  - **Estimated:** 1.5 hours

**Day 6 Total:** ~9 hours

---

### Day 7: StorageHealthPanel Component

**Goal:** Build storage visualization and cleanup

**Tasks:**
- [x] **T7.1** Create `src/renderer/components/StorageHealthPanel.tsx`
  - Class-based component
  - Props: electron, autoRefresh
  - State: health, loading, cleaning, optimizing, error
  - **Estimated:** 2 hours

- [x] **T7.2** Implement storage fetching
  - IPC call to `nexus-ai:storage:get-health`
  - Auto-refresh every 60s if enabled
  - **Estimated:** 1 hour

- [x] **T7.3** Implement storage visualization
  - Progress bars for graph DB and vector DB
  - Percentage labels
  - Warning color if >75%
  - Event count and date range
  - **Estimated:** 2.5 hours

- [x] **T7.4** Implement cleanup action
  - "Cleanup Old Events" button
  - IPC call to `nexus-ai:storage:cleanup`
  - Show loading state
  - Show success message
  - **Estimated:** 1.5 hours

- [x] **T7.5** Implement optimize action
  - "Optimize Databases" button
  - IPC call (if we add it)
  - Show loading state
  - **Estimated:** 1 hour

- [x] **T7.6** Write unit tests
  - Test rendering with mock data
  - Test cleanup action
  - Test optimize action
  - Test warning states
  - **Estimated:** 1.5 hours

**Day 7 Total:** ~9.5 hours

---

### Day 8: TopIssuesPanel Component

**Goal:** Build proactive issue detection

**Tasks:**
- [ ] **T8.1** Create `src/renderer/components/TopIssuesPanel.tsx`
  - Class-based component
  - Props: electron, autoRefresh
  - State: issues, loading, error
  - **Estimated:** 2 hours

- [ ] **T8.2** Implement issue fetching
  - IPC call to `nexus-ai:issues:detect`
  - Auto-refresh every 60s if enabled
  - Sort by severity
  - **Estimated:** 1.5 hours

- [ ] **T8.3** Implement issue list UI
  - Issue entry: icon, title, description, action button
  - Severity colors (warning=yellow, error=red)
  - Empty state: "✓ All systems healthy"
  - Max 5 issues shown
  - **Estimated:** 2.5 hours

- [ ] **T8.4** Implement action handlers
  - Retry failed events
  - Navigate to sites (if applicable)
  - Trigger cleanup
  - **Estimated:** 1.5 hours

- [ ] **T8.5** Write unit tests
  - Test rendering issue list
  - Test sorting by severity
  - Test action handlers
  - Test empty state
  - **Estimated:** 1.5 hours

**Day 8 Total:** ~9 hours

---

### Day 9: FleetOverview Integration

**Goal:** Integrate all components into FleetOverview

**Tasks:**
- [ ] **T9.1** Add "Visibility" tab to FleetOverview
  - Update state: activeTab includes 'visibility'
  - Add tab button in navigation
  - **Estimated:** 1 hour

- [ ] **T9.2** Import all 4 new components
  - EventStatsCards
  - EventTimeline
  - StorageHealthPanel
  - TopIssuesPanel
  - **Estimated:** 0.5 hours

- [ ] **T9.3** Implement `renderVisibilityTab()` method
  - Stats cards at top (full width)
  - 2-column layout below: timeline (left) + issues/storage (right)
  - Responsive layout
  - **Estimated:** 2 hours

- [ ] **T9.4** Add tab navigation logic
  - Switch between tabs
  - Preserve state when switching
  - Auto-refresh only on active tab
  - **Estimated:** 1.5 hours

- [ ] **T9.5** Styling and polish
  - Consistent spacing
  - Colors match Local theme
  - Responsive breakpoints
  - **Estimated:** 2 hours

- [ ] **T9.6** Manual testing
  - Navigate between tabs
  - Verify all components render
  - Verify auto-refresh works
  - Test in different window sizes
  - **Estimated:** 1 hour

**Day 9 Total:** ~8 hours

---

### Day 10: E2E Tests & Polish

**Goal:** Comprehensive testing and final polish

**Tasks:**
- [ ] **T10.1** Write E2E test: Visibility dashboard
  - `tests/e2e/19-visibility-dashboard.e2e.test.ts`
  - Navigate to Visibility tab
  - Verify stats cards render
  - Verify timeline renders
  - Verify issues panel renders
  - Verify storage panel renders
  - **Estimated:** 2.5 hours

- [ ] **T10.2** Write E2E test: Event visibility
  - `tests/e2e/20-event-visibility.e2e.test.ts`
  - Activate plugin in WordPress
  - Wait for event to appear in timeline
  - Verify stats update
  - Test filtering
  - **Estimated:** 2.5 hours

- [ ] **T10.3** Manual testing checklist
  - Run full manual test plan from detailed plan
  - Test all interactions
  - Test error states
  - Test auto-refresh
  - **Estimated:** 2 hours

- [ ] **T10.4** UI polish pass
  - Fix spacing inconsistencies
  - Improve loading states
  - Add icons where missing
  - Ensure colors match Local theme
  - **Estimated:** 1.5 hours

- [ ] **T10.5** Error handling improvements
  - Better error messages
  - Retry buttons on errors
  - Graceful degradation
  - **Estimated:** 1 hour

- [ ] **T10.6** Documentation
  - Update README with Visibility tab
  - Add screenshots
  - Document new IPC handlers
  - **Estimated:** 1 hour

**Day 10 Total:** ~10.5 hours

---

## Sprint Summary

### Total Estimated Hours: 84.5 hours (~10.5 days)

**Week 1 Backend:** 30.5 hours (3.8 days)
- Day 1: GraphService queries (9.5h) ✅
- Day 2: Types & helpers (6.5h) ✅
- Day 3: IPC handlers (7h) ✅
- Day 4: Testing & validation (7.5h) ✅

**Week 2 UI:** 54 hours (6.7 days)
- Day 5: EventStatsCards (8h) ✅
- Day 6: EventTimeline (9h)
- Day 7: StorageHealthPanel (9.5h) ✅
- Day 8: TopIssuesPanel (9h) ✅
- Day 9: FleetOverview integration (8h) ✅
- Day 10: E2E tests & polish (10.5h)

---

## Progress Tracking

**Legend:**
- ⬜ Not Started
- 🟦 In Progress
- ✅ Complete
- ❌ Blocked

**Day 1: Backend Foundation**
- ✅ T1.1 getRecentEvents()
- ✅ T1.2 getEventStats()
- ✅ T1.3 getStorageHealth()
- ✅ T1.4 detectIssues()
- ✅ T1.5 Unit tests

**Day 2: Types & Helpers**
- ✅ T2.1 Main types
- ✅ T2.2 Common types
- ✅ T2.3 Event summaries
- ✅ T2.4 Tests
- ✅ T2.5 Indexes

**Day 3: IPC Handlers**
- ✅ T3.1 Constants
- ✅ T3.2 Timeline handler
- ✅ T3.3 Stats handler
- ✅ T3.4 Health handler
- ✅ T3.5 Issues handler
- ✅ T3.6 Cleanup handler
- ✅ T3.7 Retry handler
- ✅ T3.8 Integration tests

**Day 4: Backend Testing**
- ✅ T4.1 Timeline flow test
- ✅ T4.2 Storage flow test
- ✅ T4.3 Issue detection test
- ✅ T4.4 Manual IPC testing
- ✅ T4.5 Code review

**Day 5: EventStatsCards**
- ✅ T5.1 Component scaffold
- ✅ T5.2 Fetching logic
- ✅ T5.3 Card layout
- ✅ T5.4 Health indicator
- ✅ T5.5 Unit tests

**Day 6: EventTimeline**
- ⬜ T6.1 Component scaffold
- ⬜ T6.2 Fetching logic
- ⬜ T6.3 Event list UI
- ⬜ T6.4 Filter dropdown
- ⬜ T6.5 Unit tests

**Day 7: StorageHealthPanel**
- ✅ T7.1 Component scaffold
- ✅ T7.2 Fetching logic
- ✅ T7.3 Visualization
- ✅ T7.4 Cleanup action
- ✅ T7.5 Optimize action
- ✅ T7.6 Unit tests

**Day 8: TopIssuesPanel**
- ✅ T8.1 Component scaffold
- ✅ T8.2 Fetching logic
- ✅ T8.3 Issue list UI
- ✅ T8.4 Action handlers
- ✅ T8.5 Unit tests

**Day 9: Integration**
- ✅ T9.1 Add Visibility tab
- ✅ T9.2 Import components
- ✅ T9.3 renderVisibilityTab()
- ✅ T9.4 Tab navigation
- ✅ T9.5 Styling
- ✅ T9.6 Manual testing

**Day 10: Testing & Polish**
- ⬜ T10.1 E2E dashboard test
- ⬜ T10.2 E2E visibility test
- ⬜ T10.3 Manual checklist
- ⬜ T10.4 UI polish
- ⬜ T10.5 Error handling
- ⬜ T10.6 Documentation

---

## Sprint Completion Checklist

### Deliverables

**Code:**
- [ ] 4 new UI components
- [ ] 4 new GraphService methods
- [ ] 6 new IPC handlers
- [ ] Enhanced FleetOverview with Visibility tab

**Tests:**
- [ ] 4 unit test files (components)
- [ ] 1 unit test file (GraphService)
- [ ] 3 integration test files
- [ ] 2 E2E test files
- [ ] All tests passing

**Documentation:**
- [ ] README updated with Visibility tab
- [ ] Screenshots added
- [ ] IPC handlers documented
- [ ] Sprint retrospective written

**Quality:**
- [ ] No console errors
- [ ] Auto-refresh works smoothly
- [ ] UI feels polished
- [ ] Performance acceptable (<1s load)

### Definition of Done

Sprint 1 is complete when:
1. All tasks marked ✅
2. All tests passing
3. Manual testing checklist complete
4. Code reviewed
5. Merged to main
6. COMPREHENSIVE_ROADMAP updated
7. Demo ready for stakeholders

---

**Next Sprint:** Sprint 2 - Easy Fleet Discovery 🔍
