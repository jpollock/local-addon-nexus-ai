import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { registerContentTools } from '../../src/main/mcp/modules/content/index';
import { registerSiteContextTools } from '../../src/main/mcp/modules/site-context/index';
import { registerOllamaTools } from '../../src/main/mcp/modules/ollama/index';
import { registerFleetTools } from '../../src/main/mcp/modules/fleet/index';
import { registerSiteManagementTools } from '../../src/main/mcp/modules/site-management/index';
import { registerWpCliTools } from '../../src/main/mcp/modules/wp-cli/index';
import { registerWpeTools } from '../../src/main/mcp/modules/wpe/index';
import { registerWpConnectorTools } from '../../src/main/mcp/modules/wp-connector/index';
import { TIER_OVERRIDES } from '../../src/main/mcp/safety';
import { createStubBridge } from './helpers/stub-bridge';
import { createSiteData } from './helpers/fixtures';
import type { NexusServices } from '../../src/main/mcp/types';

function createMinimalServices(overrides: Partial<NexusServices>): NexusServices {
  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: { listAll: () => [] } as any,
    fileScanner: {} as any,
    siteData: createSiteData({}),
    logger: { info: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('Tool Registry with All Modules', () => {
  let registry: ToolRegistry;

  beforeAll(() => {
    registry = new ToolRegistry();
    registerContentTools(registry);
    registerSiteContextTools(registry);
    registerOllamaTools(registry);
    registerFleetTools(registry);
    registerSiteManagementTools(registry);
    registerWpCliTools(registry);
    registerWpeTools(registry);
    registerWpConnectorTools(registry);
  });

  test('all expected tools are registered', () => {
    const names = registry.allToolNames();
    expect(names.length).toBeGreaterThanOrEqual(46);

    // Spot-check key tools from each module
    expect(names).toContain('search_site_content');
    expect(names).toContain('search_across_sites');
    expect(names).toContain('get_site_structure');
    expect(names).toContain('reindex_site');
    expect(names).toContain('fleet_summary');
    expect(names).toContain('local_list_sites');
    expect(names).toContain('local_create_site');
    expect(names).toContain('local_delete_site');
    expect(names).toContain('wp_plugin_list');
    expect(names).toContain('wp_plugin_install');
    expect(names).toContain('wpe_get_accounts');
    expect(names).toContain('ask_ollama');
    expect(names).toContain('nexus_list_sites');
  });

  test('list() without localServices hides site-management tools', () => {
    const services = createMinimalServices({ localServices: undefined });
    const available = registry.list(services);
    const names = available.map((t) => t.name);

    // These should be present (no isAvailable gate)
    expect(names).toContain('search_site_content');
    expect(names).toContain('fleet_summary');

    // These should be hidden (gated on localServices)
    expect(names).not.toContain('local_create_site');
    expect(names).not.toContain('wp_plugin_list');
    expect(names).not.toContain('wpe_get_accounts');
  });

  test('list() with localServices but no CAPI shows local tools but hides WPE tools', () => {
    const siteData = createSiteData({});
    const services = createMinimalServices({
      localServices: createStubBridge(siteData, { capiAvailable: false }),
    });
    const available = registry.list(services);
    const names = available.map((t) => t.name);

    expect(names).toContain('local_create_site');
    expect(names).toContain('wp_plugin_list');
    // WPE CAPI tools should still be hidden
    expect(names).not.toContain('wpe_get_accounts');
  });

  test('each tool has a non-empty description and valid inputSchema', () => {
    const siteData = createSiteData({});
    const services = createMinimalServices({
      localServices: createStubBridge(siteData, { capiAvailable: true }),
    });
    const tools = registry.list(services);

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('every tool in TIER_OVERRIDES is actually registered', () => {
    const registeredNames = new Set(registry.allToolNames());
    const missing: string[] = [];
    for (const name of Object.keys(TIER_OVERRIDES)) {
      if (!registeredNames.has(name)) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      console.log('Missing tools:', missing);
    }
    expect(missing.length).toBe(0);
  });
});
