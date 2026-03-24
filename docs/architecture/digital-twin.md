# Digital Twin: Site Metadata Persistence

**Status:** Implemented (Phase 1.1-1.4 complete, March 2026)
**Rationale:** Solve UI responsiveness and state persistence issues across Local restarts

---

## Problem Statement

Prior to the Digital Twin implementation, the Nexus AI addon had **incomplete persistence** of WordPress site state:

### Persistent State (✅ Worked across restarts)
- **Content:** Vector store embeddings for semantic search
- **Graph structure:** Plugins, themes, users as nodes in graph DB
- **Event timeline:** WordPress events from connector plugin
- **User credentials:** AI provider API keys
- **AI setup state:** Plugin installation status (added in commit `58f8e86`)

### Ephemeral State (❌ Required live WP-CLI query every time)
- WordPress version
- Plugin list and activation status
- Theme info
- PHP version, MySQL version
- Site configuration

### The Gap

When a site was slow to start, WP-CLI timed out, or the site was halted, the UI showed stale/missing data even though we **knew** this information from previous sessions.

**Real-world example:** After upgrading a site to WordPress 7.0 and running "Setup AI", the Nexus site info section showed "AI plugin: Not installed" after restarting Local. The plugin **was** installed, but WP-CLI query failed because the site took 30 seconds to start.

---

## Solution: "Last Known State" Cache

The Digital Twin is a **persistent metadata cache** that stores WordPress runtime state with timestamps, enabling:

1. **Instant UI loads** — No waiting for WP-CLI queries
2. **Graceful degradation** — UI shows cached data when site is halted or slow
3. **State persistence** — AI setup status survives Local restarts
4. **Drift detection** — Compare cached vs. live state to catch manual changes

### Core Concept

Think of it as a "digital twin" of your WordPress sites:
- The **real site** is the authoritative source (when running)
- The **digital twin** (cache) is a snapshot that persists when the real site is unavailable
- The cache is **optimistically correct** — assumes it's accurate until proven otherwise
- Cache is **refreshed automatically** on site start and after setup operations

---

## Architecture

### Data Model

```typescript
// Storage key
STORAGE_KEYS.SITE_METADATA: `${ADDON_PREFIX}_site_metadata`

// Structure
interface SiteMetadata {
  wpVersion: string;              // "7.0-beta6-62094"
  phpVersion?: string;             // "8.3" (future)
  mysqlVersion?: string;           // "8.0.35" (future)
  plugins: Array<{
    name: string;                 // "ai"
    title: string;                // "AI"
    version: string;              // "0.6.0"
    status: 'active' | 'inactive';
    file?: string;                // "ai/ai.php"
  }>;
  themes: Array<{
    name: string;                 // "twentytwentyfour"
    title: string;                // "Twenty Twenty-Four"
    version: string;              // "1.0"
    status: 'active' | 'inactive';
  }>;
  activeTheme?: string;           // name of the current active theme
  siteUrl?: string;               // (future)
  adminEmail?: string;            // (future)
  lastUpdated: number;            // Unix timestamp (ms)
  updateSource: 'lifecycle' | 'manual' | 'setup-ai';
}

// Storage shape
Record<siteId, SiteMetadata>
```

### Components

#### 1. SiteMetadataCache (`src/main/metadata/SiteMetadataCache.ts`)

Core cache management class.

**Methods:**
- `get(siteId)` — Retrieve cached metadata (or null)
- `getWithAge(siteId)` — Returns `{ metadata, ageMs, isStale }`
- `set(siteId, metadata)` — Store/update metadata
- `update(siteId, partial)` — Partial update (merges with existing)
- `invalidate(siteId)` — Remove site from cache
- `isStale(siteId)` — Check if > 24 hours old
- `getAgeString(siteId)` — Human-readable age ("Just now", "5m ago", "3h ago", "2d ago")
- `clear()` — Wipe entire cache (testing only)

**Example:**
```typescript
const cache = new SiteMetadataCache(registryStorage);

// Store metadata
cache.set('site-1', {
  wpVersion: '7.0.1',
  plugins: [
    { name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' }
  ],
  themes: [
    { name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }
  ],
  activeTheme: 'twentytwentyfour',
  updateSource: 'lifecycle',
});

// Retrieve with age
const withAge = cache.getWithAge('site-1');
console.log(withAge.ageMs);        // 5432 (milliseconds since last update)
console.log(withAge.isStale);      // false (< 24 hours)
console.log(cache.getAgeString('site-1')); // "Just now"
```

#### 2. Lifecycle Hooks (`src/main/content/lifecycle-hooks.ts`)

**Automatic cache refresh on site start:**

```typescript
context.hooks.addAction('siteStarted', async (site: LocalSiteRef) => {
  // ... existing indexing logic ...

  // Refresh metadata cache (runs in parallel with indexing)
  const [wpVersion, plugins, themes] = await Promise.all([
    localServices.getWpVersion(site.id),
    localServices.getPlugins(site.id),
    localServices.getThemes(site.id),
  ]);

  metadataCache.set(site.id, {
    wpVersion: wpVersion ?? 'unknown',
    plugins: plugins.map(p => ({ ... })),
    themes: themes.map(t => ({ ... })),
    activeTheme: themes.find(t => t.status === 'active')?.name,
    updateSource: 'lifecycle',
  });
});
```

**Cache invalidation on site removal:**

```typescript
context.hooks.addAction('siteRemoved', async (site: LocalSiteRef) => {
  // ... existing cleanup logic ...

  metadataCache.invalidate(site.id);
});
```

#### 3. IPC Handlers (`src/main/ipc-handlers.ts`)

**Cache-first fallback pattern:**

```typescript
// GET_WP_VERSION handler
safeHandle(IPC_CHANNELS.GET_WP_VERSION, async (_event: any, siteId: string) => {
  let version: string | null = null;
  let fromCache = false;
  let metadataAge: string | null = null;

  // Check cache first (instant)
  const cachedMetadata = metadataCache?.getWithAge(siteId);
  if (cachedMetadata) {
    version = cachedMetadata.wpVersion;
    fromCache = true;
    metadataAge = metadataCache?.getAgeString(siteId) ?? null;
  }

  // If cache is stale or missing, verify with live WP-CLI
  if (siteStatus === 'running' && (!cachedMetadata || cachedMetadata.isStale)) {
    try {
      const liveVersion = await localServicesBridge.getWpVersion(siteId);
      if (liveVersion) {
        version = liveVersion;
        fromCache = false;
        metadataAge = null; // Fresh data
      }
    } catch (err) {
      // WP-CLI failed — keep using cached version if we have it
      if (!version) {
        throw err; // No cache, propagate error
      }
    }
  }

  return { success: true, version, fromCache, metadataAge };
});
```

**Manual refresh endpoint:**

```typescript
safeHandle(IPC_CHANNELS.REFRESH_SITE_METADATA, async (_event: any, siteId: string) => {
  // Fetch fresh data
  const [wpVersion, plugins, themes] = await Promise.all([
    localServicesBridge.getWpVersion(siteId),
    localServicesBridge.getPlugins(siteId),
    localServicesBridge.getThemes(siteId),
  ]);

  // Update cache
  metadataCache.set(siteId, {
    wpVersion: wpVersion ?? 'unknown',
    plugins: plugins.map(p => ({ ... })),
    themes: themes.map(t => ({ ... })),
    activeTheme: themes.find(t => t.status === 'active')?.name,
    updateSource: 'manual',
  });

  return { success: true, metadataAge: 'Just now' };
});
```

#### 4. Setup AI Integration

**Refresh cache after plugin installations:**

```typescript
// SETUP_AI handler
const result = await setupSiteForAI(siteId, localServicesBridge, registryStorage, localLogger, options);

if (result.success && metadataCache) {
  // Refresh cache to reflect newly installed plugins
  const [wpVersion, plugins, themes] = await Promise.all([
    localServicesBridge.getWpVersion(siteId),
    localServicesBridge.getPlugins(siteId),
    localServicesBridge.getThemes(siteId),
  ]);

  metadataCache.set(siteId, {
    wpVersion: wpVersion ?? 'unknown',
    plugins: plugins.map(p => ({ ... })),
    themes: themes.map(t => ({ ... })),
    activeTheme: themes.find(t => t.status === 'active')?.name,
    updateSource: 'setup-ai',
  });
}
```

#### 5. UI Components (`src/renderer/components/SiteNexusSection.tsx`)

**Display cache age and staleness indicator:**

```typescript
interface SiteAiStatus {
  aiPlugin: 'active' | 'inactive' | 'not_installed';
  ollamaProvider: 'active' | 'inactive' | 'not_installed';
  credentialsSynced: boolean;
  providers: string[];
  metadataAge?: string | null;      // "Just now", "5m ago", etc.
  metadataIsStale?: boolean;        // true if > 24 hours old
}

// Render metadata row with refresh button
const metadataAge = aiStatus?.metadataAge || wpVersionAge;
const isStale = aiStatus?.metadataIsStale ?? false;

if (hasMetadata) {
  const ageDisplay = metadataAge
    ? ` (${metadataAge}${isStale ? ', stale' : ''})`
    : '';

  rows.push(row('Metadata',
    React.createElement('span', {
      style: dotStyle(isStale ? UI_COLORS.STATUS_WARNING : UI_COLORS.STATUS_RUNNING)
    }),
    `Cached${ageDisplay}`,
    this.createActionButton({
      onClick: refreshingMetadata ? undefined : this.handleRefreshMetadata,
      disabled: refreshingMetadata,
      children: refreshingMetadata ? 'Refreshing...' : 'Refresh',
    }),
  ));
}
```

---

## Update Triggers

### 1. Site Start (Automatic)

**Lifecycle hook:** `siteStarted`
**Frequency:** Every time a site starts
**Accuracy:** ✅ Highest — queries live WordPress immediately after startup
**Source:** `updateSource: 'lifecycle'`

```typescript
// In lifecycle-hooks.ts
context.hooks.addAction('siteStarted', async (site: LocalSiteRef) => {
  // Refresh metadata cache in parallel with content indexing
  const [wpVersion, plugins, themes] = await Promise.all([
    localServices.getWpVersion(site.id),
    localServices.getPlugins(site.id),
    localServices.getThemes(site.id),
  ]);

  metadataCache.set(site.id, { ... });
});
```

### 2. Setup AI Completes (Automatic)

**Trigger:** After `setupSiteForAI()` succeeds
**Frequency:** When user clicks "Setup AI" (single or bulk)
**Accuracy:** ✅ High — plugins were just installed
**Source:** `updateSource: 'setup-ai'`

```typescript
// In ipc-handlers.ts (SETUP_AI)
const result = await setupSiteForAI(...);
if (result.success && metadataCache) {
  // Refresh to reflect newly installed AI plugins
  metadataCache.set(siteId, { ... });
}
```

### 3. Manual Refresh (User-initiated)

**Trigger:** User clicks "Refresh" button in UI
**Frequency:** On-demand
**Accuracy:** ✅ Highest — queries live WordPress on user request
**Source:** `updateSource: 'manual'`

```typescript
// In SiteNexusSection.tsx
handleRefreshMetadata = async () => {
  await electron.ipcRenderer.invoke(IPC_CHANNELS.REFRESH_SITE_METADATA, siteId);
  this.fetchData(); // Re-render UI
};
```

---

## Cache Invalidation

### Staleness Threshold

**24 hours** — Cache is marked "stale" if not updated in 24 hours.

```typescript
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

isStale(siteId: string): boolean {
  const metadata = this.get(siteId);
  if (!metadata) return false;
  return (Date.now() - metadata.lastUpdated) > STALE_THRESHOLD_MS;
}
```

**UI Behavior:**
- **Fresh (< 24h):** Green dot, "Cached (5m ago)"
- **Stale (> 24h):** Yellow dot, "Cached (2d ago, stale)"

### Site Removal

**Automatic invalidation** when site is deleted:

```typescript
context.hooks.addAction('siteRemoved', async (site: LocalSiteRef) => {
  metadataCache.invalidate(site.id);
});
```

### Drift Detection

**Scenario:** User manually deactivates a plugin via wp-admin, bypassing the cache.

**Detection:** When cache is stale and site is running, IPC handlers query live WP-CLI and compare:

```typescript
const cachedMetadata = metadataCache?.getWithAge(siteId);
if (siteStatus === 'running' && cachedMetadata?.isStale) {
  const livePlugins = await localServicesBridge.getPlugins(siteId);

  // Compare cached vs. live
  const drift = cachedMetadata.plugins.some(cached => {
    const live = livePlugins.find(p => p.name === cached.name);
    return live && live.status !== cached.status;
  });

  if (drift) {
    // Update cache with live data
    metadataCache.set(siteId, { ... });
  }
}
```

---

## Performance Characteristics

### Cache Lookups

**50 sites, all cached:**
- **Time:** < 10ms for 50 `get()` calls
- **Memory:** ~50KB for 50 sites (1KB/site average)

### UI Load Time

**Before (no cache):**
- Site info panel: 2-5 seconds (WP-CLI query + render)
- Halted site: ∞ (timeout, shows "Not available")

**After (with cache):**
- Site info panel: < 100ms (cache lookup + render)
- Halted site: < 100ms (cache fallback)

### WP-CLI Reduction

**Lifecycle refresh strategy:**
- **Site start:** 1 WP-CLI batch (version + plugins + themes)
- **Site running, cache fresh:** 0 WP-CLI queries
- **Site running, cache stale:** 1 WP-CLI batch (on next GET_AI_STATUS)

**Result:** ~90% reduction in WP-CLI queries during normal operation.

---

## Testing

### Unit Tests (`tests/unit/SiteMetadataCache.test.ts`)

**20 tests covering:**
- Basic CRUD operations
- Age calculation and staleness detection
- Persistence across cache instance recreations
- Edge cases (null values, empty cache)

```bash
npm run test:unit -- SiteMetadataCache
```

### Integration Tests

#### Lifecycle Integration (`tests/integration/15-metadata-cache-lifecycle.integration.test.ts`)

**6 tests covering:**
- Cache population on `siteStarted`
- Cache invalidation on `siteRemoved`
- Age tracking accuracy
- Multiple sites isolation

```bash
npm run test:integration -- 15-metadata-cache-lifecycle
```

#### Persistence & Drift (`tests/integration/16-metadata-cache-persistence.integration.test.ts`)

**7+ tests covering:**
- Persistence across cache instance recreations (simulated restarts)
- Setup AI flow → restart → verify status persists
- Staleness detection over 24 hours
- Drift detection (cached vs. live plugin status)
- Performance with 50 cached sites

```bash
npm run test:integration -- 16-metadata-cache-persistence
```

### E2E Tests (`tests/e2e/15-setup-ai.e2e.test.ts`)

**Existing test validates:**
- Setup AI installs plugins successfully
- Plugins are active after setup
- AI experiments are enabled

**Note:** E2E tests cannot restart Local, so persistence testing is done via integration tests that recreate cache instances.

---

## Future Enhancements

### Phase 2: Periodic Refresh (Optional)

**Goal:** Catch manual plugin activations without forcing user to refresh.

**Implementation:**
- Every 15 minutes, if site is running and cache is fresh, verify plugin list
- If drift detected, update cache and log warning

**Trade-off:** Adds complexity, marginal benefit (most changes happen via Setup AI or lifecycle events).

**Decision:** Defer until user feedback indicates it's needed.

### Phase 3: Additional Metadata

**Candidates:**
- `phpVersion` — Useful for compatibility checks
- `mysqlVersion` — Useful for debugging database issues
- `siteUrl` — Useful for link generation
- `adminEmail` — Useful for notifications

**Implementation:** Add fields to `SiteMetadata` interface and query via WP-CLI.

---

## Troubleshooting

### Cache Shows Stale Data

**Symptom:** UI shows "AI plugin: Not installed" but plugin is actually installed.

**Diagnosis:**
1. Check cache age: Look for "Cached (Xm ago, stale)" in UI
2. Check if site is running: If halted, cache is expected to be stale
3. Check last update source: `lifecycle` | `setup-ai` | `manual`

**Solution:**
1. Click "Refresh" button in UI to force cache update
2. If site is halted, start the site (triggers lifecycle refresh)
3. Check logs for WP-CLI errors during refresh

### Cache Not Updating After Setup AI

**Symptom:** Setup AI succeeds, but UI still shows old plugin list.

**Diagnosis:**
1. Check logs for "Refreshed metadata cache after setup-ai for site X"
2. Check if cache refresh failed (non-fatal error)
3. Verify `metadataCache` is initialized in `ipc-handlers.ts`

**Solution:**
1. Manually refresh via "Refresh" button
2. Restart site to trigger lifecycle refresh
3. Check for WP-CLI errors in Local logs

### Performance Degradation

**Symptom:** UI loads slowly even with cache.

**Diagnosis:**
1. Check storage size: `userData.get(STORAGE_KEYS.SITE_METADATA)`
2. Check number of cached sites
3. Profile cache lookups with performance.now()

**Solution:**
1. Clear cache for deleted sites: `metadataCache.clear()`
2. Limit cache size (future: LRU eviction policy)
3. Optimize serialization (future: use binary format)

---

## Commits

- **7d60f56** — Phase 1.1: Core infrastructure (SiteMetadataCache, IPC handlers, unit tests)
- **37b4f07** — Phase 1.2: Lifecycle integration (siteStarted/siteRemoved hooks, integration tests)
- **17f2adc** — Phase 1.3: UI integration (cache-first IPC handlers, staleness UI, refresh button)
- **ff5f45c** — Phase 1.4: Setup AI integration (cache refresh after plugin installations)

---

## References

- **Roadmap:** `docs/roadmap-short-term.md` (Digital Twin section)
- **Source Code:**
  - `src/main/metadata/SiteMetadataCache.ts` — Core cache class
  - `src/main/content/lifecycle-hooks.ts` — Automatic refresh on site start
  - `src/main/ipc-handlers.ts` — Cache-first IPC handlers
  - `src/renderer/components/SiteNexusSection.tsx` — UI with cache age display
- **Tests:**
  - `tests/unit/SiteMetadataCache.test.ts` — Unit tests (20 tests)
  - `tests/integration/15-metadata-cache-lifecycle.integration.test.ts` — Lifecycle tests (6 tests)
  - `tests/integration/16-metadata-cache-persistence.integration.test.ts` — Persistence tests (7+ tests)
  - `tests/e2e/15-setup-ai.e2e.test.ts` — E2E setup AI flow
