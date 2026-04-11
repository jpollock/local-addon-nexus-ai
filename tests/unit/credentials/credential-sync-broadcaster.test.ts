/**
 * Unit tests for CredentialSyncBroadcaster
 */
import { CredentialSyncBroadcaster } from '../../../src/main/credentials/CredentialSyncBroadcaster';

// Mock autoSyncCredentials
jest.mock('../../../src/main/mcp/modules/wp-connector/auto-sync', () => ({
  autoSyncCredentials: jest.fn().mockResolvedValue(undefined),
}));

import { autoSyncCredentials } from '../../../src/main/mcp/modules/wp-connector/auto-sync';
const mockedAutoSync = autoSyncCredentials as jest.MockedFunction<typeof autoSyncCredentials>;

function createMockDeps(overrides?: any) {
  return {
    localServices: {
      getAllSiteStatuses: jest.fn().mockReturnValue({
        'site-1': 'running',
        'site-2': 'running',
        'site-3': 'halted',
      }),
      ...overrides?.localServices,
    },
    registryStorage: {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'nexus-ai_api_keys') {
          return { openai: 'sk-test-123', anthropic: 'sk-ant-456' };
        }
        if (key === 'nexus-ai_site_ai_config') {
          return {
            'site-1': { provider: 'openai', configuredAt: Date.now() },
            'site-2': { provider: 'openai', configuredAt: Date.now() },
            'site-3': { provider: 'anthropic', configuredAt: Date.now() },
          };
        }
        return null;
      }),
      set: jest.fn(),
      ...overrides?.registryStorage,
    },
    siteData: {
      getSite: jest.fn().mockImplementation((id: string) => {
        const sites: Record<string, any> = {
          'site-1': { id: 'site-1', name: 'Alpha Site', path: '/path/1', domain: 'alpha.local' },
          'site-2': { id: 'site-2', name: 'Beta Site', path: '/path/2', domain: 'beta.local' },
          'site-3': { id: 'site-3', name: 'Gamma Site', path: '/path/3', domain: 'gamma.local' },
        };
        return sites[id] ?? null;
      }),
      getSites: jest.fn().mockReturnValue({
        'site-1': { id: 'site-1', name: 'Alpha Site', path: '/path/1', domain: 'alpha.local' },
        'site-2': { id: 'site-2', name: 'Beta Site', path: '/path/2', domain: 'beta.local' },
        'site-3': { id: 'site-3', name: 'Gamma Site', path: '/path/3', domain: 'gamma.local' },
      }),
      ...overrides?.siteData,
    },
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      ...overrides?.logger,
    },
  };
}

describe('CredentialSyncBroadcaster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. broadcastKeyChange calls autoSyncCredentials for each running site
  it('should sync credentials to all running sites', async () => {
    const deps = createMockDeps();
    const broadcaster = new CredentialSyncBroadcaster(deps as any);

    const results = await broadcaster.broadcastKeyChange('openai');

    expect(results).toHaveLength(2); // site-1 and site-2 are running
    expect(mockedAutoSync).toHaveBeenCalledTimes(2);
    expect(mockedAutoSync).toHaveBeenCalledWith(
      'site-1', 'Alpha Site', deps.localServices, deps.registryStorage, deps.logger,
    );
    expect(mockedAutoSync).toHaveBeenCalledWith(
      'site-2', 'Beta Site', deps.localServices, deps.registryStorage, deps.logger,
    );
    expect(results.every((r) => r.success)).toBe(true);
  });

  // 2. broadcastKeyChange skips halted sites
  it('should skip halted sites', async () => {
    const deps = createMockDeps();
    const broadcaster = new CredentialSyncBroadcaster(deps as any);

    const results = await broadcaster.broadcastKeyChange('openai');

    // site-3 is halted — should not be synced
    const siteIds = results.map((r) => r.siteId);
    expect(siteIds).not.toContain('site-3');
    expect(siteIds).toContain('site-1');
    expect(siteIds).toContain('site-2');
  });

  // 3. broadcastKeyChange handles per-site failures independently
  it('should handle per-site failures independently', async () => {
    mockedAutoSync
      .mockResolvedValueOnce(undefined) // site-1 succeeds
      .mockRejectedValueOnce(new Error('WP-CLI timeout')); // site-2 fails

    const deps = createMockDeps();
    const broadcaster = new CredentialSyncBroadcaster(deps as any);

    const results = await broadcaster.broadcastKeyChange('openai');

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[0].siteId).toBe('site-1');
    expect(results[1].success).toBe(false);
    expect(results[1].siteId).toBe('site-2');
    expect(results[1].error).toBe('WP-CLI timeout');
  });

  // 4. syncAllKeysToSite syncs all configured providers to one site
  it('should sync all keys to a single site', async () => {
    const deps = createMockDeps();
    const broadcaster = new CredentialSyncBroadcaster(deps as any);

    const result = await broadcaster.syncAllKeysToSite('site-1');

    expect(result.success).toBe(true);
    expect(result.siteId).toBe('site-1');
    expect(result.siteName).toBe('Alpha Site');
    expect(mockedAutoSync).toHaveBeenCalledTimes(1);
  });

  // 5. getSyncStatus returns accurate per-site state after broadcast
  it('should track sync status per site', async () => {
    const deps = createMockDeps();
    const broadcaster = new CredentialSyncBroadcaster(deps as any);

    // Initially empty
    expect(Object.keys(broadcaster.getSyncStatus())).toHaveLength(0);

    // After broadcast
    await broadcaster.broadcastKeyChange('openai');

    const status = broadcaster.getSyncStatus();
    expect(Object.keys(status)).toHaveLength(2);
    expect(status['site-1']).toBeDefined();
    expect(status['site-1'].success).toBe(true);
    expect(status['site-1'].lastSync).toBeGreaterThan(0);
    expect(status['site-1'].providers).toContain('openai');
    expect(status['site-1'].providers).toContain('anthropic');
  });

  // 6. No-op when no API keys configured
  it('should return empty results when no running sites', async () => {
    const deps = createMockDeps({
      localServices: {
        getAllSiteStatuses: jest.fn().mockReturnValue({
          'site-1': 'halted',
          'site-2': 'halted',
          'site-3': 'halted',
        }),
      },
    });
    const broadcaster = new CredentialSyncBroadcaster(deps as any);

    const results = await broadcaster.broadcastKeyChange('openai');

    expect(results).toHaveLength(0);
    expect(mockedAutoSync).not.toHaveBeenCalled();
  });

  it('should only sync to sites using the changed provider', async () => {
    const deps = createMockDeps();
    const broadcaster = new CredentialSyncBroadcaster(deps as any);

    // Broadcast anthropic key change — only site-3 uses anthropic, but site-3 is halted
    const results = await broadcaster.broadcastKeyChange('anthropic');
    expect(results).toHaveLength(0); // site-3 is halted, no running sites use anthropic
    expect(mockedAutoSync).not.toHaveBeenCalled();
  });

  it('should sync only to running sites using the changed provider', async () => {
    const deps = createMockDeps({
      registryStorage: {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'nexus-ai_api_keys') return { openai: 'sk-test', anthropic: 'sk-ant' };
          if (key === 'nexus-ai_site_ai_config') {
            return {
              'site-1': { provider: 'openai', configuredAt: Date.now() },
              'site-2': { provider: 'anthropic', configuredAt: Date.now() }, // different provider
            };
          }
          return null;
        }),
        set: jest.fn(),
      },
    });
    const broadcaster = new CredentialSyncBroadcaster(deps as any);

    const results = await broadcaster.broadcastKeyChange('openai');
    expect(results).toHaveLength(1); // only site-1 uses openai
    expect(mockedAutoSync).toHaveBeenCalledTimes(1);
    expect(mockedAutoSync).toHaveBeenCalledWith('site-1', 'Alpha Site', expect.anything(), expect.anything(), expect.anything());
  });
});

describe('CredentialSyncBroadcaster — gateway site exclusion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips credential sync for gateway sites even when provider matches', async () => {
    const deps = createMockDeps({
      localServices: {
        getAllSiteStatuses: jest.fn().mockReturnValue({
          'site-1': 'running', // uses openai BUT has useLocalGateway: true
          'site-2': 'running', // uses openai directly (no gateway)
        }),
      },
      registryStorage: {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'nexus-ai_api_keys') return { openai: 'sk-test' };
          if (key === 'nexus-ai_site_ai_config') {
            return {
              'site-1': { provider: 'openai', useLocalGateway: true,  configuredAt: 0 },
              'site-2': { provider: 'openai', useLocalGateway: false, configuredAt: 0 },
            };
          }
          return null;
        }),
        set: jest.fn(),
      },
    });

    const broadcaster = new CredentialSyncBroadcaster(deps as any);
    await broadcaster.broadcastKeyChange('openai');

    // Only site-2 should receive the sync — site-1 uses gateway
    expect(mockedAutoSync).toHaveBeenCalledTimes(1);
    expect(mockedAutoSync).toHaveBeenCalledWith('site-2', expect.any(String), expect.anything(), expect.anything(), expect.anything());
    expect(mockedAutoSync).not.toHaveBeenCalledWith('site-1', expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it('autoSyncCredentials returns early when site has useLocalGateway=true', async () => {
    // Import the actual function (not broadcaster) and test it directly
    const { autoSyncCredentials: realAutoSync } = jest.requireActual('../../../src/main/mcp/modules/wp-connector/auto-sync');

    const storage = {
      get: (key: string) => {
        if (key === 'nexus-ai_site_ai_config') return { 'site-1': { provider: 'anthropic', useLocalGateway: true } };
        if (key === 'nexus-ai_api_keys') return { anthropic: 'sk-ant-test' };
        return null;
      },
      set: jest.fn(),
    };
    const localServices = {
      getWpVersion: jest.fn().mockResolvedValue('7.0.0'),
      wpCliRun: jest.fn(),
    };
    const logger = { info: jest.fn(), error: jest.fn() };

    await realAutoSync('site-1', 'Test Site', localServices, storage, logger);

    // Should exit before calling wpCliRun (gateway sites skip credential sync)
    expect(localServices.wpCliRun).not.toHaveBeenCalled();
  });
});
