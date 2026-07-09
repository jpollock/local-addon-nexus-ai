/**
 * Unit tests for applyGatewayChange (tested indirectly via siteStarted hook)
 *
 * applyGatewayChange is a private function inside registerLifecycleHooks.
 * We test it by:
 *   1. Calling registerLifecycleHooks with mocked context + services
 *   2. Capturing the siteStarted callback
 *   3. Setting up storage state where gateway setting differs from siteConfig
 *   4. Calling the captured callback
 *   5. Verifying switchProviderForSite was/wasn't called with the right args
 */

jest.mock('../../../src/main/mcp/modules/wp-connector/switch-provider', () => ({
  switchProviderForSite: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../../src/main/mcp/modules/wp-connector/auto-sync', () => ({
  autoSyncCredentials: jest.fn().mockResolvedValue(undefined),
}));

// Mock heavy dependencies that lifecycle-hooks imports
jest.mock('../../../src/main/ai-context/auto-generate', () => ({
  autoGenerateContextFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/main/ai-gateway/mu-plugin-template', () => ({
  generateMuPluginContent: jest.fn().mockReturnValue('<?php // mock'),
}));

// Mock fs-extra used by installNexusAiConnectorPlugin
jest.mock('fs-extra', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  copy: jest.fn().mockResolvedValue(undefined),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

import { switchProviderForSite } from '../../../src/main/mcp/modules/wp-connector/switch-provider';
import { registerLifecycleHooks, LifecycleContext } from '../../../src/main/content/lifecycle-hooks';
import { IndexRegistry, RegistryStorage } from '../../../src/main/content/IndexRegistry';
import { STORAGE_KEYS } from '../../../src/common/constants';

const mockedSwitchProvider = switchProviderForSite as jest.MockedFunction<typeof switchProviderForSite>;

function createMockStorage(initialData: Record<string, any> = {}): RegistryStorage {
  const store = new Map<string, any>(Object.entries(initialData));
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => store.set(key, value),
  };
}

function createMockLocalServices(overrides?: any) {
  return {
    wpCliRun: jest.fn().mockResolvedValue({ success: true, stdout: '' }),
    resolveSiteObject: jest.fn().mockReturnValue({
      paths: { webRoot: '/sites/mysite/app/public' },
    }),
    getWpVersion: jest.fn().mockResolvedValue('7.0.0'),
    getPlugins: jest.fn().mockResolvedValue([]),
    getThemes: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createTestSetup(storageData: Record<string, any>, localServicesOverrides?: any) {
  const hooks: Record<string, Function> = {};
  const context: LifecycleContext = {
    hooks: {
      addAction: (name: string, cb: Function) => { hooks[name] = cb; },
    },
  };

  const storage = createMockStorage(storageData);
  const pipeline = {
    indexSite: jest.fn().mockResolvedValue({
      siteId: 'site-1', documentsIndexed: 0, chunksIndexed: 0, durationMs: 10, errors: [],
    }),
    removeSite: jest.fn().mockResolvedValue(undefined),
  };
  const indexRegistry = new IndexRegistry(createMockStorage());
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const localServices = createMockLocalServices(localServicesOverrides);

  registerLifecycleHooks(
    context,
    pipeline as any,
    indexRegistry,
    logger,
    undefined,
    storage,
    localServices as any,
    undefined,
  );

  return { hooks, logger, localServices };
}

const site = { id: 'site-1', name: 'Test Site', path: '/sites/mysite' };

describe('applyGatewayChange (via siteStarted hook)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSwitchProvider.mockResolvedValue({ success: true });
  });

  // 1. Gateway toggled ON — site was configured without gateway
  it('calls switchProviderForSite when gateway is now ON but site was OFF', async () => {
    const { hooks } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {
        'site-1': { provider: 'anthropic', useLocalGateway: false, configuredAt: 0 },
      },
    });

    await hooks.siteStarted(site);

    expect(mockedSwitchProvider).toHaveBeenCalledWith(
      'site-1',
      'anthropic',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  // 2. Gateway toggled OFF — site was configured with gateway
  it('calls switchProviderForSite when gateway is now OFF but site was ON', async () => {
    const { hooks } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic', useLocalGateway: false },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {
        'site-1': { provider: 'anthropic', useLocalGateway: true, configuredAt: 0 },
      },
    });

    await hooks.siteStarted(site);

    expect(mockedSwitchProvider).toHaveBeenCalledWith(
      'site-1',
      'anthropic',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  // 3. No change needed — gateway state already matches
  it('does NOT call switchProviderForSite when gateway state matches site config', async () => {
    const { hooks } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {
        'site-1': { provider: 'anthropic', useLocalGateway: true, configuredAt: 0 },
      },
    });

    await hooks.siteStarted(site);

    expect(mockedSwitchProvider).not.toHaveBeenCalled();
  });

  // 4. Site not configured (no SiteAIConfig entry)
  it('does NOT call switchProviderForSite when site has no config', async () => {
    const { hooks } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {}, // no entry for site-1
    });

    await hooks.siteStarted(site);

    expect(mockedSwitchProvider).not.toHaveBeenCalled();
  });

  it('logs a skip message when site has no AI config (gateway cannot be applied)', async () => {
    const { hooks, logger } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {}, // no entry for site-1
    });

    await hooks.siteStarted(site);

    const infoMessages = (logger.info as jest.Mock).mock.calls.map((c: any[]) => c.join(' '));
    expect(infoMessages.some((m: string) => m.includes('Skipping') && m.includes('AI not configured'))).toBe(true);
  });

  // 5. Ollama provider always skips gateway logic
  it('does NOT call switchProviderForSite for ollama provider regardless of gateway setting', async () => {
    const { hooks } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'ollama', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {
        'site-1': { provider: 'ollama', useLocalGateway: false, configuredAt: 0 },
      },
    });

    await hooks.siteStarted(site);

    expect(mockedSwitchProvider).not.toHaveBeenCalled();
  });

  // 6. Switch failure is logged as error, does not throw
  it('logs error without throwing when switchProviderForSite fails', async () => {
    mockedSwitchProvider.mockResolvedValue({ success: false, error: 'Plugin install failed' });

    const { hooks, logger } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {
        'site-1': { provider: 'anthropic', useLocalGateway: false, configuredAt: 0 },
      },
    });

    // Should not throw
    await expect(hooks.siteStarted(site)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed for'),
    );
  });

  // 7. Treats undefined useLocalGateway on site config as "false"
  it('treats undefined useLocalGateway in site config as false', async () => {
    const { hooks } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {
        // useLocalGateway not set — defaults to false
        'site-1': { provider: 'anthropic', configuredAt: 0 },
      },
    });

    await hooks.siteStarted(site);

    // Gateway is ON globally but site config has no useLocalGateway → mismatch → switch
    expect(mockedSwitchProvider).toHaveBeenCalled();
  });
});

describe('applyGatewayChange — provider-only change', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSwitchProvider.mockResolvedValue({ success: true });
  });

  // 8. Provider changes while gateway stays ON — must NOT call switchProviderForSite
  it('does NOT call switchProviderForSite when only provider changes on a gateway site', async () => {
    const { hooks } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'openai', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {
        // Site has gateway ON with anthropic — provider changed to openai
        'site-1': { provider: 'anthropic', useLocalGateway: true, configuredAt: 0 },
      },
    });

    await hooks.siteStarted(site);

    expect(mockedSwitchProvider).not.toHaveBeenCalled();
  });

  // 9. Provider change updates SITE_AI_CONFIG
  it('updates SITE_AI_CONFIG.provider when provider changes on a gateway site', async () => {
    const storage = createMockStorage({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'openai', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {
        'site-1': { provider: 'anthropic', useLocalGateway: true, configuredAt: 0 },
      },
    });

    const hooks: Record<string, Function> = {};
    const context: LifecycleContext = {
      hooks: { addAction: (name: string, cb: Function) => { hooks[name] = cb; } },
    };
    const pipeline = {
      indexSite: jest.fn().mockResolvedValue({ siteId: 'site-1', documentsIndexed: 0, chunksIndexed: 0, durationMs: 10, errors: [] }),
      removeSite: jest.fn(),
    };
    const indexRegistry = new IndexRegistry(createMockStorage());
    const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const localServices = createMockLocalServices();

    registerLifecycleHooks(context, pipeline as any, indexRegistry, logger, undefined, storage, localServices as any, undefined);

    await hooks.siteStarted(site);

    const updatedConfigs = storage.get(STORAGE_KEYS.SITE_AI_CONFIG);
    expect(updatedConfigs?.['site-1']?.provider).toBe('openai');
  });

  // 10. Same provider, gateway stays ON — no action at all
  it('takes no action when provider and gateway state both match', async () => {
    const { hooks } = createTestSetup({
      [STORAGE_KEYS.SETTINGS]: { aiProvider: 'openai', useLocalGateway: true },
      [STORAGE_KEYS.SITE_AI_CONFIG]: {
        'site-1': { provider: 'openai', useLocalGateway: true, configuredAt: 0 },
      },
    });

    await hooks.siteStarted(site);

    expect(mockedSwitchProvider).not.toHaveBeenCalled();
  });
});
