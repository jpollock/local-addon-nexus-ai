import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, LocalSiteInfo } from '../../src/main/mcp/types';
import { RegistryStorage } from '../../src/main/content/IndexRegistry';
import { registerWpConnectorTools } from '../../src/main/mcp/modules/wp-connector/index';
import { setupSiteForAI, SetupAIResult } from '../../src/main/mcp/modules/wp-connector/setup-ai';
import { STORAGE_KEYS } from '../../src/common/constants';
import { TIER_OVERRIDES } from '../../src/main/mcp/safety';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStorage(initialKeys?: Record<string, string>): RegistryStorage {
  const store = new Map<string, any>();
  if (initialKeys) {
    store.set(STORAGE_KEYS.API_KEYS, initialKeys);
  }
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
  const wpCliCalls: Array<{ siteId: string; args: string[] }> = [];

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
      wpCliRun: jest.fn(async (siteId: string, args: string[]) => {
        wpCliCalls.push({ siteId, args });
        return { stdout: 'synced', success: true };
      }),
      getSiteStatus: (siteId: string) => testSites[siteId]?.status ?? 'halted',
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

    const result = await registry.call('wp_sync_ai_credentials', { site: 'My Blog' }, services);
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain('Synced 2 provider(s)');
    expect(text).toContain('openai');
    expect(text).toContain('anthropic');
    expect(text).toContain('Connector Screen');

    // Verify WP-CLI calls — uses `wp eval` to bypass sanitize filters
    const calls = (services as any)._wpCliCalls;
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0]).toBe('eval');
    expect(calls[0].args[1]).toContain('connectors_ai_openai_api_key');
    expect(calls[0].args[1]).toContain('remove_all_filters');
    expect(calls[1].args[0]).toBe('eval');
    expect(calls[1].args[1]).toContain('connectors_ai_anthropic_api_key');
  });

  test('masks API keys in output', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-openai-key-12345678',
    });
    const services = createMockServices(storage);

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

    // No WP-CLI calls should have been made
    const calls = (services as any)._wpCliCalls;
    expect(calls).toHaveLength(0);
  });

  test('filters to requested providers only', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-1234',
      anthropic: 'sk-ant-5678',
      google: 'AIza-9012',
    });
    const services = createMockServices(storage);

    const result = await registry.call(
      'wp_sync_ai_credentials',
      { site: 'My Blog', providers: ['openai'] },
      services,
    );

    const calls = (services as any)._wpCliCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toContain('connectors_ai_openai_api_key');
    expect(calls[0].args[1]).not.toContain('connectors_ai_anthropic_api_key');
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
    expect(result.content[0].text).toContain('Failed');
  });

  test('skips unsupported provider IDs', async () => {
    const storage = createMockStorage({
      openai: 'sk-test-1234',
      ollama: 'not-a-cloud-key', // Ollama is local, no WP connector
    });
    const services = createMockServices(storage);

    const result = await registry.call('wp_sync_ai_credentials', { site: 'My Blog' }, services);

    // Only openai should be synced — ollama has no WP connector option
    const calls = (services as any)._wpCliCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toContain('connectors_ai_openai_api_key');
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
// setupSiteForAI
// ---------------------------------------------------------------------------

describe('setupSiteForAI', () => {
  const mockLogger = { info: jest.fn(), error: jest.fn() };

  function createMockBridge(
    plugins: Array<{ name: string; status: string; version: string }>,
    overrideWpCli?: (siteId: string, args: string[], callIndex: number) => { stdout: string; success: boolean } | null,
  ) {
    const wpCliCalls: Array<{ siteId: string; args: string[] }> = [];
    let callCount = 0;
    return {
      bridge: {
        getPlugins: jest.fn(async () => plugins.map((p) => ({ ...p, title: p.name }))),
        wpCliRun: jest.fn(async (siteId: string, args: string[]) => {
          const idx = callCount++;
          wpCliCalls.push({ siteId, args });
          if (overrideWpCli) {
            const resp = overrideWpCli(siteId, args, idx);
            if (resp) return resp;
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
    const { bridge, wpCliCalls } = createMockBridge([]);

    const result = await setupSiteForAI('site1', bridge, mockLogger);

    expect(result.success).toBe(true);
    expect(result.aiPlugin).toBe('installed');
    expect(result.acfAbilities).toBe('skipped');
    expect(wpCliCalls[0].args).toEqual(['plugin', 'install', 'ai', '--activate']);
    expect(result.message).toContain('AI Experiments plugin installed');
  });

  test('activates AI plugin when installed but inactive', async () => {
    const { bridge, wpCliCalls } = createMockBridge([
      { name: 'ai', status: 'inactive', version: '1.0.0' },
    ]);

    const result = await setupSiteForAI('site1', bridge, mockLogger);

    expect(result.success).toBe(true);
    expect(result.aiPlugin).toBe('activated');
    expect(wpCliCalls[0].args).toEqual(['plugin', 'activate', 'ai']);
    expect(result.message).toContain('AI Experiments plugin activated');
  });

  test('skips when AI plugin already active', async () => {
    const { bridge } = createMockBridge([
      { name: 'ai', status: 'active', version: '1.0.0' },
    ]);

    const result = await setupSiteForAI('site1', bridge, mockLogger);

    expect(result.success).toBe(true);
    expect(result.aiPlugin).toBe('already_active');
    expect(result.message).toContain('already active');
  });

  test('enables ACF abilities when ACF PRO >= 6.8 is active', async () => {
    const { bridge, wpCliCalls } = createMockBridge(
      [
        { name: 'ai', status: 'active', version: '1.0.0' },
        { name: 'advanced-custom-fields-pro', status: 'active', version: '6.8.1' },
      ],
      (_siteId, args) => {
        // First eval: check if mu-plugin exists → missing
        // Second eval: write mu-plugin → ok
        if (args[0] === 'eval' && args[1].includes('file_exists')) {
          return { stdout: 'missing', success: true };
        }
        if (args[0] === 'eval' && args[1].includes('file_put_contents')) {
          return { stdout: 'ok', success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, mockLogger);

    expect(result.success).toBe(true);
    expect(result.acfAbilities).toBe('enabled');
    expect(result.message).toContain('ACF abilities mu-plugin created');
    // Should have called wpCliRun for the check and the write
    const evalCalls = wpCliCalls.filter((c) => c.args[0] === 'eval');
    expect(evalCalls.length).toBe(2);
  });

  test('skips ACF abilities when mu-plugin already exists', async () => {
    const { bridge } = createMockBridge(
      [
        { name: 'ai', status: 'active', version: '1.0.0' },
        { name: 'advanced-custom-fields-pro', status: 'active', version: '6.8.0' },
      ],
      (_siteId, args) => {
        if (args[0] === 'eval' && args[1].includes('file_exists')) {
          return { stdout: 'exists', success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, mockLogger);

    expect(result.success).toBe(true);
    expect(result.acfAbilities).toBe('already_enabled');
    expect(result.message).toContain('already present');
  });

  test('skips ACF when not installed', async () => {
    const { bridge } = createMockBridge([
      { name: 'ai', status: 'active', version: '1.0.0' },
    ]);

    const result = await setupSiteForAI('site1', bridge, mockLogger);

    expect(result.acfAbilities).toBe('skipped');
    expect(result.message).toContain('ACF PRO >= 6.8 not found');
  });

  test('skips ACF when version < 6.8', async () => {
    const { bridge } = createMockBridge([
      { name: 'ai', status: 'active', version: '1.0.0' },
      { name: 'advanced-custom-fields-pro', status: 'active', version: '6.7.9' },
    ]);

    const result = await setupSiteForAI('site1', bridge, mockLogger);

    expect(result.acfAbilities).toBe('skipped');
  });

  test('handles plugin install failure', async () => {
    const { bridge } = createMockBridge([], (_siteId, args) => {
      if (args[0] === 'plugin' && args[1] === 'install') {
        return { stdout: 'Could not install plugin', success: false };
      }
      return null;
    });

    const result = await setupSiteForAI('site1', bridge, mockLogger);

    expect(result.success).toBe(false);
    expect(result.aiPlugin).toBe('failed');
    expect(result.message).toContain('setup failed');
  });

  test('returns combined result message', async () => {
    const { bridge } = createMockBridge(
      [
        { name: 'advanced-custom-fields-pro', status: 'active', version: '6.9.0' },
      ],
      (_siteId, args) => {
        if (args[0] === 'eval' && args[1].includes('file_exists')) {
          return { stdout: 'missing', success: true };
        }
        if (args[0] === 'eval' && args[1].includes('file_put_contents')) {
          return { stdout: 'ok', success: true };
        }
        return null;
      },
    );

    const result = await setupSiteForAI('site1', bridge, mockLogger);

    expect(result.success).toBe(true);
    expect(result.aiPlugin).toBe('installed');
    expect(result.acfAbilities).toBe('enabled');
    expect(result.message).toContain('installed and activated');
    expect(result.message).toContain('ACF abilities mu-plugin created');
  });
});
