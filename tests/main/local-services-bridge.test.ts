import fs from 'fs';
import { createLocalServicesBridge, LocalServicesBridge } from '../../src/main/mcp/local-services-bridge';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
}));

function makeMockContainer() {
  const mockSite = { id: 'site-1', name: 'Test Site', path: '/path/to/site', domain: 'test.local' };

  return {
    siteData: {
      getSite: jest.fn((id: string) => (id === 'site-1' ? mockSite : null)),
      getSites: jest.fn(() => ({ 'site-1': mockSite })),
    },
    siteProcessManager: {
      start: jest.fn(),
      stop: jest.fn(),
      restart: jest.fn(),
      getSiteStatus: jest.fn(() => 'running'),
      getSiteStatuses: jest.fn(() => ({ 'site-1': 'running' })),
    },
    wpCli: {
      run: jest.fn(() => 'cli output'),
      getPlugins: jest.fn(() => [{ name: 'akismet', title: 'Akismet', version: '5.0', status: 'active' }]),
      getThemes: jest.fn(() => [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }]),
      getWpVersion: jest.fn(() => '6.4.2'),
      getOption: jest.fn(() => 'Test Blog'),
    },
    addSite: {
      addSite: jest.fn(() => ({ id: 'new-1', name: 'New Site', domain: 'new-site.local' })),
    },
    deleteSite: {
      deleteSite: jest.fn(),
    },
    cloneSite: {
      cloneSite: jest.fn(() => ({ id: 'clone-1', name: 'Cloned Site' })),
    },
    exportSite: {
      exportSite: jest.fn(() => '/path/to/export.zip'),
    },
    siteDatabase: {
      dump: jest.fn(() => '/path/to/dump.sql'),
    },
    capi: {
      getAccountList: jest.fn(() => [{ id: 'acc-1', name: 'My Account' }]),
      getInstallList: jest.fn(() => [{ id: 'inst-1', name: 'myinstall' }]),
      getInstall: jest.fn(() => ({ id: 'inst-1', name: 'myinstall' })),
      createBackup: jest.fn(),
      purgeCache: jest.fn(),
    },
    x509CertService: {
      trustCert: jest.fn(),
    },
    lightningServices: {
      getAvailableServices: jest.fn(() => [{ version: '8.1' }, { version: '8.2' }]),
    },
    mockSite,
  };
}

describe('LocalServicesBridge', () => {
  let container: ReturnType<typeof makeMockContainer>;
  let bridge: LocalServicesBridge;

  beforeEach(() => {
    container = makeMockContainer();
    bridge = createLocalServicesBridge(container);
  });

  // --- Site Process Management ---

  describe('startSite', () => {
    test('calls siteProcessManager.start with site object', async () => {
      await bridge.startSite('site-1');
      expect(container.siteProcessManager.start).toHaveBeenCalledWith(container.mockSite);
    });

    test('throws for unknown site', async () => {
      await expect(bridge.startSite('nonexistent')).rejects.toThrow('Site not found');
    });
  });

  describe('stopSite', () => {
    test('calls siteProcessManager.stop', async () => {
      await bridge.stopSite('site-1');
      expect(container.siteProcessManager.stop).toHaveBeenCalledWith(container.mockSite);
    });
  });

  describe('restartSite', () => {
    test('calls siteProcessManager.restart', async () => {
      await bridge.restartSite('site-1');
      expect(container.siteProcessManager.restart).toHaveBeenCalledWith(container.mockSite);
    });
  });

  describe('getSiteStatus', () => {
    test('returns site status', () => {
      const status = bridge.getSiteStatus('site-1');
      expect(status).toBe('running');
      expect(container.siteProcessManager.getSiteStatus).toHaveBeenCalledWith(container.mockSite);
    });
  });

  describe('getAllSiteStatuses', () => {
    test('returns all statuses', () => {
      const statuses = bridge.getAllSiteStatuses();
      expect(statuses).toEqual({ 'site-1': 'running' });
    });
  });

  // --- Site CRUD ---

  describe('createSite', () => {
    test('calls addSite with correct params', async () => {
      const result = await bridge.createSite({ name: 'My New Site' });
      expect(result).toEqual({ id: 'new-1', name: 'New Site', domain: 'new-site.local' });
      expect(container.addSite.addSite).toHaveBeenCalledWith(
        expect.objectContaining({
          newSiteInfo: expect.objectContaining({ siteName: 'My New Site' }),
          goToSite: false,
          installWP: true,
        }),
      );
    });

    test('passes phpVersion when provided', async () => {
      await bridge.createSite({ name: 'Test', phpVersion: '8.2' });
      const call = (container.addSite.addSite as jest.Mock).mock.calls[0][0] as any;
      expect(call.newSiteInfo.phpVersion).toBe('8.2');
    });
  });

  describe('deleteSite', () => {
    test('calls deleteSite service', async () => {
      await bridge.deleteSite('site-1', true);
      expect(container.deleteSite.deleteSite).toHaveBeenCalledWith({
        site: container.mockSite,
        trashFiles: true,
        updateHosts: true,
      });
    });
  });

  describe('cloneSite', () => {
    test('calls cloneSite service', async () => {
      const result = await bridge.cloneSite('site-1', 'Clone Name');
      expect(result).toEqual({ id: 'clone-1', name: 'Cloned Site' });
      expect(container.cloneSite.cloneSite).toHaveBeenCalledWith({
        site: container.mockSite,
        newSiteName: 'Clone Name',
      });
    });
  });

  describe('exportSite', () => {
    test('calls exportSite service', async () => {
      const result = await bridge.exportSite('site-1', '/tmp/export');
      expect(result).toBe('/tmp/export.zip');
    });
  });

  // --- WP-CLI ---

  describe('wpCliRun', () => {
    // wpCliRun races the WP-CLI call against a 120s timeout setTimeout.
    // The mock resolves synchronously so the race completes immediately, but
    // the real setTimeout handle would linger for 120s keeping Jest alive.
    // Fake timers prevent that handle from entering the real event loop.
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('returns stdout on success', async () => {
      const result = await bridge.wpCliRun('site-1', ['plugin', 'list']);
      expect(result).toEqual({ stdout: 'cli output', success: true });
      expect(container.wpCli.run).toHaveBeenCalledWith(container.mockSite, ['plugin', 'list'], undefined);
    });

    test('returns error message on failure', async () => {
      (container.wpCli.run as jest.Mock).mockRejectedValue(new Error('WP-CLI failed'));
      const result = await bridge.wpCliRun('site-1', ['bad', 'command']);
      expect(result).toEqual({ stdout: 'WP-CLI failed', success: false });
    });
  });

  describe('getPlugins', () => {
    test('returns plugin list', async () => {
      const plugins = await bridge.getPlugins('site-1');
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('akismet');
    });

    test('returns empty array when null', async () => {
      (container.wpCli.getPlugins as jest.Mock).mockResolvedValue(null);
      const plugins = await bridge.getPlugins('site-1');
      expect(plugins).toEqual([]);
    });
  });

  describe('getThemes', () => {
    test('returns theme list', async () => {
      const themes = await bridge.getThemes('site-1');
      expect(themes).toHaveLength(1);
      expect(themes[0].name).toBe('twentytwentyfour');
    });
  });

  describe('getWpVersion', () => {
    test('returns WP version', async () => {
      const version = await bridge.getWpVersion('site-1');
      expect(version).toBe('6.4.2');
    });
  });

  describe('getOption', () => {
    test('returns option value', async () => {
      const value = await bridge.getOption('site-1', 'blogname');
      expect(value).toBe('Test Blog');
      expect(container.wpCli.getOption).toHaveBeenCalledWith(container.mockSite, 'blogname');
    });
  });

  // --- Database ---

  describe('dumpDatabase', () => {
    test('returns dump path', async () => {
      const dumpPath = await bridge.dumpDatabase('site-1');
      expect(dumpPath).toBe('/path/to/dump.sql');
    });

    test('passes destination', async () => {
      await bridge.dumpDatabase('site-1', '/custom/path');
      expect(container.siteDatabase.dump).toHaveBeenCalledWith(container.mockSite, '/custom/path');
    });
  });

  // --- CAPI ---

  describe('CAPI methods', () => {
    test('isCAPIAvailable returns true when capi exists', () => {
      expect(bridge.isCAPIAvailable()).toBe(true);
    });

    test('capiGetAccounts calls capi.getAccountList', async () => {
      const accounts = await bridge.capiGetAccounts();
      expect(accounts).toEqual([{ id: 'acc-1', name: 'My Account' }]);
    });

    test('capiGetInstalls calls capi.getInstallList', async () => {
      const installs = await bridge.capiGetInstalls();
      expect(installs).toEqual([{ id: 'inst-1', name: 'myinstall' }]);
    });

    test('capiGetInstall calls capi.getInstall', async () => {
      const install = await bridge.capiGetInstall('inst-1');
      expect(install).toEqual({ id: 'inst-1', name: 'myinstall' });
    });

    test('capiCreateBackup calls capi.createBackup', async () => {
      await bridge.capiCreateBackup('inst-1', 'Pre-deploy backup');
      expect(container.capi.createBackup).toHaveBeenCalledWith('inst-1', 'Pre-deploy backup');
    });

    test('capiPurgeCache calls capi.purgeCache', async () => {
      await bridge.capiPurgeCache('inst-1');
      expect(container.capi.purgeCache).toHaveBeenCalledWith('inst-1', 'all');
    });
  });

  describe('CAPI unavailable', () => {
    test('isCAPIAvailable returns false when no capi', () => {
      const noCapi = { ...container, capi: undefined };
      delete (noCapi as any).capi;
      const b = createLocalServicesBridge(noCapi);
      expect(b.isCAPIAvailable()).toBe(false);
    });

    test('CAPI methods throw when not available', async () => {
      const noCapi = { ...container, capi: undefined };
      delete (noCapi as any).capi;
      const b = createLocalServicesBridge(noCapi);
      await expect(b.capiGetAccounts()).rejects.toThrow('CAPI not available');
    });
  });

  // --- SSL ---

  describe('trustCert', () => {
    test('calls x509CertService.trustCert', async () => {
      await bridge.trustCert('site-1');
      expect(container.x509CertService.trustCert).toHaveBeenCalledWith(container.mockSite);
    });
  });

  // --- Lightning Services ---

  describe('getAvailablePhpVersions', () => {
    test('returns version strings', async () => {
      const versions = await bridge.getAvailablePhpVersions();
      expect(versions).toEqual(['8.1', '8.2']);
    });
  });

  // --- Site resolution ---

  describe('resolveSiteObject', () => {
    test('returns raw site object', () => {
      const site = bridge.resolveSiteObject('site-1');
      expect(site).toBe(container.mockSite);
    });

    test('throws for unknown site', () => {
      expect(() => bridge.resolveSiteObject('bad-id')).toThrow('Site not found');
    });
  });
});
