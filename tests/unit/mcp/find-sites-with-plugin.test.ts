import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { NexusServices } from '../../../src/main/mcp/types';
import { registerFleetTools } from '../../../src/main/mcp/modules/fleet/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(siteRows: any[], pluginRows: any[] = []) {
  return {
    prepare: jest.fn().mockImplementation((sql: string) => {
      const statement = {
        all: jest.fn().mockImplementation((...params: any[]) => {
          if (sql.includes('FROM plugins')) {
            // Filter plugins by is_active in sites if WHERE clause includes is_active
            if (sql.includes('AND s.is_active = 1')) {
              const activeSiteIds = new Set(siteRows.filter(s => s.is_active === 1).map(s => s.id));
              return pluginRows.filter(p => activeSiteIds.has(p.site_id));
            }
            return pluginRows;
          }
          return siteRows;
        }),
        get: jest.fn().mockImplementation(() => {
          // For COUNT queries
          if (sql.includes('COUNT(*)')) {
            const filtered = sql.includes('is_active = 1')
              ? siteRows.filter(s => s.is_active === 1)
              : siteRows;
            return { c: filtered.length };
          }
          return siteRows[0];
        }),
      };
      return statement;
    }),
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

describe('find_sites_with_plugin', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerFleetTools(registry);
  });

  test('excludes a soft-deleted external host even if it has a matching plugin', async () => {
    // Seed one active external site + plugin row, one is_active:false external
    // site + the same plugin slug. Assert the result only contains the active
    // site's name.
    const siteRows = [
      { id: 'ext1', name: 'active-host', source: 'external', is_active: 1 },
      { id: 'ext2', name: 'deleted-host', source: 'external', is_active: 0 },
    ];
    const pluginRows = [
      { site_id: 'ext1', slug: 'woocommerce', version: '9.0.0', is_active: 1, site_name: 'active-host', source: 'external' },
      { site_id: 'ext2', slug: 'woocommerce', version: '9.0.0', is_active: 1, site_name: 'deleted-host', source: 'external' },
    ];
    const db = makeDb(siteRows, pluginRows);
    const s = makeServices(db);
    const result = await registry.call('find_sites_with_plugin', { plugin: 'woocommerce' }, s);
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    // Result should mention only the active site
    expect(text).toContain('active-host');
    // Result should NOT mention the deleted host
    expect(text).not.toContain('deleted-host');
    // Verify count is 1 of 1 (only active sites are counted)
    expect(text).toContain('Found in 1 of 1 sites');
  });

  test('excludes a soft-deleted WPE install even if it has a matching plugin', async () => {
    // Same test but with WPE sources
    const siteRows = [
      { id: 'wpe1', name: 'active-install', source: 'wpe', is_active: 1 },
      { id: 'wpe2', name: 'deleted-install', source: 'wpe', is_active: 0 },
    ];
    const pluginRows = [
      { site_id: 'wpe1', slug: 'jetpack', version: '14.0.0', is_active: 1, site_name: 'active-install', source: 'wpe' },
      { site_id: 'wpe2', slug: 'jetpack', version: '14.0.0', is_active: 1, site_name: 'deleted-install', source: 'wpe' },
    ];
    const db = makeDb(siteRows, pluginRows);
    const s = makeServices(db);
    const result = await registry.call('find_sites_with_plugin', { plugin: 'jetpack' }, s);
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('active-install');
    expect(text).not.toContain('deleted-install');
    expect(text).toContain('Found in 1 of 1 sites');
  });
});
