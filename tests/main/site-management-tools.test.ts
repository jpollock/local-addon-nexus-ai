import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, LocalSiteInfo } from '../../src/main/mcp/types';
import { registerSiteManagementTools } from '../../src/main/mcp/modules/site-management/index';
import { LocalServicesBridge } from '../../src/main/mcp/local-services-bridge';

// --- Mock services ---

const site1: LocalSiteInfo = { id: 'site-1', name: 'My Site', path: '/sites/my-site', domain: 'my-site.local' };
const site2: LocalSiteInfo = { id: 'site-2', name: 'Other Site', path: '/sites/other', domain: 'other.local' };

function makeLocalServices(): jest.Mocked<LocalServicesBridge> {
  return {
    startSite: jest.fn(),
    stopSite: jest.fn(),
    restartSite: jest.fn(),
    getSiteStatus: jest.fn(() => 'running'),
    getAllSiteStatuses: jest.fn(() => ({ 'site-1': 'running', 'site-2': 'halted' })),
    createSite: jest.fn(() => Promise.resolve({ id: 'new-1', name: 'New Site', domain: 'new-site.local' })),
    deleteSite: jest.fn(),
    cloneSite: jest.fn(() => Promise.resolve({ id: 'clone-1', name: 'Cloned Site' })),
    exportSite: jest.fn(() => Promise.resolve('/tmp/export.zip')),
    wpCliRun: jest.fn(() => Promise.resolve({ stdout: '', success: true })),
    getPlugins: jest.fn(() => Promise.resolve([])),
    getThemes: jest.fn(() => Promise.resolve([])),
    getWpVersion: jest.fn(() => Promise.resolve('6.4.2')),
    getOption: jest.fn(() => Promise.resolve(null)),
    dumpDatabase: jest.fn(() => Promise.resolve('/tmp/dump.sql')),
    capiGetAccounts: jest.fn(() => Promise.resolve([])),
    capiGetInstalls: jest.fn(() => Promise.resolve([])),
    capiGetInstall: jest.fn(() => Promise.resolve(null)),
    capiCreateBackup: jest.fn(),
    capiPurgeCache: jest.fn(),
    isCAPIAvailable: jest.fn(() => false),
    trustCert: jest.fn(),
    getAvailablePhpVersions: jest.fn(() => Promise.resolve(['8.1', '8.2', '8.3'])),
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
    indexRegistry: {
      get: (id: string) => id === 'site-1' ? {
        siteId: 'site-1',
        state: 'ready',
        documentCount: 42,
        chunkCount: 100,
        lastIndexed: Date.now(),
      } : null,
      listAll: () => [{ siteId: 'site-1' }],
    },
    localServices: localServices ?? makeLocalServices(),
    logger: { info: jest.fn(), error: jest.fn() },
  } as unknown as NexusServices;
}

describe('Site Management Tools', () => {
  let registry: ToolRegistry;
  let localServices: jest.Mocked<LocalServicesBridge>;
  let services: NexusServices;

  beforeEach(() => {
    registry = new ToolRegistry();
    localServices = makeLocalServices();
    services = makeServices(localServices);
    registerSiteManagementTools(registry);
  });

  test('registers 17 tools', () => {
    const names = registry.allToolNames();
    expect(names).toHaveLength(17);
    expect(names).toContain('local_list_sites');
    expect(names).toContain('local_get_site');
    expect(names).toContain('local_start_site');
    expect(names).toContain('local_stop_site');
    expect(names).toContain('local_restart_site');
    expect(names).toContain('local_create_site');
    expect(names).toContain('local_delete_site');
    expect(names).toContain('local_clone_site');
    expect(names).toContain('local_export_site');
    expect(names).toContain('local_change_php_version');
    expect(names).toContain('local_trust_ssl');
    expect(names).toContain('local_toggle_xdebug');
    expect(names).toContain('local_rename_site');
    expect(names).toContain('local_import_site');
    expect(names).toContain('local_list_blueprints');
    expect(names).toContain('local_save_blueprint');
    expect(names).toContain('local_get_site_logs');
  });

  test('all tools are available when localServices present', () => {
    const tools = registry.list(services);
    expect(tools).toHaveLength(17);
  });

  test('no tools available without localServices', () => {
    const noLocal = makeServices();
    (noLocal as any).localServices = undefined;
    const tools = registry.list(noLocal);
    expect(tools).toHaveLength(0);
  });

  // --- local_list_sites ---

  describe('local_list_sites', () => {
    test('lists sites grouped by status', async () => {
      const result = await registry.call('local_list_sites', {}, services);
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('2 total');
      expect(text).toContain('1 running');
      expect(text).toContain('My Site');
      expect(text).toContain('Other Site');
    });

    test('shows index status', async () => {
      const result = await registry.call('local_list_sites', {}, services);
      const text = result.content[0].text;
      expect(text).toContain('indexed: yes');
    });
  });

  // --- local_get_site ---

  describe('local_get_site', () => {
    test('returns site details', async () => {
      const result = await registry.call('local_get_site', { site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('My Site');
      expect(text).toContain('my-site.local');
      expect(text).toContain('running');
      expect(text).toContain('42 docs');
    });

    test('returns error for unknown site', async () => {
      const result = await registry.call('local_get_site', { site: 'Nonexistent' }, services);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  // --- local_start_site ---

  describe('local_start_site', () => {
    test('starts a halted site', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      const result = await registry.call('local_start_site', { site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.startSite).toHaveBeenCalledWith('site-1');
    });

    test('skips if already running', async () => {
      localServices.getSiteStatus.mockReturnValue('running');
      const result = await registry.call('local_start_site', { site: 'My Site' }, services);
      expect(result.content[0].text).toContain('already running');
      expect(localServices.startSite).not.toHaveBeenCalled();
    });
  });

  // --- local_stop_site ---

  describe('local_stop_site', () => {
    test('stops a running site', async () => {
      localServices.getSiteStatus.mockReturnValue('running');
      const result = await registry.call('local_stop_site', { site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.stopSite).toHaveBeenCalledWith('site-1');
    });

    test('skips if already halted', async () => {
      localServices.getSiteStatus.mockReturnValue('halted');
      const result = await registry.call('local_stop_site', { site: 'My Site' }, services);
      expect(result.content[0].text).toContain('already stopped');
      expect(localServices.stopSite).not.toHaveBeenCalled();
    });
  });

  // --- local_restart_site ---

  describe('local_restart_site', () => {
    test('restarts a site', async () => {
      const result = await registry.call('local_restart_site', { site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.restartSite).toHaveBeenCalledWith('site-1');
    });
  });

  // --- local_create_site ---

  describe('local_create_site', () => {
    test('creates a site', async () => {
      const result = await registry.call('local_create_site', { name: 'New Project' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('New Site');
      expect(localServices.createSite).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Project' }),
      );
    });

    test('passes php_version', async () => {
      await registry.call('local_create_site', { name: 'Test', php_version: '8.2' }, services);
      expect(localServices.createSite).toHaveBeenCalledWith(
        expect.objectContaining({ phpVersion: '8.2' }),
      );
    });

    test('rejects empty name', async () => {
      const result = await registry.call('local_create_site', { name: '' }, services);
      expect(result.isError).toBe(true);
    });
  });

  // --- local_delete_site ---

  describe('local_delete_site', () => {
    test('deletes a site (confirmation handled by registry)', async () => {
      // Note: Tier 3 confirmation is handled by ToolRegistry.call().
      // The handler itself just executes the delete.
      const handler = (registry as any).handlers.get('local_delete_site');
      const result = await handler.execute({ site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.deleteSite).toHaveBeenCalledWith('site-1', true);
    });

    test('defaults trash_files to true', async () => {
      const handler = (registry as any).handlers.get('local_delete_site');
      await handler.execute({ site: 'My Site' }, services);
      expect(localServices.deleteSite).toHaveBeenCalledWith('site-1', true);
    });

    test('respects trash_files=false', async () => {
      const handler = (registry as any).handlers.get('local_delete_site');
      await handler.execute({ site: 'My Site', trash_files: false }, services);
      expect(localServices.deleteSite).toHaveBeenCalledWith('site-1', false);
    });
  });

  // --- local_clone_site ---

  describe('local_clone_site', () => {
    test('clones a site', async () => {
      const result = await registry.call('local_clone_site', { site: 'My Site', new_name: 'Clone' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Cloned Site');
      expect(localServices.cloneSite).toHaveBeenCalledWith('site-1', 'Clone');
    });

    test('rejects empty new_name', async () => {
      const result = await registry.call('local_clone_site', { site: 'My Site', new_name: '' }, services);
      expect(result.isError).toBe(true);
    });
  });

  // --- local_export_site ---

  describe('local_export_site', () => {
    test('exports a site', async () => {
      const result = await registry.call('local_export_site', { site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('/tmp/export.zip');
    });
  });

  // --- local_change_php_version ---

  describe('local_change_php_version', () => {
    test('changes PHP version for running site', async () => {
      localServices.getSiteStatus.mockReturnValue('running');
      const result = await registry.call(
        'local_change_php_version',
        { site: 'My Site', php_version: '8.2' },
        services,
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('8.2');
      expect(localServices.stopSite).toHaveBeenCalled();
      expect(localServices.startSite).toHaveBeenCalled();
    });

    test('rejects unavailable PHP version', async () => {
      const result = await registry.call(
        'local_change_php_version',
        { site: 'My Site', php_version: '5.4' },
        services,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not available');
    });
  });

  // --- local_trust_ssl ---

  describe('local_trust_ssl', () => {
    test('trusts SSL cert', async () => {
      const result = await registry.call('local_trust_ssl', { site: 'My Site' }, services);
      expect(result.isError).toBeUndefined();
      expect(localServices.trustCert).toHaveBeenCalledWith('site-1');
    });
  });
});
