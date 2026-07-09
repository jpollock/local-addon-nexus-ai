import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, LocalSiteInfo } from '../../src/main/mcp/types';
import { RegistryStorage } from '../../src/main/content/IndexRegistry';
import { registerWpConnectorTools } from '../../src/main/mcp/modules/wp-connector/index';
import { setupSiteForAI, SetupAIResult } from '../../src/main/mcp/modules/wp-connector/setup-ai';
import { STORAGE_KEYS } from '../../src/common/constants';
import { TIER_OVERRIDES } from '../../src/main/mcp/safety';
import * as fs from 'fs';

// Mock fs operations for plugin installation tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => true),
  cpSync: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStorage(initialKeys?: Record<string, string>, initialSettings?: Record<string, any>): RegistryStorage {
  const store = new Map<string, any>();
  if (initialKeys) store.set(STORAGE_KEYS.API_KEYS, initialKeys);
  if (initialSettings) store.set(STORAGE_KEYS.SETTINGS, initialSettings);
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => store.set(key, value),
  };
}

const testSites: Record<string, LocalSiteInfo> = {
  site1: { id: 'site1', name: 'My Blog', path: '/tmp/myblog', domain: 'myblog.local', status: 'running' },
  site2: { id: 'site2', name: 'WP7 Test', path: '/tmp/wp7', domain: 'wp7.local', status: 'running' },
  site3: { id: 'site3', name: 'Halted Site', path: '/tmp/halted', domain: 'halted.local', status: 'halted' },
};

function createMockServices(storage: RegistryStorage): NexusServices {
  const wpCliCalls: Array<{ siteId: string; args: string[]; opts?: any }> = [];

  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: {} as any,
    fileScanner: {} as any,
    siteData: {
      getSite: (id: string) => testSites[id] ?? null,
      getSites: () => testSites,
    },
    logger: { info: jest.fn(), error: jest.fn() },
    localServices: {
      wpCliRun: jest.fn(async (siteId: string, args: string[], opts?: any) => {
        wpCliCalls.push({ siteId, args, opts });
        // Handle WP_PLUGIN_DIR eval for plugin installation
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('WP_PLUGIN_DIR')) {
          return { stdout: '/tmp/myblog/wp-content/plugins', success: true };
        }
        // Handle health check eval
        if (args[0] === 'eval' && phpCode === "echo 'healthy';") {
          return { stdout: 'healthy', success: true };
        }
        // Default: return JSON result for credential sync
        if (args[0] === 'eval' && phpCode.includes('connectors_written')) {
          return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
        }
        return { stdout: 'synced', success: true };
      }),
      getSiteStatus: (siteId: string) => testSites[siteId]?.status ?? 'halted',
      resolveSiteObject: jest.fn((siteId: string) => ({
        id: siteId,
        paths: {
          webRoot: '/tmp/myblog',
        },
      })),
    } as any,
    registryStorage: storage,
    _wpCliCalls: wpCliCalls,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wp_sync_ai_credentials', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerWpConnectorTools(registry);
  });

  test('tool is registered', () => {
    expect(registry.allToolNames()).toContain('wp_sync_ai_credentials');
  });

  test('tool is tier 2 (modify)', () => {
    expect(TIER_OVERRIDES['wp_sync_ai_credentials']).toBe(2);
  });

  test('syncs all configured providers to a running site', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-openai-key-12345678',
      anthropic: 'sk-ant-test-key-87654321',
    });
    const services = createMockServices(storage);

    // Mock wpCliRun to return credential sync JSON
    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: JSON.stringify({ connectors: 2, ai_client: true }),
      success: true,
    }));

    const result = await registry.call('wp_sync_ai_credentials', { site: 'My Blog' }, services);
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain('Synced 2 provider(s)');
    expect(text).toContain('openai');
    expect(text).toContain('anthropic');
    expect(text).toContain('Connector Screen');

    // Verify WP-CLI was called with skipPlugins: false
    const calls = (services.localServices as any).wpCliRun.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][1][0]).toBe('eval');
    expect(calls[0][1][1]).toContain('connectors_ai_openai_api_key');
    expect(calls[0][1][1]).toContain('connectors_ai_anthropic_api_key');
    expect(calls[0][1][1]).toContain('wp_ai_client_provider_credentials');
    // skipPlugins not passed — defaults to true (we bypass filters and verify via $wpdb)
  });

  test('writes to both credential stores', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-1234',
    });
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async (_siteId: string, args: string[]) => {
      const phpCode = args[1] ?? '';
      // Verify PHP writes to both stores
      expect(phpCode).toContain('connectors_ai_openai_api_key');
      expect(phpCode).toContain('wp_ai_client_provider_credentials');
      return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
    });

    const result = await registry.call('wp_sync_ai_credentials', { site: 'My Blog' }, services);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('AI Experiments plugin store: updated');
  });

  test('masks API keys in output', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-openai-key-12345678',
    });
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: JSON.stringify({ connectors: 1, ai_client: true }),
      success: true,
    }));

    const result = await registry.call('wp_sync_ai_credentials', { site: 'My Blog' }, services);
    const text = result.content[0].text;

    // Key should be masked — showing only last 4 chars
    expect(text).toContain('5678');
    expect(text).not.toContain('sk-test-openai-key-12345678');
  });

  test('dry run shows what would be synced without writing', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-key-1234',
      google: 'AIza-test-key-5678',
    });
    const services = createMockServices(storage);

    const result = await registry.call('wp_sync_ai_credentials', { site: 'My Blog', dry_run: true }, services);
    const text = result.content[0].text;

    expect(text).toContain('Dry run');
    expect(text).toContain('openai');
    expect(text).toContain('google');
    expect(text).toContain('connectors_ai_openai_api_key');
    expect(text).toContain('wp_ai_client_provider_credentials');

    // No WP-CLI calls should have been made
    const calls = (services.localServices as any).wpCliRun.mock.calls;
    expect(calls).toHaveLength(0);
  });

  test('filters to requested providers only', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-1234',
      anthropic: 'sk-ant-5678',
      google: 'AIza-9012',
    });
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async (_siteId: string, args: string[]) => {
      const phpCode = args[1] ?? '';
      expect(phpCode).toContain('connectors_ai_openai_api_key');
      expect(phpCode).not.toContain('connectors_ai_anthropic_api_key');
      return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
    });

    await registry.call(
      'wp_sync_ai_credentials',
      { site: 'My Blog', providers: ['openai'] },
      services,
    );

    expect((services.localServices as any).wpCliRun).toHaveBeenCalledTimes(1);
  });

  test('errors when no API keys are configured', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    const result = await registry.call('wp_sync_ai_credentials', { site: 'My Blog' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No AI provider API keys configured');
  });

  test('errors when site is not running', async () => {
    const storage = createMockStorage({ openai: 'sk-test' });
    const services = createMockServices(storage);

    const result = await registry.call('wp_sync_ai_credentials', { site: 'Halted Site' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('halted');
  });

  test('errors when site is not found', async () => {
    const storage = createMockStorage({ openai: 'sk-test' });
    const services = createMockServices(storage);

    const result = await registry.call('wp_sync_ai_credentials', { site: 'nonexistent' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  test('handles WP-CLI failure gracefully', async () => {
    const storage = createMockStorage({ openai: 'sk-test-1234' });
    const services = createMockServices(storage);

    // Override wpCliRun to fail
    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: 'Error: Could not update option.',
      success: false,
    }));

    const result = await registry.call('wp_sync_ai_credentials', { site: 'My Blog' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('WP-CLI error');
  });

  test('skips unsupported provider IDs', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-1234',
      ollama: 'not-a-cloud-key', // Ollama is local, no WP connector
    });
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async (_siteId: string, args: string[]) => {
      const phpCode = args[1] ?? '';
      expect(phpCode).toContain('connectors_ai_openai_api_key');
      expect(phpCode).not.toContain('ollama');
      return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
    });

    await registry.call('wp_sync_ai_credentials', { site: 'My Blog' }, services);

    // Only one WP-CLI call — all providers synced in a single eval
    expect((services.localServices as any).wpCliRun).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// wp_list_abilities
// ---------------------------------------------------------------------------

describe('wp_list_abilities', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerWpConnectorTools(registry);
  });

  test('tool is registered', () => {
    expect(registry.allToolNames()).toContain('wp_list_abilities');
  });

  test('tool is tier 1 (read-only)', () => {
    expect(TIER_OVERRIDES['wp_list_abilities']).toBe(1);
  });

  test('returns parsed abilities from WP-CLI output', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    const abilities = [
      {
        name: 'core/get-site-info',
        label: 'Get Site Info',
        description: 'Returns basic site information',
        category: 'core',
        input_schema: null,
        output_schema: null,
      },
      {
        name: 'acf/list-field-groups',
        label: 'List Field Groups',
        description: 'Lists all ACF field groups',
        category: 'acf',
        input_schema: { type: 'object', properties: { status: { type: 'string' } } },
        output_schema: null,
      },
    ];

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: JSON.stringify(abilities),
      success: true,
    }));

    const result = await registry.call('wp_list_abilities', { site: 'My Blog' }, services);
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain('2 registered ability');
    expect(text).toContain('core/get-site-info');
    expect(text).toContain('acf/list-field-groups');
    expect(text).toContain('### core');
    expect(text).toContain('### acf');
    expect(text).toContain('wp_run_ability');
  });

  test('filters by category', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async (_siteId: string, args: string[]) => {
      // Verify the PHP code includes the category filter
      expect(args[1]).toContain("get_category() !== 'acf'");
      return { stdout: JSON.stringify([]), success: true };
    });

    await registry.call('wp_list_abilities', { site: 'My Blog', category: 'acf' }, services);

    const calls = (services.localServices as any).wpCliRun;
    expect(calls).toHaveBeenCalledTimes(1);
  });

  test('returns empty array for pre-6.9 sites', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: '[]',
      success: true,
    }));

    const result = await registry.call('wp_list_abilities', { site: 'My Blog' }, services);
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain('No abilities registered');
    expect(text).toContain('WordPress < 6.9');
  });

  test('handles WP-CLI failure', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: 'Error: something went wrong',
      success: false,
    }));

    const result = await registry.call('wp_list_abilities', { site: 'My Blog' }, services);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('WP-CLI error');
  });

  test('errors when site is not found', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    const result = await registry.call('wp_list_abilities', { site: 'nonexistent' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  test('errors when site is not running', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    const result = await registry.call('wp_list_abilities', { site: 'Halted Site' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('halted');
  });

  test('shows ability annotations', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    const abilities = [
      {
        name: 'acf/delete-field-group',
        label: 'Delete Field Group',
        description: 'Deletes an ACF field group',
        category: 'acf',
        input_schema: { type: 'object', properties: { id: { type: 'number' } } },
        output_schema: null,
        annotations: { destructive: true },
      },
    ];

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: JSON.stringify(abilities),
      success: true,
    }));

    const result = await registry.call('wp_list_abilities', { site: 'My Blog' }, services);
    const text = result.content[0].text;

    expect(text).toContain('destructive');
  });

  test('handles invalid JSON response', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: 'not json at all',
      success: true,
    }));

    const result = await registry.call('wp_list_abilities', { site: 'My Blog' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to parse');
  });
});

// ---------------------------------------------------------------------------
// wp_run_ability
// ---------------------------------------------------------------------------

describe('wp_run_ability', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerWpConnectorTools(registry);
  });

  test('tool is registered', () => {
    expect(registry.allToolNames()).toContain('wp_run_ability');
  });

  test('tool is tier 2 (modify)', () => {
    expect(TIER_OVERRIDES['wp_run_ability']).toBe(2);
  });

  test('executes ability and returns result', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: JSON.stringify({ result: { name: 'My Site', url: 'https://mysite.local' } }),
      success: true,
    }));

    const result = await registry.call(
      'wp_run_ability',
      { site: 'My Blog', ability: 'core/get-site-info' },
      services,
    );
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain('core/get-site-info');
    expect(text).toContain('My Site');
    expect(text).toContain('https://mysite.local');
  });

  test('passes input data to ability', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async (_siteId: string, args: string[]) => {
      // Verify the PHP code includes the input data
      expect(args[1]).toContain('"status":"publish"');
      return {
        stdout: JSON.stringify({ result: [{ id: 1, title: 'Group A' }] }),
        success: true,
      };
    });

    const result = await registry.call(
      'wp_run_ability',
      { site: 'My Blog', ability: 'acf/list-field-groups', input: { status: 'publish' } },
      services,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Group A');
  });

  test('returns error for unknown ability', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: JSON.stringify({ error: 'Ability not found: fake/ability' }),
      success: true,
    }));

    const result = await registry.call(
      'wp_run_ability',
      { site: 'My Blog', ability: 'fake/ability' },
      services,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Ability not found');
  });

  test('returns error when permission check fails', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: JSON.stringify({ error: 'You do not have permission to perform this action.' }),
      success: true,
    }));

    const result = await registry.call(
      'wp_run_ability',
      { site: 'My Blog', ability: 'acf/delete-field-group', input: { id: 1 } },
      services,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('permission');
  });

  test('handles WP-CLI failure', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: 'PHP Fatal error: something broke',
      success: false,
    }));

    const result = await registry.call(
      'wp_run_ability',
      { site: 'My Blog', ability: 'core/get-site-info' },
      services,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('WP-CLI error');
  });

  test('returns error for pre-6.9 sites', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: JSON.stringify({ error: 'Abilities API not available. Requires WordPress 6.9+.' }),
      success: true,
    }));

    const result = await registry.call(
      'wp_run_ability',
      { site: 'My Blog', ability: 'core/get-site-info' },
      services,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Abilities API not available');
  });

  test('errors when site is not found', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    const result = await registry.call(
      'wp_run_ability',
      { site: 'nonexistent', ability: 'core/get-site-info' },
      services,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  test('errors when site is not running', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    const result = await registry.call(
      'wp_run_ability',
      { site: 'Halted Site', ability: 'core/get-site-info' },
      services,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('halted');
  });

  test('handles string result from ability', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async () => ({
      stdout: JSON.stringify({ result: 'Operation completed successfully' }),
      success: true,
    }));

    const result = await registry.call(
      'wp_run_ability',
      { site: 'My Blog', ability: 'core/some-action' },
      services,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Operation completed successfully');
  });

  test('handles empty input gracefully', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).wpCliRun = jest.fn(async (_siteId: string, args: string[]) => {
      // When no input is provided, PHP should check the ability's input_schema
      // to decide whether to pass null or empty array
      expect(args[1]).toContain('get_input_schema');
      return {
        stdout: JSON.stringify({ result: { info: 'test' } }),
        success: true,
      };
    });

    const result = await registry.call(
      'wp_run_ability',
      { site: 'My Blog', ability: 'core/get-site-info' },
      services,
    );

    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// wp_setup_ai (MCP tool)
// ---------------------------------------------------------------------------

describe('wp_setup_ai', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerWpConnectorTools(registry);
  });

  test('tool is registered', () => {
    expect(registry.allToolNames()).toContain('wp_setup_ai');
  });

  test('tool is tier 2 (modify)', () => {
    expect(TIER_OVERRIDES['wp_setup_ai']).toBe(2);
  });

  test('returns setup result on success', async () => {
    const storage = createMockStorage({ openai: 'sk-test-key-12345678' }, { aiProvider: 'openai' });
    const services = createMockServices(storage);

    // Mock wpCliRun to handle all the setup steps
    (services.localServices as any).wpCliRun = jest.fn(async (_siteId: string, args: string[]) => {
      const phpCode = args[1] ?? '';
      // New implementation uses activate, not install
      if (args[0] === 'plugin' && args[1] === 'activate') {
        return { stdout: 'ok', success: true };
      }
      // Handle WP_PLUGIN_DIR eval
      if (args[0] === 'eval' && phpCode.includes('WP_PLUGIN_DIR')) {
        return { stdout: '/tmp/myblog/wp-content/plugins', success: true };
      }
      // Handle health check
      if (args[0] === 'eval' && phpCode === "echo 'healthy';") {
        return { stdout: 'healthy', success: true };
      }
      if (args[0] === 'eval' && phpCode.includes('wpai_features_enabled')) {
        return { stdout: JSON.stringify({ global: true, 'abilities-explorer': true, 'excerpt-generation': true, 'alt-text-generation': true, 'image-generation': true, summarization: true, 'title-generation': true }), success: true };
      }
      if (args[0] === 'eval' && phpCode.includes('wp_ai_client_provider_credentials')) {
        return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
      }
      return { stdout: 'ok', success: true };
    });
    // Mock getPlugins and getWpVersion for setupSiteForAI
    (services.localServices as any).getPlugins = jest.fn(async () => []);
    (services.localServices as any).getWpVersion = jest.fn(async () => '7.0');

    const result = await registry.call('wp_setup_ai', { site: 'My Blog' }, services);
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain('Setup for AI completed');
    expect(text).toContain('AI Plugin: installed');
    expect(text).toContain('AI Experiments: enabled');
    expect(text).toContain('Credentials: synced');
  });

  test('errors when site is not found', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    const result = await registry.call('wp_setup_ai', { site: 'nonexistent' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  test('errors when site is not running', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    const result = await registry.call('wp_setup_ai', { site: 'Halted Site' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('halted');
  });

  test('returns error result when setup fails', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    // Mock getPlugins to throw, causing setupSiteForAI to fail
    (services.localServices as any).getPlugins = jest.fn(async () => {
      throw new Error('Database connection refused');
    });

    const result = await registry.call('wp_setup_ai', { site: 'My Blog' }, services);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('partially failed');
  });

  test('reports already_active when AI plugin is present', async () => {
    const storage = createMockStorage();
    const services = createMockServices(storage);

    (services.localServices as any).getPlugins = jest.fn(async () => [
      { name: 'ai', status: 'active', version: '1.0.0', title: 'AI' },
    ]);
    (services.localServices as any).getWpVersion = jest.fn(async () => '7.0');
    (services.localServices as any).wpCliRun = jest.fn(async (_siteId: string, args: string[]) => {
      const phpCode = args[1] ?? '';
      if (args[0] === 'eval' && phpCode.includes('ai_experiments_enabled')) {
        return { stdout: JSON.stringify({ enabled: 7 }), success: true };
      }
      return { stdout: 'ok', success: true };
    });

    const result = await registry.call('wp_setup_ai', { site: 'My Blog' }, services);
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain('AI Plugin: already_active');
  });
});

// ---------------------------------------------------------------------------
// setupSiteForAI
// ---------------------------------------------------------------------------

describe('setupSiteForAI', () => {
  const mockLogger = { info: jest.fn(), error: jest.fn() };

  function createMockBridge(
    plugins: Array<{ name: string; status: string; version: string }>,
    overrideWpCli?: (siteId: string, args: string[], callIndex: number) => { stdout: string; success: boolean } | null,
    wpVersion: string | null = '7.0',
  ) {
    const wpCliCalls: Array<{ siteId: string; args: string[]; opts?: any }> = [];
    let callCount = 0;
    return {
      bridge: {
        getPlugins: jest.fn(async () => plugins.map((p) => ({ ...p, title: p.name }))),
        getWpVersion: jest.fn(async () => wpVersion),
        resolveSiteObject: jest.fn((siteId: string) => ({
          id: siteId,
          paths: {
            webRoot: '/tmp/test-site',
          },
        })),
        wpCliRun: jest.fn(async (siteId: string, args: string[], opts?: any) => {
          const idx = callCount++;
          wpCliCalls.push({ siteId, args, opts });
          if (overrideWpCli) {
            const resp = overrideWpCli(siteId, args, idx);
            if (resp) return resp;
          }
          // Return plugin directory path for WP_PLUGIN_DIR eval
          if (args[0] === 'eval' && args[1]?.includes('WP_PLUGIN_DIR')) {
            return { stdout: '/tmp/test-site/wp-content/plugins', success: true };
          }
          // Default: health check returns healthy
          if (args[0] === 'eval' && args[1] === "echo 'healthy';") {
            return { stdout: 'healthy', success: true };
          }
          return { stdout: 'ok', success: true };
        }),
      } as any,
      wpCliCalls,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('installs and activates AI plugin when not present', async () => {
    const storage = createMockStorage();
    const { bridge, wpCliCalls } = createMockBridge([]);

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.success).toBe(true);
    expect(result.aiPlugin).toBe('installed');
    expect(result.acfAbilities).toBe('skipped');

    // New implementation copies bundled plugin and activates it
    // First call gets the plugins directory, second call activates
    const activateCall = wpCliCalls.find((c) =>
      c.args[0] === 'plugin' && c.args[1] === 'activate' && c.args[2] === 'ai'
    );
    expect(activateCall).toBeDefined();
    expect(result.message).toContain('AI Experiments plugin installed');
  });

  test('activates AI plugin when installed but inactive', async () => {
    const storage = createMockStorage();
    const { bridge, wpCliCalls } = createMockBridge([
      { name: 'ai', status: 'inactive', version: '1.0.0' },
    ]);

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.success).toBe(true);
    expect(result.aiPlugin).toBe('activated');
    expect(wpCliCalls[0].args).toEqual(['plugin', 'activate', 'ai']);
    expect(result.message).toContain('AI Experiments plugin activated');
  });

  test('skips when AI plugin already active', async () => {
    const storage = createMockStorage();
    const { bridge } = createMockBridge([
      { name: 'ai', status: 'active', version: '1.0.0' },
    ]);

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.success).toBe(true);
    expect(result.aiPlugin).toBe('already_active');
    expect(result.message).toContain('already active');
  });

  test('enables all AI experiments after plugin install', async () => {
    const storage = createMockStorage();
    const { bridge, wpCliCalls } = createMockBridge(
      [],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('wpai_features_enabled')) {
          return { stdout: JSON.stringify({ global: true, 'abilities-explorer': true, 'excerpt-generation': true, 'alt-text-generation': true, 'image-generation': true, summarization: true, 'title-generation': true }), success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.aiFeatures).toBe('enabled');
    expect(result.message).toContain('All AI experiments enabled');

    // Find the experiment-enabling call
    const experimentCall = wpCliCalls.find((c) =>
      c.args[0] === 'eval' && (c.args[1] ?? '').includes('wpai_features_enabled'),
    );
    expect(experimentCall).toBeDefined();
    expect(experimentCall!.args[1]).toContain("wpai_feature_abilities-explorer_enabled");
    expect(experimentCall!.args[1]).toContain("wpai_feature_excerpt-generation_enabled");
    expect(experimentCall!.args[1]).toContain("wpai_feature_alt-text-generation_enabled");
    expect(experimentCall!.args[1]).toContain("wpai_feature_summarization_enabled");
    expect(experimentCall!.args[1]).toContain("wpai_feature_title-generation_enabled");
  });

  test('syncs credentials when API keys are configured', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-key-12345678',
      anthropic: 'sk-ant-key-87654321',
    }, { aiProvider: 'openai' });
    const { bridge, wpCliCalls } = createMockBridge(
      [],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('wpai_features_enabled')) {
          return { stdout: JSON.stringify({ global: true, 'abilities-explorer': true, 'excerpt-generation': true, 'alt-text-generation': true, 'image-generation': true, summarization: true, 'title-generation': true }), success: true };
        }
        if (args[0] === 'eval' && phpCode.includes('wp_ai_client_provider_credentials')) {
          return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.credentials).toBe('synced');
    expect(result.message).toContain('API key synced');

    // Verify credentials were written for the configured provider (openai)
    const credCall = wpCliCalls.find((c) =>
      c.args[0] === 'eval' && (c.args[1] ?? '').includes('wp_ai_client_provider_credentials'),
    );
    expect(credCall).toBeDefined();
    expect(credCall!.args[1]).toContain('connectors_ai_openai_api_key');
  });

  test('skips credentials when no API keys configured', async () => {
    const storage = createMockStorage();
    const { bridge } = createMockBridge(
      [{ name: 'ai', status: 'active', version: '1.0.0' }],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('ai_experiments_enabled')) {
          return { stdout: JSON.stringify({ enabled: 7 }), success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.credentials).toBe('skipped');
    expect(result.message).toContain('No API keys configured');
  });

  test('enables ACF abilities when ACF PRO >= 6.8 is active', async () => {
    const storage = createMockStorage();
    const { bridge, wpCliCalls } = createMockBridge(
      [
        { name: 'ai', status: 'active', version: '1.0.0' },
        { name: 'advanced-custom-fields-pro', status: 'active', version: '6.8.1' },
      ],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('ai_experiments_enabled')) {
          return { stdout: JSON.stringify({ enabled: 7 }), success: true };
        }
        // First eval: check if mu-plugin exists → missing
        // Second eval: write mu-plugin → ok
        if (args[0] === 'eval' && phpCode.includes('file_exists')) {
          return { stdout: 'missing', success: true };
        }
        if (args[0] === 'eval' && phpCode.includes('file_put_contents')) {
          return { stdout: 'ok', success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.success).toBe(true);
    expect(result.acfAbilities).toBe('enabled');
    expect(result.message).toContain('ACF abilities mu-plugin created');
    // Should have called wpCliRun for the check and the write
    const evalCalls = wpCliCalls.filter((c) => c.args[0] === 'eval');
    expect(evalCalls.length).toBeGreaterThanOrEqual(2);
  });

  test('skips ACF abilities when mu-plugin already exists', async () => {
    const storage = createMockStorage();
    const { bridge } = createMockBridge(
      [
        { name: 'ai', status: 'active', version: '1.0.0' },
        { name: 'advanced-custom-fields-pro', status: 'active', version: '6.8.0' },
      ],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('ai_experiments_enabled')) {
          return { stdout: JSON.stringify({ enabled: 7 }), success: true };
        }
        if (args[0] === 'eval' && phpCode.includes('file_exists')) {
          return { stdout: 'exists', success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.success).toBe(true);
    expect(result.acfAbilities).toBe('already_enabled');
    expect(result.message).toContain('already present');
  });

  test('skips ACF when not installed', async () => {
    const storage = createMockStorage();
    const { bridge } = createMockBridge(
      [{ name: 'ai', status: 'active', version: '1.0.0' }],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('ai_experiments_enabled')) {
          return { stdout: JSON.stringify({ enabled: 7 }), success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.acfAbilities).toBe('skipped');
    expect(result.message).toContain('ACF PRO >= 6.8 not found');
  });

  test('skips ACF when version < 6.8', async () => {
    const storage = createMockStorage();
    const { bridge } = createMockBridge(
      [
        { name: 'ai', status: 'active', version: '1.0.0' },
        { name: 'advanced-custom-fields-pro', status: 'active', version: '6.7.9' },
      ],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('ai_experiments_enabled')) {
          return { stdout: JSON.stringify({ enabled: 7 }), success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.acfAbilities).toBe('skipped');
  });

  test('installs provider plugins for configured API keys', async () => {
    const storage = createMockStorage({ anthropic: 'sk-ant-key-12345678' }, { aiProvider: 'anthropic' });
    const { bridge, wpCliCalls } = createMockBridge(
      [],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('wpai_features_enabled')) {
          return { stdout: JSON.stringify({ global: true, 'abilities-explorer': true, 'excerpt-generation': true, 'alt-text-generation': true, 'image-generation': true, summarization: true, 'title-generation': true }), success: true };
        }
        if (args[0] === 'eval' && phpCode.includes('wp_ai_client_provider_credentials')) {
          return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.providerPlugins).toBe('installed');
    expect(result.message).toContain('AI provider plugin(s) installed');

    const providerInstallCall = wpCliCalls.find((c) =>
      c.args[0] === 'plugin' && c.args[1] === 'install' && c.args[2] === 'ai-provider-for-anthropic',
    );
    expect(providerInstallCall).toBeDefined();
    expect(providerInstallCall!.args).toContain('--activate');
  });

  test('skips provider plugins when no API keys configured', async () => {
    const storage = createMockStorage();
    const { bridge } = createMockBridge(
      [{ name: 'ai', status: 'active', version: '1.0.0' }],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('ai_experiments_enabled')) {
          return { stdout: JSON.stringify({ enabled: 7 }), success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.providerPlugins).toBe('skipped');
  });

  test('skips provider plugins on WP < 7.0', async () => {
    const storage = createMockStorage({ anthropic: 'sk-ant-key-12345678' });
    const { bridge } = createMockBridge(
      [],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('ai_experiments_enabled')) {
          return { stdout: JSON.stringify({ enabled: 7 }), success: true };
        }
        if (args[0] === 'eval' && phpCode.includes('wp_ai_client_provider_credentials')) {
          return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
        }
        return null;
      },
      '6.7.2', // WP 6.x — no core AI client
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.providerPlugins).toBe('skipped');
    // Should NOT have tried to install any provider plugins
    const providerInstallCall = (bridge.wpCliRun as jest.Mock).mock.calls.find(
      (c: any[]) => c[1][0] === 'plugin' && c[1][1] === 'install' && c[1][2]?.includes('ai-provider'),
    );
    expect(providerInstallCall).toBeUndefined();
  });

  test('deactivates provider plugin that crashes WordPress', async () => {
    const storage = createMockStorage({ anthropic: 'sk-ant-key-12345678' }, { aiProvider: 'anthropic' });
    let healthCheckCount = 0;
    const { bridge, wpCliCalls } = createMockBridge(
      [],
      (_siteId, args, _idx) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('wpai_features_enabled')) {
          return { stdout: JSON.stringify({ global: true, 'abilities-explorer': true, 'excerpt-generation': true, 'alt-text-generation': true, 'image-generation': true, summarization: true, 'title-generation': true }), success: true };
        }
        if (args[0] === 'eval' && phpCode.includes('wp_ai_client_provider_credentials')) {
          return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
        }
        // First health check (AI plugin) passes, second one (provider plugin) fails
        if (args[0] === 'eval' && args[1] === "echo 'healthy';") {
          healthCheckCount++;
          if (healthCheckCount === 1) {
            // AI plugin health check passes
            return { stdout: 'healthy', success: true };
          } else {
            // Provider plugin health check fails
            return { stdout: 'Fatal error: DiscoveryFailedException', success: false };
          }
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.providerPlugins).toBe('failed');
    // Should have deactivated the crashing plugin
    const deactivateCall = wpCliCalls.find((c) =>
      c.args[0] === 'plugin' && c.args[1] === 'deactivate' && c.args[2] === 'ai-provider-for-anthropic',
    );
    expect(deactivateCall).toBeDefined();
  });

  test('handles plugin install failure', async () => {
    const storage = createMockStorage();
    const { bridge } = createMockBridge([], (_siteId, args) => {
      // New implementation uses activate, not install
      if (args[0] === 'plugin' && args[1] === 'activate' && args[2] === 'ai') {
        return { stdout: 'Could not activate plugin', success: false };
      }
      return null;
    });

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.success).toBe(false);
    expect(result.aiPlugin).toBe('failed');
    expect(result.providerPlugins).toBe('skipped');
    expect(result.aiFeatures).toBe('skipped');
    expect(result.credentials).toBe('skipped');
    expect(result.message).toContain('setup failed');
  });

  test('returns combined result message with all steps', async () => {
    const storage = createMockStorage({ openai: 'sk-test-1234' }, { aiProvider: 'openai' });
    const { bridge } = createMockBridge(
      [
        { name: 'advanced-custom-fields-pro', status: 'active', version: '6.9.0' },
      ],
      (_siteId, args) => {
        const phpCode = args[1] ?? '';
        if (args[0] === 'eval' && phpCode.includes('wpai_features_enabled')) {
          return { stdout: JSON.stringify({ global: true, 'abilities-explorer': true, 'excerpt-generation': true, 'alt-text-generation': true, 'image-generation': true, summarization: true, 'title-generation': true }), success: true };
        }
        if (args[0] === 'eval' && phpCode.includes('wp_ai_client_provider_credentials')) {
          return { stdout: JSON.stringify({ connectors: 1, ai_client: true }), success: true };
        }
        if (args[0] === 'eval' && phpCode.includes('file_exists')) {
          return { stdout: 'missing', success: true };
        }
        if (args[0] === 'eval' && phpCode.includes('file_put_contents')) {
          return { stdout: 'ok', success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, storage, mockLogger);

    expect(result.success).toBe(true);
    expect(result.aiPlugin).toBe('installed');
    expect(result.aiFeatures).toBe('enabled');
    expect(result.credentials).toBe('synced');
    expect(result.acfAbilities).toBe('enabled');
    expect(result.message).toContain('installed and activated');
    expect(result.message).toContain('All AI experiments enabled');
    expect(result.message).toContain('API key synced');
    expect(result.message).toContain('ACF abilities mu-plugin created');
  });
});
