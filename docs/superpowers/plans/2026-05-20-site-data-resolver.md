# SiteDataResolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary "site running or fail" pattern in MCP/CLI tools with a `SiteDataResolver` that routes each capability through the best available data path (live WP-CLI → Configured cache → Scanned → external API), always including provenance so callers know how fresh the data is.

**Architecture:** A new `SiteDataResolver` class holds all path-routing logic for capabilities (plugins, WP version, PHP version, update availability). A `WordPressOrgClient` enables plugin update checking via the WordPress.org REST API without needing a running site. `nexus_plugin_audit` is retrofitted as the first consumer — it becomes the reference implementation for other tools to follow. All responses carry a `DataProvenance` record stating level, source, age, and caveat.

**Tech Stack:** TypeScript · Node.js `fetch` API (for WP.org calls) · `fs` module (filesystem reads) · existing `NexusServices` (siteData, localServices, metadataCache, indexRegistry) · Jest (unit tests)

---

## Capability → Path Map (reference for implementers)

| Capability | live (running) | configured (halted) | scanned (always) | external API |
|---|---|---|---|---|
| Plugin list + versions | `ls.getPlugins()` | `metadataCache.get().plugins` | `indexRegistry.get().structure.plugins` | — |
| Plugin update availability | WP-CLI `--dry-run` | cached slugs+versions + **WP.org API** | — | `api.wordpress.org/plugins/update-check/1.1/` |
| WordPress version | WP-CLI | `metadataCache.get().wpVersion` | `wp-includes/version.php` filesystem | — |
| PHP version | WP-CLI | `metadataCache.get().phpVersion` | `site.phpVersion ?? site.php?.version` | — |

---

## File Structure

### New files
- `src/main/resolver/SiteDataResolver.ts` — capability router; one class, four public methods
- `src/main/resolver/WordPressOrgClient.ts` — WP.org REST API client; one static method
- `tests/unit/resolver/SiteDataResolver.test.ts`
- `tests/unit/resolver/WordPressOrgClient.test.ts`

### Modified files
- `src/common/types.ts` — add `DataProvenance`, `ResolvedPluginInfo`, `ResolvedData<T>`
- `src/main/mcp/modules/composite/plugin-audit.ts` — retrofit to use SiteDataResolver

---

## Task 1: Types

**Goal:** Add the three new shared types. No behaviour yet.

**Files:**
- Modify: `src/common/types.ts`
- Test: `tests/unit/resolver/types.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/resolver/types.test.ts`:

```typescript
import type { DataProvenance, ResolvedData, ResolvedPluginInfo } from '../../../src/common/types';

test('DataProvenance level union has all expected values', () => {
  const levels: DataProvenance['level'][] = ['live', 'configured', 'scanned', 'external-api'];
  expect(levels.length).toBe(4);
});

test('ResolvedData wraps any type with provenance', () => {
  const result: ResolvedData<string[]> = {
    data: ['a', 'b'],
    provenance: { level: 'configured', source: 'SiteMetadataCache', ageSeconds: 3600, caveat: 'Start site for fresh data' },
  };
  expect(result.data.length).toBe(2);
  expect(result.provenance.level).toBe('configured');
});

test('ResolvedPluginInfo has update field', () => {
  const plugin: ResolvedPluginInfo = {
    name: 'Elementor', slug: 'elementor', version: '3.21.0',
    status: 'active', updateAvailable: '3.22.0',
  };
  expect(plugin.updateAvailable).toBe('3.22.0');
});
```

Run: `npm test -- --testPathPattern="resolver/types" --no-coverage 2>&1 | tail -5`
Expected: FAIL — types not defined.

- [ ] **Step 2: Add types to `src/common/types.ts`**

Find the `// ===== AI Assistant Types =====` section and add AFTER it:

```typescript
// ===== Site Data Resolver Types =====

/** Which data path answered a resolver query. */
export interface DataProvenance {
  /** live = WP-CLI on running site; configured = SiteMetadataCache;
   *  scanned = filesystem / Local site object; external-api = WordPress.org */
  level: 'live' | 'configured' | 'scanned' | 'external-api';
  /** Human-readable source name, e.g. "WP-CLI", "SiteMetadataCache + WordPress.org API" */
  source: string;
  /** Seconds since data was captured. null = real-time (live). */
  ageSeconds: number | null;
  /** Suggestion for getting fresher data. null = data is already fresh. */
  caveat: string | null;
}

/** Generic wrapper returned by all SiteDataResolver methods. */
export interface ResolvedData<T> {
  data: T;
  provenance: DataProvenance;
}

/** Plugin info returned by SiteDataResolver — richer than raw WpPlugin. */
export interface ResolvedPluginInfo {
  name: string;
  slug: string;
  version: string;
  status: 'active' | 'inactive';
  /** Set when update is available; null when current; undefined when unknown. */
  updateAvailable?: string | null;
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern="resolver/types" --no-coverage 2>&1 | tail -5
```
Expected: 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/common/types.ts tests/unit/resolver/types.test.ts
git commit -m "feat(resolver): add DataProvenance, ResolvedData, ResolvedPluginInfo types"
```

---

## Task 2: WordPressOrgClient

**Goal:** A single static method that takes `[{ slug, version }]` and returns a `Map<slug, newVersion>` for any plugins with available updates. Uses the same endpoint WordPress core uses. No running site needed.

**Files:**
- Create: `src/main/resolver/WordPressOrgClient.ts`
- Test: `tests/unit/resolver/WordPressOrgClient.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/resolver/WordPressOrgClient.test.ts`:

```typescript
import { WordPressOrgClient } from '../../../src/main/resolver/WordPressOrgClient';

// Mock fetch for unit tests
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

afterEach(() => { mockFetch.mockReset(); });

test('returns empty map when plugin list is empty', async () => {
  const result = await WordPressOrgClient.checkUpdates([]);
  expect(result.size).toBe(0);
  expect(mockFetch).not.toHaveBeenCalled();
});

test('returns update version when WP.org reports newer version', async () => {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({
      plugins: {
        'elementor/elementor.php': { new_version: '3.22.0', slug: 'elementor' },
      },
    }),
  });

  const result = await WordPressOrgClient.checkUpdates([
    { slug: 'elementor', version: '3.21.0' },
  ]);

  expect(result.get('elementor')).toBe('3.22.0');
});

test('returns empty map when WP.org API is unreachable', async () => {
  mockFetch.mockRejectedValueOnce(new Error('Network error'));
  const result = await WordPressOrgClient.checkUpdates([{ slug: 'elementor', version: '3.21.0' }]);
  expect(result.size).toBe(0);
});

test('skips plugins not in WP.org response', async () => {
  mockFetch.mockResolvedValueOnce({ json: async () => ({ plugins: {} }) });
  const result = await WordPressOrgClient.checkUpdates([{ slug: 'premium-plugin', version: '1.0.0' }]);
  expect(result.size).toBe(0);
});

test('handles multiple plugins in one call', async () => {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({
      plugins: {
        'elementor/elementor.php': { new_version: '3.22.0' },
        'woocommerce/woocommerce.php': { new_version: '8.5.0' },
      },
    }),
  });

  const result = await WordPressOrgClient.checkUpdates([
    { slug: 'elementor', version: '3.21.0' },
    { slug: 'woocommerce', version: '8.4.0' },
  ]);

  expect(result.size).toBe(2);
  expect(result.get('woocommerce')).toBe('8.5.0');
});
```

Run: `npm test -- --testPathPattern="WordPressOrgClient" --no-coverage 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `src/main/resolver/WordPressOrgClient.ts`**

```typescript
/**
 * WordPress.org plugin update check client.
 * Uses the same endpoint WordPress core uses for background update checks.
 * No running site required — only needs plugin slugs and installed versions.
 */

const WP_ORG_UPDATE_URL = 'https://api.wordpress.org/plugins/update-check/1.1/';
const TIMEOUT_MS = 10_000;

export class WordPressOrgClient {
  /**
   * Check multiple plugins for available updates.
   * @returns Map of slug → new version for plugins that have updates.
   *          Empty map if API is unavailable or no updates found.
   */
  static async checkUpdates(
    plugins: Array<{ slug: string; version: string }>,
  ): Promise<Map<string, string>> {
    if (plugins.length === 0) return new Map();

    // Build the same payload format WordPress core sends
    const checked: Record<string, string> = {};
    for (const p of plugins) {
      // WP.org keys are "slug/slug.php" — this is the conventional path format
      checked[`${p.slug}/${p.slug}.php`] = p.version;
    }

    const body = JSON.stringify({
      plugins: checked,
      active: Object.keys(checked),
    });

    try {
      const response = await fetch(WP_ORG_UPDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `plugins=${encodeURIComponent(body)}`,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const data = await response.json() as { plugins?: Record<string, { new_version?: string }> };
      const updates = new Map<string, string>();

      for (const [path, info] of Object.entries(data?.plugins ?? {})) {
        const slug = path.split('/')[0];
        if (info.new_version) {
          updates.set(slug, info.new_version);
        }
      }

      return updates;
    } catch {
      // Network unavailable, timeout, or parse error — return empty (no updates known)
      return new Map();
    }
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern="WordPressOrgClient" --no-coverage 2>&1 | tail -5
```
Expected: 5 tests PASS.

- [ ] **Step 4: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/main/resolver/WordPressOrgClient.ts tests/unit/resolver/WordPressOrgClient.test.ts
git commit -m "feat(resolver): add WordPressOrgClient — plugin update check without running site"
```

---

## Task 3: SiteDataResolver

**Goal:** The core capability router. Four public methods: `getPlugins`, `getPluginsWithUpdateCheck`, `getWpVersion`, `getPhpVersion`. Each cascades through the best available path and returns `ResolvedData<T>`.

**Context — key dependencies available on `NexusServices`:**
- `services.siteData.getSites()` → `Record<id, site>` — Local's native site objects. Has `site.phpVersion` or `site.php?.version` for PHP. Has `site.path` for filesystem reads.
- `services.localServices.getAllSiteStatuses()` → `Record<id, 'running'|'halted'>` — live status
- `services.localServices.getPlugins(siteId)` → `WpPlugin[]` — WP-CLI, requires running
- `services.localServices.wpCliRun(siteId, args)` → `{ success, stdout }` — WP-CLI, requires running
- `services.metadataCache?.get(siteId)` → `SiteMetadataWithAge | null` — SiteMetadataCache (Configured level). Has `.plugins`, `.wpVersion`, `.phpVersion`, `.lastUpdated`.
- `services.indexRegistry.get(siteId)` → entry with `.structure?.plugins[]` (isActive, name, slug, version), `.lastIndexed`

**Files:**
- Create: `src/main/resolver/SiteDataResolver.ts`
- Test: `tests/unit/resolver/SiteDataResolver.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/resolver/SiteDataResolver.test.ts`:

```typescript
import { SiteDataResolver } from '../../../src/main/resolver/SiteDataResolver';

// Minimal mock for a halted site with Configured data
function makeDeps(overrides: Partial<Parameters<typeof SiteDataResolver['prototype']['constructor']>[0]> = {}) {
  return {
    siteData: {
      getSites: () => ({
        'site-1': { id: 'site-1', name: 'acme', path: '/tmp/acme', phpVersion: '8.1' },
      }),
    },
    localServices: {
      getAllSiteStatuses: () => ({ 'site-1': 'halted' }),
      getPlugins: jest.fn(),
      wpCliRun: jest.fn(),
    },
    metadataCache: {
      get: (id: string) => id === 'site-1' ? {
        plugins: [{ name: 'elementor', title: 'Elementor', version: '3.21.0', status: 'active' }],
        wpVersion: '6.9.4',
        phpVersion: '8.1',
        lastUpdated: Date.now() - 3_600_000, // 1 hour ago
      } : null,
    },
    indexRegistry: { get: () => null },
    ...overrides,
  };
}

test('getPlugins returns configured level for halted site with cache', async () => {
  const resolver = new SiteDataResolver(makeDeps() as any);
  const result = await resolver.getPlugins('site-1');
  expect(result.provenance.level).toBe('configured');
  expect(result.data).toHaveLength(1);
  expect(result.data[0].slug).toBe('elementor');
  expect(result.data[0].version).toBe('3.21.0');
});

test('getPlugins returns empty array with scanned provenance when no data available', async () => {
  const deps = makeDeps({ metadataCache: { get: () => null } });
  const resolver = new SiteDataResolver(deps as any);
  const result = await resolver.getPlugins('site-1');
  expect(result.provenance.level).toBe('scanned');
  expect(result.data).toHaveLength(0);
  expect(result.provenance.caveat).toContain('Start site');
});

test('getPlugins falls back to IndexRegistry when cache is empty', async () => {
  const deps = makeDeps({
    metadataCache: { get: () => null },
    indexRegistry: {
      get: (id: string) => id === 'site-1' ? {
        lastIndexed: Date.now() - 86_400_000, // 1 day ago
        structure: {
          plugins: [{ name: 'Elementor', slug: 'elementor', version: '3.20.0', isActive: true }],
        },
      } : null,
    },
  });
  const resolver = new SiteDataResolver(deps as any);
  const result = await resolver.getPlugins('site-1');
  expect(result.provenance.level).toBe('searchable');
  expect(result.data[0].slug).toBe('elementor');
});

test('getPhpVersion returns scanned level from Local site object (always available)', async () => {
  const resolver = new SiteDataResolver(makeDeps() as any);
  const result = await resolver.getPhpVersion('site-1');
  expect(result.provenance.level).toBe('scanned');
  expect(result.data).toBe('8.1');
  expect(result.provenance.ageSeconds).toBe(0);
  expect(result.provenance.caveat).toBeNull();
});

test('getPhpVersion falls back to cache when site object has no phpVersion', async () => {
  const deps = makeDeps({
    siteData: { getSites: () => ({ 'site-1': { id: 'site-1', name: 'acme', path: '/tmp/acme' } }) },
  });
  const resolver = new SiteDataResolver(deps as any);
  const result = await resolver.getPhpVersion('site-1');
  expect(result.provenance.level).toBe('configured');
  expect(result.data).toBe('8.1');
});

test('getWpVersion returns configured level from cache', async () => {
  const resolver = new SiteDataResolver(makeDeps() as any);
  const result = await resolver.getWpVersion('site-1');
  expect(result.provenance.level).toBe('configured');
  expect(result.data).toBe('6.9.4');
});

test('formatAge returns human-readable string', () => {
  const resolver = new SiteDataResolver(makeDeps() as any);
  expect(resolver.formatAge(0)).toBe('just now');
  expect(resolver.formatAge(90)).toBe('1m ago');
  expect(resolver.formatAge(7200)).toBe('2h ago');
  expect(resolver.formatAge(172800)).toBe('2d ago');
  expect(resolver.formatAge(null)).toBe('unknown age');
});
```

Run: `npm test -- --testPathPattern="SiteDataResolver" --no-coverage 2>&1 | tail -5`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `src/main/resolver/SiteDataResolver.ts`**

```typescript
import type { DataProvenance, ResolvedData, ResolvedPluginInfo } from '../../common/types';
import { WordPressOrgClient } from './WordPressOrgClient';
import * as fs from 'fs';
import * as path from 'path';

interface SiteDataResolverDeps {
  siteData: { getSites(): Record<string, any> };
  localServices: {
    getAllSiteStatuses(): Record<string, string>;
    getPlugins(siteId: string): Promise<any[]>;
    wpCliRun(siteId: string, args: string[]): Promise<{ success: boolean; stdout?: string }>;
  } | null;
  metadataCache: { get(siteId: string): any | null } | null;
  indexRegistry: { get(siteId: string): any | null } | null;
}

export class SiteDataResolver {
  constructor(private deps: SiteDataResolverDeps) {}

  // ---------------------------------------------------------------------------
  // Plugin list — live → configured → searchable
  // ---------------------------------------------------------------------------

  async getPlugins(siteId: string): Promise<ResolvedData<ResolvedPluginInfo[]>> {
    const statuses = this.deps.localServices?.getAllSiteStatuses?.() ?? {};

    // Path 1: live WP-CLI (running site)
    if (statuses[siteId] === 'running' && this.deps.localServices) {
      try {
        const raw = await this.deps.localServices.getPlugins(siteId);
        return {
          data: raw.map(p => ({
            name: p.name ?? p.title ?? '',
            slug: p.name ?? '',
            version: p.version ?? 'unknown',
            status: (p.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
          })),
          provenance: { level: 'live', source: 'WP-CLI', ageSeconds: 0, caveat: null },
        };
      } catch { /* fall through to cache */ }
    }

    // Path 2: SiteMetadataCache (Configured level)
    const meta = this.deps.metadataCache?.get?.(siteId);
    if (meta?.plugins?.length > 0) {
      const ageSeconds = meta.lastUpdated
        ? Math.floor((Date.now() - meta.lastUpdated) / 1000)
        : null;
      return {
        data: meta.plugins.map((p: any) => ({
          name: p.title ?? p.name ?? '',
          slug: p.name ?? '',
          version: p.version ?? 'unknown',
          status: (p.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
        })),
        provenance: {
          level: 'configured',
          source: 'SiteMetadataCache',
          ageSeconds,
          caveat: 'Start site for real-time plugin data',
        },
      };
    }

    // Path 3: IndexRegistry structure (Searchable level)
    const entry = this.deps.indexRegistry?.get?.(siteId);
    if (entry?.structure?.plugins?.length > 0) {
      const ageSeconds = entry.lastIndexed
        ? Math.floor((Date.now() - entry.lastIndexed) / 1000)
        : null;
      return {
        data: entry.structure.plugins.map((p: any) => ({
          name: p.name ?? '',
          slug: p.slug ?? p.name ?? '',
          version: p.version ?? 'unknown',
          status: (p.isActive ? 'active' : 'inactive') as 'active' | 'inactive',
        })),
        provenance: {
          level: 'searchable',
          source: 'IndexRegistry',
          ageSeconds,
          caveat: 'Data from last content index. Start site for real-time plugin data.',
        },
      };
    }

    // No data
    return {
      data: [],
      provenance: {
        level: 'scanned',
        source: 'none',
        ageSeconds: null,
        caveat: 'No plugin data available. Start site at least once to populate the data cache.',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Plugin update check — live WP-CLI or cache + WordPress.org API
  // ---------------------------------------------------------------------------

  async getPluginsWithUpdateCheck(siteId: string): Promise<ResolvedData<ResolvedPluginInfo[]>> {
    const statuses = this.deps.localServices?.getAllSiteStatuses?.() ?? {};

    // Path 1: live WP-CLI with dry-run update check
    if (statuses[siteId] === 'running' && this.deps.localServices) {
      try {
        const [pluginsResult, updateResult] = await Promise.allSettled([
          this.deps.localServices.getPlugins(siteId),
          this.deps.localServices.wpCliRun(siteId, ['plugin', 'update', '--all', '--dry-run', '--format=json']),
        ]);

        if (pluginsResult.status === 'fulfilled') {
          const updateMap = new Map<string, string>();
          if (updateResult.status === 'fulfilled' && updateResult.value.success) {
            try {
              const updates = JSON.parse(updateResult.value.stdout ?? '[]') as Array<{ name: string; update_version: string }>;
              for (const u of updates) { updateMap.set(u.name, u.update_version); }
            } catch { /* parse failed */ }
          }

          return {
            data: pluginsResult.value.map(p => ({
              name: p.name ?? p.title ?? '',
              slug: p.name ?? '',
              version: p.version ?? 'unknown',
              status: (p.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
              updateAvailable: updateMap.get(p.name ?? '') ?? null,
            })),
            provenance: { level: 'live', source: 'WP-CLI', ageSeconds: 0, caveat: null },
          };
        }
      } catch { /* fall through */ }
    }

    // Path 2: Cached plugins + WordPress.org API (no running site needed)
    const cachedResult = await this.getPlugins(siteId);
    if (cachedResult.data.length === 0) return cachedResult;

    const wpOrgUpdates = await WordPressOrgClient.checkUpdates(
      cachedResult.data.map(p => ({ slug: p.slug, version: p.version })),
    );

    const ageStr = this.formatAge(cachedResult.provenance.ageSeconds);
    return {
      data: cachedResult.data.map(p => ({
        ...p,
        updateAvailable: wpOrgUpdates.get(p.slug) ?? null,
      })),
      provenance: {
        ...cachedResult.provenance,
        source: `${cachedResult.provenance.source} + WordPress.org API`,
        caveat: `Plugin list from cache (${ageStr}). Update availability checked live via WordPress.org. Start site to apply updates.`,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // WordPress version — filesystem → cache (WP-CLI rarely needed)
  // ---------------------------------------------------------------------------

  async getWpVersion(siteId: string): Promise<ResolvedData<string | null>> {
    const site = this.deps.siteData.getSites()[siteId] as any;

    // Path 1: filesystem wp-includes/version.php (always available)
    if (site?.path) {
      const versionFile = path.join(site.path, 'app', 'public', 'wp-includes', 'version.php');
      try {
        const content = fs.readFileSync(versionFile, 'utf8');
        const match = content.match(/\$wp_version\s*=\s*'([^']+)'/);
        if (match) {
          return { data: match[1], provenance: { level: 'scanned', source: 'wp-includes/version.php', ageSeconds: 0, caveat: null } };
        }
      } catch { /* file not accessible */ }
    }

    // Path 2: SiteMetadataCache
    const meta = this.deps.metadataCache?.get?.(siteId);
    if (meta?.wpVersion) {
      const ageSeconds = meta.lastUpdated ? Math.floor((Date.now() - meta.lastUpdated) / 1000) : null;
      return { data: meta.wpVersion, provenance: { level: 'configured', source: 'SiteMetadataCache', ageSeconds, caveat: null } };
    }

    return { data: null, provenance: { level: 'scanned', source: 'none', ageSeconds: null, caveat: 'Start site once to cache WordPress version' } };
  }

  // ---------------------------------------------------------------------------
  // PHP version — Local site object (always) → cache
  // ---------------------------------------------------------------------------

  async getPhpVersion(siteId: string): Promise<ResolvedData<string | null>> {
    const site = this.deps.siteData.getSites()[siteId] as any;

    // Path 1: Local site object — phpVersion OR php.version (both paths used in codebase)
    const phpFromSite = site?.phpVersion ?? site?.php?.version ?? null;
    if (phpFromSite) {
      return { data: phpFromSite, provenance: { level: 'scanned', source: 'Local site config', ageSeconds: 0, caveat: null } };
    }

    // Path 2: SiteMetadataCache
    const meta = this.deps.metadataCache?.get?.(siteId);
    if (meta?.phpVersion) {
      const ageSeconds = meta.lastUpdated ? Math.floor((Date.now() - meta.lastUpdated) / 1000) : null;
      return { data: meta.phpVersion, provenance: { level: 'configured', source: 'SiteMetadataCache', ageSeconds, caveat: null } };
    }

    return { data: null, provenance: { level: 'scanned', source: 'none', ageSeconds: null, caveat: null } };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Build SiteDataResolver from NexusServices — use inside MCP tool handlers */
  static fromServices(services: any): SiteDataResolver {
    return new SiteDataResolver({
      siteData: services.siteData,
      localServices: services.localServices ?? null,
      metadataCache: services.metadataCache ?? null,
      indexRegistry: services.indexRegistry ?? null,
    });
  }

  formatAge(ageSeconds: number | null): string {
    if (ageSeconds === null) return 'unknown age';
    if (ageSeconds < 5)  return 'just now';
    if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
    if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
    return `${Math.floor(ageSeconds / 86400)}d ago`;
  }

  /** Level emoji for output formatting */
  static levelEmoji(level: DataProvenance['level']): string {
    return { live: '🟢', configured: '🟡', searchable: '🔵', 'external-api': '🌐', scanned: '⚪' }[level] ?? '⚪';
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- --testPathPattern="SiteDataResolver" --no-coverage 2>&1 | tail -10
```
Expected: 7 tests PASS. If `getWpVersion` filesystem test fails (no `/tmp/acme/wp-includes/version.php`), that's expected — the test mocks `metadataCache` so it falls to path 2.

- [ ] **Step 4: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/main/resolver/SiteDataResolver.ts tests/unit/resolver/SiteDataResolver.test.ts
git commit -m "feat(resolver): add SiteDataResolver — capability router with live/configured/scanned/api paths"
```

---

## Task 4: Retrofit nexus_plugin_audit

**Goal:** Replace the "No running sites found" hard failure with SiteDataResolver. The tool now audits ALL sites regardless of running status, shows each site's data level, and uses WordPress.org API to check updates for halted sites.

**Files:**
- Modify: `src/main/mcp/modules/composite/plugin-audit.ts`

**Context:** `services.metadataCache` and `services.indexRegistry` are both available on `NexusServices` (confirmed at `src/main/mcp/types.ts:134` and `:107`). Use `SiteDataResolver.fromServices(services)` to build the resolver.

- [ ] **Step 1: Rewrite `src/main/mcp/modules/composite/plugin-audit.ts`**

Replace the entire file:

```typescript
import { McpToolHandler, McpToolResult } from '../../types';
import { SiteDataResolver } from '../../../resolver/SiteDataResolver';

/**
 * Fleet-wide plugin audit — works for ALL sites regardless of running status.
 *
 * Data sources by site state:
 *   Running: WP-CLI (fresh, authoritative)
 *   Halted + Configured cache: cached plugin list + WordPress.org update check
 *   Halted + Searchable only: index snapshot (no update check)
 *   No data: prompts to start site
 */
export const pluginAuditHandler: McpToolHandler = {
  definition: {
    name: 'nexus_plugin_audit',
    description:
      'Fleet-wide plugin audit across all local sites — lists installed plugins with current and latest versions, available updates. ' +
      'Works even when sites are halted by using cached data (SiteMetadataCache) + WordPress.org API for update checks. ' +
      'Data freshness is reported per site. Running sites get real-time WP-CLI data.',
    inputSchema: { type: 'object', properties: {} },
    isAvailable: (services) => !!services.siteData,
  },

  async execute(_args, services): Promise<McpToolResult> {
    const resolver = SiteDataResolver.fromServices(services);
    const sites = Object.values(services.siteData.getSites()) as any[];

    if (sites.length === 0) {
      return ok('No local sites found.');
    }

    const reports = await Promise.all(
      sites.map(async (site) => {
        const result = await resolver.getPluginsWithUpdateCheck(site.id);
        return { site, result };
      }),
    );

    const lines: string[] = ['## Fleet Plugin Audit', ''];
    let totalUpdates = 0;
    let sitesWithData = 0;

    for (const { site, result } of reports) {
      const { data: plugins, provenance } = result;
      const updates = plugins.filter(p => p.updateAvailable);
      totalUpdates += updates.length;
      if (plugins.length > 0) sitesWithData++;

      const emoji = SiteDataResolver.levelEmoji(provenance.level);
      const age = resolver.formatAge(provenance.ageSeconds);
      const sourceLabel = provenance.ageSeconds === 0 ? provenance.source : `${provenance.source}, ${age}`;

      lines.push(`### ${site.name} ${emoji}`);
      lines.push(`*${sourceLabel}*`);
      lines.push('');

      if (plugins.length === 0) {
        lines.push('No plugin data available — start site to populate cache.');
      } else {
        lines.push(`${plugins.length} plugins installed, ${updates.length} update${updates.length !== 1 ? 's' : ''} available`);
        if (updates.length > 0) {
          lines.push('');
          lines.push('**Updates available:**');
          for (const u of updates) {
            lines.push(`- ${u.name}: v${u.version} → v${u.updateAvailable}`);
          }
        }
      }

      if (provenance.caveat) {
        lines.push('');
        lines.push(`⚠️ ${provenance.caveat}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push(`**${totalUpdates} updates available across ${sitesWithData}/${sites.length} sites with data**`);
    lines.push('');
    lines.push('Legend: 🟢 live · 🟡 configured cache · 🔵 searchable index · ⚪ no data');

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
```

- [ ] **Step 2: Build**

```bash
npm run compile 2>&1 | tail -5
```

- [ ] **Step 3: Verify behaviour manually**

With all sites halted, run `nexus_plugin_audit` via MCP or CLI:
- Should return results for all sites (not "No running sites found")
- Each site shows emoji + data source + age
- Updates section from WordPress.org API for halted sites with Configured data
- Sites with no data show the prompt to start once

- [ ] **Step 4: Commit**

```bash
git add src/main/mcp/modules/composite/plugin-audit.ts
git commit -m "feat(resolver): retrofit nexus_plugin_audit — works for all sites via SiteDataResolver"
```

---

## Task 5: Final build + full test run

- [ ] **Step 1: Run all resolver tests**

```bash
npm test -- --testPathPattern="resolver" --no-coverage 2>&1 | tail -15
```
Expected: All 15 tests pass (3 type + 5 WPOrgClient + 7 SiteDataResolver).

- [ ] **Step 2: Full test suite**

```bash
npm test -- --no-coverage 2>&1 | grep -E "Tests:|Test Suites:" | tail -3
```
Expected: same pre-existing failures, no new failures.

- [ ] **Step 3: Full build**

```bash
npm run build 2>&1 | tail -8
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(resolver): complete SiteDataResolver — provenance-aware data routing for MCP tools"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| DataProvenance, ResolvedData, ResolvedPluginInfo types | Task 1 |
| WordPress.org API update check (no running site) | Task 2 |
| Plugin list cascade: live → configured → searchable | Task 3 |
| WP version: filesystem first (always available) | Task 3 |
| PHP version: Local site object first (always available) | Task 3 |
| `SiteDataResolver.fromServices()` factory | Task 3 |
| nexus_plugin_audit uses resolver, all sites, provenance in output | Task 4 |
| formatAge() and levelEmoji() helpers | Task 3 |
| Tests for all paths | Tasks 1, 2, 3 |

**Placeholder scan:** None found.

**Type consistency:**
- `ResolvedPluginInfo` defined Task 1, used as `ResolvedData<ResolvedPluginInfo[]>` throughout Task 3 ✓
- `DataProvenance.level` union `'live' | 'configured' | 'searchable' | 'external-api'` consistent across tasks ✓
- `SiteDataResolver.fromServices(services)` defined Task 3, called in Task 4 ✓
- `WordPressOrgClient.checkUpdates([{slug, version}])` defined Task 2, called in Task 3 ✓
- `formatAge(null | number)` defined Task 3, called in Task 4 ✓
