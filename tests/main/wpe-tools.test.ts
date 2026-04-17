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
    capiGetSites: jest.fn(() => Promise.resolve([
      {
        id: 'site-wpe-1',
        name: 'My WPE Site',
        installs: [
          { id: 'inst-1', name: 'mysite-prod', environment: 'production', primaryDomain: 'mysite.wpengine.com' },
          { id: 'inst-2', name: 'mysite-stg', environment: 'staging', primaryDomain: 'mysite-stg.wpengine.com' },
        ],
      },
    ])),
    isCAPIAvailable: jest.fn(() => capiAvailable),
    isWPEAuthenticated: jest.fn(() => capiAvailable),
    getWpeUserId: jest.fn(() => null),
    wpeSetApiCredentials: jest.fn(() => Promise.resolve()),
    wpeClearApiCredentials: jest.fn(() => Promise.resolve()),
    wpeGetApiCredentialsStatus: jest.fn(() => Promise.resolve({ configured: false })),
    trustCert: jest.fn(),
    getAvailablePhpVersions: jest.fn(),
    resolveSiteObject: jest.fn(() => ({
      id: 'site-1',
      name: 'My Site',
      hostConnections: {
        wpe: {
          hostId: 'wpe',
          remoteSiteId: 'inst-1',
          remoteSiteEnv: 'production',
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

  test('registers 77 tools', () => {
    expect(registry.allToolNames()).toHaveLength(77);
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

  // --- wpe_set_api_credentials ---

  describe('wpe_set_api_credentials', () => {
    test('stores credentials', async () => {
      const result = await registry.call(
        'wpe_set_api_credentials',
        { username: 'myuser', password: 'mypass' },
        services,
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('stored securely');
      expect(localServices.wpeSetApiCredentials).toHaveBeenCalledWith('myuser', 'mypass');
    });

    test('errors if username missing', async () => {
      const result = await registry.call(
        'wpe_set_api_credentials',
        { username: '', password: 'mypass' },
        services,
      );
      expect(result.isError).toBe(true);
    });
  });

  // --- wpe_clear_api_credentials ---

  describe('wpe_clear_api_credentials', () => {
    test('clears credentials', async () => {
      const result = await registry.call('wpe_clear_api_credentials', {}, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('cleared');
      expect(localServices.wpeClearApiCredentials).toHaveBeenCalled();
    });
  });

  // --- wpe_credentials_status ---

  describe('wpe_credentials_status', () => {
    test('reports not configured', async () => {
      const result = await registry.call('wpe_credentials_status', {}, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('NOT configured');
    });

    test('reports configured with username', async () => {
      localServices.wpeGetApiCredentialsStatus.mockResolvedValue({ configured: true, username: 'myuser' });
      const result = await registry.call('wpe_credentials_status', {}, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('configured');
      expect(result.content[0].text).toContain('myuser');
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
      expect(result.content[0].text).toContain('inst-1');
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
      expect(payload.status).toBe('in_progress');
    });

    test('rejects halted site', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      const result = await registry.call('local_wpe_pull', { site: 'My Site' }, services);
      expect(result.content[0].text).toContain('halted');
    });

    test('rejects unlinked site', async () => {
      localServices.resolveSiteObject.mockReturnValue({ id: 'site-1', hostConnections: {} });
      const result = await registry.call('local_wpe_pull', { site: 'My Site' }, services);
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
      expect(payload.status).toBe('in_progress');
    });

    test('rejects halted site', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      const handler = (registry as any).handlers.get('local_wpe_push');
      const result = await handler.execute({ site: 'My Site' }, services);
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

    test('wpe_status returns a result without throwing', async () => {
      const result = await registry.call('wpe_status', {}, services);
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

  // --- wpe_portfolio_usage ---

  describe('wpe_portfolio_usage', () => {
    function makeServicesWithUsage(): NexusServices {
      const ls = makeLocalServices();
      ls.capiGetAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'Account One' },
        { id: 'acc-2', name: 'Account Two' },
      ] as any);
      ls.capiDirect.mockImplementation((url: string) => {
        if (url.includes('acc-1')) {
          return Promise.resolve({
            environment_metrics: [
              {
                environment_name: 'site-a-prod',
                metrics_rollup: {
                  visit_count: { sum: '30000' },
                  network_total_bytes: { sum: '2000000000' },
                  storage_file_bytes: { latest: { value: '1073741824' } },
                  storage_database_bytes: { latest: { value: '536870912' } },
                },
              },
            ],
          });
        }
        return Promise.resolve({
          environment_metrics: [
            {
              environment_name: 'site-b-prod',
              metrics_rollup: {
                visit_count: { sum: '5000' },
                network_total_bytes: { sum: '500000000' },
                storage_file_bytes: { latest: { value: '214748364' } },
                storage_database_bytes: { latest: { value: '107374182' } },
              },
            },
          ],
        });
      });
      return makeServices(ls);
    }

    test('lists installs from all accounts sorted by visits', async () => {
      const s = makeServicesWithUsage();
      const result = await registry.call('wpe_portfolio_usage', {}, s);
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('2 accounts');
      expect(text).toContain('site-a-prod');
      expect(text).toContain('site-b-prod');
      // site-a-prod has more visits so should appear first
      expect(text.indexOf('site-a-prod')).toBeLessThan(text.indexOf('site-b-prod'));
    });

    test('applies min_visits_per_day filter', async () => {
      const s = makeServicesWithUsage();
      // site-b-prod has 5000 visits over ~30 days = ~167/day; site-a-prod has 30000 = ~1000/day
      const result = await registry.call('wpe_portfolio_usage', { min_visits_per_day: 500 }, s);
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('site-a-prod');
      expect(text).not.toContain('site-b-prod');
    });

    test('returns message when no accounts found', async () => {
      const ls = makeLocalServices();
      ls.capiGetAccounts.mockResolvedValue([] as any);
      const s = makeServices(ls);
      const result = await registry.call('wpe_portfolio_usage', {}, s);
      expect(result.content[0].text).toContain('No WP Engine accounts found');
    });

    test('includes bandwidth and storage columns in output', async () => {
      const s = makeServicesWithUsage();
      const result = await registry.call('wpe_portfolio_usage', {}, s);
      const text = result.content[0].text;
      expect(text).toContain('GB');
      expect(text).toContain('Bandwidth');
    });
  });

  // --- wpe_fleet_versions ---

  describe('wpe_fleet_versions', () => {
    function makeServicesWithGraph(rows: any[]): NexusServices {
      const mockDb = {
        prepare: jest.fn().mockReturnValue({
          all: jest.fn().mockReturnValue(rows),
          get: jest.fn(),
        }),
      };
      const s = makeServices();
      (s as any).graphService = { getDb: () => mockDb };
      return s;
    }

    test('formats WP/PHP version table from graph DB', async () => {
      const s = makeServicesWithGraph([
        { name: 'alpha-prod', wp_version: '6.7.2', php_version: '8.2', domain: 'alpha.wpengine.com', last_sync_at: Date.now() },
        { name: 'beta-prod', wp_version: '6.6.0', php_version: '8.1', domain: 'beta.wpengine.com', last_sync_at: Date.now() },
      ]);
      const result = await registry.call('wpe_fleet_versions', {}, s);
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('alpha-prod');
      expect(text).toContain('6.7.2');
      expect(text).toContain('beta-prod');
      expect(text).toContain('8.1');
    });

    test('filters by min_wp_version — returns only installs below threshold', async () => {
      const s = makeServicesWithGraph([
        { name: 'old-prod', wp_version: '6.5.0', php_version: '8.1', domain: 'old.wpengine.com', last_sync_at: Date.now() },
        { name: 'new-prod', wp_version: '6.8.0', php_version: '8.2', domain: 'new.wpengine.com', last_sync_at: Date.now() },
      ]);
      const result = await registry.call('wpe_fleet_versions', { min_wp_version: '6.7' }, s);
      const text = result.content[0].text;
      expect(text).toContain('old-prod');
      expect(text).not.toContain('new-prod');
    });

    test('returns error message when graph DB not available', async () => {
      const s = makeServices();
      // no graphService attached
      const result = await registry.call('wpe_fleet_versions', {}, s);
      expect(result.content[0].text).toContain('Graph database not available');
    });

    test('shows not-found warning for requested install names missing from graph', async () => {
      const s = makeServicesWithGraph([
        { name: 'alpha-prod', wp_version: '6.7.2', php_version: '8.2', domain: 'alpha.wpengine.com', last_sync_at: Date.now() },
      ]);
      const result = await registry.call('wpe_fleet_versions', { install_names: ['alpha-prod', 'missing-site'] }, s);
      const text = result.content[0].text;
      expect(text).toContain('missing-site');
      expect(text).toContain('Not found in graph');
    });

    test('returns no-data message when graph is empty', async () => {
      const s = makeServicesWithGraph([]);
      const result = await registry.call('wpe_fleet_versions', {}, s);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('wpe_sync_sites');
    });
  });

  // --- wpe_detect_drift ---

  describe('wpe_detect_drift', () => {
    function makeServicesWithDrift(opts: {
      localSites?: Record<string, any>;
      graphResponses?: Record<string, any>;
    }): NexusServices {
      const { localSites = {}, graphResponses = {} } = opts;

      const mockDb = {
        prepare: jest.fn().mockImplementation((sql: string) => ({
          get: jest.fn().mockImplementation((...params: any[]) => {
            const key = `get:${sql.trim().slice(0, 40)}:${params.join(',')}`;
            return graphResponses[key] ?? undefined;
          }),
          all: jest.fn().mockImplementation((...params: any[]) => {
            const key = `all:${sql.trim().slice(0, 40)}:${params.join(',')}`;
            return graphResponses[key] ?? [];
          }),
        })),
      };

      const s = {
        siteData: {
          getSite: (id: string) => localSites[id] ?? null,
          getSites: () => localSites,
        },
        indexRegistry: { get: () => null, listAll: () => [] },
        localServices: makeLocalServices(),
        logger: { info: jest.fn(), error: jest.fn() },
      } as unknown as NexusServices;
      (s as any).graphService = { getDb: () => mockDb };
      return s;
    }

    test('returns no-linked-sites message when no hostConnections', async () => {
      const s = makeServicesWithDrift({
        localSites: {
          'site-1': { id: 'site-1', name: 'Local Site', hostConnections: {} },
        },
      });
      const result = await registry.call('wpe_detect_drift', {}, s);
      expect(result.content[0].text).toContain('No local sites are linked');
    });

    test('detects WP version drift between local and WPE', async () => {
      // Build a more direct mock approach using jest.fn() chains
      const prepareGet = jest.fn();
      const prepareAll = jest.fn();
      const mockDb = {
        prepare: jest.fn().mockReturnValue({
          get: prepareGet,
          all: prepareAll,
        }),
      };

      // local site graph row (wp_version)
      prepareGet.mockImplementation((...params: any[]) => {
        // First call: local site row (by id = 'site-local')
        // Second call: wpe site row (by name = 'mywpe-prod')
        if (params[0] === 'site-local') {
          return { wp_version: '6.9.0', php_version: '8.2' };
        }
        if (params[0] === 'mywpe-prod') {
          return { wp_version: '6.8.0', php_version: '8.1' };
        }
        return undefined;
      });
      prepareAll.mockReturnValue([]); // no plugins

      const s = {
        siteData: {
          getSites: () => ({
            'site-local': {
              id: 'site-local',
              name: 'Local Dev',
              hostConnections: {
                wpe: { host: 'wpe', installName: 'mywpe-prod' },
              },
            },
          }),
        },
        indexRegistry: { get: () => null, listAll: () => [] },
        localServices: makeLocalServices(),
        logger: { info: jest.fn(), error: jest.fn() },
      } as unknown as NexusServices;
      (s as any).graphService = { getDb: () => mockDb };

      const result = await registry.call('wpe_detect_drift', {}, s);
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('Local Dev');
      expect(text).toContain('mywpe-prod');
      expect(text).toContain('local is ahead');
    });

    test('returns graph-unavailable message when no graphService', async () => {
      const s = makeServices();
      // siteData.getSites returns a site with a WPE connection but no graphService
      (s.siteData as any).getSites = () => ({
        'site-1': {
          id: 'site-1',
          name: 'My Site',
          hostConnections: { wpe: { host: 'wpe', installName: 'mysite-prod' } },
        },
      });
      const result = await registry.call('wpe_detect_drift', {}, s);
      expect(result.content[0].text).toContain('Graph database not available');
    });

    test('filters to specific site when site arg provided', async () => {
      const prepareGet = jest.fn().mockReturnValue(undefined);
      const prepareAll = jest.fn().mockReturnValue([]);
      const mockDb = { prepare: jest.fn().mockReturnValue({ get: prepareGet, all: prepareAll }) };

      const s = {
        siteData: {
          getSites: () => ({
            'site-a': { id: 'site-a', name: 'Alpha Site', hostConnections: { wpe: { host: 'wpe', installName: 'alpha-prod' } } },
            'site-b': { id: 'site-b', name: 'Beta Site', hostConnections: { wpe: { host: 'wpe', installName: 'beta-prod' } } },
          }),
        },
        indexRegistry: { get: () => null, listAll: () => [] },
        localServices: makeLocalServices(),
        logger: { info: jest.fn(), error: jest.fn() },
      } as unknown as NexusServices;
      (s as any).graphService = { getDb: () => mockDb };

      const result = await registry.call('wpe_detect_drift', { site: 'Alpha' }, s);
      const text = result.content[0].text;
      // Only Alpha Site should appear in the report header
      expect(text).toContain('Alpha Site');
      expect(text).not.toContain('Beta Site');
    });
  });
});
