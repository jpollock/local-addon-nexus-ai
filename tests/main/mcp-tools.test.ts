import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, LocalSiteInfo } from '../../src/main/mcp/types';
import { IndexRegistry, RegistryStorage } from '../../src/main/content/IndexRegistry';
import { registerContentTools } from '../../src/main/mcp/modules/content/index';
import { registerSiteContextTools } from '../../src/main/mcp/modules/site-context/index';
import { VECTOR_DIMENSIONS, STORAGE_KEYS } from '../../src/common/constants';

function createMockStorage(): RegistryStorage {
  const store = new Map<string, any>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => store.set(key, value),
  };
}

function makeFakeVector(): Float32Array {
  const vec = new Float32Array(VECTOR_DIMENSIONS);
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) vec[i] = Math.random();
  return vec;
}

const testSites: Record<string, LocalSiteInfo> = {
  site1: { id: 'site1', name: 'My Blog', path: '/tmp/myblog', domain: 'myblog.local' },
  site2: { id: 'site2', name: 'Shop', path: '/tmp/shop', domain: 'shop.local' },
};

function createMockServices(indexRegistry: IndexRegistry): NexusServices {
  return {
    vectorStore: {
      search: jest.fn().mockResolvedValue([
        {
          id: 'wp_site1_1',
          title: 'Hello World',
          content: 'This is a test post about WordPress.',
          postType: 'post',
          postId: 1,
          score: 0.95,
          metadata: JSON.stringify({ categories: ['General'] }),
        },
      ]),
    } as any,
    embeddingService: {
      embed: jest.fn().mockResolvedValue(makeFakeVector()),
    } as any,
    contentPipeline: {
      reindexSite: jest.fn().mockResolvedValue({
        siteId: 'site1',
        documentsIndexed: 5,
        chunksIndexed: 8,
        durationMs: 500,
        errors: [],
      }),
    } as any,
    indexRegistry,
    fileScanner: {
      scan: jest.fn().mockResolvedValue({
        themes: [{ name: 'Twenty Twenty-Four', slug: 'twentytwentyfour', version: '1.1', isActive: true, isChildTheme: false }],
        plugins: [{ name: 'WooCommerce', slug: 'woocommerce', version: '8.5', isActive: true, description: 'eCommerce' }],
        phpVersion: '8.2',
        wpVersion: '6.5',
        isMultisite: false,
        hasWooCommerce: true,
        hasACF: false,
      }),
    } as any,
    siteData: {
      getSite: (id: string) => testSites[id] ?? null,
      getSites: () => testSites,
    },
    logger: { info: jest.fn(), error: jest.fn() },
  };
}

describe('MCP Tool Handlers', () => {
  let registry: ToolRegistry;
  let indexRegistry: IndexRegistry;
  let services: NexusServices;

  beforeEach(() => {
    registry = new ToolRegistry();
    indexRegistry = new IndexRegistry(createMockStorage());
    services = createMockServices(indexRegistry);

    registerContentTools(registry);
    registerSiteContextTools(registry);
  });

  test('registers all 11 content + site-context tools', () => {
    const names = registry.allToolNames().sort();
    expect(names).toEqual([
      'get_index_status',
      'get_site_structure',
      'list_indexed_sites',
      'nexus_fleet_refresh',
      'nexus_get_fleet_twins',
      'nexus_get_site_twin',
      'nexus_site_refresh',
      'nexus_site_status',
      'reindex_site',
      'search_across_sites',
      'search_site_content',
    ]);
  });

  describe('search_site_content', () => {
    test('returns results for indexed site', async () => {
      indexRegistry.update('site1', { state: 'indexed', siteName: 'My Blog' });

      const result = await registry.call(
        'search_site_content',
        { site: 'My Blog', query: 'WordPress' },
        services,
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Hello World');
      expect(result.content[0].text).toContain('0.950');
    });

    test('returns error for unknown site', async () => {
      const result = await registry.call(
        'search_site_content',
        { site: 'nonexistent', query: 'test' },
        services,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    test('returns error for unindexed site', async () => {
      const result = await registry.call(
        'search_site_content',
        { site: 'My Blog', query: 'test' },
        services,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not indexed');
    });
  });

  describe('search_across_sites', () => {
    test('returns results grouped by site', async () => {
      indexRegistry.update('site1', { state: 'indexed', siteName: 'My Blog' });
      indexRegistry.update('site2', { state: 'indexed', siteName: 'Shop' });

      const result = await registry.call(
        'search_across_sites',
        { query: 'WordPress' },
        services,
      );
      expect(result.content[0].text).toContain('My Blog');
    });

    test('returns error when no sites indexed', async () => {
      const result = await registry.call(
        'search_across_sites',
        { query: 'test' },
        services,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No sites');
    });
  });

  describe('get_site_structure', () => {
    test('returns enriched structure', async () => {
      const result = await registry.call(
        'get_site_structure',
        { site: 'My Blog' },
        services,
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Twenty Twenty-Four');
      expect(result.content[0].text).toContain('WooCommerce');
      expect(result.content[0].text).toContain('6.5');
    });

    test('returns error for unknown site', async () => {
      const result = await registry.call(
        'get_site_structure',
        { site: 'nonexistent' },
        services,
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('get_index_status', () => {
    test('returns status for indexed site', async () => {
      indexRegistry.update('site1', {
        state: 'indexed',
        siteName: 'My Blog',
        documentCount: 10,
        chunkCount: 15,
        durationMs: 500,
      });

      const result = await registry.call(
        'get_index_status',
        { site: 'My Blog' },
        services,
      );
      expect(result.content[0].text).toContain('10');
      expect(result.content[0].text).toContain('15');
    });

    test('returns message for unindexed site', async () => {
      const result = await registry.call(
        'get_index_status',
        { site: 'My Blog' },
        services,
      );
      expect(result.content[0].text).toContain('not been indexed');
    });
  });

  describe('list_indexed_sites', () => {
    test('lists all indexed sites', async () => {
      indexRegistry.update('site1', { state: 'indexed', siteName: 'My Blog', documentCount: 5 });
      indexRegistry.update('site2', { state: 'stale', siteName: 'Shop', documentCount: 3 });

      const result = await registry.call('list_indexed_sites', {}, services);
      expect(result.content[0].text).toContain('My Blog');
      expect(result.content[0].text).toContain('Shop');
      expect(result.content[0].text).toContain('[STALE]');
    });

    test('returns message when no sites indexed', async () => {
      const result = await registry.call('list_indexed_sites', {}, services);
      expect(result.content[0].text).toContain('No sites');
    });
  });

  describe('reindex_site', () => {
    test('triggers reindexing', async () => {
      const result = await registry.call(
        'reindex_site',
        { site: 'My Blog' },
        services,
      );
      expect(result.content[0].text).toContain('5');
      expect(result.content[0].text).toContain('8');
      expect(services.contentPipeline.reindexSite).toHaveBeenCalled();
    });
  });
});
