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

  test('all tools require localServices', () => {
    const noLocal = makeServices();
    (noLocal as any).localServices = undefined;
    expect(registry.list(noLocal)).toHaveLength(0);
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

    test('rejects halted site', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      const result = await registry.call('nexus_site_audit', { site: 'Test Site' }, services);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('halted');
    });

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
  // ---------------------------------------------------------------------------

  describe('nexus_plugin_audit', () => {
    test('audits plugins across all running sites', async () => {
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
      expect(text).toContain('2 sites');

      // Both sites audited
      expect(text).toContain('Test Site');
      expect(text).toContain('Staging');

      // Update info
      expect(text).toContain('v5.1');

      // Summary
      expect(text).toMatch(/Total.*4 plugins/); // 2 plugins × 2 sites
    });

    test('only audits running sites', async () => {
      localServices.getAllSiteStatuses.mockReturnValue({
        'site-1': 'running',
        'site-2': 'halted',
      });

      const result = await registry.call('nexus_plugin_audit', {}, services);

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('1 sites');
      expect(text).toContain('Test Site');
      expect(text).not.toContain('Staging');
    });

    test('returns error when no sites are running', async () => {
      localServices.getAllSiteStatuses.mockReturnValue({
        'site-1': 'halted',
        'site-2': 'halted',
      });

      const result = await registry.call('nexus_plugin_audit', {}, services);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No running sites');
    });

    test('handles per-site errors gracefully', async () => {
      // First site works, second throws
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
      // One site has data, one has error
      expect(text).toContain('1 plugins');
      expect(text).toContain('connection refused');
    });

    test('reports total plugins and updates in summary', async () => {
      localServices.wpCliRun.mockResolvedValue({ stdout: '[]', success: true });

      const result = await registry.call('nexus_plugin_audit', {}, services);
      const text = result.content[0].text;

      expect(text).toContain('4 plugins'); // 2 plugins × 2 sites
      expect(text).toContain('0 updates');
    });
  });
});
