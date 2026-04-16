import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, LocalSiteInfo } from '../../src/main/mcp/types';
import { registerWpCliTools } from '../../src/main/mcp/modules/wp-cli/index';
import { LocalServicesBridge } from '../../src/main/mcp/local-services-bridge';

const site1: LocalSiteInfo = { id: 'site-1', name: 'Test Site', path: '/sites/test', domain: 'test.local' };

function makeLocalServices(): jest.Mocked<LocalServicesBridge> {
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
    wpCliRun: jest.fn(() => Promise.resolve({ stdout: 'ok', success: true })),
    getPlugins: jest.fn(() => Promise.resolve([
      { name: 'akismet', title: 'Akismet', version: '5.0', status: 'active' },
      { name: 'hello-dolly', title: 'Hello Dolly', version: '1.7', status: 'inactive' },
    ])),
    getThemes: jest.fn(() => Promise.resolve([
      { name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' },
    ])),
    getWpVersion: jest.fn(() => Promise.resolve('6.4.2')),
    getOption: jest.fn((id: string, opt: string) => {
      if (opt === 'blogname') return Promise.resolve('Test Blog');
      return Promise.resolve(null);
    }),
    dumpDatabase: jest.fn(() => Promise.resolve('/tmp/dump.sql')),
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
      getSite: (id: string) => id === 'site-1' ? site1 : null,
      getSites: () => ({ 'site-1': site1 }),
    },
    indexRegistry: { get: () => null, listAll: () => [] },
    localServices: localServices ?? makeLocalServices(),
    logger: { info: jest.fn(), error: jest.fn() },
  } as unknown as NexusServices;
}

describe('WP-CLI Tools', () => {
  let registry: ToolRegistry;
  let localServices: jest.Mocked<LocalServicesBridge>;
  let services: NexusServices;

  beforeEach(() => {
    registry = new ToolRegistry();
    localServices = makeLocalServices();
    services = makeServices(localServices);
    registerWpCliTools(registry);
  });

  test('registers 19 tools', () => {
    expect(registry.allToolNames()).toHaveLength(19);
  });

  test('all tools require localServices', () => {
    const noLocal = makeServices();
    (noLocal as any).localServices = undefined;
    expect(registry.list(noLocal)).toHaveLength(0);
  });

  // --- Pre-flight checks ---

  describe('pre-flight: site must be running', () => {
    test('wp_plugin_list rejects halted site with no twin data', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      const result = await registry.call('wp_plugin_list', { site: 'Test Site' }, services);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('halted');
      expect(result.content[0].text).toContain('nexus sites start');
    });

    test('wp_core_version rejects halted site', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      const result = await registry.call('wp_core_version', { site: 'Test Site' }, services);
      expect(result.isError).toBe(true);
    });
  });

  // --- wp_plugin_list ---

  describe('wp_plugin_list', () => {
    test('lists plugins', async () => {
      const result = await registry.call('wp_plugin_list', { site: 'Test Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('akismet');
      expect(result.content[0].text).toContain('hello-dolly');
      expect(result.content[0].text).toContain('**active**');
    });
  });

  // --- wp_plugin_install ---

  describe('wp_plugin_install', () => {
    test('installs a plugin', async () => {
      const result = await registry.call('wp_plugin_install', { site: 'Test Site', slug: 'jetpack' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.wpCliRun).toHaveBeenCalledWith('site-1', ['plugin', 'install', 'jetpack']);
    });

    test('activates on install when requested', async () => {
      await registry.call('wp_plugin_install', { site: 'Test Site', slug: 'jetpack', activate: true }, services);
      expect(localServices.wpCliRun).toHaveBeenCalledWith('site-1', ['plugin', 'install', 'jetpack', '--activate']);
    });

    test('rejects invalid slug', async () => {
      const result = await registry.call('wp_plugin_install', { site: 'Test Site', slug: 'Bad Slug!' }, services);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid');
    });
  });

  // --- wp_plugin_activate ---

  describe('wp_plugin_activate', () => {
    test('activates a plugin', async () => {
      const result = await registry.call('wp_plugin_activate', { site: 'Test Site', slug: 'akismet' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.wpCliRun).toHaveBeenCalledWith('site-1', ['plugin', 'activate', 'akismet']);
    });
  });

  // --- wp_plugin_deactivate ---

  describe('wp_plugin_deactivate', () => {
    test('deactivates a plugin', async () => {
      const result = await registry.call('wp_plugin_deactivate', { site: 'Test Site', slug: 'akismet' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.wpCliRun).toHaveBeenCalledWith('site-1', ['plugin', 'deactivate', 'akismet']);
    });
  });

  // --- wp_plugin_update ---

  describe('wp_plugin_update', () => {
    test('updates a plugin', async () => {
      const result = await registry.call('wp_plugin_update', { site: 'Test Site', slug: 'akismet' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.wpCliRun).toHaveBeenCalledWith('site-1', ['plugin', 'update', 'akismet'], { timeoutMs: 180000 });
    });

    test('supports --all', async () => {
      await registry.call('wp_plugin_update', { site: 'Test Site', slug: '--all' }, services);
      expect(localServices.wpCliRun).toHaveBeenCalledWith('site-1', ['plugin', 'update', '--all'], { timeoutMs: 180000 });
    });
  });

  // --- wp_theme_list ---

  describe('wp_theme_list', () => {
    test('lists themes', async () => {
      const result = await registry.call('wp_theme_list', { site: 'Test Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('twentytwentyfour');
      expect(result.content[0].text).toContain('**active**');
    });
  });

  // --- wp_core_version ---

  describe('wp_core_version', () => {
    test('returns WP version', async () => {
      const result = await registry.call('wp_core_version', { site: 'Test Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('6.4.2');
    });
  });

  // --- wp_user_list ---

  describe('wp_user_list', () => {
    test('lists users from JSON output', async () => {
      localServices.wpCliRun.mockResolvedValue({
        stdout: JSON.stringify([
          { user_login: 'admin', display_name: 'Admin', roles: 'administrator' },
        ]),
        success: true,
      });
      const result = await registry.call('wp_user_list', { site: 'Test Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('admin');
      expect(result.content[0].text).toContain('administrator');
    });
  });

  // --- wp_option_get ---

  describe('wp_option_get', () => {
    test('returns option value', async () => {
      const result = await registry.call('wp_option_get', { site: 'Test Site', option: 'blogname' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Test Blog');
    });

    test('returns error for unknown option', async () => {
      const result = await registry.call('wp_option_get', { site: 'Test Site', option: 'nonexistent' }, services);
      expect(result.isError).toBe(true);
    });
  });

  // --- wp_site_health ---

  describe('wp_site_health', () => {
    test('runs site health check', async () => {
      const result = await registry.call('wp_site_health', { site: 'Test Site' }, services);
      expect(result.isError).toBeUndefined();
    });
  });

  // --- wp_db_export ---

  describe('wp_db_export', () => {
    test('exports database', async () => {
      const result = await registry.call('wp_db_export', { site: 'Test Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('/tmp/dump.sql');
    });
  });

  // --- wp_search_replace ---

  describe('wp_search_replace', () => {
    test('defaults to dry run', async () => {
      const result = await registry.call(
        'wp_search_replace',
        { site: 'Test Site', search: 'old.com', replace: 'new.com' },
        services,
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Dry run');
      expect(localServices.wpCliRun).toHaveBeenCalledWith(
        'site-1',
        ['search-replace', 'old.com', 'new.com', '--dry-run'],
      );
    });

    test('applies changes when dry_run=false', async () => {
      await registry.call(
        'wp_search_replace',
        { site: 'Test Site', search: 'old.com', replace: 'new.com', dry_run: false },
        services,
      );
      expect(localServices.wpCliRun).toHaveBeenCalledWith(
        'site-1',
        ['search-replace', 'old.com', 'new.com'],
      );
    });

    test('rejects empty search string', async () => {
      const result = await registry.call(
        'wp_search_replace',
        { site: 'Test Site', search: '', replace: 'new.com' },
        services,
      );
      expect(result.isError).toBe(true);
    });
  });

  // --- Unknown site ---

  describe('unknown site handling', () => {
    test('all tools reject unknown site', async () => {
      const tools = ['wp_plugin_list', 'wp_plugin_install', 'wp_theme_list', 'wp_core_version',
        'wp_user_list', 'wp_option_get', 'wp_site_health', 'wp_db_export'];
      for (const tool of tools) {
        const args: any = { site: 'Nonexistent' };
        if (tool === 'wp_plugin_install') args.slug = 'test';
        if (tool === 'wp_option_get') args.option = 'test';
        const result = await registry.call(tool, args, services);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      }
    });
  });
});
