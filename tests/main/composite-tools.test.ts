import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, LocalSiteInfo } from '../../src/main/mcp/types';
import { registerCompositeTools } from '../../src/main/mcp/modules/composite/index';
import { LocalServicesBridge } from '../../src/main/mcp/local-services-bridge';

const site1: LocalSiteInfo = { id: 'site-1', name: 'Test Site', path: '/sites/test', domain: 'test.local' };
const site2: LocalSiteInfo = { id: 'site-2', name: 'Staging', path: '/sites/staging', domain: 'staging.local' };

function makeLocalServices(): jest.Mocked<LocalServicesBridge> {
  return {
    startSite: jest.fn(),
    stopSite: jest.fn(),
    restartSite: jest.fn(),
    getSiteStatus: jest.fn(() => 'running'),
    getAllSiteStatuses: jest.fn(() => ({ 'site-1': 'running', 'site-2': 'running' })),
    createSite: jest.fn(),
    deleteSite: jest.fn(),
    cloneSite: jest.fn(),
    exportSite: jest.fn(),
    wpCliRun: jest.fn(() => Promise.resolve({ stdout: 'ok', success: true })),
    getPlugins: jest.fn(() => Promise.resolve([
      { name: 'akismet', title: 'Akismet', version: '5.0', status: 'active' },
      { name: 'hello-dolly', title: 'Hello Dolly', version: '1.7', status: 'inactive' },
    ])),
    getThemes: jest.fn(() => Promise.resolve([
      { name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' },
    ])),
    getWpVersion: jest.fn(() => Promise.resolve('6.4.2')),
    getOption: jest.fn(),
    dumpDatabase: jest.fn(),
    capiGetAccounts: jest.fn(),
    capiGetInstalls: jest.fn(),
    capiGetInstall: jest.fn(),
    capiCreateBackup: jest.fn(),
    capiPurgeCache: jest.fn(),
    isCAPIAvailable: jest.fn(() => false),
    trustCert: jest.fn(),
    getAvailablePhpVersions: jest.fn(),
    resolveSiteObject: jest.fn(),
  } as unknown as jest.Mocked<LocalServicesBridge>;
}

function makeServices(localServices?: jest.Mocked<LocalServicesBridge>): NexusServices {
  return {
    siteData: {
      getSite: (id: string) => {
        if (id === 'site-1') return site1;
        if (id === 'site-2') return site2;
        return null;
      },
      getSites: () => ({ 'site-1': site1, 'site-2': site2 }),
    },
    indexRegistry: { get: () => null, listAll: () => [] },
    localServices: localServices ?? makeLocalServices(),
    logger: { info: jest.fn(), error: jest.fn() },
  } as unknown as NexusServices;
}

describe('Composite Tools', () => {
  let registry: ToolRegistry;
  let localServices: jest.Mocked<LocalServicesBridge>;
  let services: NexusServices;

  beforeEach(() => {
    registry = new ToolRegistry();
    localServices = makeLocalServices();
    services = makeServices(localServices);
    registerCompositeTools(registry);
  });

  test('registers 2 composite tools', () => {
    expect(registry.allToolNames()).toContain('nexus_site_audit');
    expect(registry.allToolNames()).toContain('nexus_plugin_audit');
  });

  test('nexus_site_audit requires localServices; nexus_plugin_audit only requires siteData', () => {
    const noLocal = makeServices();
    (noLocal as any).localServices = undefined;
    // nexus_plugin_audit is available without localServices (isAvailable: !!services.siteData)
    // nexus_site_audit requires localServices
    expect(registry.list(noLocal)).toHaveLength(1);
    expect(registry.list(noLocal)[0].name).toBe('nexus_plugin_audit');
  });

  // ---------------------------------------------------------------------------
  // nexus_site_audit
  // ---------------------------------------------------------------------------

  describe('nexus_site_audit', () => {
    test('returns unified audit with version, plugins, themes, health, and updates', async () => {
      localServices.wpCliRun.mockImplementation((_id, args) => {
        if (args[0] === 'site' && args[1] === 'health') {
          return Promise.resolve({ stdout: '{"status":"good"}', success: true });
        }
        if (args[0] === 'plugin' && args[1] === 'update') {
          return Promise.resolve({
            stdout: JSON.stringify([
              { name: 'akismet', version: '5.0', update_version: '5.1' },
            ]),
            success: true,
          });
        }
        return Promise.resolve({ stdout: 'ok', success: true });
      });

      const result = await registry.call('nexus_site_audit', { site: 'Test Site' }, services);

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;

      // Version
      expect(text).toContain('6.4.2');

      // Plugins table
      expect(text).toContain('akismet');
      expect(text).toContain('hello-dolly');
      expect(text).toContain('**active**');

      // Updates table
      expect(text).toContain('Updates Available');
      expect(text).toContain('v5.1');

      // Themes
      expect(text).toContain('twentytwentyfour');

      // Health
      expect(text).toContain('Site Health');
    });

    test('calls all services in parallel', async () => {
      await registry.call('nexus_site_audit', { site: 'Test Site' }, services);

      expect(localServices.getWpVersion).toHaveBeenCalledWith('site-1');
      expect(localServices.getPlugins).toHaveBeenCalledWith('site-1');
      expect(localServices.getThemes).toHaveBeenCalledWith('site-1');
      expect(localServices.wpCliRun).toHaveBeenCalledWith('site-1', expect.arrayContaining(['site', 'health']));
      expect(localServices.wpCliRun).toHaveBeenCalledWith('site-1', expect.arrayContaining(['plugin', 'update']));
    });

    test('rejects unknown site', async () => {
      const result = await registry.call('nexus_site_audit', { site: 'Nonexistent' }, services);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    test('auto-starts and audits a halted site', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      localServices.wpCliRun.mockImplementation((_siteId: string, args: string[]) => {
        // Readiness probe returns 'ready' immediately so waitForDatabaseReady exits
        if (args[0] === 'eval') return Promise.resolve({ stdout: 'ready', success: true });
        return Promise.resolve({ stdout: 'ok', success: true });
      });

      const result = await registry.call('nexus_site_audit', { site: 'Test Site' }, services);

      expect(localServices.startSite).toHaveBeenCalledWith('site-1');
      expect(result.isError).toBeUndefined();
    }, 10_000);

    test('handles partial failures gracefully', async () => {
      localServices.getWpVersion.mockRejectedValue(new Error('version failed'));
      localServices.wpCliRun.mockRejectedValue(new Error('cli failed'));

      const result = await registry.call('nexus_site_audit', { site: 'Test Site' }, services);

      // Should still succeed with available data
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('unknown'); // WP version fallback
      expect(text).toContain('akismet'); // plugins still work
    });

    test('reports all plugins up to date when no updates available', async () => {
      localServices.wpCliRun.mockImplementation((_id, args) => {
        if (args[0] === 'plugin' && args[1] === 'update') {
          return Promise.resolve({ stdout: '[]', success: true });
        }
        return Promise.resolve({ stdout: 'ok', success: true });
      });

      const result = await registry.call('nexus_site_audit', { site: 'Test Site' }, services);
      expect(result.content[0].text).toContain('up to date');
    });
  });

  // ---------------------------------------------------------------------------
  // nexus_plugin_audit
  // Uses SiteDataResolver — works for all sites (running=WP-CLI, halted=cache/index)
  // ---------------------------------------------------------------------------

  describe('nexus_plugin_audit', () => {
    test('audits plugins across all running sites and shows update info', async () => {
      // wpCliRun for update dry-run returns one update for akismet
      localServices.wpCliRun.mockResolvedValue({
        stdout: JSON.stringify([
          { name: 'akismet', version: '5.0', update_version: '5.1' },
        ]),
        success: true,
      });

      const result = await registry.call('nexus_plugin_audit', {}, services);

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;

      // Fleet header
      expect(text).toContain('Fleet Plugin Audit');
      // Both sites appear
      expect(text).toContain('Test Site');
      expect(text).toContain('Staging');
      // Update info (format: "akismet: v5.0 → v5.1")
      expect(text).toContain('v5.0 → v5.1');
    });

    test('halted sites with no cache show no-data message', async () => {
      localServices.getAllSiteStatuses.mockReturnValue({
        'site-1': 'running',
        'site-2': 'halted',
      });

      const result = await registry.call('nexus_plugin_audit', {}, services);

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      // Both sites appear in the report
      expect(text).toContain('Test Site');
      expect(text).toContain('Staging');
      // site-2 has no data (no cache, no index configured in test)
      expect(text).toContain('No plugin data available');
      // site-1 has plugin data
      expect(text).toContain('2 plugins installed');
    });

    test('returns success (no isError) even when all sites have no data', async () => {
      localServices.getAllSiteStatuses.mockReturnValue({
        'site-1': 'halted',
        'site-2': 'halted',
      });

      const result = await registry.call('nexus_plugin_audit', {}, services);
      // No error — just reports no data available per site
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('No plugin data available');
      expect(text).toContain('0 updates available');
    });

    test('handles per-site WP-CLI errors gracefully', async () => {
      // site-1 succeeds, site-2 throws on getPlugins → falls through to empty
      let callCount = 0;
      localServices.getPlugins.mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          return Promise.reject(new Error('connection refused'));
        }
        return Promise.resolve([
          { name: 'akismet', title: 'Akismet', version: '5.0', status: 'active' },
        ]);
      });

      const result = await registry.call('nexus_plugin_audit', {}, services);

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      // site-1 has data, site-2 falls back to no-data message
      expect(text).toContain('1 plugins installed');
      expect(text).toContain('No plugin data available');
    });

    test('reports update count in footer summary', async () => {
      localServices.wpCliRun.mockResolvedValue({ stdout: '[]', success: true });

      const result = await registry.call('nexus_plugin_audit', {}, services);
      const text = result.content[0].text;

      // Footer summary format: "N updates available across M/total sites with data"
      expect(text).toContain('0 updates available');
      // Both running sites have 2 plugins each (from getPlugins mock)
      expect(text).toContain('2 plugins installed');
    });
  });
});
