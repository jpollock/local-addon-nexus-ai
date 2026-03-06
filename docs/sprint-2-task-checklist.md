# Sprint 2: Easy Fleet Discovery - Task Checklist

**Sprint Goal:** Make fleet-wide discovery and filtering effortless
**Timeline:** 10 working days (2 weeks)
**Start Date:** 2026-03-05
**Status:** 🟡 Not Started

---

## Quick Stats

- **Total Tasks:** 116
- **Completed:** 0
- **In Progress:** 0
- **Remaining:** 116
- **Completion:** 0%

---

## Week 1: Backend & Search (Days 1-5)

### Day 1: SearchService - Part 1 (Core Infrastructure)

**Files to Create:**
- `src/main/search/SearchService.ts`
- `src/main/search/types.ts`
- `tests/unit/search/search-service.test.ts`

**Backend Tasks:**
- [ ] Create SearchService class skeleton
- [ ] Define SearchFilters interface
- [ ] Define SearchOptions interface
- [ ] Define SearchResult interface
- [ ] Define SearchResults interface
- [ ] Define SearchFacets interface
- [ ] Implement constructor with dependencies
- [ ] Add searchFleet() method signature

**Unit Tests (RED phase):**
- [ ] Test: searchFleet() searches all indexed sites
- [ ] Test: searchFleet() respects siteId filter
- [ ] Test: searchFleet() respects content type filter
- [ ] Test: searchFleet() returns empty results for no matches
- [ ] Test: searchFleet() handles empty query

**Status:** Not Started

---

### Day 2: SearchService - Part 2 (Implementation)

**Backend Tasks:**
- [ ] Implement searchAllSites() - vector search
- [ ] Implement searchMetadata() - plugin/theme/user search
- [ ] Implement mergeResults() - combine vector + metadata
- [ ] Implement applyFilters() - filter merged results
- [ ] Implement sortByRelevance() - ranking logic
- [ ] Implement computeFacets() - result facets
- [ ] Implement countByType() helper
- [ ] Implement countBySite() helper
- [ ] Implement countByHealthRange() helper

**Unit Tests (GREEN phase):**
- [ ] Test: searchAllSites() calls VectorStore.search()
- [ ] Test: searchMetadata() calls GraphService methods
- [ ] Test: mergeResults() combines results correctly
- [ ] Test: applyFilters() filters by date range
- [ ] Test: sortByRelevance() sorts correctly
- [ ] Test: computeFacets() returns accurate counts

**Integration Test:**
- [ ] Create tests/integration/14-unified-search.integration.test.ts
- [ ] Test: Vector + metadata search integration
- [ ] Test: Filter by content type integration
- [ ] Test: Pagination integration

**Status:** Not Started

---

### Day 3: HealthScoreCalculator - Part 1 (Security & Performance)

**Files to Create:**
- `src/main/health/HealthScoreCalculator.ts`
- `src/main/health/types.ts`
- `tests/unit/health/health-calculator.test.ts`

**Backend Tasks:**
- [ ] Create HealthScoreCalculator class
- [ ] Define HealthBreakdown interface
- [ ] Define FactorScore interface
- [ ] Implement constructor with dependencies
- [ ] Implement calculateScore() method signature
- [ ] Implement checkSecurity() - SSL, updates, PHP
- [ ] Implement checkPerformance() - caching, optimization

**Unit Tests:**
- [ ] Test: calculateScore() returns HealthBreakdown
- [ ] Test: checkSecurity() detects SSL
- [ ] Test: checkSecurity() detects plugin updates
- [ ] Test: checkSecurity() checks PHP version
- [ ] Test: checkSecurity() checks security plugins
- [ ] Test: checkPerformance() checks PHP version
- [ ] Test: checkPerformance() detects caching
- [ ] Test: checkPerformance() detects image optimization

**Status:** Not Started

---

### Day 4: HealthScoreCalculator - Part 2 (Maintenance, Activity, Stability)

**Backend Tasks:**
- [ ] Implement checkMaintenance() - indexing, disk, backups
- [ ] Implement checkActivity() - events, content freshness
- [ ] Implement checkStability() - failed events, errors
- [ ] Implement generateRecommendations()
- [ ] Implement weighted score calculation
- [ ] Add score caching (5 minute TTL)

**Unit Tests:**
- [ ] Test: checkMaintenance() checks index freshness
- [ ] Test: checkMaintenance() checks disk space
- [ ] Test: checkMaintenance() checks database size
- [ ] Test: checkActivity() checks recent events
- [ ] Test: checkActivity() checks content freshness
- [ ] Test: checkStability() checks failed events
- [ ] Test: generateRecommendations() returns actionable items
- [ ] Test: Weighted average calculation correct
- [ ] Test: Score caching works

**Integration Test:**
- [ ] Create tests/integration/15-health-scoring.integration.test.ts
- [ ] Test: Full health calculation with real data
- [ ] Test: Score updates when site changes
- [ ] Test: Recommendations accurate

**Status:** Not Started

---

### Day 5: FilterEngine + QueryStorage

**Files to Create:**
- `src/main/search/FilterEngine.ts`
- `src/main/search/QueryStorage.ts`
- `tests/unit/search/filter-engine.test.ts`
- `tests/unit/search/query-storage.test.ts`

**Backend Tasks - FilterEngine:**
- [ ] Create FilterEngine class
- [ ] Define SmartFilter interface
- [ ] Define FilterQuery interface
- [ ] Implement getFilterCounts()
- [ ] Implement applyFilter()
- [ ] Implement filterSecurityUpdates()
- [ ] Implement filterOutdatedPHP()
- [ ] Implement filterNoSSL()
- [ ] Implement filterNotIndexed()
- [ ] Implement filterLargeDatabases()
- [ ] Implement filterLowDisk()
- [ ] Implement filterNoRecentEvents()
- [ ] Implement filterLowHealth()

**Backend Tasks - QueryStorage:**
- [ ] Create QueryStorage class
- [ ] Define SavedQuery interface
- [ ] Implement save() method
- [ ] Implement update() method
- [ ] Implement delete() method
- [ ] Implement list() method
- [ ] Implement get() method
- [ ] Implement load() from disk
- [ ] Implement persist() to disk
- [ ] Implement generateId() helper

**Unit Tests - FilterEngine:**
- [ ] Test: getFilterCounts() returns all filters
- [ ] Test: filterSecurityUpdates() correct sites
- [ ] Test: filterOutdatedPHP() correct sites
- [ ] Test: filterNoSSL() correct sites
- [ ] Test: filterNotIndexed() correct sites
- [ ] Test: filterLargeDatabases() correct sites
- [ ] Test: filterLowHealth() correct sites
- [ ] Test: applyFilter() handles unknown filter ID

**Unit Tests - QueryStorage:**
- [ ] Test: save() creates new query
- [ ] Test: update() modifies query
- [ ] Test: delete() removes query
- [ ] Test: list() sorted by pinned
- [ ] Test: persist() writes to disk
- [ ] Test: load() reads from disk
- [ ] Test: generateId() unique IDs

**Integration Tests:**
- [ ] Create tests/integration/16-smart-filters.integration.test.ts
- [ ] Test: Each filter returns correct sites
- [ ] Test: Filter counts accurate
- [ ] Create tests/integration/17-saved-queries.integration.test.ts
- [ ] Test: Save/load/update/delete flow
- [ ] Test: Query execution
- [ ] Test: Result count caching

**IPC Handlers:**
- [ ] Register nexus-ai:search:unified
- [ ] Register nexus-ai:filters:get-counts
- [ ] Register nexus-ai:filters:apply
- [ ] Register nexus-ai:health:get-score
- [ ] Register nexus-ai:health:get-all-scores
- [ ] Register nexus-ai:queries:list
- [ ] Register nexus-ai:queries:create
- [ ] Register nexus-ai:queries:update
- [ ] Register nexus-ai:queries:delete
- [ ] Register nexus-ai:queries:run

**Status:** Not Started

---

## Week 2: UI Components (Days 6-10)

### Day 6: UnifiedSearchPanel - Part 1

**Files to Create:**
- `src/renderer/components/UnifiedSearchPanel.tsx`
- `tests/unit/renderer/UnifiedSearchPanel.test.tsx`

**Component Tasks:**
- [ ] Create UnifiedSearchPanel class component
- [ ] Define UnifiedSearchPanelProps interface
- [ ] Define UnifiedSearchPanelState interface
- [ ] Implement constructor with initial state
- [ ] Implement componentDidMount()
- [ ] Implement componentWillUnmount()
- [ ] Add search input with debounce (300ms)
- [ ] Add advanced filters toggle
- [ ] Add content type checkboxes

**Rendering Methods:**
- [ ] Implement renderSearchInput()
- [ ] Implement renderAdvancedFilters()
- [ ] Implement renderResultsList()
- [ ] Implement renderResult() - single result
- [ ] Implement renderPagination()
- [ ] Implement renderEmptyState()
- [ ] Implement renderLoadingState()
- [ ] Implement renderErrorState()

**Unit Tests:**
- [ ] Test: Renders search input
- [ ] Test: Debounces search input (300ms)
- [ ] Test: Shows/hides advanced filters
- [ ] Test: Content type filters update state
- [ ] Test: Renders results list
- [ ] Test: Shows empty state for no results

**Status:** Not Started

---

### Day 7: UnifiedSearchPanel - Part 2 + SmartFiltersPanel

**Component Tasks - UnifiedSearchPanel:**
- [ ] Implement handleSearch() method
- [ ] Implement handleFilterChange() method
- [ ] Implement handleResultClick() method
- [ ] Implement handleSaveQuery() method
- [ ] Add IPC call to nexus-ai:search:unified
- [ ] Add result type icons (post, plugin, theme, user)
- [ ] Add relevance score display
- [ ] Add "Save Query" button
- [ ] Style component with CSS-in-JS

**Unit Tests - UnifiedSearchPanel:**
- [ ] Test: handleSearch() calls IPC
- [ ] Test: Filters apply correctly
- [ ] Test: Result click fires callback
- [ ] Test: Save query button works
- [ ] Test: Loading state shows during search
- [ ] Test: Error state shows on failure

**Files to Create:**
- `src/renderer/components/SmartFiltersPanel.tsx`
- `tests/unit/renderer/SmartFiltersPanel.test.tsx`

**Component Tasks - SmartFiltersPanel:**
- [ ] Create SmartFiltersPanel class component
- [ ] Define SmartFiltersPanelProps interface
- [ ] Define SmartFiltersPanelState interface
- [ ] Implement fetchFilterCounts() method
- [ ] Implement handleFilterClick() method
- [ ] Add auto-refresh (60s interval)
- [ ] Render filter categories
- [ ] Render filter buttons with counts
- [ ] Color-code by severity
- [ ] Style component

**Unit Tests - SmartFiltersPanel:**
- [ ] Test: Renders filter categories
- [ ] Test: Renders filter buttons with counts
- [ ] Test: Filter click fires callback
- [ ] Test: Auto-refresh updates counts
- [ ] Test: Color-coded by severity
- [ ] Test: Loading state

**Status:** Not Started

---

### Day 8: SavedQueriesPanel + SiteHealthBadge

**Files to Create:**
- `src/renderer/components/SavedQueriesPanel.tsx`
- `tests/unit/renderer/SavedQueriesPanel.test.tsx`
- `src/renderer/components/SiteHealthBadge.tsx`
- `tests/unit/renderer/SiteHealthBadge.test.tsx`

**Component Tasks - SavedQueriesPanel:**
- [ ] Create SavedQueriesPanel class component
- [ ] Define SavedQueriesPanelProps interface
- [ ] Define SavedQueriesPanelState interface
- [ ] Implement fetchQueries() method
- [ ] Implement handleCreateQuery() method
- [ ] Implement handleEditQuery() method
- [ ] Implement handleDeleteQuery() method
- [ ] Implement handleRunQuery() method
- [ ] Implement handlePinQuery() method
- [ ] Render query list
- [ ] Render "New Query" button
- [ ] Render edit/delete actions
- [ ] Style component

**Unit Tests - SavedQueriesPanel:**
- [ ] Test: Renders query list
- [ ] Test: Create query calls IPC
- [ ] Test: Edit query updates state
- [ ] Test: Delete query removes from list
- [ ] Test: Run query fires callback
- [ ] Test: Pin query moves to top
- [ ] Test: Empty state when no queries

**Component Tasks - SiteHealthBadge:**
- [ ] Create SiteHealthBadge class component
- [ ] Define SiteHealthBadgeProps interface
- [ ] Define SiteHealthBadgeState interface
- [ ] Implement fetchScore() method
- [ ] Implement renderBadge() method
- [ ] Implement renderBreakdown() modal
- [ ] Color-code by score (green/yellow/red)
- [ ] Add icons (checkmark, warning, error)
- [ ] Add tooltip with top issues
- [ ] Style component with size variants

**Unit Tests - SiteHealthBadge:**
- [ ] Test: Renders badge with score
- [ ] Test: Color-coded correctly (green 80+, yellow 50-79, red <50)
- [ ] Test: Click shows breakdown modal
- [ ] Test: Breakdown shows 5 factors
- [ ] Test: Shows recommendations
- [ ] Test: Loading state
- [ ] Test: Error state
- [ ] Test: Size variants (small, medium, large)

**Status:** Not Started

---

### Day 9: FleetOverview Integration

**Files to Modify:**
- `src/renderer/components/FleetOverview.tsx`

**Integration Tasks:**
- [ ] Import UnifiedSearchPanel
- [ ] Import SmartFiltersPanel
- [ ] Import SavedQueriesPanel
- [ ] Import SiteHealthBadge
- [ ] Update renderSearchTab() method
- [ ] Add 2-column layout (search + sidebar)
- [ ] Add SmartFiltersPanel to sidebar
- [ ] Add SavedQueriesPanel to sidebar
- [ ] Wire up filter click handler
- [ ] Wire up query run handler
- [ ] Wire up search result click handler

**Sites Tab Enhancements:**
- [ ] Add SiteHealthBadge to each site row
- [ ] Add "Sort by Health" option
- [ ] Add "Filter by Health Range" option
- [ ] Update site list rendering

**Testing:**
- [ ] Test Search tab layout
- [ ] Test sidebar components render
- [ ] Test filter clicks apply to search
- [ ] Test saved query execution
- [ ] Test health badges in site list
- [ ] Test tab navigation preserves state

**Status:** Not Started

---

### Day 10: E2E Tests, Polish & Documentation

**E2E Tests:**
- [ ] Create tests/e2e/21-unified-search.e2e.test.ts
- [ ] Test: Type search query, see results
- [ ] Test: Apply content type filter
- [ ] Test: Click smart filter, results update
- [ ] Test: Save query appears in list
- [ ] Test: Run saved query loads results
- [ ] Test: Pagination works
- [ ] Create tests/e2e/22-health-scores.e2e.test.ts
- [ ] Test: Health badges appear in site list
- [ ] Test: Click badge shows breakdown
- [ ] Test: Breakdown shows factors and recommendations
- [ ] Test: Health score changes when site updated

**Manual Testing:**
- [ ] Run full manual testing checklist
- [ ] Test with 5+ sites
- [ ] Test with 0 indexed sites (edge case)
- [ ] Test with no search results
- [ ] Test with 100+ search results (pagination)
- [ ] Test health scores for various site states
- [ ] Test saved query persistence (restart Local)

**UI Polish:**
- [ ] Add loading animations
- [ ] Add result hover states
- [ ] Add filter active states
- [ ] Add health badge animations
- [ ] Polish empty states
- [ ] Polish error messages
- [ ] Add keyboard navigation (search input focus)
- [ ] Add accessibility labels (ARIA)

**Error Handling:**
- [ ] Handle IPC errors gracefully
- [ ] Handle network timeouts
- [ ] Handle malformed responses
- [ ] Add retry logic for failed requests
- [ ] Show user-friendly error messages

**Documentation:**
- [ ] Create docs/implementation-notes/sprint-2-completion.md
- [ ] Update README with search features
- [ ] Add screenshots to docs
- [ ] Document health score calculation
- [ ] Document smart filter logic
- [ ] Update user guide

**Final Review:**
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] All E2E tests passing
- [ ] No console errors
- [ ] No TypeScript errors
- [ ] Code coverage >80%
- [ ] Manual testing checklist 100%

**Status:** Not Started

---

## Constants & Types

**Add to src/common/constants.ts:**
- [ ] SEARCH_UNIFIED channel
- [ ] FILTERS_GET_COUNTS channel
- [ ] FILTERS_APPLY channel
- [ ] HEALTH_GET_SCORE channel
- [ ] HEALTH_GET_ALL_SCORES channel
- [ ] QUERIES_LIST channel
- [ ] QUERIES_CREATE channel
- [ ] QUERIES_UPDATE channel
- [ ] QUERIES_DELETE channel
- [ ] QUERIES_RUN channel

**Add to src/common/types.ts:**
- [ ] SearchResult interface
- [ ] SearchFilters interface
- [ ] SearchResults interface
- [ ] SearchFacets interface
- [ ] SmartFilter interface
- [ ] SavedQuery interface
- [ ] HealthBreakdown interface

---

## GraphService Extensions

**Add to src/main/events/GraphService.ts:**
- [ ] searchPlugins(query: string) method
- [ ] searchThemes(query: string) method
- [ ] searchUsers(query: string) method
- [ ] getPlugins(siteId: string) method
- [ ] getRecentContent(siteId: string, days: number) method

---

## Dependencies

**No new npm packages required** - all functionality uses existing dependencies:
- VectorStore (LanceDB)
- GraphService (better-sqlite3)
- EmbeddingService (ONNX Runtime)
- LocalServicesBridge (Local APIs)

---

## Acceptance Criteria Summary

**Backend:**
- [x] SearchService searches all sites
- [x] HealthScoreCalculator calculates 0-100 scores
- [x] FilterEngine evaluates 8+ smart filters
- [x] QueryStorage persists queries to disk
- [x] All IPC handlers registered

**Frontend:**
- [x] UnifiedSearchPanel renders and searches
- [x] SmartFiltersPanel shows filter counts
- [x] SavedQueriesPanel manages queries
- [x] SiteHealthBadge displays scores
- [x] FleetOverview integrates all components

**Testing:**
- [x] 60+ unit tests passing
- [x] 15+ integration tests passing
- [x] 5+ E2E tests passing
- [x] Manual testing checklist 100%

**Quality:**
- [x] Zero console errors
- [x] Zero TypeScript errors
- [x] Code coverage >80%
- [x] Search results <1s
- [x] Health calculation <2s per site

---

## Daily Standup Format

**What did we complete yesterday?**
- List completed tasks

**What are we working on today?**
- Current day's focus

**Any blockers?**
- Technical issues
- Dependency problems
- Unclear requirements

---

**Sprint 2 Status:** 🟡 Not Started
**Next Review:** End of Day 1
**Last Updated:** 2026-03-05
