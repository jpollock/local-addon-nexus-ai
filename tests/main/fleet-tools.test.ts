import { IndexRegistry, RegistryStorage } from '../../src/main/content/IndexRegistry';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, SiteDataAccessor, LocalSiteInfo } from '../../src/main/mcp/types';
import { registerFleetTools } from '../../src/main/mcp/modules/fleet/index';
import { IndexEntry, SiteStructure, PluginInfo, ThemeInfo } from '../../src/common/types';
import { compareVersions, isOlderThan, groupByVersion } from '../../src/main/mcp/modules/fleet/version-utils';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePlugin(slug: string, name: string, version: string, active = true): PluginInfo {
  return { slug, name, version, isActive: active, description: `${name} plugin` };
}

function makeTheme(slug: string, name: string, version: string, active = false, child = false, parent?: string): ThemeInfo {
  return { slug, name, version, isActive: active, isChildTheme: child, parentTheme: parent };
}

function makeStructure(overrides?: Partial<SiteStructure>): SiteStructure {
  return {
    themes: [makeTheme('twentytwentyfour', 'Twenty Twenty-Four', '1.2', true)],
    plugins: [],
    phpVersion: '8.2',
    wpVersion: '6.9.1',
    isMultisite: false,
    hasWooCommerce: false,
    hasACF: false,
    ...overrides,
  };
}

const woo = makePlugin('woocommerce', 'WooCommerce', '10.0.4');
const wooOld = makePlugin('woocommerce', 'WooCommerce', '9.8.2');
const acf = makePlugin('advanced-custom-fields', 'Advanced Custom Fields', '6.4.3');
const jetpack = makePlugin('jetpack', 'Jetpack', '13.2');
const qm = makePlugin('query-monitor', 'Query Monitor', '3.16.0');
const tt24 = makeTheme('twentytwentyfour', 'Twenty Twenty-Four', '1.2', true);
const tt25 = makeTheme('twentytwentyfive', 'Twenty Twenty-Five', '1.0', true);

// Site definitions
const siteAStructure = makeStructure({
  plugins: [woo, acf, qm],
  themes: [tt24],
  wpVersion: '6.9.1',
  phpVersion: '8.2',
  hasWooCommerce: true,
  hasACF: true,
  users: { totalUsers: 7, roleBreakdown: { administrator: 2, editor: 3, subscriber: 2 }, customRoles: [] },
});

const siteBStructure = makeStructure({
  plugins: [acf, jetpack],
  themes: [tt25],
  wpVersion: '6.9.1',
  phpVersion: '8.2',
  hasWooCommerce: false,
  hasACF: true,
  users: { totalUsers: 3, roleBreakdown: { administrator: 1, editor: 2 }, customRoles: [] },
});

const siteCStructure = makeStructure({
  plugins: [wooOld],
  themes: [tt24],
  wpVersion: '6.8.0',
  phpVersion: '8.1',
  hasWooCommerce: true,
  hasACF: false,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
): NexusServices {
  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry,
    fileScanner: {} as any,
    siteData,
    logger: { info: () => {}, error: () => {} },
  };
}

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// Standard 3-site setup
// ---------------------------------------------------------------------------

function setupThreeSites() {
  const sites: Record<string, LocalSiteInfo> = {
    'site-a': { id: 'site-a', name: 'The Curated Shelf', path: '/sites/a', domain: 'curatedshelf.local' },
    'site-b': { id: 'site-b', name: 'My Blog', path: '/sites/b', domain: 'myblog.local' },
    'site-c': { id: 'site-c', name: 'Dev Store', path: '/sites/c', domain: 'devstore.local' },
  };

  const siteData = createSiteData(sites);
  const indexRegistry = new IndexRegistry(createStorage());

  indexRegistry.update('site-a', {
    siteName: 'The Curated Shelf',
    state: 'indexed',
    documentCount: 44,
    chunkCount: 44,
    lastIndexed: Date.now(),
    structure: siteAStructure,
  });

  indexRegistry.update('site-b', {
    siteName: 'My Blog',
    state: 'indexed',
    documentCount: 127,
    chunkCount: 180,
    lastIndexed: Date.now(),
    structure: siteBStructure,
  });

  indexRegistry.update('site-c', {
    siteName: 'Dev Store',
    state: 'indexed',
    documentCount: 30,
    chunkCount: 30,
    lastIndexed: Date.now(),
    structure: siteCStructure,
  });

  const services = buildServices(indexRegistry, siteData);
  const registry = new ToolRegistry();
  registerFleetTools(registry);

  return { services, registry, indexRegistry, siteData };
}

// ---------------------------------------------------------------------------
// version-utils tests
// ---------------------------------------------------------------------------

describe('version-utils', () => {
  describe('compareVersions', () => {
    test('equal versions return 0', () => {
      expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    });

    test('greater version returns positive', () => {
      expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    });

    test('lesser version returns negative', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    });

    test('different segment counts', () => {
      expect(compareVersions('1.2', '1.2.0')).toBe(0);
      expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0);
    });

    test('compares numerically not lexically', () => {
      expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    });
  });

  describe('isOlderThan', () => {
    test('returns true when older', () => {
      expect(isOlderThan('6.8.0', '6.9.1')).toBe(true);
    });

    test('returns false when equal', () => {
      expect(isOlderThan('6.9.1', '6.9.1')).toBe(false);
    });

    test('returns false when newer', () => {
      expect(isOlderThan('7.0.0', '6.9.1')).toBe(false);
    });
  });

  describe('groupByVersion', () => {
    test('groups items and sorts newest first', () => {
      const items = [
        { name: 'a', v: '1.0' },
        { name: 'b', v: '2.0' },
        { name: 'c', v: '1.0' },
      ];
      const groups = groupByVersion(items, (i) => i.v);
      const keys = Array.from(groups.keys());
      expect(keys).toEqual(['2.0', '1.0']);
      expect(groups.get('1.0')!.length).toBe(2);
      expect(groups.get('2.0')!.length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// fleet_summary tests
// ---------------------------------------------------------------------------

describe('fleet_summary', () => {
  test('shows correct site counts and version distribution', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('fleet_summary', {}, services);
    const text = getText(result);

    expect(text).toContain('3 indexed / 3 in Local');
    expect(text).toContain('6.9.1: 2 sites');
    expect(text).toContain('6.8.0: 1 site');
    expect(text).toContain('8.2: 2 sites');
    expect(text).toContain('8.1: 1 site');
  });

  test('shows plugin ranking', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('fleet_summary', {}, services);
    const text = getText(result);

    // WooCommerce on 2 sites, ACF on 2 sites
    expect(text).toContain('WooCommerce');
    expect(text).toContain('Advanced Custom Fields');
  });

  test('shows content totals', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('fleet_summary', {}, services);
    const text = getText(result);

    expect(text).toContain('Total documents: 201');
    expect(text).toContain('Total chunks: 254');
  });

  test('shows key integrations', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('fleet_summary', {}, services);
    const text = getText(result);

    expect(text).toContain('WooCommerce: 2 sites');
    expect(text).toContain('ACF: 2 sites');
  });

  test('handles no indexed sites', async () => {
    const siteData = createSiteData({
      's1': { id: 's1', name: 'Empty', path: '/empty' },
    });
    const indexRegistry = new IndexRegistry(createStorage());
    const services = buildServices(indexRegistry, siteData);
    const registry = new ToolRegistry();
    registerFleetTools(registry);

    const result = await registry.call('fleet_summary', {}, services);
    const text = getText(result);

    expect(text).toContain('0 indexed / 1 in Local');
    expect(text).toContain('No sites have been indexed');
  });

  test('reports stale and error indexes', async () => {
    const siteData = createSiteData({
      's1': { id: 's1', name: 'Stale Site', path: '/s1' },
      's2': { id: 's2', name: 'Error Site', path: '/s2' },
    });
    const indexRegistry = new IndexRegistry(createStorage());
    indexRegistry.update('s1', {
      siteName: 'Stale Site', state: 'stale', documentCount: 10, chunkCount: 10,
      structure: makeStructure(),
    });
    indexRegistry.update('s2', {
      siteName: 'Error Site', state: 'error', documentCount: 0, chunkCount: 0,
      structure: makeStructure(),
    });
    const services = buildServices(indexRegistry, siteData);
    const registry = new ToolRegistry();
    registerFleetTools(registry);

    const result = await registry.call('fleet_summary', {}, services);
    const text = getText(result);

    expect(text).toContain('stale indexes');
    expect(text).toContain('index errors');
  });
});

// ---------------------------------------------------------------------------
// find_sites_with_plugin tests
// ---------------------------------------------------------------------------

describe('find_sites_with_plugin', () => {
  test('finds sites by exact slug', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_plugin', { plugin: 'woocommerce' }, services);
    const text = getText(result);

    expect(text).toContain('The Curated Shelf');
    expect(text).toContain('Dev Store');
    expect(text).toContain('Found in 2 of 3');
  });

  test('finds sites by fuzzy name', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_plugin', { plugin: 'woo' }, services);
    const text = getText(result);

    expect(text).toContain('The Curated Shelf');
    expect(text).toContain('Dev Store');
  });

  test('case-insensitive name match', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_plugin', { plugin: 'WOOCOMMERCE' }, services);
    const text = getText(result);

    expect(text).toContain('The Curated Shelf');
  });

  test('returns no match message', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_plugin', { plugin: 'nonexistent' }, services);
    const text = getText(result);

    expect(text).toContain('No indexed sites have a plugin matching');
  });

  test('shows version and status', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_plugin', { plugin: 'woocommerce' }, services);
    const text = getText(result);

    expect(text).toContain('v10.0.4');
    expect(text).toContain('v9.8.2');
    expect(text).toContain('active');
  });

  test('errors on missing plugin arg', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_plugin', {}, services);
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// find_sites_with_theme tests
// ---------------------------------------------------------------------------

describe('find_sites_with_theme', () => {
  test('finds sites by exact slug', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_theme', { theme: 'twentytwentyfour' }, services);
    const text = getText(result);

    expect(text).toContain('The Curated Shelf');
    expect(text).toContain('Dev Store');
    expect(text).toContain('Found in 2 of 3');
  });

  test('finds sites by fuzzy name', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_theme', { theme: 'Twenty Twenty' }, services);
    const text = getText(result);

    // All three sites have a Twenty Twenty theme
    expect(text).toContain('The Curated Shelf');
    expect(text).toContain('My Blog');
    expect(text).toContain('Dev Store');
  });

  test('returns no match message', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_theme', { theme: 'nonexistent' }, services);
    const text = getText(result);

    expect(text).toContain('No indexed sites have a theme matching');
  });

  test('errors on missing theme arg', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('find_sites_with_theme', {}, services);
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compare_sites// ---------------------------------------------------------------------------
// compare_sites tests
// ---------------------------------------------------------------------------

describe('compare_sites', () => {
  test('shows shared plugins with same version', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('compare_sites', {
      site_a: 'The Curated Shelf',
      site_b: 'My Blog',
    }, services);
    const text = getText(result);

    // ACF is shared with same version
    expect(text).toContain('Advanced Custom Fields v6.4.3');
    expect(text).toContain('Shared');
  });

  test('shows unique plugins per site', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('compare_sites', {
      site_a: 'The Curated Shelf',
      site_b: 'My Blog',
    }, services);
    const text = getText(result);

    expect(text).toContain('Only in The Curated Shelf');
    expect(text).toContain('WooCommerce');
    expect(text).toContain('Query Monitor');
    expect(text).toContain('Only in My Blog');
    expect(text).toContain('Jetpack');
  });

  test('shows version differences for shared plugins', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('compare_sites', {
      site_a: 'The Curated Shelf',
      site_b: 'Dev Store',
    }, services);
    const text = getText(result);

    // WooCommerce is shared but different versions
    expect(text).toContain('Version Differences');
    expect(text).toContain('WooCommerce');
    expect(text).toContain('v10.0.4');
    expect(text).toContain('v9.8.2');
  });

  test('shows content comparison', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('compare_sites', {
      site_a: 'The Curated Shelf',
      site_b: 'My Blog',
    }, services);
    const text = getText(result);

    expect(text).toContain('Documents');
    expect(text).toContain('44');
    expect(text).toContain('127');
  });

  test('shows WP/PHP version differences', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('compare_sites', {
      site_a: 'The Curated Shelf',
      site_b: 'Dev Store',
    }, services);
    const text = getText(result);

    expect(text).toContain('WordPress: 6.9.1');
    expect(text).toContain('6.8.0');
  });

  test('errors on unknown site', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('compare_sites', {
      site_a: 'The Curated Shelf',
      site_b: 'Nonexistent',
    }, services);

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not found');
  });

  test('errors on site without index data', async () => {
    const sites: Record<string, LocalSiteInfo> = {
      'site-a': { id: 'site-a', name: 'Site A', path: '/a' },
      'site-b': { id: 'site-b', name: 'Site B', path: '/b' },
    };
    const siteData = createSiteData(sites);
    const indexRegistry = new IndexRegistry(createStorage());
    indexRegistry.update('site-a', {
      siteName: 'Site A', state: 'indexed', documentCount: 10, chunkCount: 10,
      structure: makeStructure(),
    });
    // site-b has no structure
    indexRegistry.update('site-b', {
      siteName: 'Site B', state: 'error', documentCount: 0, chunkCount: 0,
      structure: null,
    });
    const services = buildServices(indexRegistry, siteData);
    const registry = new ToolRegistry();
    registerFleetTools(registry);

    const result = await registry.call('compare_sites', {
      site_a: 'Site A',
      site_b: 'Site B',
    }, services);

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('no index data');
  });
});

// ---------------------------------------------------------------------------
// detect_drift tests
// ---------------------------------------------------------------------------

describe('detect_drift', () => {
  test('detects missing plugins', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('detect_drift', {
      baseline_site: 'The Curated Shelf',
    }, services);
    const text = getText(result);

    // My Blog doesn't have WooCommerce or Query Monitor
    expect(text).toContain('Missing plugin: WooCommerce');
    expect(text).toContain('Missing plugin: Query Monitor');
  });

  test('detects extra plugins', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('detect_drift', {
      baseline_site: 'The Curated Shelf',
    }, services);
    const text = getText(result);

    // My Blog has Jetpack that Curated Shelf doesn't
    expect(text).toContain('Extra plugin: Jetpack');
  });

  test('detects version mismatches', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('detect_drift', {
      baseline_site: 'The Curated Shelf',
    }, services);
    const text = getText(result);

    // Dev Store has older WooCommerce
    expect(text).toContain('WooCommerce: 10.0.4 (baseline) vs 9.8.2 (target)');
  });

  test('detects WordPress version differences', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('detect_drift', {
      baseline_site: 'The Curated Shelf',
    }, services);
    const text = getText(result);

    expect(text).toContain('WordPress: 6.9.1 (baseline) vs 6.8.0 (target)');
  });

  test('shows drift counts per site', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('detect_drift', {
      baseline_site: 'The Curated Shelf',
    }, services);
    const text = getText(result);

    expect(text).toContain('My Blog');
    expect(text).toContain('Dev Store');
    expect(text).toMatch(/\d+ drift/);
  });

  test('compares against specific sites only', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('detect_drift', {
      baseline_site: 'The Curated Shelf',
      compare_sites: ['Dev Store'],
    }, services);
    const text = getText(result);

    expect(text).toContain('Dev Store');
    expect(text).not.toContain('My Blog');
  });

  test('reports no drift when sites are aligned', async () => {
    const siteData = createSiteData({
      's1': { id: 's1', name: 'Site A', path: '/a' },
      's2': { id: 's2', name: 'Site B', path: '/b' },
    });
    const indexRegistry = new IndexRegistry(createStorage());
    const sharedStructure = makeStructure({ plugins: [woo, acf] });
    indexRegistry.update('s1', {
      siteName: 'Site A', state: 'indexed', documentCount: 10, chunkCount: 10,
      structure: sharedStructure,
    });
    indexRegistry.update('s2', {
      siteName: 'Site B', state: 'indexed', documentCount: 10, chunkCount: 10,
      structure: sharedStructure,
    });
    const services = buildServices(indexRegistry, siteData);
    const registry = new ToolRegistry();
    registerFleetTools(registry);

    const result = await registry.call('detect_drift', { baseline_site: 'Site A' }, services);
    const text = getText(result);

    expect(text).toContain('0 drift');
    expect(text).toContain('All aligned');
  });

  test('errors on unknown baseline site', async () => {
    const { services, registry } = setupThreeSites();
    const result = await registry.call('detect_drift', {
      baseline_site: 'Nonexistent',
    }, services);

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not found');
  });

  test('handles no other indexed sites', async () => {
    const siteData = createSiteData({
      's1': { id: 's1', name: 'Solo', path: '/s1' },
    });
    const indexRegistry = new IndexRegistry(createStorage());
    indexRegistry.update('s1', {
      siteName: 'Solo', state: 'indexed', documentCount: 10, chunkCount: 10,
      structure: makeStructure(),
    });
    const services = buildServices(indexRegistry, siteData);
    const registry = new ToolRegistry();
    registerFleetTools(registry);

    const result = await registry.call('detect_drift', { baseline_site: 'Solo' }, services);
    const text = getText(result);

    expect(text).toContain('No other indexed sites');
  });
});

// ---------------------------------------------------------------------------
// Registration tests
// ---------------------------------------------------------------------------

describe('fleet tool registration', () => {
  test('all 6 fleet tools are registered', () => {
    const registry = new ToolRegistry();
    registerFleetTools(registry);
    const names = registry.allToolNames();

    expect(names).toContain('fleet_summary');
    expect(names).toContain('find_sites_with_plugin');
    expect(names).toContain('find_sites_with_theme');
    expect(names).toContain('find_outdated_sites');
    expect(names).toContain('compare_sites');
    expect(names).toContain('detect_drift');
    expect(names.length).toBe(6);
  });

  test('all fleet tools are always available (no isAvailable gate)', () => {
    const registry = new ToolRegistry();
    registerFleetTools(registry);

    const services = buildServices(
      new IndexRegistry(createStorage()),
      createSiteData({}),
    );

    const listed = registry.list(services);
    const fleetTools = listed.filter((t) =>
      ['fleet_summary', 'find_sites_with_plugin', 'find_sites_with_theme',
       'find_outdated_sites', 'compare_sites', 'detect_drift'].includes(t.name),
    );
    expect(fleetTools.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Edge case: sites without structure
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  test('fleet_summary handles entries without structure', async () => {
    const siteData = createSiteData({
      's1': { id: 's1', name: 'Indexed', path: '/s1' },
      's2': { id: 's2', name: 'No Structure', path: '/s2' },
    });
    const indexRegistry = new IndexRegistry(createStorage());
    indexRegistry.update('s1', {
      siteName: 'Indexed', state: 'indexed', documentCount: 10, chunkCount: 10,
      structure: makeStructure({ plugins: [woo] }),
    });
    indexRegistry.update('s2', {
      siteName: 'No Structure', state: 'indexing', documentCount: 0, chunkCount: 0,
      structure: null,
    });
    const services = buildServices(indexRegistry, siteData);
    const registry = new ToolRegistry();
    registerFleetTools(registry);

    const result = await registry.call('fleet_summary', {}, services);
    const text = getText(result);

    // Should count 2 indexed total, but only 1 with structure
    expect(text).toContain('2 indexed / 2 in Local');
    expect(text).toContain('WooCommerce');
  });

  test('find_sites_with_plugin handles no indexed sites', async () => {
    const siteData = createSiteData({});
    const indexRegistry = new IndexRegistry(createStorage());
    const services = buildServices(indexRegistry, siteData);
    const registry = new ToolRegistry();
    registerFleetTools(registry);

    const result = await registry.call('find_sites_with_plugin', { plugin: 'woo' }, services);
    const text = getText(result);

    expect(text).toContain('No indexed sites with structure data');
  });

});
