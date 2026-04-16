import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StartupSiteScanner } from '../../../src/main/startup/StartupSiteScanner';
import { SiteMetadataCache } from '../../../src/main/metadata/SiteMetadataCache';
import type { RegistryStorage } from '../../../src/main/content/IndexRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorage(): { storage: RegistryStorage; data: Record<string, any> } {
  const data: Record<string, any> = {};
  return {
    data,
    storage: {
      get: (k: string) => data[k] ?? null,
      set: (k: string, v: any) => { data[k] = v; },
    },
  };
}

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeLocalServices(overrides: Partial<{
  getPlugins: jest.Mock;
  getThemes: jest.Mock;
  wpCliRun: jest.Mock;
  getOption: jest.Mock;
  getSiteStatus: jest.Mock;
  getAllSiteStatuses: jest.Mock;
}> = {}) {
  return {
    getPlugins: overrides.getPlugins ?? jest.fn().mockResolvedValue([
      { name: 'akismet', title: 'Akismet', version: '5.3', status: 'active' },
    ]),
    getThemes: overrides.getThemes ?? jest.fn().mockResolvedValue([
      { name: 'twentytwentyfive', title: 'Twenty Twenty-Five', version: '1.0', status: 'active' },
    ]),
    wpCliRun: overrides.wpCliRun ?? jest.fn().mockResolvedValue({ success: true, stdout: '[]' }),
    getOption: overrides.getOption ?? jest.fn().mockResolvedValue(null),
    getSiteStatus: overrides.getSiteStatus ?? jest.fn().mockReturnValue('halted'),
    getAllSiteStatuses: overrides.getAllSiteStatuses ?? jest.fn().mockReturnValue({}),
  } as any;
}

/**
 * Create a minimal WP site structure under `siteRoot/app/public/` and return siteRoot.
 * StartupSiteScanner expects: site.path + '/app/public' = WP root.
 */
function makeFakeSite(siteRoot: string, wpVersion = '7.0-RC2', plugins = ['akismet', 'woocommerce']): void {
  const wpRoot    = path.join(siteRoot, 'app', 'public');
  const wpIncl    = path.join(wpRoot, 'wp-includes');
  const pluginDir = path.join(wpRoot, 'wp-content', 'plugins');
  const themeDir  = path.join(wpRoot, 'wp-content', 'themes');

  fs.mkdirSync(wpIncl, { recursive: true });
  for (const p of plugins) fs.mkdirSync(path.join(pluginDir, p), { recursive: true });
  fs.mkdirSync(path.join(themeDir, 'twentytwentyfive'), { recursive: true });

  fs.writeFileSync(path.join(wpIncl, 'version.php'), `<?php\n$wp_version = '${wpVersion}';\n`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartupSiteScanner', () => {
  let tmpDir: string;
  let storage: RegistryStorage;
  let metadataCache: SiteMetadataCache;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-scanner-test-'));
    const s = makeStorage();
    storage = s.storage;
    metadataCache = new SiteMetadataCache(storage);
    logger = makeLogger();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('filesystem scan (Phase 1)', () => {
    it('reads WP version from wp-includes/version.php', async () => {
      makeFakeSite(tmpDir, '7.0-RC2');
      const scanner = new StartupSiteScanner({
        getAllSites: () => [{ id: 'site-1', name: 'Test', path: tmpDir }],
        getRunningSiteIds: () => [],
        localServices: makeLocalServices(),
        metadataCache,
        logger,
      });
      await scanner.scan();
      const meta = metadataCache.get('site-1');
      expect(meta).not.toBeNull();
      expect(meta!.wpVersion).toBe('7.0-RC2');
      expect(meta!.scanDepth).toBe('filesystem');
      expect(meta!.updateSource).toBe('startup-scan');
    });

    it('reads installed plugin directory names', async () => {
      makeFakeSite(tmpDir, '7.0', ['akismet', 'woocommerce']);
      const scanner = new StartupSiteScanner({
        getAllSites: () => [{ id: 'site-1', name: 'Test', path: tmpDir }],
        getRunningSiteIds: () => [],
        localServices: makeLocalServices(),
        metadataCache,
        logger,
      });
      await scanner.scan();
      expect(metadataCache.get('site-1')!.installedPlugins).toContain('akismet');
      expect(metadataCache.get('site-1')!.installedPlugins).toContain('woocommerce');
    });

    it('skips site with no version.php gracefully', async () => {
      fs.mkdirSync(tmpDir, { recursive: true }); // no WP files
      const scanner = new StartupSiteScanner({
        getAllSites: () => [{ id: 'site-1', name: 'Test', path: tmpDir }],
        getRunningSiteIds: () => [],
        localServices: makeLocalServices(),
        metadataCache,
        logger,
      });
      await scanner.scan();
      expect(metadataCache.get('site-1')).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('does not overwrite existing fresh full scan', async () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [{ name: 'akismet', title: 'Akismet', version: '5.3', status: 'active' }],
        themes: [], updateSource: 'lifecycle', scanDepth: 'full',
      });
      makeFakeSite(tmpDir, '6.0'); // older version on disk
      const scanner = new StartupSiteScanner({
        getAllSites: () => [{ id: 'site-1', name: 'Test', path: tmpDir }],
        getRunningSiteIds: () => [],
        localServices: makeLocalServices(),
        metadataCache,
        logger,
      });
      await scanner.scan();
      expect(metadataCache.get('site-1')!.scanDepth).toBe('full');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Fresh full scan exists'));
    });
  });

  describe('WP-CLI enrichment (Phase 2, running sites only)', () => {
    it('does not run WP-CLI enrichment for halted sites', async () => {
      makeFakeSite(tmpDir);
      const localServices = makeLocalServices();
      const scanner = new StartupSiteScanner({
        getAllSites: () => [{ id: 'site-1', name: 'Test', path: tmpDir }],
        getRunningSiteIds: () => [],
        localServices,
        metadataCache,
        logger,
      });
      await scanner.scan();
      expect(localServices.getPlugins).not.toHaveBeenCalled();
      expect(metadataCache.get('site-1')!.scanDepth).toBe('filesystem');
    });

    it('runs WP-CLI enrichment for running sites and sets scanDepth full', async () => {
      makeFakeSite(tmpDir);
      // fetchPostCounts PHP eval returns {total, byType, lastDate} — not an array of rows
      const postJson = JSON.stringify({ total: 5, byType: { post: 5 }, lastDate: '2026-01-01 00:00:00' });
      const localServices = makeLocalServices({
        // wpCliRun call order: (1) fetchPostCounts inside Promise.allSettled,
        // (2) mysql version — posts fires before mysql since fetchPostCounts
        // is initiated at position 3 in the allSettled array, mysql at position 6.
        wpCliRun: jest.fn()
          .mockResolvedValueOnce({ success: true, stdout: postJson })  // call 1: posts
          .mockResolvedValueOnce({ success: true, stdout: '8.0.35' }), // call 2: mysql
        getOption: jest.fn()
          .mockResolvedValueOnce('http://myblog.local')   // siteurl
          .mockResolvedValueOnce('admin@myblog.local'),   // admin_email
      });
      const scanner = new StartupSiteScanner({
        getAllSites: () => [{ id: 'site-1', name: 'Test', path: tmpDir }],
        getRunningSiteIds: () => ['site-1'],
        localServices,
        metadataCache,
        logger,
      });
      await scanner.scan();
      const meta = metadataCache.get('site-1')!;
      expect(meta.scanDepth).toBe('full');
      expect(meta.plugins).toHaveLength(1);
      expect(meta.postCount).toBe(5);
      expect(meta.siteUrl).toBe('http://myblog.local');
      expect(meta.adminEmail).toBe('admin@myblog.local');
      expect(meta.mysqlVersion).toBe('8.0.35');
    });

    it('handles individual WP-CLI failures gracefully — still writes full scan', async () => {
      makeFakeSite(tmpDir);
      const localServices = makeLocalServices({
        getPlugins: jest.fn().mockRejectedValue(new Error('WP-CLI timeout')),
        wpCliRun: jest.fn().mockResolvedValue({ success: true, stdout: '8.0.35' }),
        getOption: jest.fn().mockResolvedValue('http://myblog.local'),
      });
      const scanner = new StartupSiteScanner({
        getAllSites: () => [{ id: 'site-1', name: 'Test', path: tmpDir }],
        getRunningSiteIds: () => ['site-1'],
        localServices,
        metadataCache,
        logger,
      });
      await scanner.scan();
      expect(metadataCache.get('site-1')!.scanDepth).toBe('full');
    });

    it('errors on one site do not abort other sites', async () => {
      const site1Root = path.join(tmpDir, 'site1'); // no WP files — will fail
      const site2Root = path.join(tmpDir, 'site2');
      fs.mkdirSync(site1Root, { recursive: true });
      makeFakeSite(site2Root);
      const scanner = new StartupSiteScanner({
        getAllSites: () => [
          { id: 'site-1', name: 'Bad Site', path: site1Root },
          { id: 'site-2', name: 'Good Site', path: site2Root },
        ],
        getRunningSiteIds: () => [],
        localServices: makeLocalServices(),
        metadataCache,
        logger,
      });
      await scanner.scan();
      expect(metadataCache.get('site-1')).toBeNull();
      expect(metadataCache.get('site-2')).not.toBeNull();
    });
  });
});
