import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices } from '../../src/main/mcp/types';
import { registerFleetTools } from '../../src/main/mcp/modules/fleet/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(siteRows: any[], pluginRows: any[] = []) {
  return {
    prepare: jest.fn().mockImplementation((sql: string) => ({
      all: jest.fn().mockImplementation((...params: any[]) => {
        if (sql.includes('FROM plugins')) return pluginRows;
        return siteRows;
      }),
      get: jest.fn(),
    })),
  };
}

function makeServices(db?: ReturnType<typeof makeDb>): NexusServices {
  const s = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    indexRegistry: { get: () => null, listAll: () => [] },
    logger: { info: jest.fn(), error: jest.fn() },
  } as unknown as NexusServices;
  if (db) {
    (s as any).graphService = { getDb: () => db };
  }
  return s;
}

function getText(result: any): string {
  return result.content[0].text;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('find_outdated_sites', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerFleetTools(registry);
  });

  test('reads from graph DB when graphService is available', async () => {
    const db = makeDb([
      { id: 's1', name: 'prod-site', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' },
    ]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', {}, s);
    expect(result.isError).toBeUndefined();
    // DB was queried
    expect(db.prepare).toHaveBeenCalled();
    // Report mentions the single site in scope
    expect(getText(result)).toContain('1 sites in scope');
  });

  test('source filter "wpe" — only queries graph for WPE rows', async () => {
    const db = makeDb([
      { id: 'w1', name: 'wpe-site', source: 'wpe', wp_version: '6.7.0', php_version: '8.1' },
      { id: 'l1', name: 'local-site', source: 'local', wp_version: '6.9.1', php_version: '8.2' },
    ]);
    // When source='wpe', find-outdated-sites passes [sourceFilter] as param and adds WHERE source=?
    // The mock returns all rows regardless — filter logic tested via output
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { source: 'wpe' }, s);
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    // Report header should note WPE-only scope
    expect(text).toContain('WP Engine installs only');
  });

  test('source filter "local" — skips WPE rows and supplements with index registry', async () => {
    const db = makeDb([
      { id: 'l1', name: 'local-site', source: 'local', wp_version: '6.9.1', php_version: '8.2' },
    ]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { source: 'local' }, s);
    const text = getText(result);
    expect(text).toContain('local sites only');
  });

  test('sites with null wp_version are reported in "no version data" note', async () => {
    const db = makeDb([
      { id: 'w1', name: 'versioned-wpe', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' },
      { id: 'w2', name: 'no-version-wpe', source: 'wpe', wp_version: null, php_version: null },
      { id: 'w3', name: 'also-versioned', source: 'wpe', wp_version: '6.7.0', php_version: '8.1' },
    ]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { source: 'wpe', component: 'wordpress' }, s);
    const text = getText(result);
    // Three sites total, one with null wp_version
    expect(text).toContain('1 site with no WordPress version data');
  });

  test('shows "no site version data" hint when graph is empty and source is wpe', async () => {
    const db = makeDb([]);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { source: 'wpe' }, s);
    expect(getText(result)).toContain('Run "Sync WP Engine Sites" first');
  });

  test('falls back to index registry for local sites not in graph', async () => {
    // graph returns nothing; indexRegistry has a local site
    const db = makeDb([]);
    const s = makeServices(db);
    (s as any).indexRegistry = {
      listAll: () => [
        {
          siteId: 'local-fallback',
          siteName: 'Fallback Site',
          structure: { wpVersion: '6.9.1', phpVersion: '8.2' },
        },
      ],
    };
    const result = await registry.call('find_outdated_sites', {}, s);
    // The fallback site is included in scope
    expect(getText(result)).toContain('1 sites in scope');
    // Single version group — report confirms all on same version
    expect(getText(result)).toContain('6.9.1');
  });

  test('plugin section shows no plugin data when graph has no plugin rows', async () => {
    const db = makeDb(
      [{ id: 'w1', name: 'wpe-site', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' }],
      [], // no plugins
    );
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { component: 'plugins' }, s);
    expect(getText(result)).toContain('No plugin data available');
  });

  test('plugin section detects version mismatches across sites', async () => {
    const sites = [
      { id: 's1', name: 'site-one', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' },
      { id: 's2', name: 'site-two', source: 'wpe', wp_version: '6.8.0', php_version: '8.2' },
    ];
    const plugins = [
      { site_id: 's1', slug: 'woocommerce', version: '9.0.0' },
      { site_id: 's2', slug: 'woocommerce', version: '8.5.0' },
    ];
    const db = makeDb(sites, plugins);
    const s = makeServices(db);
    const result = await registry.call('find_outdated_sites', { component: 'plugins' }, s);
    const text = getText(result);
    expect(text).toContain('woocommerce');
    expect(text).toContain('9.0.0');
    expect(text).toContain('8.5.0');
  });

  test('returns no-data hint when graphService is missing and no index entries', async () => {
    const s = makeServices(); // no graphService, empty indexRegistry
    const result = await registry.call('find_outdated_sites', {}, s);
    expect(getText(result)).toContain('No site version data available');
  });
});
