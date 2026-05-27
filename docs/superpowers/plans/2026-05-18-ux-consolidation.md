# UX Consolidation — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four-store mental model (Context Index / Site Graph / Twin Data / WPE Sync) with a single "data completeness" concept (Scanned / Configured / Searchable) across all surfaces, and replace the Discover comparison view with a unified search box that queries both content vectors and fleet metadata.

**Architecture:** Three new backend modules (intent classifier, metadata searcher, opportunistic scheduler) feed into a redesigned `SEARCH_UNIFIED` IPC handler and a new `FLEET_COMPLETENESS` handler. The renderer replaces `DiscoverTab` with `SearchTab`, rewrites the Overview completeness cards, and redesigns System tab site rows from a 4-column matrix to a single level-per-site indicator. Phase 2 (WPE content indexing via SSH) is out of scope here.

**Tech Stack:** TypeScript · Electron IPC · LanceDB (content vectors) · better-sqlite3/graph.db (metadata search) · SiteMetadataCache (local plugin/user data) · React.createElement class components (no JSX, no hooks) · Jest (unit tests) · BulkOperationManager with `autoStartStop: true` (opportunistic scheduler pattern)

---

## Visual Design Reference

These mockups were approved before implementation. Build exactly what is shown.

### Overview tab — Data completeness widget
```
295 sites   14 local · 281 WP Engine

┌─ Data completeness ──────────────────────────────────────────────────────┐
│  Scanned      ████████████████████████████████████  295/295  100%        │
│               WP version · installed plugins/themes known                 │
│                                                                           │
│  Configured   ████████████████████████████░░░░░░░░  268/295   91%        │
│               Active plugins · users · post counts known                  │
│                                                                           │
│  Searchable   █████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   97/295   33%        │
│               Posts · pages · custom content indexed                      │
│                                                                           │
│  Last updated 6m ago                     ⚡ Index all  ⏱ Schedule…      │
└───────────────────────────────────────────────────────────────────────────┘
```

### Search tab — Unified search with result tabs
```
┌──────────────────────────────────────────────────────────────────┐
│ ⌕  Search across 295 sites…                               ↵     │
└──────────────────────────────────────────────────────────────────┘
[● Auto]  [  Content  ]  [  Site Metadata  ]

— after search: "elementor" ——————————————————————————————————————

[ All (14) ]  [ Sites (12) ]  [ Content (2) ]

● acme-prod       [plugin]   active · v3.21.0   WPE production
● my-local        [plugin]   inactive · v3.18.0  Local
  ·  ·  ·  10 more                                 Show all →
──────────────────────────────────────────────────────────────────
  "Getting started with Elementor"  [content]  my-blog     0.91
  "Page Builder Comparison"         [content]  acme-prod   0.84

ℹ 198 WPE sites not yet indexed — content search covers 97/295
```

### System tab — Level dots per site
```
Auto-refresh: Every 8h · next run in 6h          → Configure in Preferences

LOCAL SITES  14
SITE              STATUS   LEVEL                      ACTIONS
nexus-e2e-test    halted   ●●●  Searchable  1h ago
jeremypollockblog halted   ●●○  Configured  3h ago    ⚡ Index
nitropack-1     ▼ halted   ●○○  Scanned     —          ▸ Start
  ┌────────────────────────────────────────────────────────────┐
  │ ✓ Scanned      WP 7.0-RC4 · 8 plugins installed          │
  │ ○ Configured   Site is halted — start to enrich           │
  │ ○ Searchable   Requires Configured first                  │
  └────────────────────────────────────────────────────────────┘

WP ENGINE  281 installs   synced 6m ago            ↻ Sync WPE now
Scanned 281/281 · Configured 281/281 · Searchable 96/281
████████████████████████████░░░░░░░░░░░░░░░░░  96 searchable
                                          [View all installs]
```

---

## Data Level Definitions

Every site (local or WPE) has one of three data levels:

| Level | Label | Local criteria | WPE criteria |
|-------|-------|---------------|--------------|
| L1 | **Scanned** | Any SiteMetadata exists in cache | Present in graph.db `sites` table |
| L2 | **Configured** | `scanDepth === 'full'` in SiteMetadata | `wp_version` is set in graph.db |
| L3 | **Searchable** | IndexRegistry `state === 'indexed'` | IndexRegistry `state === 'indexed'` |

A site can only advance levels in order. The highest level it meets is its displayed level.

---

## File Structure

### New files
- `src/main/search/classifyIntent.ts` — heuristic + optional AI intent classifier
- `src/main/search/metadataSearch.ts` — graph.db + SiteMetadataCache plugin/theme/version search
- `src/main/scheduler/OpportunisticScheduler.ts` — interval-based fleet indexer (start → index → stop)
- `src/renderer/components/SearchTab.tsx` — replaces DiscoverTab; unified search UI
- `src/renderer/components/FleetCompletenessWidget.tsx` — three-bar completeness widget for Overview
- `tests/unit/search/classifyIntent.test.ts`
- `tests/unit/search/metadataSearch.test.ts`
- `tests/unit/scheduler/OpportunisticScheduler.test.ts`

### Modified files
- `src/common/types.ts` — add `UnifiedSearchResult`, `MetadataSearchResult`, `FleetCompleteness` types; add `localContentIndexIntervalHours`, `localContentIndexAutoEnabled` to `NexusSettings`
- `src/common/constants.ts` — add `FLEET_COMPLETENESS`, `SEARCH_CLASSIFY_INTENT` channels
- `src/common/schemas.ts` — add new NexusSettings fields to `UpdateSettingsSchema`
- `src/main/ipc-handlers.ts` — update `SEARCH_UNIFIED` to route by intent; add `FLEET_COMPLETENESS` handler
- `src/main/index.ts` — create and start `OpportunisticScheduler`
- `src/renderer/components/NexusOverview.tsx` — replace three store cards with `FleetCompletenessWidget`; rename 'discover'→'search' tab; render `SearchTab`
- `src/renderer/components/SystemTab.tsx` — replace four summary bars with level-per-site rows; add expand/collapse
- `src/renderer/components/NexusPreferences.tsx` — add local scheduler controls under new "Local Sites" scheduling subsection

### Deleted files
- `src/renderer/components/DiscoverTab.tsx` — replaced by SearchTab (delete after wiring SearchTab)

---

## Task 1: Types, IPC channels, and schema

**Goal:** Add all new types and settings fields before any implementation touches them. Failing tests confirm the schema correctly rejects unknown fields.

**Files:**
- Modify: `src/common/types.ts`
- Modify: `src/common/constants.ts`
- Modify: `src/common/schemas.ts`
- Test: `tests/unit/schemas.test.ts` (create if missing)

- [ ] **Step 1: Write failing tests for new NexusSettings fields**

Create `tests/unit/schemas.test.ts` (or add to existing):

```typescript
import { UpdateSettingsSchema } from '../../src/common/schemas';

test('UpdateSettingsSchema accepts localContentIndexIntervalHours', () => {
  const result = UpdateSettingsSchema.safeParse({
    autoIndex: true,
    excludedSiteIds: [],
    localContentIndexIntervalHours: 8,
    localContentIndexAutoEnabled: true,
  });
  expect(result.success).toBe(true);
});

test('UpdateSettingsSchema rejects unknown fields due to strict mode', () => {
  const result = UpdateSettingsSchema.safeParse({
    autoIndex: true,
    excludedSiteIds: [],
    unknownField: 'oops',
  });
  // strict() strips unknown fields; check the parsed output doesn't include them
  if (result.success) {
    expect((result.data as any).unknownField).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="schemas" --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `localContentIndexIntervalHours` stripped or not validated.

- [ ] **Step 3: Add types to `src/common/types.ts`**

Add after the existing `NexusSettings` interface (after `wpeSiteExceptions`):

```typescript
// ===== Unified Search Types =====

export type SearchIntent = 'content' | 'metadata' | 'both';

export interface MetadataSearchResult {
  type: 'site-metadata';
  matchKind: 'plugin' | 'theme' | 'wp-version' | 'php-version';
  siteId: string;
  siteName: string;
  siteSource: 'local' | 'wpe';
  field: string;    // e.g. "elementor/elementor.php"
  value: string;    // e.g. "active · v3.21.0"
  score: number;    // 0–1
}

export interface ContentSearchResult {
  type: 'content';
  siteId: string;
  siteName: string;
  postId: number;
  title: string;
  excerpt: string;
  postType: string;
  score: number;
}

export type UnifiedSearchResult = MetadataSearchResult | ContentSearchResult;

export interface UnifiedSearchResponse {
  intent: SearchIntent;
  metadataResults: MetadataSearchResult[];
  contentResults: ContentSearchResult[];
}

// ===== Fleet Completeness Types =====

export interface FleetCompleteness {
  total: number;
  scanned: number;    // L1: WP version known
  configured: number; // L2: active plugins/users known
  searchable: number; // L3: content indexed
  lastUpdatedMs: number | null;
}
```

Add to `NexusSettings` interface (inside the existing interface block, after `wpeSiteExceptions`):
```typescript
  /** Hours between scheduled local site content index runs. 0 or undefined = manual only. */
  localContentIndexIntervalHours?: number;
  /** Whether the opportunistic content indexer is enabled. Default: false. */
  localContentIndexAutoEnabled?: boolean;
```

- [ ] **Step 4: Add IPC channels to `src/common/constants.ts`**

Add inside the `IPC_CHANNELS` object after `NAVIGATE_TO_PREFERENCES`:

```typescript
  // Fleet completeness (Overview widget)
  FLEET_COMPLETENESS: `${ADDON_PREFIX}:fleet:completeness`,

  // Search intent classification
  SEARCH_CLASSIFY_INTENT: `${ADDON_PREFIX}:search:classify-intent`,
```

- [ ] **Step 5: Add fields to `src/common/schemas.ts`**

Find `UpdateSettingsSchema` in `src/common/schemas.ts`. It uses Zod. Add the two new fields inside it:

```typescript
  localContentIndexIntervalHours: z.number().int().min(0).max(168).optional(),
  localContentIndexAutoEnabled: z.boolean().optional(),
```

- [ ] **Step 6: Run tests to verify passing**

```bash
npm test -- --testPathPattern="schemas" --no-coverage 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 7: Build to confirm TypeScript**

```bash
npm run compile 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/common/types.ts src/common/constants.ts src/common/schemas.ts tests/unit/schemas.test.ts
git commit -m "feat(ux-consolidation): add unified search types, fleet completeness types, scheduler settings"
```

---

## Task 2: Intent classifier

**Goal:** A pure function `classifyIntent(query)` that uses pattern matching to return `content | metadata | both`. No AI in this task — AI fallback is wired in Task 3 when the IPC handler calls it.

**Files:**
- Create: `src/main/search/classifyIntent.ts`
- Create: `tests/unit/search/classifyIntent.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/search/classifyIntent.test.ts
import { classifyIntent } from '../../../src/main/search/classifyIntent';

describe('classifyIntent', () => {
  test.each([
    ['sites with Elementor', 'both'],
    ['which sites have WooCommerce', 'both'],
    ['running PHP 7.4', 'both'],
    ['on WP 6.9', 'both'],
    ['plugin installed', 'both'],
    ['theme active', 'both'],
  ])('"%s" → %s (metadata signal present)', (query, expected) => {
    expect(classifyIntent(query)).toBe(expected);
  });

  test.each([
    ['customer onboarding flow', 'content'],
    ['pricing strategy', 'content'],
    ['getting started guide', 'content'],
    ['welcome email series', 'content'],
  ])('"%s" → content (no metadata signal)', (query, expected) => {
    expect(classifyIntent(query)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="classifyIntent" --no-coverage 2>&1 | tail -10
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/search/classifyIntent.ts`**

```typescript
import type { SearchIntent } from '../../common/types';

// Patterns that signal the user is asking about site configuration/metadata.
// When matched, we run BOTH searches (metadata results shown first in "Sites" tab).
const METADATA_SIGNALS = [
  /\bsites?\s+with\b/i,
  /\bwhich\s+sites?\b/i,
  /\brunning\s+php\b/i,
  /\bon\s+wp\s+\d/i,
  /\bphp\s+\d/i,
  /\bwp\s+\d+\.\d/i,
  /\bplugin\b/i,
  /\btheme\b/i,
  /\bversion\b/i,
  /\binstalled\b/i,
  /\bactive\b/i,
  /\binactive\b/i,
];

/**
 * Classify a search query as content, metadata, or both.
 * Returns 'both' whenever any metadata signal is detected so the user
 * always sees metadata results when relevant — they can override via the mode pill.
 */
export function classifyIntent(query: string): SearchIntent {
  if (METADATA_SIGNALS.some(p => p.test(query))) return 'both';
  return 'content';
}
```

- [ ] **Step 4: Run tests to verify passing**

```bash
npm test -- --testPathPattern="classifyIntent" --no-coverage 2>&1 | tail -10
```
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/search/classifyIntent.ts tests/unit/search/classifyIntent.test.ts
git commit -m "feat(ux-consolidation): add classifyIntent — heuristic search intent classifier"
```

---

## Task 3: Metadata search

**Goal:** A function that searches graph.db plugins/themes tables AND SiteMetadataCache for sites matching a query string. Returns typed `MetadataSearchResult[]`.

**Important:** The function accepts two sources: `db` (graph.db) for WPE plugin data and `metadataCache` for local plugin data. Both are searched and results merged.

**Files:**
- Create: `src/main/search/metadataSearch.ts`
- Create: `tests/unit/search/metadataSearch.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/search/metadataSearch.test.ts
import { searchMetadata } from '../../../src/main/search/metadataSearch';
import type { MetadataSearchResult } from '../../../src/common/types';

const mockDb = {
  prepare: jest.fn().mockReturnValue({
    all: jest.fn().mockReturnValue([
      { site_id: 'wpe-abc', slug: 'elementor/elementor.php', name: 'Elementor', version: '3.21.0', is_active: 1, site_name: 'acme-prod', source: 'wpe-capi' },
    ]),
  }),
};

const mockMetadataCache = {
  getAll: jest.fn().mockReturnValue({
    'local-123': {
      plugins: [
        { name: 'elementor', title: 'Elementor', version: '3.18.0', status: 'inactive' },
      ],
    },
  }),
  getSiteNames: jest.fn().mockReturnValue({ 'local-123': 'my-local' }),
};

test('searchMetadata finds plugins in graph.db', () => {
  const results = searchMetadata('elementor', mockDb as any, null, 10);
  const wpeResult = results.find(r => r.siteId === 'wpe-abc');
  expect(wpeResult).toBeDefined();
  expect(wpeResult!.matchKind).toBe('plugin');
  expect(wpeResult!.siteSource).toBe('wpe');
});

test('searchMetadata finds plugins in local metadata cache', () => {
  const results = searchMetadata('elementor', null, mockMetadataCache as any, 10);
  const localResult = results.find(r => r.siteId === 'local-123');
  expect(localResult).toBeDefined();
  expect(localResult!.siteSource).toBe('local');
  expect(localResult!.value).toContain('inactive');
});

test('searchMetadata returns empty array when query too short', () => {
  const results = searchMetadata('el', mockDb as any, null, 10);
  expect(results).toEqual([]);
});

test('searchMetadata deduplicates same site+plugin from both sources', () => {
  const results = searchMetadata('elementor', mockDb as any, mockMetadataCache as any, 10);
  const siteIds = results.map(r => r.siteId);
  const uniqueSiteIds = new Set(siteIds);
  // Same site can appear once per matched plugin, but not twice for the same plugin
  expect(siteIds.length).toBe(uniqueSiteIds.size + (siteIds.length - uniqueSiteIds.size));
  // wpe-abc and local-123 are different sites, so both appear
  expect(results.some(r => r.siteId === 'wpe-abc')).toBe(true);
  expect(results.some(r => r.siteId === 'local-123')).toBe(true);
});
```

- [ ] **Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="metadataSearch" --no-coverage 2>&1 | tail -10
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/search/metadataSearch.ts`**

```typescript
import type { MetadataSearchResult } from '../../common/types';

interface MetadataCacheAccessor {
  getAll(): Record<string, { plugins?: Array<{ name: string; title: string; version?: string; status: string }>; themes?: Array<{ name: string; title: string; version?: string; status: string }> } | null>;
  getSiteNames(): Record<string, string>;
}

/**
 * Search plugins, themes, and version data across graph.db (WPE) and
 * SiteMetadataCache (local sites). Returns typed MetadataSearchResult[].
 *
 * @param query     Raw search string from the user
 * @param db        graph.db Database instance (may be null)
 * @param cache     SiteMetadataCache accessor (may be null)
 * @param limit     Max results to return
 */
export function searchMetadata(
  query: string,
  db: any | null,
  cache: MetadataCacheAccessor | null,
  limit: number,
): MetadataSearchResult[] {
  const q = query.toLowerCase().trim();
  if (q.length < 3) return [];

  const results: MetadataSearchResult[] = [];

  // ── graph.db: plugins (WPE + any local sites synced to graph) ──────────
  if (db) {
    try {
      const pluginRows = db.prepare(`
        SELECT p.site_id, p.slug, p.name, p.version, p.is_active,
               s.name AS site_name, s.source
        FROM plugins p
        JOIN sites s ON s.id = p.site_id
        WHERE (LOWER(p.name) LIKE ? OR LOWER(p.slug) LIKE ?)
        LIMIT ?
      `).all(`%${q}%`, `%${q}%`, limit) as any[];

      for (const row of pluginRows) {
        const status = row.is_active ? 'active' : 'inactive';
        results.push({
          type: 'site-metadata',
          matchKind: 'plugin',
          siteId: row.site_id,
          siteName: row.site_name,
          siteSource: row.source === 'local' ? 'local' : 'wpe',
          field: row.slug,
          value: `${status} · v${row.version ?? '?'}`,
          score: row.is_active ? 1.0 : 0.7,
        });
      }

      // ── graph.db: WP/PHP version queries ──────────────────────────────
      const versionPattern = /\b(\d+\.\d[\d.]*)/;
      const vMatch = versionPattern.exec(q);
      if (vMatch) {
        const ver = vMatch[1];
        if (q.includes('php')) {
          const phpRows = db.prepare(
            `SELECT id, name, source FROM sites WHERE php_version LIKE ? AND is_active = 1 LIMIT ?`
          ).all(`${ver}%`, limit) as any[];
          for (const row of phpRows) {
            results.push({
              type: 'site-metadata', matchKind: 'php-version',
              siteId: row.id, siteName: row.name,
              siteSource: row.source === 'local' ? 'local' : 'wpe',
              field: 'php_version', value: `PHP ${ver}`, score: 0.9,
            });
          }
        } else {
          const wpRows = db.prepare(
            `SELECT id, name, source FROM sites WHERE wp_version LIKE ? AND is_active = 1 LIMIT ?`
          ).all(`${ver}%`, limit) as any[];
          for (const row of wpRows) {
            results.push({
              type: 'site-metadata', matchKind: 'wp-version',
              siteId: row.id, siteName: row.name,
              siteSource: row.source === 'local' ? 'local' : 'wpe',
              field: 'wp_version', value: `WP ${ver}`, score: 0.9,
            });
          }
        }
      }
    } catch { /* graph.db unavailable */ }
  }

  // ── SiteMetadataCache: local plugins + themes ──────────────────────────
  if (cache) {
    const allMeta = cache.getAll();
    const siteNames = cache.getSiteNames();
    for (const [siteId, meta] of Object.entries(allMeta)) {
      if (!meta) continue;
      for (const plugin of meta.plugins ?? []) {
        if (
          plugin.name.toLowerCase().includes(q) ||
          plugin.title.toLowerCase().includes(q)
        ) {
          results.push({
            type: 'site-metadata', matchKind: 'plugin',
            siteId, siteName: siteNames[siteId] ?? siteId,
            siteSource: 'local',
            field: plugin.name,
            value: `${plugin.status} · v${plugin.version ?? '?'}`,
            score: plugin.status === 'active' ? 1.0 : 0.7,
          });
        }
      }
      for (const theme of meta.themes ?? []) {
        if (
          theme.name.toLowerCase().includes(q) ||
          theme.title.toLowerCase().includes(q)
        ) {
          results.push({
            type: 'site-metadata', matchKind: 'theme',
            siteId, siteName: siteNames[siteId] ?? siteId,
            siteSource: 'local',
            field: theme.name,
            value: `${theme.status} · v${theme.version ?? '?'}`,
            score: theme.status === 'active' ? 1.0 : 0.6,
          });
        }
      }
    }
  }

  // Sort by score descending, cap at limit
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run tests to verify passing**

```bash
npm test -- --testPathPattern="metadataSearch" --no-coverage 2>&1 | tail -10
```
Expected: PASS (4 tests).

- [ ] **Step 5: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/main/search/metadataSearch.ts tests/unit/search/metadataSearch.test.ts
git commit -m "feat(ux-consolidation): add metadataSearch — query plugins/themes/versions across graph.db and metadata cache"
```

---

## Task 4: Update SEARCH_UNIFIED IPC handler + add FLEET_COMPLETENESS

**Goal:** `SEARCH_UNIFIED` now classifies intent and runs metadata search alongside content search. `FLEET_COMPLETENESS` computes Scanned/Configured/Searchable counts from both local and WPE data.

**Files:**
- Modify: `src/main/ipc-handlers.ts`

**Context about existing handler:**
`SEARCH_UNIFIED` is at line ~1499 in `src/main/ipc-handlers.ts`. It currently calls `searchService.search(params)` and returns flat results. The handler has access to `graphService`, `metadataCache`, `indexRegistry`, and `embeddingService` via closure.

`SiteMetadataCache` (the `metadataCache` variable in the handler closure) has:
- `metadataCache.get(siteId)` → `SiteMetadataWithAge | null`
- `metadataCache.getAll()` → `Record<string, SiteMetadata>`
- Needs a `getSiteNames()` helper — build from `siteData.getSites()`

- [ ] **Step 1: Update SEARCH_UNIFIED handler**

Find the `safeHandle(IPC_CHANNELS.SEARCH_UNIFIED, ...)` block and replace it:

```typescript
safeHandle(IPC_CHANNELS.SEARCH_UNIFIED, async (
  _event: any,
  params: { query: string; mode?: 'auto' | 'content' | 'metadata'; limit?: number }
) => {
  const { query, mode = 'auto', limit = 10 } = params;
  if (!query?.trim()) return { intent: 'content', metadataResults: [], contentResults: [] };

  const { classifyIntent } = require('./search/classifyIntent');
  const { searchMetadata } = require('./search/metadataSearch');

  // Determine intent — mode pill overrides auto-classification
  let intent: import('../common/types').SearchIntent;
  if (mode === 'content') intent = 'content';
  else if (mode === 'metadata') intent = 'metadata';
  else intent = classifyIntent(query);

  // Build cache accessor for local plugin/theme data
  const cacheAccessor = metadataCache ? {
    getAll: () => {
      const all = metadataCache.getAll?.() ?? {};
      return all;
    },
    getSiteNames: () => {
      const sites = siteData.getSites();
      const names: Record<string, string> = {};
      Object.values(sites).forEach((s: any) => { names[s.id] = s.name; });
      return names;
    },
  } : null;

  const db = graphService?.getDb?.() ?? null;

  // Run searches in parallel based on intent
  const [metadataResults, contentResults] = await Promise.all([
    intent !== 'content'
      ? Promise.resolve(searchMetadata(query, db, cacheAccessor, limit))
      : Promise.resolve([]),
    intent !== 'metadata'
      ? searchService.search({ query, limit }).catch(() => ({ results: [] }))
      : Promise.resolve({ results: [] }),
  ]);

  // Normalise content results to ContentSearchResult shape
  const normalisedContent = ((contentResults as any).results ?? []).map((r: any) => ({
    type: 'content' as const,
    siteId: r.siteId,
    siteName: r.siteName,
    postId: r.postId,
    title: r.title,
    excerpt: (r.content ?? '').slice(0, 160),
    postType: r.postType ?? 'post',
    score: r.score ?? 0,
  }));

  return {
    intent,
    metadataResults,
    contentResults: normalisedContent,
  };
});
```

- [ ] **Step 2: Add FLEET_COMPLETENESS handler** (add after SEARCH_UNIFIED block)

```typescript
safeHandle(IPC_CHANNELS.FLEET_COMPLETENESS, () => {
  try {
    const db = graphService?.getDb?.() ?? null;
    const allLocalSites = Object.values(siteData.getSites()) as any[];
    const allRegistry = indexRegistry.listAll() as Array<{ siteId: string; state: string; lastIndexed?: number }>;
    const indexedSet = new Set(allRegistry.filter(e => e.state === 'indexed').map(e => e.siteId));

    // ── Local sites ──────────────────────────────────────────────────────
    let localScanned = 0, localConfigured = 0, localSearchable = 0;
    for (const site of allLocalSites) {
      const meta = metadataCache?.get?.(site.id);
      if (!meta) continue;
      localScanned++;
      if ((meta as any).scanDepth === 'full' || (meta as any).updateSource === 'lifecycle') localConfigured++;
      if (indexedSet.has(site.id)) localSearchable++;
    }

    // ── WPE installs ─────────────────────────────────────────────────────
    let wpeScanned = 0, wpeConfigured = 0, wpeSearchable = 0;
    let lastUpdatedMs: number | null = null;
    if (db) {
      const wpeSites = db.prepare(
        "SELECT id, wp_version, last_sync_at FROM sites WHERE source != 'local' AND is_active = 1"
      ).all() as Array<{ id: string; wp_version: string | null; last_sync_at: number | null }>;

      for (const site of wpeSites) {
        wpeScanned++;
        if (site.wp_version) wpeConfigured++;
        if (indexedSet.has(site.id)) wpeSearchable++;
        if (site.last_sync_at) {
          const ms = site.last_sync_at * 1000;
          if (!lastUpdatedMs || ms > lastUpdatedMs) lastUpdatedMs = ms;
        }
      }
    }

    const total = allLocalSites.length + wpeScanned;
    return {
      total,
      scanned:    allLocalSites.length + wpeScanned,   // always total — all sites are "known"
      configured: localConfigured + wpeConfigured,
      searchable: localSearchable + wpeSearchable,
      lastUpdatedMs,
    };
  } catch { return null; }
});
```

- [ ] **Step 3: Build**

```bash
npm run compile 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat(ux-consolidation): update SEARCH_UNIFIED with intent routing; add FLEET_COMPLETENESS handler"
```

---

## Task 5: OpportunisticScheduler

**Goal:** A class that fires `BulkOperationManager.execute({ type: 'reindex', autoStartStop: true })` on a configurable interval. Wires into `index.ts`.

**Context:** `BulkOperationManager` (at `src/main/bulk/BulkOperationManager.ts`) already implements `autoStartStop: true` — it starts halted sites, does the work, and stops them after. The scheduler just needs to trigger it on a timer.

**Files:**
- Create: `src/main/scheduler/OpportunisticScheduler.ts`
- Create: `tests/unit/scheduler/OpportunisticScheduler.test.ts`
- Modify: `src/main/index.ts` (wire in)

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/scheduler/OpportunisticScheduler.test.ts
import { OpportunisticScheduler } from '../../../src/main/scheduler/OpportunisticScheduler';

jest.useFakeTimers();

function makeDeps(overrides: Partial<Parameters<OpportunisticScheduler['start']>[0]> = {}) {
  const mockExecute = jest.fn().mockReturnValue('op-1');
  return {
    bulkOpManager: { execute: mockExecute } as any,
    siteData: { getSites: jest.fn().mockReturnValue({ 'site-1': { id: 'site-1', name: 'Site 1' } }) } as any,
    getSettings: jest.fn().mockReturnValue({
      localContentIndexAutoEnabled: true,
      localContentIndexIntervalHours: 8,
      excludedSiteIds: [],
    }),
    buildSiteNames: jest.fn().mockReturnValue({ 'site-1': 'Site 1' }),
    logger: { info: jest.fn(), warn: jest.fn() } as any,
    ...overrides,
  };
}

test('fires execute after configured interval', () => {
  const scheduler = new OpportunisticScheduler();
  const deps = makeDeps();
  scheduler.start(deps);
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  expect(deps.bulkOpManager.execute).toHaveBeenCalledWith(expect.objectContaining({
    type: 'reindex',
    options: expect.objectContaining({ autoStartStop: true }),
  }));
  scheduler.stop();
});

test('does not fire when autoEnabled is false', () => {
  const scheduler = new OpportunisticScheduler();
  const deps = makeDeps({
    getSettings: jest.fn().mockReturnValue({ localContentIndexAutoEnabled: false }),
  });
  scheduler.start(deps);
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  expect(deps.bulkOpManager.execute).not.toHaveBeenCalled();
  scheduler.stop();
});

test('excludes sites in excludedSiteIds', () => {
  const scheduler = new OpportunisticScheduler();
  const deps = makeDeps({
    getSettings: jest.fn().mockReturnValue({
      localContentIndexAutoEnabled: true,
      localContentIndexIntervalHours: 8,
      excludedSiteIds: ['site-1'],
    }),
  });
  scheduler.start(deps);
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  // site-1 is excluded — no sites to index, execute not called
  expect(deps.bulkOpManager.execute).not.toHaveBeenCalled();
  scheduler.stop();
});

test('restart re-arms with fresh settings', () => {
  const scheduler = new OpportunisticScheduler();
  const deps = makeDeps();
  scheduler.start(deps);
  scheduler.stop();
  scheduler.start(deps);
  jest.advanceTimersByTime(8 * 60 * 60 * 1000);
  expect(deps.bulkOpManager.execute).toHaveBeenCalledTimes(1);
  scheduler.stop();
});
```

- [ ] **Step 2: Run to verify failing**

```bash
npm test -- --testPathPattern="OpportunisticScheduler" --no-coverage 2>&1 | tail -10
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/scheduler/OpportunisticScheduler.ts`**

```typescript
import type { BulkOperationManager } from '../bulk/BulkOperationManager';
import type { NexusSettings } from '../../common/types';

interface SchedulerDeps {
  bulkOpManager: Pick<BulkOperationManager, 'execute'>;
  siteData: { getSites(): Record<string, any> };
  getSettings(): NexusSettings;
  buildSiteNames(siteIds: string[]): Record<string, string>;
  logger: { info(msg: string): void; warn(msg: string): void };
}

export class OpportunisticScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(deps: SchedulerDeps): void {
    this.stop();
    const settings = deps.getSettings();
    if (!settings.localContentIndexAutoEnabled) return;

    const hours = settings.localContentIndexIntervalHours ?? 8;
    if (hours <= 0) return;

    const intervalMs = hours * 3_600_000;
    this.timer = setInterval(() => this.runCycle(deps), intervalMs);
    deps.logger.info(`[OpportunisticScheduler] Started — interval ${hours}h`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  restart(deps: SchedulerDeps): void {
    this.stop();
    this.start(deps);
  }

  private runCycle(deps: SchedulerDeps): void {
    const settings = deps.getSettings();
    if (!settings.localContentIndexAutoEnabled) return;

    const excluded = new Set(settings.excludedSiteIds ?? []);
    const allSites = Object.values(deps.siteData.getSites()) as Array<{ id: string }>;
    const siteIds = allSites.map(s => s.id).filter(id => !excluded.has(id));

    if (siteIds.length === 0) {
      deps.logger.info('[OpportunisticScheduler] No eligible sites to index');
      return;
    }

    deps.logger.info(`[OpportunisticScheduler] Scheduled run — ${siteIds.length} sites`);
    deps.bulkOpManager.execute({
      type: 'reindex',
      siteIds,
      siteNames: deps.buildSiteNames(siteIds),
      options: { autoStartStop: true },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify passing**

```bash
npm test -- --testPathPattern="OpportunisticScheduler" --no-coverage 2>&1 | tail -10
```
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into `src/main/index.ts`**

Find where `BulkOperationManager` is instantiated (search for `new BulkOperationManager`). After the existing instantiation add:

```typescript
import { OpportunisticScheduler } from './scheduler/OpportunisticScheduler';

// After bulkOpManager is constructed:
const opportunisticScheduler = new OpportunisticScheduler();

// Build a helper that maps siteIds → Record<id, name>
const buildSiteNamesLocal = (ids: string[]) => {
  const sites = siteData.getSites();
  const names: Record<string, string> = {};
  ids.forEach(id => { names[id] = (sites[id] as any)?.name ?? id; });
  return names;
};

// Start scheduler after services are ready (inside the readyPromise.then block or equivalent)
opportunisticScheduler.start({
  bulkOpManager,
  siteData,
  getSettings: () => userData.get(STORAGE_KEYS.SETTINGS) as NexusSettings ?? { autoIndex: true, excludedSiteIds: [] },
  buildSiteNames: buildSiteNamesLocal,
  logger: localLogger,
});

// Re-arm when settings change (find the UPDATE_SETTINGS handler and add after save):
// opportunisticScheduler.restart({ ... same deps ... });
```

Find the `UPDATE_SETTINGS` safeHandle block and add `opportunisticScheduler.restart(...)` after the settings are saved.

- [ ] **Step 6: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add src/main/scheduler/OpportunisticScheduler.ts tests/unit/scheduler/OpportunisticScheduler.test.ts src/main/index.ts
git commit -m "feat(ux-consolidation): add OpportunisticScheduler — interval-based fleet indexer with auto-start/stop"
```

---

## Task 6: FleetCompletenessWidget + Overview redesign

**Goal:** Replace the three store cards (renderIndexCard / renderGraphCard / renderWpeSyncCard) in the Overview with a single `FleetCompletenessWidget` that shows three progress bars.

**Important context — class-based React rules:**
- Use `React.createElement` only — no JSX
- No hooks — all state lives in class component state
- `injectThemeVars()` is called in `componentDidMount`
- CSS vars: `--nxai-card-bg`, `--nxai-card-border`, `--nxai-card-sub`, `--nxai-card-text`

**Files:**
- Create: `src/renderer/components/FleetCompletenessWidget.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx`

- [ ] **Step 1: Create `src/renderer/components/FleetCompletenessWidget.tsx`**

```typescript
/**
 * FleetCompletenessWidget
 *
 * Shows three progress bars (Scanned / Configured / Searchable) representing
 * how deeply Nexus knows each site. Fetches its own data via FLEET_COMPLETENESS IPC.
 * Class-based, React.createElement only — no JSX, no hooks.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import type { FleetCompleteness } from '../../common/types';

interface FleetCompletenessWidgetProps {
  electron: any;
  onIndexAll?: () => void;
  onSchedule?: () => void;
}

interface FleetCompletenessWidgetState {
  data: FleetCompleteness | null;
  loading: boolean;
}

export class FleetCompletenessWidget extends React.Component<FleetCompletenessWidgetProps, FleetCompletenessWidgetState> {
  private mounted = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  state: FleetCompletenessWidgetState = { data: null, loading: true };

  componentDidMount(): void {
    this.mounted = true;
    this.load();
    this.pollTimer = setInterval(() => this.load(), 30_000);
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async load(): Promise<void> {
    const data = await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.FLEET_COMPLETENESS)
      .catch(() => null);
    if (this.mounted) this.setState({ data, loading: false });
  }

  ago(ms: number | null): string {
    if (!ms) return 'never';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  renderBar(label: string, description: string, count: number, total: number, color: string): React.ReactNode {
    const pct = total > 0 ? (count / total) * 100 : 0;
    return React.createElement('div', { style: { marginBottom: 14 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: 600, color, minWidth: 90 } }, label),
        React.createElement('div', { style: { flex: 1, background: 'var(--nxai-code-bg, #1f1f1f)', borderRadius: 3, height: 6, overflow: 'hidden' } },
          React.createElement('div', { style: { height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.6s' } }),
        ),
        React.createElement('span', { style: { fontSize: 12, fontWeight: 700, minWidth: 60, textAlign: 'right' as const } }, `${count}/${total}`),
        React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', minWidth: 36, textAlign: 'right' as const } }, `${Math.round(pct)}%`),
      ),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', paddingLeft: 98 } }, description),
    );
  }

  render(): React.ReactNode {
    const { data, loading } = this.state;
    const { onIndexAll, onSchedule } = this.props;
    const total = data?.total ?? 0;

    return React.createElement('div', {
      style: { background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 10, padding: '14px 18px' },
    },
      React.createElement('div', { style: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--nxai-card-sub, #6b7280)', marginBottom: 14 } }, 'Data completeness'),

      loading
        ? React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)' } }, 'Loading…')
        : React.createElement('div', null,
            this.renderBar('Scanned',    'WP version · installed plugins/themes known', data?.scanned ?? 0,    total, '#51BB7B'),
            this.renderBar('Configured', 'Active plugins · users · post counts known',  data?.configured ?? 0, total, '#a78bfa'),
            this.renderBar('Searchable', 'Posts · pages · custom content indexed',       data?.searchable ?? 0, total, '#0ECAD4'),
          ),

      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--nxai-card-border, #30363d)' } },
        React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' } },
          data?.lastUpdatedMs ? `Last updated ${this.ago(data.lastUpdatedMs)}` : 'Not yet synced',
        ),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          onIndexAll ? React.createElement('button', {
            onClick: onIndexAll,
            style: { padding: '4px 10px', borderRadius: 5, background: '#0ECAD4', color: '#000', fontWeight: 700, fontSize: 11, border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
          }, '⚡ Index all') : null,
          onSchedule ? React.createElement('button', {
            onClick: onSchedule,
            style: { padding: '4px 10px', borderRadius: 5, background: 'transparent', color: 'var(--nxai-card-sub, #6b7280)', fontSize: 11, border: '1px solid var(--nxai-card-border, #30363d)', cursor: 'pointer', fontFamily: 'inherit' },
          }, '⏱ Schedule…') : null,
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Update `src/renderer/components/NexusOverview.tsx` — import**

Add import near the top (after existing imports):
```typescript
import { FleetCompletenessWidget } from './FleetCompletenessWidget';
```

- [ ] **Step 3: Update renderOverviewTab — replace three store cards**

Find `renderOverviewTab()` in `NexusOverview.tsx`. Locate the block that calls `this.renderIndexCard(stats)`, `this.renderGraphCard()`, and `this.renderWpeSyncCard()`.

Replace that entire row with:
```typescript
React.createElement(FleetCompletenessWidget, {
  electron: this.props.electron,
  onIndexAll: () => this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.INDEX_ALL_AUTO).catch(() => {}),
  onSchedule: () => this.setState({ activeTab: 'system' }),
}),
```

- [ ] **Step 4: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/FleetCompletenessWidget.tsx src/renderer/components/NexusOverview.tsx
git commit -m "feat(ux-consolidation): add FleetCompletenessWidget; replace Overview store cards with completeness bars"
```

---

## Task 7: SearchTab — unified search UI

**Goal:** New `SearchTab` component replacing `DiscoverTab`. Shows a single search box with intent pills (Auto / Content / Site Metadata), runs `SEARCH_UNIFIED`, and displays results in All / Sites / Content tabs.

**Files:**
- Create: `src/renderer/components/SearchTab.tsx`
- Modify: `src/renderer/components/NexusOverview.tsx` (wire in, rename tab)
- Delete: `src/renderer/components/DiscoverTab.tsx` (after wiring)

- [ ] **Step 1: Create `src/renderer/components/SearchTab.tsx`**

```typescript
/**
 * SearchTab — Unified fleet search.
 *
 * One search box queries both content vectors (LanceDB) and fleet metadata
 * (graph.db plugins/themes/versions). Results appear in tabbed columns:
 * All / Sites / Content.
 *
 * Mode pills: Auto (intent-detected) | Content | Site Metadata.
 *
 * Class-based, React.createElement only — no JSX, no hooks (Local React).
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../common/constants';
import { injectThemeVars } from '../utils/theme';
import type { UnifiedSearchResponse, MetadataSearchResult, ContentSearchResult, SearchIntent } from '../../common/types';

type SearchMode = 'auto' | 'content' | 'metadata';
type ResultTab = 'all' | 'sites' | 'content';

interface SearchTabProps {
  electron: any;
  indexedCount: number;   // How many sites have content indexed
  totalSites: number;     // Total sites in fleet
  hasApiKey: boolean;     // Whether AI-powered intent detection is available
}

interface SearchTabState {
  query: string;
  mode: SearchMode;
  activeResultTab: ResultTab;
  searching: boolean;
  response: UnifiedSearchResponse | null;
}

export class SearchTab extends React.Component<SearchTabProps, SearchTabState> {
  private mounted = false;

  state: SearchTabState = {
    query: '',
    mode: 'auto',
    activeResultTab: 'all',
    searching: false,
    response: null,
  };

  componentDidMount(): void {
    this.mounted = true;
    injectThemeVars();
  }

  componentWillUnmount(): void {
    this.mounted = false;
  }

  handleSearch = async (): Promise<void> => {
    const q = this.state.query.trim();
    if (!q) return;
    this.setState({ searching: true, response: null });

    const res: UnifiedSearchResponse | null = await this.props.electron.ipcRenderer
      .invoke(IPC_CHANNELS.SEARCH_UNIFIED, { query: q, mode: this.state.mode, limit: 15 })
      .catch(() => null);

    if (!this.mounted) return;

    // Auto-select result tab based on what came back
    let activeResultTab: ResultTab = 'all';
    if (res) {
      if (res.metadataResults.length > 0 && res.contentResults.length === 0) activeResultTab = 'sites';
      else if (res.contentResults.length > 0 && res.metadataResults.length === 0) activeResultTab = 'content';
    }

    this.setState({ searching: false, response: res, activeResultTab });
  };

  renderModePills(): React.ReactNode {
    const { mode } = this.state;
    const { hasApiKey } = this.props;
    const pills: Array<{ key: SearchMode; label: string }> = [
      { key: 'auto', label: 'Auto' },
      { key: 'content', label: 'Content' },
      { key: 'metadata', label: 'Site Metadata' },
    ];
    return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 } },
      ...pills.map(p =>
        React.createElement('button', {
          key: p.key,
          onClick: () => this.setState({ mode: p.key }),
          style: {
            padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: p.key === mode ? 700 : 400,
            background: p.key === mode ? 'rgba(14,202,212,0.15)' : 'transparent',
            color: p.key === mode ? '#0ECAD4' : 'var(--nxai-card-sub, #6b7280)',
            border: `1px solid ${p.key === mode ? 'rgba(14,202,212,0.3)' : 'var(--nxai-card-border, #30363d)'}`,
            cursor: 'pointer', fontFamily: 'inherit',
          },
        }, (p.key === 'auto' && mode === 'auto' ? '● ' : '') + p.label),
      ),
      hasApiKey
        ? React.createElement('span', { style: { fontSize: 10, color: '#0ECAD4', marginLeft: 6 } }, '✦ AI-powered')
        : React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)', marginLeft: 6 } }, 'Heuristic intent'),
    );
  }

  renderResultTabs(metaCount: number, contentCount: number): React.ReactNode {
    const { activeResultTab } = this.state;
    const total = metaCount + contentCount;
    const tabs: Array<{ key: ResultTab; label: string; count: number }> = [
      { key: 'all',     label: 'All',          count: total },
      { key: 'sites',   label: 'Sites',         count: metaCount },
      { key: 'content', label: 'Content',       count: contentCount },
    ];
    return React.createElement('div', { style: { display: 'flex', gap: 0, borderBottom: '1px solid var(--nxai-card-border, #30363d)', marginBottom: 12 } },
      ...tabs.map(t =>
        React.createElement('button', {
          key: t.key,
          onClick: () => this.setState({ activeResultTab: t.key }),
          style: {
            padding: '6px 14px', fontSize: 12, fontWeight: t.key === activeResultTab ? 600 : 400,
            color: t.key === activeResultTab ? 'var(--nxai-card-text, #e6edf3)' : 'var(--nxai-card-sub, #6b7280)',
            background: 'transparent', border: 'none',
            borderBottom: t.key === activeResultTab ? '2px solid #0ECAD4' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1,
          },
        }, `${t.label} (${t.count})`),
      ),
    );
  }

  renderMetadataResult(r: MetadataSearchResult, i: number): React.ReactNode {
    const dotColor = r.siteSource === 'wpe' ? '#0ECAD4' : '#51BB7B';
    const sourceBadge = r.siteSource === 'wpe' ? 'WPE' : 'Local';
    const isActive = r.value.startsWith('active');
    return React.createElement('div', {
      key: `${r.siteId}-${r.field}-${i}`,
      style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid rgba(42,47,61,0.4)', fontSize: 12 },
    },
      React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: isActive ? dotColor : '#444', flexShrink: 0 } }),
      React.createElement('span', { style: { flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } }, r.siteName),
      React.createElement('span', { style: { fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(14,202,212,0.08)', color: '#0ECAD4', border: '1px solid rgba(14,202,212,0.15)' } }, 'plugin'),
      React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' } }, r.value),
      React.createElement('span', { style: { fontSize: 10, color: '#444', marginLeft: 4 } }, sourceBadge),
    );
  }

  renderContentResult(r: ContentSearchResult, i: number): React.ReactNode {
    return React.createElement('div', {
      key: `${r.siteId}-${r.postId}-${i}`,
      style: { padding: '10px 12px', borderBottom: '1px solid rgba(42,47,61,0.4)' },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 } },
        React.createElement('span', { style: { fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(81,187,123,0.08)', color: '#51BB7B', border: '1px solid rgba(81,187,123,0.15)' } }, 'content'),
        React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } }, r.siteName),
        React.createElement('span', { style: { fontSize: 10, color: '#333', marginLeft: 'auto' } }, r.score.toFixed(2)),
      ),
      React.createElement('div', { style: { fontSize: 13, fontWeight: 500, marginBottom: 3 } }, r.title),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', lineHeight: 1.5 } }, r.excerpt),
    );
  }

  renderResults(): React.ReactNode {
    const { response, activeResultTab } = this.state;
    if (!response) return null;

    const { metadataResults, contentResults } = response;
    const showMeta    = activeResultTab === 'all' || activeResultTab === 'sites';
    const showContent = activeResultTab === 'all' || activeResultTab === 'content';
    const SHOW_MAX = 8;

    const visibleMeta    = showMeta    ? metadataResults.slice(0, SHOW_MAX) : [];
    const visibleContent = showContent ? contentResults.slice(0,  SHOW_MAX) : [];
    const hiddenMeta     = showMeta    ? Math.max(0, metadataResults.length - SHOW_MAX) : 0;

    return React.createElement('div', { style: { border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 8, overflow: 'hidden' } },
      ...visibleMeta.map((r, i) => this.renderMetadataResult(r, i)),
      hiddenMeta > 0
        ? React.createElement('div', { style: { padding: '8px 12px', fontSize: 11, color: '#0ECAD4', cursor: 'pointer' } }, `+ ${hiddenMeta} more sites`)
        : null,
      visibleMeta.length > 0 && visibleContent.length > 0
        ? React.createElement('div', { style: { height: 1, background: 'var(--nxai-card-border, #30363d)' } })
        : null,
      ...visibleContent.map((r, i) => this.renderContentResult(r, i)),
      visibleMeta.length === 0 && visibleContent.length === 0
        ? React.createElement('div', { style: { padding: 32, textAlign: 'center' as const, color: 'var(--nxai-card-sub, #6b7280)', fontSize: 12 } }, 'No results found')
        : null,
    );
  }

  render(): React.ReactNode {
    const { query, searching, response } = this.state;
    const { indexedCount, totalSites } = this.props;
    const metaCount    = response?.metadataResults.length ?? 0;
    const contentCount = response?.contentResults.length ?? 0;
    const hasResults   = !!response;

    const SUGGESTIONS = ['customer feedback', 'Elementor', 'PHP 7.4', 'pricing page'];

    return React.createElement('div', { style: { padding: '20px 24px' } },

      // Search box
      React.createElement('div', { style: { position: 'relative' as const, maxWidth: 640, marginBottom: 10 } },
        React.createElement('span', { style: { position: 'absolute' as const, left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--nxai-card-sub, #6b7280)', pointerEvents: 'none' } }, '⌕'),
        React.createElement('input', {
          type: 'text', value: query,
          placeholder: `Search across ${totalSites} sites…`,
          onChange: (e: any) => this.setState({ query: e.target.value }),
          onKeyDown: (e: any) => { if (e.key === 'Enter') this.handleSearch(); },
          style: { width: '100%', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 10, color: 'inherit', padding: '11px 42px 11px 44px', fontSize: 14, outline: 'none', fontFamily: 'inherit' },
        }),
        React.createElement('span', { style: { position: 'absolute' as const, right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#444', background: '#252525', borderRadius: 4, padding: '2px 5px', fontFamily: 'monospace' } }, '↵'),
      ),

      // Mode pills
      this.renderModePills(),

      // Suggestions (only when no results yet)
      !hasResults && !searching
        ? React.createElement('div', { style: { marginBottom: 20, fontSize: 11, color: '#444' } },
            'Try: ',
            ...SUGGESTIONS.map((s, i) =>
              React.createElement('span', {
                key: s, onClick: () => this.setState({ query: s }, () => this.handleSearch()),
                style: { color: '#0ECAD4', cursor: 'pointer', marginLeft: i === 0 ? 0 : 6 },
              }, s + (i < SUGGESTIONS.length - 1 ? ' ·' : '')),
            ),
          )
        : null,

      // Loading
      searching
        ? React.createElement('div', { style: { textAlign: 'center' as const, padding: '40px 0', color: 'var(--nxai-card-sub, #6b7280)', fontSize: 12 } }, 'Searching…')
        : null,

      // Results
      hasResults && !searching
        ? React.createElement('div', null,
            this.renderResultTabs(metaCount, contentCount),
            this.renderResults(),
            // Coverage info
            indexedCount < totalSites
              ? React.createElement('div', {
                  style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '8px 10px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 6, fontSize: 11, color: '#c8a870' },
                }, 'ℹ', ` ${totalSites - indexedCount} sites not yet indexed — content search covers ${indexedCount}/${totalSites}`)
              : null,
          )
        : null,
    );
  }
}
```

- [ ] **Step 2: Wire `SearchTab` into `NexusOverview.tsx` — update imports**

```typescript
// Remove:
import { DiscoverTab } from './DiscoverTab';
// Add:
import { SearchTab } from './SearchTab';
```

- [ ] **Step 3: Update `NexusOverviewState` activeTab union type**

Find:
```typescript
activeTab: 'overview' | 'discover' | 'activity' | 'operations' | 'system';
```
Replace with:
```typescript
activeTab: 'overview' | 'search' | 'activity' | 'operations' | 'system';
```

- [ ] **Step 4: Update initial state**

Find `activeTab: 'discover'` in initial state and change to `activeTab: 'search'`.

- [ ] **Step 5: Update `renderTabBar()`**

Find the tabs array:
```typescript
{ key: 'discover', label: 'Discover', isNew: true },
```
Replace with:
```typescript
{ key: 'search', label: 'Search' },
```

- [ ] **Step 6: Update `renderActiveTab()`**

Find where `DiscoverTab` is rendered (likely inside `renderActiveTab()` or a switch). Replace:
```typescript
// Remove DiscoverTab render, add SearchTab:
if (activeTab === 'search') {
  const indexedCount = this.props.indexEntries?.filter((e: any) => e.state === 'indexed').length ?? 0;
  const totalSites = (this.props.sites?.length ?? 0) + (this.state.stats?.wpeInstallCount ?? 0);
  return React.createElement(SearchTab, {
    electron: this.props.electron,
    indexedCount,
    totalSites,
    hasApiKey: !!(this.state.stats?.hasApiKey),
  });
}
```

- [ ] **Step 7: Delete DiscoverTab**

```bash
rm src/renderer/components/DiscoverTab.tsx
```

- [ ] **Step 8: Build**

```bash
npm run compile 2>&1 | tail -5
```
Expected: no errors (all references to DiscoverTab removed).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/SearchTab.tsx src/renderer/components/NexusOverview.tsx
git rm src/renderer/components/DiscoverTab.tsx
git commit -m "feat(ux-consolidation): add SearchTab with unified search; replace DiscoverTab; rename 'Discover' tab to 'Search'"
```

---

## Task 8: System tab redesign — level dots per site

**Goal:** Replace the four summary bars (Metadata Cache / Content Index / Graph Plugins / Graph Users) with a per-site level indicator using `●●●` dots. Each row shows level label and last-updated time. Clicking a row expands to show what each level contains for that site and what's missing.

The WPE summary section (added in an earlier commit) stays. The four summary bars at top are removed. The per-site matrix columns change from 5 (metadata/content/plugins/users) to 3 (status/level/actions).

**Files:**
- Modify: `src/renderer/components/SystemTab.tsx`

- [ ] **Step 1: Add `computeLevel` helper method to SystemTab class**

Add inside the `SystemTab` class (after the `ago()` method):

```typescript
computeLevel(
  metadata: SiteMetadata | null,
  entry: IndexEntry | undefined,
): { level: 0 | 1 | 2 | 3; label: string; dots: string } {
  if (!metadata) return { level: 0, label: 'Unknown', dots: '○○○' };
  // L1: any metadata at all
  // L2: full WP-CLI scan (plugins known with active status + userCount)
  const isConfigured = metadata.plugins !== undefined && metadata.plugins.length > 0;
  // L3: content indexed
  const isSearchable = entry?.state === 'indexed';

  if (isSearchable) return { level: 3, label: 'Searchable', dots: '●●●' };
  if (isConfigured) return { level: 2, label: 'Configured', dots: '●●○' };
  return { level: 1, label: 'Scanned', dots: '●○○' };
}
```

- [ ] **Step 2: Add `expandedSiteId` to state**

Add to `SystemTabState` interface:
```typescript
expandedSiteId: string | null;
```

Add to initial state:
```typescript
expandedSiteId: null,
```

- [ ] **Step 3: Replace the four summary cards section with a scheduling status line**

Find the `this.renderSummaryCard(...)` calls (the four-card grid). Replace the entire four-card section with:

```typescript
React.createElement('div', {
  style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 6, marginBottom: 14, fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' },
},
  React.createElement('span', null, '⏱'),
  React.createElement('span', null, 'Auto-refresh: Every 8h · next run calculated from settings'),
  React.createElement('span', { style: { marginLeft: 'auto', color: '#0ECAD4', cursor: 'pointer' } }, '→ Configure in Preferences'),
),
```

- [ ] **Step 4: Replace the five-column site matrix with the three-column level matrix**

Replace the `grid` constant and the header/rows entirely:

```typescript
// New grid: name | status | level | actions
const grid = '160px 72px 1fr 120px';
```

Replace the header row:
```typescript
React.createElement('div', { style: { display: 'grid', gridTemplateColumns: grid, background: 'var(--nxai-code-bg, #1f1f1f)', borderBottom: '1px solid var(--nxai-card-border, #30363d)' } },
  React.createElement('div', { style: mch }, 'Site'),
  React.createElement('div', { style: mch }, 'Status'),
  React.createElement('div', { style: mch }, 'Level'),
  React.createElement('div', { style: mch }),
),
```

Replace the row rendering inside `.map()`:

```typescript
...sites.map((site, i) => {
  const entry    = indexEntries.find(e => e.siteId === site.id);
  const sd       = siteData[site.id];
  const live     = liveProgress[site.id];
  const action   = actionInProgress[site.id];
  const running  = site.status === 'running';
  const expanded = this.state.expandedSiteId === site.id;
  const { level, label, dots } = this.computeLevel(sd?.metadata ?? null, entry);

  const dotColor: Record<number, string> = { 0: '#333', 1: '#51BB7B', 2: '#a78bfa', 3: '#0ECAD4' };
  const levelAge = entry?.lastIndexed
    ? this.ago(entry.lastIndexed)
    : sd?.metadata?.lastUpdated
    ? this.ago(sd.metadata.lastUpdated)
    : null;

  const border = i < sites.length - 1 ? '1px solid rgba(42,47,61,.4)' : 'none';

  return React.createElement('div', { key: site.id },
    // Main row
    React.createElement('div', {
      style: { display: 'grid', gridTemplateColumns: grid, alignItems: 'center', borderBottom: border, cursor: 'pointer' },
      onClick: () => this.setState(prev => ({ expandedSiteId: prev.expandedSiteId === site.id ? null : site.id })),
    },
      // Name
      React.createElement('div', { style: { ...mc, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } },
        React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)', fontSize: 10, marginRight: 4 } }, expanded ? '▼' : '▶'),
        site.name,
      ),
      // Status
      React.createElement('div', { style: mc },
        React.createElement('span', {
          style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6,
            background: running ? 'rgba(81,187,123,.1)' : 'rgba(107,114,128,.08)',
            color: running ? '#51BB7B' : 'var(--nxai-card-sub, #6b7280)',
            border: `1px solid ${running ? 'rgba(81,187,123,.2)' : 'rgba(107,114,128,.15)'}` },
        },
          React.createElement('div', { style: { width: 5, height: 5, borderRadius: '50%', background: 'currentColor' } }),
          running ? 'running' : 'halted',
        ),
      ),
      // Level dots + label
      React.createElement('div', { style: { ...mc, display: 'flex', alignItems: 'center', gap: 8 } },
        live?.state === 'indexing'
          ? React.createElement('div', null,
              React.createElement('span', { style: { fontSize: 11, color: '#0ECAD4' } }, `${live.progress}% indexing…`),
              React.createElement('div', { style: { background: 'var(--nxai-code-bg, #1f1f1f)', borderRadius: 2, height: 3, width: 80, overflow: 'hidden', marginTop: 3 } },
                React.createElement('div', { style: { height: '100%', width: `${live.progress}%`, background: '#0ECAD4', borderRadius: 2, transition: 'width .3s' } }),
              ),
            )
          : React.createElement('div', null,
              React.createElement('span', { style: { fontFamily: 'monospace', fontSize: 12, letterSpacing: 1, color: dotColor[level] } }, dots),
              React.createElement('span', { style: { fontSize: 11, fontWeight: 500, color: dotColor[level], marginLeft: 6 } }, label),
              levelAge
                ? React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)', marginLeft: 4 } }, levelAge)
                : null,
            ),
      ),
      // Actions
      React.createElement('div', { style: { padding: '6px 8px', display: 'flex', gap: 4 }, onClick: (e: any) => e.stopPropagation() },
        !running && !action && !live
          ? React.createElement('button', {
              onClick: () => this.props.electron.ipcRenderer.invoke('nexus-ai:start-site', { siteId: site.id }).catch(() => {}),
              style: { padding: '3px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(81,187,123,.25)', background: 'rgba(81,187,123,.1)', color: '#51BB7B', fontFamily: 'inherit' },
            }, '▸ Start')
          : null,
        running && !action && level < 3
          ? React.createElement('button', {
              onClick: () => this.handleReindex(site.id),
              style: { padding: '3px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(14,202,212,.25)', background: 'rgba(14,202,212,.08)', color: '#0ECAD4', fontFamily: 'inherit' },
            }, level === 0 ? '⚡ Index' : level < 3 ? '⚡ Index' : '↻ Re-index')
          : null,
        action ? React.createElement('span', { style: { fontSize: 10, color: '#0ECAD4' } }, '⏳…') : null,
      ),
    ),

    // Expanded detail panel
    expanded
      ? React.createElement('div', {
          style: { borderBottom: border, background: 'rgba(14,202,212,0.02)', padding: '10px 20px 12px 32px' },
        },
          ...[
            {
              done: level >= 1, label: 'Scanned',
              detail: sd?.metadata?.wpVersion
                ? `WP ${sd.metadata.wpVersion}${sd.metadata.plugins ? ` · ${sd.metadata.plugins.length} plugins installed` : ''}`
                : 'No metadata yet',
              missing: level < 1 ? 'Filesystem scan not complete' : null,
            },
            {
              done: level >= 2, label: 'Configured',
              detail: level >= 2 && sd?.metadata?.plugins
                ? `${sd.metadata.plugins.filter(p => p.status === 'active').length} active plugins · ${sd?.metadata?.userCount ?? '?'} users`
                : null,
              missing: level < 2 ? (running ? 'WP-CLI enrichment pending' : 'Site is halted — start to enrich') : null,
            },
            {
              done: level >= 3, label: 'Searchable',
              detail: level >= 3 && entry
                ? `${entry.documentCount} docs · ${entry.chunkCount} chunks`
                : null,
              missing: level < 3
                ? level < 2 ? 'Requires Configured first' : running ? 'Click ⚡ Index to index content' : 'Start site to index content'
                : null,
            },
          ].map((row, j) =>
            React.createElement('div', { key: j, style: { display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: j < 2 ? 6 : 0, fontSize: 11 } },
              React.createElement('span', { style: { color: row.done ? '#51BB7B' : 'var(--nxai-card-sub, #6b7280)', minWidth: 12 } }, row.done ? '✓' : '○'),
              React.createElement('span', { style: { fontWeight: 600, minWidth: 80, color: row.done ? 'var(--nxai-card-text, #e6edf3)' : 'var(--nxai-card-sub, #6b7280)' } }, row.label),
              row.detail
                ? React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, row.detail)
                : row.missing
                ? React.createElement('span', { style: { color: '#444', fontStyle: 'italic' } }, row.missing)
                : null,
            ),
          ),
        )
      : null,
  );
}),
```

- [ ] **Step 5: Remove the source legend** (the four coloured badge row at the top of render). Find the `...([{ col: '#51BB7B', text: 'Auto on site start…' }, ...])` section and delete it entirely.

- [ ] **Step 6: Remove `renderSummaryCard` and `renderFreshnessBar` and `getStoreCounts` methods** — they are no longer called. Remove the three methods to keep the file clean.

- [ ] **Step 7: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/SystemTab.tsx
git commit -m "feat(ux-consolidation): redesign System tab — level dots per site, expand-to-drill-down, remove 4-bar summary"
```

---

## Task 9: Preferences — local scheduler section

**Goal:** Add a "Local sites" scheduling subsection with metadata refresh interval and content index interval controls. Keep existing WPE scheduling controls but rename the section header for clarity.

**Files:**
- Modify: `src/renderer/components/NexusPreferences.tsx`

- [ ] **Step 1: Add handler methods for new settings fields**

Add to the `NexusPreferences` class (near the existing `handleWpeSyncIntervalChange`):

```typescript
handleLocalContentIndexIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
  const hours = Math.max(0, Math.min(168, parseInt(e.target.value, 10) || 0));
  this.setState(prev => {
    const next = { ...prev.settings, localContentIndexIntervalHours: hours };
    return { settings: next };
  });
};

handleLocalContentIndexAutoEnabledChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
  this.setState(prev => {
    const next = { ...prev.settings, localContentIndexAutoEnabled: e.target.checked };
    return { settings: next };
  });
};
```

- [ ] **Step 2: Find the Sync Schedule section and add Local section**

Find the section starting with `React.createElement('div', { style: labelStyle }, 'Sync Schedule')` (around line 1233). Before the existing WPE schedule rows, add a "Local sites" subsection:

```typescript
// Local sites scheduling subsection header
React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--nxai-card-sub, #6b7280)', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 8, marginTop: 4 } }, 'Local sites'),

// Content indexing interval row
React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--nxai-card-border, #30363d)' } },
  React.createElement('div', null,
    React.createElement('div', { style: { fontSize: 12, fontWeight: 500 } }, 'Content index interval'),
    React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 2 } }, 'Auto-starts halted sites, indexes content, stops them. 0 = manual only.'),
  ),
  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
    React.createElement('input', {
      type: 'checkbox',
      checked: settings.localContentIndexAutoEnabled ?? false,
      onChange: this.handleLocalContentIndexAutoEnabledChange,
    }),
    React.createElement('input', {
      type: 'number', min: 0, max: 168,
      value: settings.localContentIndexIntervalHours ?? 8,
      onChange: this.handleLocalContentIndexIntervalChange,
      disabled: !(settings.localContentIndexAutoEnabled ?? false),
      style: { width: 60, padding: '4px 6px', borderRadius: 4, background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', color: 'inherit', fontSize: 12, fontFamily: 'inherit' },
    }),
    React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' } }, 'hours'),
  ),
),

// WPE subsection header (rename existing section)
React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--nxai-card-sub, #6b7280)', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 8, marginTop: 16 } }, 'WP Engine installs'),
```

- [ ] **Step 3: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/NexusPreferences.tsx
git commit -m "feat(ux-consolidation): add local content index scheduler controls to Preferences"
```

---

## Task 10: Final build, tests, and cleanup

**Goal:** Full test run, build verification, clean up any remaining 'discover' references.

**Files:**
- Modify: any remaining references to 'discover' or DiscoverTab

- [ ] **Step 1: Find and fix remaining 'discover' references**

```bash
grep -rn "discover\|DiscoverTab\|discoverProgress" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "\.js"
```

For any hits in the renderer: update `'discover'` to `'search'`. For `discoverProgress` in types.ts and settings: rename to `searchProgress` (or remove if DiscoverTab was the only consumer — check usages first).

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --no-coverage 2>&1 | tail -30
```
Expected: existing 5 suite failures (native module, unrelated to this work) — no new failures.

- [ ] **Step 3: Full build**

```bash
npm run build 2>&1 | tail -10
```
Expected: clean build with all entry points created.

- [ ] **Step 4: Verify SEARCH_UNIFIED works end-to-end**

Start Local, open the addon, go to Search tab. Run:
- `"elementor"` → should show Sites tab results from graph.db (if WPE SSH synced)
- `"customer onboarding"` → should show Content tab results from LanceDB
- `"sites with WooCommerce"` → should classify as 'both', show Sites tab active

- [ ] **Step 5: Verify OpportunisticScheduler config is respected**

In Preferences, enable local content index auto-refresh at 0.01 hours (36 seconds) to verify it fires. Confirm BulkOperationManager is triggered. Re-disable after.

- [ ] **Step 6: Commit cleanup**

```bash
git add -A
git commit -m "feat(ux-consolidation): final cleanup — remove discover references, verify build"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|-------------|------|
| Scanned/Configured/Searchable terminology | Tasks 6, 8 |
| Overview completeness bars | Task 6 |
| Search tab replaces Discover | Task 7 |
| Intent pills: Auto / Content / Site Metadata | Task 7 |
| Result tabs: All / Sites / Content | Task 7 |
| Metadata search (plugins/themes/versions) | Task 3 |
| Intent classification (heuristic) | Task 2 |
| SEARCH_UNIFIED routes by intent | Task 4 |
| FLEET_COMPLETENESS IPC | Task 4 |
| System tab level dots ●●● | Task 8 |
| Expand row shows level breakdown | Task 8 |
| System tab scheduling status line | Task 8 |
| OpportunisticScheduler (start→index→stop) | Task 5 |
| Preferences local scheduler controls | Task 9 |
| Types + schema | Task 1 |
| DiscoverTab deleted | Task 7 |

**Placeholder scan:** None found — all tasks have exact code.

**Type consistency check:**
- `MetadataSearchResult` defined in Task 1 (types.ts), used in Tasks 3, 4, 7 ✓
- `UnifiedSearchResponse` defined in Task 1, returned by Task 4, consumed by Task 7 ✓
- `FleetCompleteness` defined in Task 1, returned by Task 4, consumed by Task 6 ✓
- `SearchIntent` defined in Task 1, used in Tasks 2, 4, 7 ✓
- `computeLevel()` returns `{ level: 0|1|2|3, label: string, dots: string }` defined in Task 8 ✓
- `OpportunisticScheduler.start(deps)` deps shape defined in Task 5, wired in Task 5 ✓
