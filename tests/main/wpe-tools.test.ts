import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, LocalSiteInfo } from '../../src/main/mcp/types';
import { registerWpeTools } from '../../src/main/mcp/modules/wpe/index';
import { LocalServicesBridge } from '../../src/main/mcp/local-services-bridge';

const site1: LocalSiteInfo = {
  id: 'site-1', name: 'My Site', path: '/sites/my-site', domain: 'my-site.local',
};

function makeLocalServices(capiAvailable = true): jest.Mocked<LocalServicesBridge> {
  return {
    startSite: jest.fn(),
    stopSite: jest.fn(),
    restartSite: jest.fn(),
    getSiteStatus: jest.fn(() => 'running'),
    getAllSiteStatuses: jest.fn(() => ({ 'site-1': 'running' })),
    createSite: jest.fn(),
    deleteSite: jest.fn(),
    cloneSite: jest.fn(),
    exportSite: jest.fn(),
    wpCliRun: jest.fn(),
    getPlugins: jest.fn(),
    getThemes: jest.fn(),
    getWpVersion: jest.fn(),
    getOption: jest.fn(),
    dumpDatabase: jest.fn(),
    capiGetAccounts: jest.fn(() => Promise.resolve([
      { id: 'acc-1', name: 'My Account' },
    ])),
    capiGetInstalls: jest.fn(() => Promise.resolve([
      { id: 'inst-1', name: 'mysite-prod', environment: 'production' },
      { id: 'inst-2', name: 'mysite-stg', environment: 'staging' },
    ])),
    capiGetInstall: jest.fn(() => Promise.resolve({
      id: 'inst-1', name: 'mysite-prod', environment: 'production', status: 'active',
    })),
    capiCreateBackup: jest.fn(),
    capiPurgeCache: jest.fn(),
    capiDirect: jest.fn(() => Promise.resolve({
      install_name: 'mysite-prod',
      metrics_rollup: {
        visit_count: { sum: '12345' },
        network_total_bytes: { sum: '4831838208' },
        storage_file_bytes: { latest: { value: '2254857830' } },
        storage_database_bytes: { latest: { value: '536870912' } },
      },
    })),
    wpeGetUserInfo: jest.fn(() => Promise.resolve({ email: 'test@example.com', accountName: 'Test Account' })),
    wpeAuthenticate: jest.fn(() => Promise.resolve()),
    wpeLogout: jest.fn(() => Promise.resolve()),
    isCAPIAvailable: jest.fn(() => capiAvailable),
    trustCert: jest.fn(),
    getAvailablePhpVersions: jest.fn(),
    resolveSiteObject: jest.fn(() => ({
      id: 'site-1',
      name: 'My Site',
      hostConnections: {
        wpe: {
          hostId: 'wpe',
          installName: 'mysite-prod',
          accountId: 'acc-1',
        },
      },
    })),
    wpePull: {
      pull: jest.fn().mockResolvedValue(undefined),
    },
    wpePush: {
      push: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as jest.Mocked<LocalServicesBridge>;
}

function makeServices(localServices?: jest.Mocked<LocalServicesBridge>): NexusServices {
  return {
    siteData: {
      getSite: (id: string) => id === 'site-1' ? site1 : null,
      getSites: () => ({ 'site-1': site1 }),
    },
    indexRegistry: { get: () => null, listAll: () => [] },
    localServices: localServices ?? makeLocalServices(),
    logger: { info: jest.fn(), error: jest.fn() },
  } as unknown as NexusServices;
}

describe('WPE Integration Tools', () => {
  let registry: ToolRegistry;
  let localServices: jest.Mocked<LocalServicesBridge>;
  let services: NexusServices;

  beforeEach(() => {
    registry = new ToolRegistry();
    localServices = makeLocalServices();
    services = makeServices(localServices);
    registerWpeTools(registry);
  });

  test('registers 16 tools', () => {
    expect(registry.allToolNames()).toHaveLength(16);
  });

  describe('CAPI tool gating', () => {
    test('CAPI tools available when authenticated', () => {
      const tools = registry.list(services);
      const capiTools = tools.filter((t) =>
        ['wpe_get_accounts', 'wpe_get_installs', 'wpe_get_install',
         'wpe_create_backup', 'wpe_purge_cache',
         'wpe_get_install_usage', 'wpe_get_account_usage'].includes(t.name));
      expect(capiTools).toHaveLength(7);
    });

    test('CAPI tools hidden when not authenticated', () => {
      const noAuth = makeLocalServices(false);
      const s = makeServices(noAuth);
      const tools = registry.list(s);
      const capiTools = tools.filter((t) =>
        ['wpe_get_accounts', 'wpe_get_installs', 'wpe_get_install',
         'wpe_create_backup', 'wpe_purge_cache',
         'wpe_get_install_usage', 'wpe_get_account_usage'].includes(t.name));
      expect(capiTools).toHaveLength(0);
    });

    test('auth tools always available with localServices', () => {
      const noAuth = makeLocalServices(false);
      const s = makeServices(noAuth);
      const tools = registry.list(s);
      const authTools = tools.filter((t) =>
        ['wpe_status', 'wpe_login', 'wpe_logout'].includes(t.name));
      expect(authTools).toHaveLength(3);
    });

    test('local_wpe_* and nexus_list_sites always available with localServices', () => {
      const noAuth = makeLocalServices(false);
      const s = makeServices(noAuth);
      const tools = registry.list(s);
      const localWpe = tools.filter((t) =>
        ['local_wpe_link', 'local_wpe_pull', 'local_wpe_push', 'nexus_list_sites'].includes(t.name));
      expect(localWpe).toHaveLength(4);
    });
  });

  // --- wpe_get_accounts ---

  describe('wpe_get_accounts', () => {
    test('lists accounts', async () => {
      const result = await registry.call('wpe_get_accounts', {}, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('My Account');
    });
  });

  // --- wpe_get_installs ---

  describe('wpe_get_installs', () => {
    test('lists installs', async () => {
      const result = await registry.call('wpe_get_installs', {}, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('mysite-prod');
      expect(result.content[0].text).toContain('mysite-stg');
    });
  });

  // --- wpe_get_install ---

  describe('wpe_get_install', () => {
    test('returns install details', async () => {
      const result = await registry.call('wpe_get_install', { install_id: 'inst-1' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('mysite-prod');
    });
  });

  // --- wpe_create_backup ---

  describe('wpe_create_backup', () => {
    test('creates a backup', async () => {
      const result = await registry.call(
        'wpe_create_backup',
        { install_id: 'inst-1', description: 'Pre-deploy' },
        services,
      );
      expect(result.isError).toBeUndefined();
      expect(localServices.capiCreateBackup).toHaveBeenCalledWith('inst-1', 'Pre-deploy');
    });
  });

  // --- wpe_purge_cache ---

  describe('wpe_purge_cache', () => {
    test('purges cache', async () => {
      const result = await registry.call('wpe_purge_cache', { install_id: 'inst-1' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.capiPurgeCache).toHaveBeenCalledWith('inst-1');
    });
  });

  // --- local_wpe_link ---

  describe('local_wpe_link', () => {
    test('shows WPE link info', async () => {
      const result = await registry.call('local_wpe_link', { site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('mysite-prod');
    });

    test('reports unlinked site', async () => {
      localServices.resolveSiteObject.mockReturnValue({ id: 'site-1', hostConnections: {} });
      const result = await registry.call('local_wpe_link', { site: 'My Site' }, services);
      expect(result.content[0].text).toContain('not linked');
    });
  });

  // --- local_wpe_pull ---

  describe('local_wpe_pull', () => {
    test('queues pull for linked running site', async () => {
      const result = await registry.call('local_wpe_pull', { site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.status).toBe('queued');
      expect(payload.async).toBe(true);
    });

    test('rejects halted site', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      const result = await registry.call('local_wpe_pull', { site: 'My Site' }, services);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('halted');
    });

    test('rejects unlinked site', async () => {
      localServices.resolveSiteObject.mockReturnValue({ id: 'site-1', hostConnections: {} });
      const result = await registry.call('local_wpe_pull', { site: 'My Site' }, services);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not linked');
    });
  });

  // --- local_wpe_push ---

  describe('local_wpe_push', () => {
    test('queues push for linked running site (direct handler)', async () => {
      // Tier 3 confirmation is tested in tool-registry-safety.test.ts
      // Here we test the handler directly
      const handler = (registry as any).handlers.get('local_wpe_push');
      const result = await handler.execute({ site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.status).toBe('queued');
    });

    test('rejects halted site', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      const handler = (registry as any).handlers.get('local_wpe_push');
      const result = await handler.execute({ site: 'My Site' }, services);
      expect(result.isError).toBe(true);
    });
  });

  // --- nexus_list_sites ---

  describe('nexus_list_sites', () => {
    test('merges local and WPE sites', async () => {
      const result = await registry.call('nexus_list_sites', {}, services);
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('1 local');
      expect(text).toContain('2 WPE');
      expect(text).toContain('My Site');
      expect(text).toContain('mysite-prod');
    });

    test('works in local-only mode', async () => {
      localServices.isCAPIAvailable.mockReturnValue(false);
      const result = await registry.call('nexus_list_sites', {}, services);
      const text = result.content[0].text;
      expect(text).toContain('1 local');
      expect(text).toContain('0 WPE');
    });

    test('handles CAPI error gracefully', async () => {
      localServices.capiGetInstalls.mockRejectedValue(new Error('Auth failed'));
      const result = await registry.call('nexus_list_sites', {}, services);
      expect(result.isError).toBeUndefined();
      // Should still show local sites
      expect(result.content[0].text).toContain('My Site');
    });
  });

  // --- wpe_status / wpe_login / wpe_logout ---
  // These tools call Local's built-in GraphQL server directly (not localServices).
  // In unit tests Local is not running, so they return an error — verify graceful degradation.

  describe('wpe auth tools', () => {
    test('wpe_status is registered and always available', () => {
      const tools = registry.list(services);
      expect(tools.find((t) => t.name === 'wpe_status')).toBeDefined();
    });

    test('wpe_login is registered and always available', () => {
      const tools = registry.list(services);
      expect(tools.find((t) => t.name === 'wpe_login')).toBeDefined();
    });

    test('wpe_logout is registered and always available', () => {
      const tools = registry.list(services);
      expect(tools.find((t) => t.name === 'wpe_logout')).toBeDefined();
    });

    test('wpe_status returns error (not crash) when Local is not running', async () => {
      const result = await registry.call('wpe_status', {}, services);
      // Must degrade gracefully — isError true with a message, not a thrown exception
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBeTruthy();
    });
  });

  // --- wpe_get_install_usage ---

  describe('wpe_get_install_usage', () => {
    test('fetches usage data for an install', async () => {
      const result = await registry.call('wpe_get_install_usage', { install_id: 'inst-1' }, services);
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('mysite-prod');
      expect(localServices.capiDirect).toHaveBeenCalledWith(
        expect.stringContaining('/installs/inst-1/usage'),
      );
    });

    test('uses correct date params', async () => {
      await registry.call('wpe_get_install_usage', { install_id: 'inst-1', month_offset: 1 }, services);
      const callArg: string = localServices.capiDirect.mock.calls[0][0];
      expect(callArg).toContain('first_date=');
      expect(callArg).toContain('last_date=');
    });

    test('returns cached response on second call', async () => {
      localServices.capiDirect.mockClear();
      // First call populates cache
      await registry.call('wpe_get_install_usage', { install_id: 'cached-inst', month_offset: 2 }, services);
      // Second call should hit cache (past month — 24h TTL)
      await registry.call('wpe_get_install_usage', { install_id: 'cached-inst', month_offset: 2 }, services);
      expect(localServices.capiDirect).toHaveBeenCalledTimes(1);
    });
  });

  // --- wpe_get_account_usage ---

  describe('wpe_get_account_usage', () => {
    test('fetches usage data for an account', async () => {
      localServices.capiDirect.mockClear();
      const result = await registry.call('wpe_get_account_usage', { account_id: 'acc-1' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.capiDirect).toHaveBeenCalledWith(
        expect.stringContaining('/accounts/acc-1/usage'),
      );
    });
  });
});
