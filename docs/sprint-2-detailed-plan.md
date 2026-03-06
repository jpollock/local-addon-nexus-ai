# Sprint 2: Easy Fleet Discovery - Detailed Design & Plan

**Sprint Goal:** Make fleet-wide discovery and filtering effortless

**Timeline:** 2 weeks
**Aha Moment Delivered:** #6 (Instant Fleet Intelligence)
**Current Date:** 2026-03-05

---

## Executive Summary

### What We're Building

A powerful search and discovery system that makes it trivial to find information across your entire WordPress fleet. Users will be able to:

1. **Unified Search** - Search across all sites, all content types in one interface
2. **Smart Filters** - Pre-built filters for common queries ("outdated plugins", "no recent backups")
3. **Saved Queries** - Save and reuse custom searches
4. **Site Health Scores** - 0-100 scores based on multiple health factors

### Why This Matters

**Current Problem:**
- Users have to click into each site individually to check plugin status, PHP version, etc.
- No fleet-wide view of "which sites need attention?"
- Common questions like "which sites are running PHP 7.4?" require manual checking

**After Sprint 2:**
- "Show me sites with security updates" → instant filtered list
- "Which sites haven't been indexed in 7+ days?" → one click
- Save "My Client Sites" filter → reuse weekly
- See site health scores at a glance (95, 82, 67)

---

## Architecture Overview

### Data Flow

```
User types search query
       ↓
SearchService (new) → VectorStore + GraphService
       ↓
Results aggregated and ranked
       ↓
FilterEngine (new) → Apply smart filters
       ↓
ResultsPanel → Display with actions
```

### What Exists Today

**Backend (✅ Available):**
- `VectorStore` - Semantic search across site content
- `GraphService` - Site metadata (plugins, themes, users, posts)
- `IndexRegistry` - Indexing status per site
- `LocalServicesBridge` - Site status, PHP version, disk usage

**Frontend (⚠️ Partial):**
- `FleetOverview` - Basic site list
- Search tab exists but limited (vector search only, single-site)

### What We Need to Build

**Backend (New Services):**
1. `SearchService` - Unified search across all data sources
2. `FilterEngine` - Smart filter evaluation
3. `HealthScoreCalculator` - Site health scoring logic
4. `QueryStorage` - Save/load user queries

**Data Layer (GraphService Extensions):**
1. `searchFleet(query)` - Cross-site search
2. `getSiteHealth(siteId)` - Health metrics per site
3. `getFleetSummary()` - Aggregate fleet stats

**Frontend (New Components):**
1. `UnifiedSearchPanel` - Main search interface
2. `SmartFiltersPanel` - Pre-built filter buttons
3. `SavedQueriesPanel` - Manage saved searches
4. `SiteHealthBadge` - Health score visualization
5. Enhanced `FleetOverview` - Integrate search features

---

## Component Designs

### 1. UnifiedSearchPanel Component

**Purpose:** Single search box for fleet-wide discovery

**UI Design:**
```
┌─────────────────────────────────────────────────────────┐
│ 🔍 Search across all sites...                          │
│                                                          │
│ [Advanced ▼]                                            │
│   ☐ Posts & Pages    ☐ Plugins    ☐ Themes             │
│   ☐ Users            ☐ Site Settings                    │
│                                                          │
│ Results (23 across 5 sites):                            │
│                                                          │
│ 📄 "How to Use ACF" - my-site.local            Score 95 │
│    Post • Last updated 2 days ago                       │
│    Preview: Advanced Custom Fields are powerful...      │
│                                                          │
│ 🔌 akismet/akismet.php - demo.local            Score 88 │
│    Plugin • Version 5.2 • Active                        │
│    Akismet Anti-spam protects your site...              │
│                                                          │
│ [Load More...]                          [Save Query →]  │
└─────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface UnifiedSearchPanelProps {
  electron: any;
  initialQuery?: string;
  onResultClick?: (result: SearchResult) => void;
}
```

**State:**
```typescript
interface UnifiedSearchPanelState {
  query: string;
  results: SearchResult[];
  filters: SearchFilters;
  loading: boolean;
  error: string | null;
  totalResults: number;
}

interface SearchResult {
  type: 'post' | 'plugin' | 'theme' | 'user' | 'setting';
  siteId: string;
  siteName: string;
  siteHealth: number;        // 0-100
  title: string;
  excerpt: string;
  metadata: Record<string, any>;
  score: number;             // Relevance score
  lastUpdated: number;
}

interface SearchFilters {
  contentTypes: string[];    // ['post', 'plugin', ...]
  siteIds: string[];         // Specific sites
  dateRange?: {
    start: number;
    end: number;
  };
  healthMin?: number;        // Minimum health score
}
```

**Key Features:**
- Debounced search (300ms)
- Result type icons (📄 post, 🔌 plugin, 🎨 theme, 👤 user)
- Relevance scoring (vector similarity + metadata boost)
- Expandable advanced filters
- "Save Query" button
- Pagination (20 results per page)

**IPC Calls:**
- `nexus-ai:search:unified` → { results: SearchResult[], total: number }

**File Location:** `src/renderer/components/UnifiedSearchPanel.tsx`

---

### 2. SmartFiltersPanel Component

**Purpose:** One-click filters for common fleet queries

**UI Design:**
```
┌─────────────────────────────────────────────────────────┐
│ Smart Filters                                           │
├─────────────────────────────────────────────────────────┤
│ Security & Updates:                                     │
│  [3 Security Updates]  [2 Outdated PHP]  [1 No SSL]    │
│                                                          │
│ Maintenance:                                            │
│  [5 Not Indexed]  [2 Large Databases]  [1 Low Disk]    │
│                                                          │
│ Activity:                                               │
│  [4 No Events (7d)]  [2 Stale Content]  [3 High Load]  │
│                                                          │
│ Health Scores:                                          │
│  [2 Critical (<50)]  [3 Warning (50-80)]  [8 Good]     │
└─────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface SmartFiltersPanelProps {
  electron: any;
  onFilterClick: (filter: SmartFilter) => void;
}
```

**State:**
```typescript
interface SmartFiltersPanelState {
  filters: SmartFilter[];
  loading: boolean;
  error: string | null;
}

interface SmartFilter {
  id: string;
  category: 'security' | 'maintenance' | 'activity' | 'health';
  label: string;
  description: string;
  count: number;             // Sites matching
  query: FilterQuery;        // Actual filter logic
  severity: 'info' | 'warning' | 'error';
}

interface FilterQuery {
  type: 'plugin_updates' | 'php_version' | 'ssl_missing' | 'not_indexed' |
        'disk_usage' | 'no_events' | 'health_score' | 'large_db';
  params?: Record<string, any>;
}
```

**Pre-built Filters:**

1. **Security Updates Available**
   - Check: Plugin updates available via WP-CLI
   - Action: Show sites with `wp plugin list --update=available`

2. **Outdated PHP**
   - Check: PHP version < 8.0
   - Action: Show sites, link to upgrade docs

3. **No SSL Certificate**
   - Check: Sites without HTTPS
   - Action: Show sites, offer "Trust SSL" bulk action

4. **Not Indexed**
   - Check: IndexRegistry shows never indexed OR >7 days old
   - Action: Show sites, offer "Reindex All" bulk action

5. **Large Databases**
   - Check: MySQL database > 1 GB
   - Action: Show sites, link to optimization guide

6. **Low Disk Space**
   - Check: Disk usage > 90%
   - Action: Show sites, offer cleanup actions

7. **No Recent Events**
   - Check: GraphService shows no events in last 7 days
   - Action: Show sites, check if plugin installed

8. **Health Score < 50**
   - Check: Site health score calculation
   - Action: Show sites with breakdown

**Key Features:**
- Auto-refresh counts every 60s
- Click filter → apply to search results
- Color-coded by severity (red errors, yellow warnings, blue info)
- Badge counts update in real-time

**IPC Calls:**
- `nexus-ai:filters:get-counts` → { filters: SmartFilter[] }
- `nexus-ai:filters:apply` (filterId, params) → { siteIds: string[] }

**File Location:** `src/renderer/components/SmartFiltersPanel.tsx`

---

### 3. SavedQueriesPanel Component

**Purpose:** Save and manage custom searches

**UI Design:**
```
┌─────────────────────────────────────────────────────────┐
│ Saved Queries                              [+ New]      │
├─────────────────────────────────────────────────────────┤
│ 📌 My Client Sites (5 sites)                 [Run] [✎] │
│    Filter: tag="client" AND health > 80                 │
│    Last run: 2 hours ago                                │
│                                                          │
│ 📌 Security Review (3 sites)                 [Run] [✎] │
│    Filter: updates_available > 0 OR php < 8.0          │
│    Last run: Yesterday                                  │
│                                                          │
│ 📌 WooCommerce Sites (2 sites)               [Run] [✎] │
│    Filter: plugin="woocommerce"                         │
│    Last run: 3 days ago                                 │
└─────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface SavedQueriesPanelProps {
  electron: any;
  onQueryRun: (query: SavedQuery) => void;
}
```

**State:**
```typescript
interface SavedQueriesPanelState {
  queries: SavedQuery[];
  editing: string | null;    // Query ID being edited
  loading: boolean;
  error: string | null;
}

interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  filters: SearchFilters;
  createdAt: number;
  lastRun: number | null;
  resultCount: number;       // Cache last count
  pinned: boolean;
}
```

**Key Features:**
- Create new query from current search
- Edit saved queries (name, filters)
- Pin favorites to top
- Delete queries
- Show last run time
- Show cached result count
- Export/import queries (JSON)

**IPC Calls:**
- `nexus-ai:queries:list` → SavedQuery[]
- `nexus-ai:queries:create` (query) → SavedQuery
- `nexus-ai:queries:update` (id, changes) → SavedQuery
- `nexus-ai:queries:delete` (id) → { success: boolean }
- `nexus-ai:queries:run` (id) → { results: SearchResult[] }

**File Location:** `src/renderer/components/SavedQueriesPanel.tsx`

---

### 4. SiteHealthBadge Component

**Purpose:** Visual health score indicator

**UI Design:**
```
┌──────────┐  ┌──────────┐  ┌──────────┐
│  ✓ 95    │  │  ⚠ 68    │  │  ✗ 42    │
│  Good    │  │  Warning │  │  Critical│
└──────────┘  └──────────┘  └──────────┘
   Green         Yellow        Red
```

**Props:**
```typescript
interface SiteHealthBadgeProps {
  siteId: string;
  score?: number;            // If not provided, fetch it
  showLabel?: boolean;       // Show "Good", "Warning", etc.
  size?: 'small' | 'medium' | 'large';
  onClick?: () => void;      // Show health breakdown
}
```

**State:**
```typescript
interface SiteHealthBadgeState {
  score: number | null;
  breakdown: HealthBreakdown | null;
  loading: boolean;
  error: string | null;
}

interface HealthBreakdown {
  overall: number;           // 0-100
  factors: {
    security: number;        // SSL, updates available
    performance: number;     // PHP version, caching
    maintenance: number;     // Last indexed, disk space
    activity: number;        // Recent events, content freshness
    stability: number;       // Failed events, error logs
  };
  issues: string[];          // Human-readable issues
  recommendations: string[]; // Action items
}
```

**Score Calculation:**
```typescript
Health Score = (
  Security * 0.30 +
  Performance * 0.25 +
  Maintenance * 0.20 +
  Activity * 0.15 +
  Stability * 0.10
)

Security (30%):
  - SSL enabled: +30
  - No plugin updates: +20 (or -20 if updates available)
  - PHP 8.0+: +20 (7.x: +10, <7: 0)
  - Strong passwords: +15
  - Security plugin active: +15

Performance (25%):
  - PHP 8.1+: +25 (8.0: +20, 7.4: +10, <7.4: 0)
  - Object caching enabled: +25
  - CDN configured: +20
  - Image optimization: +15
  - Database optimized: +15

Maintenance (20%):
  - Indexed recently (<7d): +20
  - Disk space <70%: +20
  - Database size reasonable: +20
  - Backup exists (<24h): +20
  - WordPress core updated: +20

Activity (15%):
  - Events in last 7d: +15
  - Content updated recently: +15
  - Active users: +10
  - No stale content (>180d): +10

Stability (10%):
  - No failed events: +10
  - No PHP errors logged: +10
  - Uptime 99%+: +10
  - No plugin conflicts: +10
```

**Key Features:**
- Click to expand breakdown
- Tooltip shows top 3 issues
- Color-coded (green 80+, yellow 50-79, red <50)
- Animation when score changes
- Cache scores (refresh every 5 minutes)

**IPC Calls:**
- `nexus-ai:health:get-score` (siteId) → HealthBreakdown

**File Location:** `src/renderer/components/SiteHealthBadge.tsx`

---

### 5. Enhanced FleetOverview Integration

**Changes to FleetOverview.tsx:**

**New Tab Layout:**
```
Overview | Search | Sites | Visibility | Saved Queries
           ^^^^^
       (Enhanced)
```

**Search Tab Structure:**
```typescript
renderSearchTab() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px' }}>
      {/* Left: Main search */}
      <div>
        <UnifiedSearchPanel electron={this.props.electron} />
      </div>

      {/* Right: Filters + Saved Queries */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <SmartFiltersPanel
          electron={this.props.electron}
          onFilterClick={this.applySmartFilter}
        />
        <SavedQueriesPanel
          electron={this.props.electron}
          onQueryRun={this.runSavedQuery}
        />
      </div>
    </div>
  );
}
```

**Sites Tab Enhancements:**
- Add `SiteHealthBadge` to each site row
- Sortable by health score
- Filter by health range

**File Changes:** `src/renderer/components/FleetOverview.tsx` (modify existing)

---

## Backend Implementation

### SearchService (New)

**File:** `src/main/search/SearchService.ts`

**Purpose:** Unified search orchestration across all data sources

**Class Design:**
```typescript
export class SearchService {
  constructor(
    private vectorStore: VectorStore,
    private graphService: GraphService,
    private embeddingService: EmbeddingService,
    private indexRegistry: IndexRegistry
  ) {}

  /**
   * Search across all sites and content types
   */
  async searchFleet(
    query: string,
    filters?: SearchFilters,
    options?: SearchOptions
  ): Promise<SearchResults> {
    // 1. Generate query embedding
    const [queryVector] = await this.embeddingService.embedBatch([query]);

    // 2. Vector search across all indexed sites
    const vectorResults = await this.searchAllSites(queryVector, filters);

    // 3. Metadata search in GraphService (plugins, themes, users)
    const metadataResults = await this.searchMetadata(query, filters);

    // 4. Merge and rank results
    const merged = this.mergeResults(vectorResults, metadataResults);

    // 5. Apply filters
    const filtered = this.applyFilters(merged, filters);

    // 6. Sort by relevance
    const sorted = this.sortByRelevance(filtered, options?.sortBy);

    return {
      results: sorted.slice(0, options?.limit || 20),
      total: sorted.length,
      facets: this.computeFacets(sorted),
    };
  }

  /**
   * Search vector store across all sites
   */
  private async searchAllSites(
    queryVector: number[],
    filters?: SearchFilters
  ): Promise<VectorResult[]> {
    const indexedSites = this.indexRegistry.listAll()
      .filter(e => e.state === 'indexed');

    const results: VectorResult[] = [];

    for (const entry of indexedSites) {
      if (filters?.siteIds && !filters.siteIds.includes(entry.siteId)) {
        continue;
      }

      const siteResults = await this.vectorStore.search(
        entry.siteId,
        queryVector,
        { limit: 10 }
      );

      results.push(...siteResults.map(r => ({
        ...r,
        siteId: entry.siteId,
        siteName: entry.siteName,
        type: 'post' as const,
      })));
    }

    return results;
  }

  /**
   * Search metadata (plugins, themes, users)
   */
  private async searchMetadata(
    query: string,
    filters?: SearchFilters
  ): Promise<MetadataResult[]> {
    const results: MetadataResult[] = [];

    // Search plugins by name/slug
    if (!filters?.contentTypes || filters.contentTypes.includes('plugin')) {
      const plugins = await this.graphService.searchPlugins(query);
      results.push(...plugins);
    }

    // Search themes
    if (!filters?.contentTypes || filters.contentTypes.includes('theme')) {
      const themes = await this.graphService.searchThemes(query);
      results.push(...themes);
    }

    // Search users
    if (!filters?.contentTypes || filters.contentTypes.includes('user')) {
      const users = await this.graphService.searchUsers(query);
      results.push(...users);
    }

    return results;
  }

  /**
   * Compute result facets (for filtering UI)
   */
  private computeFacets(results: SearchResult[]): SearchFacets {
    return {
      types: this.countByType(results),
      sites: this.countBySite(results),
      healthRanges: this.countByHealthRange(results),
    };
  }
}
```

**New Types:**
```typescript
export interface SearchFilters {
  contentTypes?: string[];
  siteIds?: string[];
  dateRange?: { start: number; end: number };
  healthMin?: number;
  healthMax?: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'relevance' | 'date' | 'health' | 'title';
}

export interface SearchResults {
  results: SearchResult[];
  total: number;
  facets: SearchFacets;
}

export interface SearchFacets {
  types: Record<string, number>;
  sites: Record<string, number>;
  healthRanges: {
    critical: number;  // 0-49
    warning: number;   // 50-79
    good: number;      // 80-100
  };
}
```

---

### HealthScoreCalculator (New)

**File:** `src/main/health/HealthScoreCalculator.ts`

**Purpose:** Calculate site health scores

**Class Design:**
```typescript
export class HealthScoreCalculator {
  constructor(
    private graphService: GraphService,
    private localServicesBridge: LocalServicesBridge,
    private indexRegistry: IndexRegistry
  ) {}

  /**
   * Calculate comprehensive health score for a site
   */
  async calculateScore(siteId: string): Promise<HealthBreakdown> {
    const site = this.localServicesBridge.getSite(siteId);
    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    // Parallel health checks
    const [security, performance, maintenance, activity, stability] =
      await Promise.all([
        this.checkSecurity(site),
        this.checkPerformance(site),
        this.checkMaintenance(site),
        this.checkActivity(site),
        this.checkStability(site),
      ]);

    // Weighted average
    const overall = Math.round(
      security.score * 0.30 +
      performance.score * 0.25 +
      maintenance.score * 0.20 +
      activity.score * 0.15 +
      stability.score * 0.10
    );

    return {
      overall,
      factors: {
        security: security.score,
        performance: performance.score,
        maintenance: maintenance.score,
        activity: activity.score,
        stability: stability.score,
      },
      issues: [
        ...security.issues,
        ...performance.issues,
        ...maintenance.issues,
        ...activity.issues,
        ...stability.issues,
      ],
      recommendations: this.generateRecommendations(overall, {
        security,
        performance,
        maintenance,
        activity,
        stability,
      }),
    };
  }

  /**
   * Security check (SSL, updates, PHP version)
   */
  private async checkSecurity(site: any): Promise<FactorScore> {
    let score = 0;
    const issues: string[] = [];

    // SSL check
    if (site.domain?.startsWith('https://')) {
      score += 30;
    } else {
      issues.push('No SSL certificate');
    }

    // Plugin updates check (requires WP-CLI call)
    try {
      const updates = await this.localServicesBridge.getPluginUpdates(site.id);
      if (updates.length === 0) {
        score += 20;
      } else {
        issues.push(`${updates.length} plugin update(s) available`);
      }
    } catch {
      // Can't check if site not running
    }

    // PHP version check
    const phpVersion = site.phpVersion || '7.4';
    if (phpVersion >= '8.1') {
      score += 20;
    } else if (phpVersion >= '8.0') {
      score += 15;
    } else if (phpVersion >= '7.4') {
      score += 10;
      issues.push('PHP version outdated (7.4)');
    } else {
      issues.push('PHP version critically outdated (<7.4)');
    }

    // Security plugin check
    const plugins = await this.graphService.getPlugins(site.id);
    const hasSecurityPlugin = plugins.some(p =>
      ['wordfence', 'sucuri', 'ithemes-security'].includes(p.plugin_slug)
    );
    if (hasSecurityPlugin) {
      score += 15;
    } else {
      issues.push('No security plugin installed');
    }

    return { score: Math.min(100, score), issues };
  }

  /**
   * Performance check (caching, PHP version, optimization)
   */
  private async checkPerformance(site: any): Promise<FactorScore> {
    let score = 0;
    const issues: string[] = [];

    // PHP version (performance impact)
    const phpVersion = site.phpVersion || '7.4';
    if (phpVersion >= '8.1') {
      score += 25;
    } else if (phpVersion >= '8.0') {
      score += 20;
    } else if (phpVersion >= '7.4') {
      score += 10;
    }

    // Object caching check (look for Redis/Memcached plugins)
    const plugins = await this.graphService.getPlugins(site.id);
    const hasCaching = plugins.some(p =>
      p.plugin_slug.includes('redis') ||
      p.plugin_slug.includes('memcached') ||
      p.plugin_slug.includes('cache')
    );
    if (hasCaching) {
      score += 25;
    } else {
      issues.push('No object caching configured');
    }

    // Image optimization check
    const hasImageOptimization = plugins.some(p =>
      ['smush', 'ewww-image-optimizer', 'imagify'].includes(p.plugin_slug)
    );
    if (hasImageOptimization) {
      score += 15;
    }

    // Database size check
    const dbSize = await this.localServicesBridge.getDatabaseSize(site.id);
    if (dbSize < 100 * 1024 * 1024) { // <100 MB
      score += 15;
    } else if (dbSize > 1 * 1024 * 1024 * 1024) { // >1 GB
      issues.push('Large database size (>1GB)');
    }

    return { score: Math.min(100, score), issues };
  }

  /**
   * Maintenance check (indexing, backups, disk space)
   */
  private async checkMaintenance(site: any): Promise<FactorScore> {
    let score = 0;
    const issues: string[] = [];

    // Index freshness
    const indexEntry = this.indexRegistry.get(site.id);
    if (indexEntry) {
      const daysSinceIndex = (Date.now() - indexEntry.lastIndexed) / (1000 * 60 * 60 * 24);
      if (daysSinceIndex < 7) {
        score += 20;
      } else if (daysSinceIndex < 30) {
        score += 10;
        issues.push('Site not indexed in >7 days');
      } else {
        issues.push('Site not indexed in >30 days');
      }
    } else {
      issues.push('Site never indexed');
    }

    // Disk space check
    const diskUsage = await this.localServicesBridge.getDiskUsage(site.path);
    if (diskUsage.percent < 70) {
      score += 20;
    } else if (diskUsage.percent < 90) {
      score += 10;
      issues.push('Disk space >70% used');
    } else {
      issues.push('Disk space critically low (>90%)');
    }

    // Database size reasonable
    const dbSize = await this.localServicesBridge.getDatabaseSize(site.id);
    if (dbSize < 500 * 1024 * 1024) { // <500 MB
      score += 20;
    } else if (dbSize < 1 * 1024 * 1024 * 1024) { // <1 GB
      score += 10;
    }

    return { score: Math.min(100, score), issues };
  }

  /**
   * Activity check (recent events, content updates)
   */
  private async checkActivity(site: any): Promise<FactorScore> {
    let score = 0;
    const issues: string[] = [];

    // Recent events check
    const events = await this.graphService.getRecentEvents({
      siteId: site.id,
      limit: 1,
    });
    if (events.length > 0) {
      const daysSinceEvent = (Date.now() - events[0].created_at) / (1000 * 60 * 60 * 24);
      if (daysSinceEvent < 7) {
        score += 15;
      } else if (daysSinceEvent < 30) {
        score += 5;
      } else {
        issues.push('No activity in >30 days');
      }
    } else {
      issues.push('No events tracked');
    }

    // Content freshness
    const recentContent = await this.graphService.getRecentContent(site.id, 30);
    if (recentContent.length > 0) {
      score += 15;
    } else {
      issues.push('No content updates in last 30 days');
    }

    return { score: Math.min(100, score), issues };
  }

  /**
   * Stability check (failed events, errors)
   */
  private async checkStability(site: any): Promise<FactorScore> {
    let score = 100;
    const issues: string[] = [];

    // Failed events check
    const failedEvents = await this.graphService.getRecentEvents({
      siteId: site.id,
      status: 'failed',
      limit: 10,
    });
    if (failedEvents.length === 0) {
      // Keep 100
    } else if (failedEvents.length < 5) {
      score -= 30;
      issues.push(`${failedEvents.length} failed event(s)`);
    } else {
      score -= 50;
      issues.push(`${failedEvents.length} failed events (critical)`);
    }

    return { score: Math.max(0, score), issues };
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(
    overall: number,
    factors: Record<string, FactorScore>
  ): string[] {
    const recommendations: string[] = [];

    // Security recommendations
    if (factors.security.score < 70) {
      recommendations.push('Enable SSL certificate');
      recommendations.push('Update plugins and themes');
      recommendations.push('Install a security plugin (Wordfence, Sucuri)');
    }

    // Performance recommendations
    if (factors.performance.score < 70) {
      recommendations.push('Upgrade to PHP 8.1+');
      recommendations.push('Enable object caching (Redis/Memcached)');
      recommendations.push('Install image optimization plugin');
    }

    // Maintenance recommendations
    if (factors.maintenance.score < 70) {
      recommendations.push('Reindex site content');
      recommendations.push('Free up disk space');
      recommendations.push('Optimize database tables');
    }

    return recommendations.slice(0, 5); // Top 5
  }
}

interface FactorScore {
  score: number;
  issues: string[];
}
```

---

### FilterEngine (New)

**File:** `src/main/search/FilterEngine.ts`

**Purpose:** Evaluate smart filter queries

**Class Design:**
```typescript
export class FilterEngine {
  constructor(
    private graphService: GraphService,
    private healthCalculator: HealthScoreCalculator,
    private indexRegistry: IndexRegistry,
    private localServicesBridge: LocalServicesBridge
  ) {}

  /**
   * Get counts for all smart filters
   */
  async getFilterCounts(): Promise<SmartFilter[]> {
    const allSites = this.localServicesBridge.getAllSites();

    return await Promise.all([
      this.countSecurityUpdates(allSites),
      this.countOutdatedPHP(allSites),
      this.countNoSSL(allSites),
      this.countNotIndexed(allSites),
      this.countLargeDatabases(allSites),
      this.countLowDisk(allSites),
      this.countNoRecentEvents(allSites),
      this.countLowHealth(allSites),
    ]);
  }

  /**
   * Apply a smart filter
   */
  async applyFilter(filterId: string, params?: any): Promise<string[]> {
    switch (filterId) {
      case 'security-updates':
        return this.filterSecurityUpdates();
      case 'outdated-php':
        return this.filterOutdatedPHP();
      case 'no-ssl':
        return this.filterNoSSL();
      case 'not-indexed':
        return this.filterNotIndexed();
      case 'large-db':
        return this.filterLargeDatabases();
      case 'low-disk':
        return this.filterLowDisk();
      case 'no-events':
        return this.filterNoRecentEvents(params?.days || 7);
      case 'low-health':
        return this.filterLowHealth(params?.threshold || 50);
      default:
        throw new Error(`Unknown filter: ${filterId}`);
    }
  }

  private async filterSecurityUpdates(): Promise<string[]> {
    const allSites = this.localServicesBridge.getAllSites();
    const sitesWithUpdates: string[] = [];

    for (const site of allSites) {
      try {
        const plugins = await this.graphService.getPlugins(site.id);
        // This would require actual WP-CLI check for updates
        // For now, simplified check
        const hasUpdates = false; // TODO: implement update check
        if (hasUpdates) {
          sitesWithUpdates.push(site.id);
        }
      } catch {
        // Skip sites that error
      }
    }

    return sitesWithUpdates;
  }

  private async filterOutdatedPHP(): Promise<string[]> {
    const allSites = this.localServicesBridge.getAllSites();
    return allSites
      .filter(site => {
        const phpVersion = site.phpVersion || '7.4';
        return phpVersion < '8.0';
      })
      .map(site => site.id);
  }

  private async filterNoSSL(): Promise<string[]> {
    const allSites = this.localServicesBridge.getAllSites();
    return allSites
      .filter(site => !site.domain?.startsWith('https://'))
      .map(site => site.id);
  }

  private async filterNotIndexed(): Promise<string[]> {
    const allSites = this.localServicesBridge.getAllSites();
    const indexed = this.indexRegistry.listAll();
    const indexedIds = new Set(
      indexed
        .filter(e => e.state === 'indexed' &&
                    (Date.now() - e.lastIndexed) < 7 * 24 * 60 * 60 * 1000)
        .map(e => e.siteId)
    );

    return allSites
      .filter(site => !indexedIds.has(site.id))
      .map(site => site.id);
  }

  // ... other filter methods
}
```

---

### QueryStorage (New)

**File:** `src/main/search/QueryStorage.ts`

**Purpose:** Persist saved queries to disk

**Class Design:**
```typescript
export class QueryStorage {
  private queriesPath: string;
  private queries: Map<string, SavedQuery> = new Map();

  constructor(storagePath: string) {
    this.queriesPath = path.join(storagePath, 'saved-queries.json');
    this.load();
  }

  async save(query: Omit<SavedQuery, 'id'>): Promise<SavedQuery> {
    const id = this.generateId();
    const saved: SavedQuery = {
      ...query,
      id,
      createdAt: Date.now(),
      lastRun: null,
      resultCount: 0,
    };

    this.queries.set(id, saved);
    await this.persist();
    return saved;
  }

  async update(id: string, changes: Partial<SavedQuery>): Promise<SavedQuery> {
    const existing = this.queries.get(id);
    if (!existing) {
      throw new Error(`Query ${id} not found`);
    }

    const updated = { ...existing, ...changes };
    this.queries.set(id, updated);
    await this.persist();
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.queries.delete(id);
    await this.persist();
  }

  list(): SavedQuery[] {
    return Array.from(this.queries.values())
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  }

  get(id: string): SavedQuery | undefined {
    return this.queries.get(id);
  }

  private async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.queriesPath, 'utf-8');
      const parsed = JSON.parse(data);
      this.queries = new Map(Object.entries(parsed));
    } catch {
      // File doesn't exist yet
    }
  }

  private async persist(): Promise<void> {
    const data = Object.fromEntries(this.queries);
    await fs.writeFile(this.queriesPath, JSON.stringify(data, null, 2));
  }

  private generateId(): string {
    return `query-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
```

---

### IPC Handler Registration

**File:** `src/main/index.ts` (add to existing)

**New IPC Handlers:**
```typescript
import { SearchService } from './search/SearchService';
import { FilterEngine } from './search/FilterEngine';
import { HealthScoreCalculator } from './health/HealthScoreCalculator';
import { QueryStorage } from './search/QueryStorage';

function registerSearchHandlers(
  searchService: SearchService,
  filterEngine: FilterEngine,
  healthCalculator: HealthScoreCalculator,
  queryStorage: QueryStorage
) {
  // Unified search
  ipcMain.handle('nexus-ai:search:unified', async (_event, query, filters, options) => {
    const results = await searchService.searchFleet(query, filters, options);
    return { success: true, ...results };
  });

  // Smart filters
  ipcMain.handle('nexus-ai:filters:get-counts', async () => {
    const filters = await filterEngine.getFilterCounts();
    return { success: true, filters };
  });

  ipcMain.handle('nexus-ai:filters:apply', async (_event, filterId, params) => {
    const siteIds = await filterEngine.applyFilter(filterId, params);
    return { success: true, siteIds };
  });

  // Health scores
  ipcMain.handle('nexus-ai:health:get-score', async (_event, siteId) => {
    const breakdown = await healthCalculator.calculateScore(siteId);
    return { success: true, ...breakdown };
  });

  ipcMain.handle('nexus-ai:health:get-all-scores', async () => {
    const allSites = siteData.getSites();
    const scores = await Promise.all(
      Object.keys(allSites).map(async (siteId) => ({
        siteId,
        score: (await healthCalculator.calculateScore(siteId)).overall,
      }))
    );
    return { success: true, scores };
  });

  // Saved queries
  ipcMain.handle('nexus-ai:queries:list', async () => {
    const queries = queryStorage.list();
    return { success: true, queries };
  });

  ipcMain.handle('nexus-ai:queries:create', async (_event, query) => {
    const saved = await queryStorage.save(query);
    return { success: true, query: saved };
  });

  ipcMain.handle('nexus-ai:queries:update', async (_event, id, changes) => {
    const updated = await queryStorage.update(id, changes);
    return { success: true, query: updated };
  });

  ipcMain.handle('nexus-ai:queries:delete', async (_event, id) => {
    await queryStorage.delete(id);
    return { success: true };
  });

  ipcMain.handle('nexus-ai:queries:run', async (_event, id) => {
    const query = queryStorage.get(id);
    if (!query) {
      return { success: false, error: 'Query not found' };
    }

    const results = await searchService.searchFleet('', query.filters);

    // Update last run stats
    await queryStorage.update(id, {
      lastRun: Date.now(),
      resultCount: results.total,
    });

    return { success: true, ...results };
  });
}
```

---

## Testing Strategy

### Unit Tests (40+ new tests)

**SearchService (10 tests):**
- `tests/unit/search/search-service.test.ts`
  - Searches vector store across all sites
  - Searches metadata (plugins, themes, users)
  - Merges vector and metadata results
  - Applies content type filters
  - Applies date range filters
  - Computes result facets
  - Sorts by relevance
  - Paginates results
  - Handles empty query
  - Handles no results

**HealthScoreCalculator (15 tests):**
- `tests/unit/health/health-calculator.test.ts`
  - Calculates overall score correctly
  - Security factor: SSL check
  - Security factor: plugin updates
  - Security factor: PHP version
  - Performance factor: PHP version
  - Performance factor: caching
  - Maintenance factor: index freshness
  - Maintenance factor: disk space
  - Activity factor: recent events
  - Activity factor: content freshness
  - Stability factor: failed events
  - Generates recommendations
  - Handles missing data gracefully
  - Caches scores appropriately
  - Weighted average calculation

**FilterEngine (8 tests):**
- `tests/unit/search/filter-engine.test.ts`
  - Returns filter counts
  - Filters security updates correctly
  - Filters outdated PHP correctly
  - Filters no SSL correctly
  - Filters not indexed correctly
  - Filters large databases correctly
  - Filters low health correctly
  - Handles unknown filter ID

**QueryStorage (7 tests):**
- `tests/unit/search/query-storage.test.ts`
  - Saves new query
  - Lists queries sorted by pinned
  - Updates query
  - Deletes query
  - Persists to disk
  - Loads from disk
  - Generates unique IDs

**Component Tests (20+ tests):**
- `tests/unit/renderer/UnifiedSearchPanel.test.tsx`
- `tests/unit/renderer/SmartFiltersPanel.test.tsx`
- `tests/unit/renderer/SavedQueriesPanel.test.tsx`
- `tests/unit/renderer/SiteHealthBadge.test.tsx`

### Integration Tests (15+ new tests)

**Search Integration:**
- `tests/integration/14-unified-search.integration.test.ts`
  - Vector search + metadata search merge
  - Filter by content type
  - Filter by health score
  - Pagination works
  - Facet counts correct

**Health Score Integration:**
- `tests/integration/15-health-scoring.integration.test.ts`
  - Full health calculation with real data
  - Score updates when site changes
  - Recommendations accurate
  - Caching works

**Filter Application:**
- `tests/integration/16-smart-filters.integration.test.ts`
  - Each smart filter returns correct sites
  - Filter counts update
  - Multiple filters compose

**Query Persistence:**
- `tests/integration/17-saved-queries.integration.test.ts`
  - Save, load, update, delete flow
  - Query execution
  - Result count caching

### E2E Tests (5+ new tests)

**Search Flow:**
- `tests/e2e/21-unified-search.e2e.test.ts`
  - Type query, see results
  - Click filter, results update
  - Save query, appears in saved list
  - Run saved query, results load

**Health Scores:**
- `tests/e2e/22-health-scores.e2e.test.ts`
  - Health badges appear in site list
  - Click badge, see breakdown
  - Health score changes when site updated

### Manual Testing Checklist

**Pre-flight:**
- [ ] npm run build
- [ ] Local app running
- [ ] Multiple sites created (3+ for testing)
- [ ] Some sites indexed, some not

**Test Scenarios:**

1. **Unified Search**
   - [ ] Search for "hello world" → see posts across sites
   - [ ] Search for "akismet" → see plugin results
   - [ ] Filter by content type → results update
   - [ ] Pagination works (>20 results)
   - [ ] Empty search shows all content

2. **Smart Filters**
   - [ ] Click "Not Indexed" → see unindexed sites
   - [ ] Click "Outdated PHP" → see PHP 7.x sites
   - [ ] Click "Low Health" → see sites <50 score
   - [ ] Filter counts update after reindex

3. **Saved Queries**
   - [ ] Create new query → appears in list
   - [ ] Pin query → moves to top
   - [ ] Edit query name → updates
   - [ ] Run saved query → results load
   - [ ] Delete query → removed from list

4. **Health Scores**
   - [ ] Site badges show scores (0-100)
   - [ ] Color-coded (green/yellow/red)
   - [ ] Click badge → see breakdown
   - [ ] Recommendations shown
   - [ ] Score updates after site changes

5. **Performance**
   - [ ] Search results appear <1s
   - [ ] Filter application <500ms
   - [ ] Health score calculation <2s
   - [ ] No UI blocking during calculations

---

## Implementation Tasks

### Week 1: Backend & Search

**Day 1-2: SearchService**
- [ ] Create `SearchService` class
- [ ] Implement `searchFleet()` method
- [ ] Implement vector + metadata merge
- [ ] Implement filter application
- [ ] Implement result ranking
- [ ] Write unit tests (10 tests)
- [ ] Write integration tests

**Day 3-4: HealthScoreCalculator**
- [ ] Create `HealthScoreCalculator` class
- [ ] Implement security factor checks
- [ ] Implement performance factor checks
- [ ] Implement maintenance factor checks
- [ ] Implement activity factor checks
- [ ] Implement stability factor checks
- [ ] Implement weighted score calculation
- [ ] Generate recommendations
- [ ] Write unit tests (15 tests)
- [ ] Write integration tests

**Day 5: FilterEngine + QueryStorage**
- [ ] Create `FilterEngine` class
- [ ] Implement filter count methods
- [ ] Implement filter application methods
- [ ] Create `QueryStorage` class
- [ ] Implement save/load/update/delete
- [ ] Write unit tests (15 tests)
- [ ] Write integration tests

### Week 2: UI Components

**Day 6-7: UnifiedSearchPanel + SmartFiltersPanel**
- [ ] Build `UnifiedSearchPanel` component
- [ ] Implement debounced search
- [ ] Implement result rendering
- [ ] Implement advanced filters UI
- [ ] Build `SmartFiltersPanel` component
- [ ] Implement filter buttons with counts
- [ ] Write unit tests (12 tests)
- [ ] Manual testing

**Day 8: SavedQueriesPanel + SiteHealthBadge**
- [ ] Build `SavedQueriesPanel` component
- [ ] Implement create/edit/delete UI
- [ ] Implement query execution
- [ ] Build `SiteHealthBadge` component
- [ ] Implement score display
- [ ] Implement breakdown modal
- [ ] Write unit tests (10 tests)
- [ ] Manual testing

**Day 9: FleetOverview Integration**
- [ ] Enhance Search tab with UnifiedSearchPanel
- [ ] Add SmartFiltersPanel to sidebar
- [ ] Add SavedQueriesPanel to sidebar
- [ ] Add SiteHealthBadge to site rows
- [ ] Layout and styling
- [ ] Test tab navigation
- [ ] Test interactions between components

**Day 10: E2E Tests & Polish**
- [ ] Write E2E test: unified search flow
- [ ] Write E2E test: smart filters
- [ ] Write E2E test: saved queries
- [ ] Write E2E test: health scores
- [ ] Manual testing checklist
- [ ] UI polish (animations, loading states)
- [ ] Error handling improvements
- [ ] Documentation updates

---

## Acceptance Criteria

### Must Have (Sprint 2 Complete)

1. **Unified Search Works**
   - [ ] Search across all sites and content types
   - [ ] Results merge vector + metadata
   - [ ] Filters apply correctly
   - [ ] Pagination works
   - [ ] Relevance ranking accurate

2. **Smart Filters Implemented**
   - [ ] At least 8 pre-built filters
   - [ ] Filter counts accurate
   - [ ] Filter application <500ms
   - [ ] Counts update in real-time

3. **Saved Queries Functional**
   - [ ] Create, edit, delete queries
   - [ ] Pin favorites
   - [ ] Execute saved queries
   - [ ] Persist to disk

4. **Health Scores Calculated**
   - [ ] Scores accurate (0-100)
   - [ ] Breakdown shows 5 factors
   - [ ] Recommendations actionable
   - [ ] Badges color-coded

5. **UI Integration Seamless**
   - [ ] Search tab enhanced
   - [ ] Site list shows health badges
   - [ ] All components render <1s
   - [ ] No console errors

6. **Tests Pass**
   - [ ] All unit tests pass (60+ new tests)
   - [ ] All integration tests pass (15+ new tests)
   - [ ] All E2E tests pass (5+ new tests)
   - [ ] Manual testing checklist complete

### Nice to Have (Post-Sprint 2)

- [ ] Export search results as CSV
- [ ] Share saved queries (JSON export)
- [ ] Health score history (track over time)
- [ ] Custom health score weights
- [ ] Advanced query builder UI
- [ ] Search result preview modal

---

## Risks & Mitigation

### Risk 1: Health Score Performance
**Impact:** Calculating scores for 20+ sites may be slow
**Mitigation:**
- Cache scores (5 minute TTL)
- Background calculation on site change
- Progressive loading (calculate as needed)
- Parallel computation with Promise.all

### Risk 2: Search Result Relevance
**Impact:** Users may not find what they're looking for
**Mitigation:**
- Boost metadata matches (exact plugin name > content mention)
- Tunable relevance weights
- Result type separation (plugins vs posts)
- Spell-check suggestions

### Risk 3: Saved Queries Complexity
**Impact:** Complex filter UI may confuse users
**Mitigation:**
- Start with simple filters only
- Progressive disclosure (advanced filters hidden)
- Pre-built filters as examples
- Clear filter descriptions

### Risk 4: Too Many Smart Filters
**Impact:** Filter panel becomes cluttered
**Mitigation:**
- Limit to 10 most useful filters
- Collapsible categories
- User can hide filters
- Analytics to track which filters are used

---

## Success Metrics

### Quantitative
- [ ] Search returns results in <1s
- [ ] Health score calculation <2s per site
- [ ] Filter application <500ms
- [ ] All components render <1s
- [ ] Zero crashes during testing

### Qualitative
- [ ] Users can answer "which sites need updates?" in 5 seconds
- [ ] Saved queries reduce repetitive work
- [ ] Health scores surface actionable issues
- [ ] Search feels "smart" (finds what you need)
- [ ] UI feels cohesive with Sprint 1 components

---

## Files to Create/Modify

### New Files (25)

**Backend Services (5):**
1. `src/main/search/SearchService.ts`
2. `src/main/search/FilterEngine.ts`
3. `src/main/search/QueryStorage.ts`
4. `src/main/health/HealthScoreCalculator.ts`
5. `src/main/search/types.ts`

**Components (4):**
6. `src/renderer/components/UnifiedSearchPanel.tsx`
7. `src/renderer/components/SmartFiltersPanel.tsx`
8. `src/renderer/components/SavedQueriesPanel.tsx`
9. `src/renderer/components/SiteHealthBadge.tsx`

**Unit Tests (8):**
10. `tests/unit/search/search-service.test.ts`
11. `tests/unit/search/filter-engine.test.ts`
12. `tests/unit/search/query-storage.test.ts`
13. `tests/unit/health/health-calculator.test.ts`
14. `tests/unit/renderer/UnifiedSearchPanel.test.tsx`
15. `tests/unit/renderer/SmartFiltersPanel.test.tsx`
16. `tests/unit/renderer/SavedQueriesPanel.test.tsx`
17. `tests/unit/renderer/SiteHealthBadge.test.tsx`

**Integration Tests (4):**
18. `tests/integration/14-unified-search.integration.test.ts`
19. `tests/integration/15-health-scoring.integration.test.ts`
20. `tests/integration/16-smart-filters.integration.test.ts`
21. `tests/integration/17-saved-queries.integration.test.ts`

**E2E Tests (2):**
22. `tests/e2e/21-unified-search.e2e.test.ts`
23. `tests/e2e/22-health-scores.e2e.test.ts`

**Documentation (2):**
24. `docs/sprint-2-task-checklist.md`
25. `docs/implementation-notes/sprint-2-completion.md`

### Modified Files (4)

1. `src/main/index.ts` - Register search/health IPC handlers
2. `src/main/events/GraphService.ts` - Add search methods
3. `src/renderer/components/FleetOverview.tsx` - Enhance Search tab
4. `src/common/constants.ts` - Add IPC channel constants

---

## Next Steps After Sprint 2

**Sprint 3 Preview:**
- Bulk operations (update all, reindex all)
- Site grouping/tagging
- Advanced analytics dashboard
- Export/import fleet configuration

**Documentation:**
- Update README with search features
- Add screenshots of Smart Filters
- Document health score factors
- Create video demo

**User Testing:**
- Beta test with 10-15 users
- Gather feedback on search relevance
- Iterate on filter usefulness
- Refine health score weights

---

**Last Updated:** 2026-03-05
**Status:** Planning Complete
**Ready to Start:** Day 1 - SearchService Implementation
