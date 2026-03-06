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
});
