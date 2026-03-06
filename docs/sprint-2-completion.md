# Sprint 2 Completion: Easy Fleet Discovery

## Summary

Sprint 2 delivers a complete fleet discovery system with unified search, smart filters,
health scoring, and saved queries across all WordPress sites.

## What Was Built

### Backend Services (4 new modules)

| Service | File | Purpose |
|---------|------|---------|
| SearchService | `src/main/search/SearchService.ts` | Cross-site vector + metadata search with facets, pagination, sorting |
| HealthScoreCalculator | `src/main/health/HealthScoreCalculator.ts` | 5-factor weighted health scoring (0-100) |
| FilterEngine | `src/main/search/FilterEngine.ts` | 8 pre-built smart filters for fleet-wide filtering |
| QueryStorage | `src/main/search/QueryStorage.ts` | JSON file-based saved query persistence |

### Health Score Formula

Weighted average of 5 factors:
- **Security (30%)**: Plugin updates, PHP version, SSL status
- **Performance (25%)**: Total plugins, database size
- **Maintenance (20%)**: Index staleness, last indexed age
- **Activity (15%)**: Recent content activity from graph events
- **Stability (10%)**: Error rate from event processing

### Smart Filters (8 pre-built)

| Filter ID | Category | Description |
|-----------|----------|-------------|
| security-updates | Security | Plugins with available updates |
| outdated-php | Security | Sites running PHP < 8.0 |
| no-ssl | Security | Sites without SSL |
| not-indexed | Maintenance | Sites not yet indexed |
| large-db | Maintenance | Database > 500MB |
| low-disk | Maintenance | Disk usage > 80% |
| no-events | Activity | No events in 7 days |
| low-health | Health | Health score < 50 |

### Frontend Components (4 new)

| Component | File | Description |
|-----------|------|-------------|
| UnifiedSearchPanel | `src/renderer/components/UnifiedSearchPanel.tsx` | Debounced search with content type filters and pagination |
| SmartFiltersPanel | `src/renderer/components/SmartFiltersPanel.tsx` | Categorized filter buttons with severity-coded count badges |
| SiteHealthBadge | `src/renderer/components/SiteHealthBadge.tsx` | Circular color-coded health score badge (green/yellow/red) |
| SavedQueriesPanel | `src/renderer/components/SavedQueriesPanel.tsx` | Create, run, pin, and delete saved search queries |

### IPC Channels (10 new)

- `SEARCH_UNIFIED` - Cross-site search
- `FILTERS_GET_COUNTS` - Smart filter counts
- `FILTERS_APPLY` - Apply a filter
- `HEALTH_GET_SCORE` - Single site health score
- `HEALTH_GET_ALL_SCORES` - All sites health scores
- `QUERIES_LIST` - List saved queries
- `QUERIES_CREATE` - Create saved query
- `QUERIES_UPDATE` - Update saved query
- `QUERIES_DELETE` - Delete saved query
- `QUERIES_RUN` - Run saved query

### Integration

- **Search tab**: Replaced basic search with 2-column layout (search left, filters + saved queries right)
- **Sites tab**: Added Health column with SiteHealthBadge for each site

## Test Coverage

| Test Suite | Tests | Status |
|------------|-------|--------|
| SearchService | 10 | Pass |
| HealthScoreCalculator | 15 | Pass |
| FilterEngine | 8 | Pass |
| QueryStorage | 7 | Pass |
| UnifiedSearchPanel | 7 | Pass |
| SmartFiltersPanel | 7 | Pass |
| SiteHealthBadge | 7 | Pass |
| SavedQueriesPanel | 7 | Pass |
| **Total** | **68** | **All passing** |

## Architecture Decisions

- **Class-based React**: All components use React.Component (Local's older React, no hooks)
- **React.createElement**: No JSX, using createElement pattern throughout
- **CSS-in-JS**: Inline styles with TypeScript CSSProperties
- **JSON persistence**: Saved queries stored in JSON file (not SQLite) for simplicity
- **Weighted scoring**: Health uses configurable factor weights for flexibility
- **Parallel search**: Vector and metadata searches run concurrently

## Files Changed

- 5 modified files (constants, types, ipc-handlers, FleetOverview, search-service test)
- 14 new files (4 services, 4 components, 4 renderer tests, 2 backend tests)
- 4,183 lines added
