/**
 * Tests for Sprint A staleness warnings across MCP tools.
 *
 * Covers: twin-helpers, compare_sites, detect_drift, find_sites_with_plugin,
 * find_sites_with_theme, fleet_health_summary, get_site_health,
 * search_site_content, search_across_sites.
 */
import { IndexRegistry, RegistryStorage } from '../../src/main/content/IndexRegistry';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, SiteDataAccessor, LocalSiteInfo } from '../../src/main/mcp/types';
import { registerFleetTools } from '../../src/main/mcp/modules/fleet/index';
import { compareSitesHandler } from '../../src/main/mcp/modules/fleet/compare-sites';
import { detectDriftHandler } from '../../src/main/mcp/modules/fleet/detect-drift';
import { findSitesWithPluginHandler } from '../../src/main/mcp/modules/fleet/find-sites-with-plugin';
import { findSitesWithThemeHandler } from '../../src/main/mcp/modules/fleet/find-sites-with-theme';
import { fleetHealthSummaryHandler } from '../../src/main/mcp/modules/fleet-intelligence/fleet-health-summary';
import { getSiteHealthHandler } from '../../src/main/mcp/modules/fleet-intelligence/get-site-health';
import { searchContentHandler } from '../../src/main/mcp/modules/content/search-content';
import { searchAcrossSitesHandler } from '../../src/main/mcp/modules/content/search-across-sites';
import { indexFreshnessWarning, fleetFreshnessWarning } from '../../src/main/twin/twin-helpers';
import { IndexEntry, SiteStructure, PluginInfo, ThemeInfo } from '../../src/common/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const FRESH = 30 * 60 * 1000; // 30 minutes — guaranteed no warning

function makePlugin(slug: string, name: string, version: string, active = true): PluginInfo {
  return { slug, name, version, isActive: active, description: '' };
}

function makeTheme(slug: string, name: string, version: string, active = false): ThemeInfo {
  return { slug, name, version, isActive: active, isChildTheme: false };
}

function makeStructure(overrides?: Partial<SiteStructure>): SiteStructure {
  return {
    themes: [makeTheme('twentytwentyfour', 'Twenty Twenty-Four', '1.2', true)],
    plugins: [makePlugin('hello-dolly', 'Hello Dolly', '1.7')],
    phpVersion: '8.2',
    wpVersion: '6.9.1',
    isMultisite: false,
    hasWooCommerce: false,
    hasACF: false,
    ...overrides,
  };
}

function makeEntry(siteId: string, lastIndexed: number, state: IndexEntry['state'] = 'indexed'): IndexEntry {
  return {
    siteId,
    siteName: `Site ${siteId}`,
    lastIndexed,
    documentCount: 10,
    chunkCount: 10,
    durationMs: 100,
    structure: makeStructure(),
    state,
  };
}

function createStorage(): RegistryStorage {
  const data: Record<string, any> = {};
  return {
    get: (key: string) => data[key] ?? null,
    set: (key: string, value: any) => { data[key] = value; },
  };
}

function createSiteData(sites: Record<string, LocalSiteInfo>): SiteDataAccessor {
  return {
    getSite: (id: string) => sites[id] ?? null,
    getSites: () => sites,
  };
}

function buildServices(
  indexRegistry: IndexRegistry,
  siteData: SiteDataAccessor,
  extra?: Partial<NexusServices>,
): NexusServices {
  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry,
    fileScanner: {} as any,
    siteData,
    logger: { info: () => {}, error: () => {} },
    ...extra,
  };
}

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// twin-helpers unit tests
// ---------------------------------------------------------------------------

describe('twin-helpers', () => {
  describe('indexFreshnessWarning', () => {
    test('returns null when indexed < 1h ago', () => {
      const entry = makeEntry('s1', Date.now() - 30 * 60 * 1000);
      expect(indexFreshnessWarning(entry)).toBeNull();
    });

    test('returns inline note when indexed 1–24h ago', () => {
      const entry = makeEntry('s1', Date.now() - 2 * HOUR);
      const result = indexFreshnessWarning(entry);
      expect(result).toBeTruthy();
      expect(result).not.toContain('⚠️');
      expect(result).not.toContain('❌');
    });

    test('returns ⚠️ warning when indexed > 24h ago', () => {
      const entry = makeEntry('s1', Date.now() - 25 * HOUR);
      const result = indexFreshnessWarning(entry);
      expect(result).toContain('⚠️');
      expect(result).toContain('reindex_site');
    });

    test('returns ❌ warning when indexed > 7d ago', () => {
      const entry = makeEntry('s1', Date.now() - 8 * DAY);
      const result = indexFreshnessWarning(entry);
      expect(result).toContain('❌');
      expect(result).toContain('reindex_site');
    });

    test('returns ❌ for error state regardless of age', () => {
      const entry = makeEntry('s1', Date.now() - HOUR, 'error');
      const result = indexFreshnessWarning(entry);
      expect(result).toContain('❌');
      expect(result).toContain('error state');
    });

    test('returns ❌ for stale state even if recently indexed', () => {
      const entry = makeEntry('s1', Date.now() - 2 * HOUR, 'stale');
      const result = indexFreshnessWarning(entry);
      expect(result).toContain('❌');
    });
  });

  describe('fleetFreshnessWarning', () => {
    test('returns null when all entries are fresh', () => {
      const entries = [
        makeEntry('s1', Date.now() - 30 * 60 * 1000),
        makeEntry('s2', Date.now() - 45 * 60 * 1000),
      ];
      expect(fleetFreshnessWarning(entries)).toBeNull();
    });

    test('returns warning based on stalest entry', () => {
      const entries = [
        makeEntry('s1', Date.now() - FRESH),
        makeEntry('s2', Date.now() - 30 * HOUR),
      ];
      const result = fleetFreshnessWarning(entries);
      expect(result).toContain('⚠️');
    });

    test('returns ❌ when stalest is > 7 days', () => {
      const entries = [
        makeEntry('s1', Date.now() - FRESH),
        makeEntry('s2', Date.now() - 8 * DAY),
      ];
      const result = fleetFreshnessWarning(entries);
      expect(result).toContain('❌');
    });

    test('returns null for empty array', () => {
      expect(fleetFreshnessWarning([])).toBeNull();
    });

    test('returns null for array of nulls', () => {
      expect(fleetFreshnessWarning([null, null])).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// compare_sites
// ---------------------------------------------------------------------------

describe('compare_sites staleness', () => {
  function setup(lastIndexedA: number, lastIndexedB: number) {
    const sites: Record<string, LocalSiteInfo> = {
      'site-a': { id: 'site-a', name: 'Site A', path: '/a', domain: 'a.local' },
      'site-b': { id: 'site-b', name: 'Site B', path: '/b', domain: 'b.local' },
    };
    const registry = new IndexRegistry(createStorage());
    registry.update('site-a', { siteName: 'Site A', state: 'indexed', lastIndexed: lastIndexedA, documentCount: 1, chunkCount: 1, durationMs: 0, structure: makeStructure() });
    registry.update('site-b', { siteName: 'Site B', state: 'indexed', lastIndexed: lastIndexedB, documentCount: 1, chunkCount: 1, durationMs: 0, structure: makeStructure() });
    const services = buildServices(registry, createSiteData(sites));
    return services;
  }

  test('no warning when both sites freshly indexed', async () => {
    const services = setup(Date.now() - FRESH, Date.now() - FRESH);
    const result = await compareSitesHandler.execute({ site_a: 'Site A', site_b: 'Site B' }, services);
    expect(getText(result)).not.toContain('⚠️');
    expect(getText(result)).not.toContain('❌');
  });

  test('⚠️ warning when one site is > 24h old', async () => {
    const services = setup(Date.now() - FRESH, Date.now() - 30 * HOUR);
    const result = await compareSitesHandler.execute({ site_a: 'Site A', site_b: 'Site B' }, services);
    expect(getText(result)).toContain('⚠️');
  });

  test('❌ warning when one site is > 7d old', async () => {
    const services = setup(Date.now() - HOUR, Date.now() - 8 * DAY);
    const result = await compareSitesHandler.execute({ site_a: 'Site A', site_b: 'Site B' }, services);
    expect(getText(result)).toContain('❌');
  });
});

// ---------------------------------------------------------------------------
// detect_drift
// ---------------------------------------------------------------------------

describe('detect_drift staleness', () => {
  function setup(baselineAge: number, targetAge: number) {
    const sites: Record<string, LocalSiteInfo> = {
      'baseline': { id: 'baseline', name: 'Baseline', path: '/b', domain: 'b.local' },
      'target': { id: 'target', name: 'Target', path: '/t', domain: 't.local' },
    };
    const registry = new IndexRegistry(createStorage());
    registry.update('baseline', { siteName: 'Baseline', state: 'indexed', lastIndexed: Date.now() - baselineAge, documentCount: 1, chunkCount: 1, durationMs: 0, structure: makeStructure() });
    registry.update('target', { siteName: 'Target', state: 'indexed', lastIndexed: Date.now() - targetAge, documentCount: 1, chunkCount: 1, durationMs: 0, structure: makeStructure() });
    const services = buildServices(registry, createSiteData(sites));
    return services;
  }

  test('no warning when all sites are fresh', async () => {
    const services = setup(FRESH, FRESH);
    const result = await detectDriftHandler.execute({ baseline_site: 'Baseline' }, services);
    expect(getText(result)).not.toContain('⚠️');
  });

  test('⚠️ warning when target is > 24h old', async () => {
    const services = setup(FRESH, 30 * HOUR);
    const result = await detectDriftHandler.execute({ baseline_site: 'Baseline' }, services);
    expect(getText(result)).toContain('⚠️');
  });

  test('❌ warning when baseline is > 7d old', async () => {
    const services = setup(8 * DAY, FRESH);
    const result = await detectDriftHandler.execute({ baseline_site: 'Baseline' }, services);
    expect(getText(result)).toContain('❌');
  });
});

// ---------------------------------------------------------------------------
// find_sites_with_plugin
// ---------------------------------------------------------------------------

describe('find_sites_with_plugin staleness', () => {
  function setup(lastIndexed: number) {
    const registry = new IndexRegistry(createStorage());
    registry.update('site-a', {
      siteName: 'Site A',
      state: 'indexed',
      lastIndexed,
      documentCount: 1,
      chunkCount: 1,
      durationMs: 0,
      structure: makeStructure({ plugins: [makePlugin('woocommerce', 'WooCommerce', '9.0', true)] }),
    });
    const siteData = createSiteData({});
    return buildServices(registry, siteData);
  }

  test('no warning when freshly indexed', async () => {
    const services = setup(Date.now() - FRESH);
    const result = await findSitesWithPluginHandler.execute({ plugin: 'woocommerce' }, services);
    expect(getText(result)).not.toContain('⚠️');
    expect(getText(result)).not.toContain('❌');
  });

  test('⚠️ warning when index is > 24h old', async () => {
    const services = setup(Date.now() - 30 * HOUR);
    const result = await findSitesWithPluginHandler.execute({ plugin: 'woocommerce' }, services);
    expect(getText(result)).toContain('⚠️');
  });

  test('❌ warning when index is > 7d old', async () => {
    const services = setup(Date.now() - 8 * DAY);
    const result = await findSitesWithPluginHandler.execute({ plugin: 'woocommerce' }, services);
    expect(getText(result)).toContain('❌');
  });
});

// ---------------------------------------------------------------------------
// find_sites_with_theme
// ---------------------------------------------------------------------------

describe('find_sites_with_theme staleness', () => {
  function setup(lastIndexed: number) {
    const registry = new IndexRegistry(createStorage());
    registry.update('site-a', {
      siteName: 'Site A',
      state: 'indexed',
      lastIndexed,
      documentCount: 1,
      chunkCount: 1,
      durationMs: 0,
      structure: makeStructure({ themes: [makeTheme('twentytwentyfour', 'Twenty Twenty-Four', '1.2', true)] }),
    });
    return buildServices(registry, createSiteData({}));
  }

  test('no warning when freshly indexed', async () => {
    const services = setup(Date.now() - FRESH);
    const result = await findSitesWithThemeHandler.execute({ theme: 'twentytwentyfour' }, services);
    expect(getText(result)).not.toContain('⚠️');
  });

  test('⚠️ warning when index is > 24h old', async () => {
    const services = setup(Date.now() - 30 * HOUR);
    const result = await findSitesWithThemeHandler.execute({ theme: 'twentytwentyfour' }, services);
    expect(getText(result)).toContain('⚠️');
  });
});

// ---------------------------------------------------------------------------
// search_site_content
// ---------------------------------------------------------------------------

describe('search_site_content staleness', () => {
  function makeVectorStore(results: any[]) {
    return {
      search: async () => results,
    };
  }

  function makeEmbeddingService() {
    return { embed: async () => new Float32Array(3) };
  }

  function setup(lastIndexed: number) {
    const sites: Record<string, LocalSiteInfo> = {
      's1': { id: 's1', name: 'My Site', path: '/s', domain: 'mysite.local' },
    };
    const registry = new IndexRegistry(createStorage());
    registry.update('s1', {
      siteName: 'My Site',
      state: 'indexed',
      lastIndexed,
      documentCount: 1,
      chunkCount: 1,
      durationMs: 0,
      structure: makeStructure(),
    });
    return buildServices(registry, createSiteData(sites), {
      vectorStore: makeVectorStore([
        { title: 'Hello', content: 'world', postType: 'post', score: 0.9, postId: 1, metadata: '{}' },
      ]) as any,
      embeddingService: makeEmbeddingService() as any,
    });
  }

  test('no warning when freshly indexed', async () => {
    const services = setup(Date.now() - FRESH);
    const result = await searchContentHandler.execute({ site: 'My Site', query: 'hello' }, services);
    expect(getText(result)).not.toContain('⚠️');
    expect(getText(result)).not.toContain('❌');
  });

  test('⚠️ warning when index is > 24h old', async () => {
    const services = setup(Date.now() - 30 * HOUR);
    const result = await searchContentHandler.execute({ site: 'My Site', query: 'hello' }, services);
    expect(getText(result)).toContain('⚠️');
  });

  test('❌ warning when index is > 7d old', async () => {
    const services = setup(Date.now() - 8 * DAY);
    const result = await searchContentHandler.execute({ site: 'My Site', query: 'hello' }, services);
    expect(getText(result)).toContain('❌');
  });
});

// ---------------------------------------------------------------------------
// search_across_sites
// ---------------------------------------------------------------------------

describe('search_across_sites fleet warning', () => {
  function makeVectorStore(results: any[]) {
    return { search: async () => results };
  }

  function setup(ages: number[]) {
    const registry = new IndexRegistry(createStorage());
    ages.forEach((ageMs, i) => {
      registry.update(`site-${i}`, {
        siteName: `Site ${i}`,
        state: 'indexed',
        lastIndexed: Date.now() - ageMs,
        documentCount: 1,
        chunkCount: 1,
        durationMs: 0,
        structure: makeStructure(),
      });
    });
    return buildServices(registry, createSiteData({}), {
      vectorStore: makeVectorStore([
        { title: 'Foo', content: 'bar', postType: 'post', score: 0.8 },
      ]) as any,
      embeddingService: { embed: async () => new Float32Array(3) } as any,
    });
  }

  test('no fleet warning when all sites < 7d old', async () => {
    const services = setup([HOUR, 2 * DAY, 5 * DAY]);
    const result = await searchAcrossSitesHandler.execute({ query: 'test' }, services);
    expect(getText(result)).not.toContain('❌');
  });

  test('❌ fleet warning when any site is > 7d old', async () => {
    const services = setup([HOUR, 8 * DAY]);
    const result = await searchAcrossSitesHandler.execute({ query: 'test' }, services);
    expect(getText(result)).toContain('❌');
    expect(getText(result)).toContain('7 days');
  });
});
