import { SiteDigitalTwinService } from '../../../src/main/twin/SiteDigitalTwinService';
import { SiteMetadataCache } from '../../../src/main/metadata/SiteMetadataCache';
import { IndexRegistry } from '../../../src/main/content/IndexRegistry';
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

function makeSiteData(sites: Array<{ id: string; name: string; domain?: string; path?: string }>) {
  const map = Object.fromEntries(
    sites.map((s) => [s.id, { ...s, path: s.path ?? '/sites/' + s.id, domain: s.domain ?? s.id + '.local' }])
  );
  return {
    getSite: (id: string) => map[id] ?? null,
    getSites: () => map,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SiteDigitalTwinService', () => {
  let storage: RegistryStorage;
  let metadataCache: SiteMetadataCache;
  let indexRegistry: IndexRegistry;
  let siteData: ReturnType<typeof makeSiteData>;

  beforeEach(() => {
    const s = makeStorage();
    storage = s.storage;
    metadataCache = new SiteMetadataCache(storage);
    indexRegistry = new IndexRegistry(storage);
    siteData = makeSiteData([
      { id: 'site-1', name: 'My Blog', domain: 'myblog.local', path: '/sites/myblog' },
    ]);
  });

  function makeService() {
    return new SiteDigitalTwinService({ siteData, metadataCache, indexRegistry });
  }

  describe('get()', () => {
    it('returns null for unknown site', () => {
      const svc = makeService();
      expect(svc.get('unknown')).toBeNull();
    });

    it('returns twin with identity fields even when no cache data exists', () => {
      const svc = makeService();
      const twin = svc.get('site-1');
      expect(twin).not.toBeNull();
      expect(twin!.siteId).toBe('site-1');
      expect(twin!.siteName).toBe('My Blog');
      expect(twin!.domain).toBe('myblog.local');
      expect(twin!.completeness).toBe('none');
      // asOf is populated from identity fields (local-site source), so it's always a timestamp
      expect(twin!.asOf).toBeGreaterThan(0);
    });

    it('populates fields from metadata cache — full scan', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0-RC2',
        phpVersion: '8.2',
        mysqlVersion: '8.0.35',
        siteUrl: 'http://myblog.local',
        adminEmail: 'admin@test.com',
        activeTheme: 'twentytwentyfive',
        plugins: [
          { name: 'akismet', title: 'Akismet', version: '5.3', status: 'active' },
          { name: 'hello', title: 'Hello Dolly', version: '1.7', status: 'inactive' },
        ],
        themes: [
          { name: 'twentytwentyfive', title: 'Twenty Twenty-Five', version: '1.0', status: 'active' },
        ],
        postCount: 42,
        postCountByType: { post: 40, page: 2 },
        lastPostAt: 1700000000000,
        updateSource: 'lifecycle',
        scanDepth: 'full',
      });

      const twin = makeService().get('site-1')!;
      expect(twin.wpVersion).toBe('7.0-RC2');
      expect(twin.phpVersion).toBe('8.2');
      expect(twin.mysqlVersion).toBe('8.0.35');
      expect(twin.siteUrl).toBe('http://myblog.local');
      expect(twin.adminEmail).toBe('admin@test.com');
      expect(twin.activeTheme).toBe('twentytwentyfive');
      expect(twin.plugins).toHaveLength(2);
      expect(twin.postCount).toBe(42);
      expect(twin.lastPostAt).toBe(1700000000000);
    });

    it('populates installedPlugins from filesystem scan', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [], themes: [],
        installedPlugins: ['akismet', 'woocommerce'],
        installedThemes: ['twentytwentyfive', 'hello'],
        updateSource: 'startup-scan', scanDepth: 'filesystem',
      });
      const twin = makeService().get('site-1')!;
      expect(twin.installedPlugins).toEqual(['akismet', 'woocommerce']);
      expect(twin.installedThemes).toEqual(['twentytwentyfive', 'hello']);
      expect(twin.plugins).toBeUndefined();
    });

    it('populates index state from IndexRegistry', () => {
      indexRegistry.update('site-1', {
        state: 'indexed',
        documentCount: 25,
        chunkCount: 50,
        lastIndexed: 1700000000000,
        siteName: 'My Blog',
      });
      const twin = makeService().get('site-1')!;
      expect(twin.indexState).toBe('indexed');
      expect(twin.documentCount).toBe(25);
      expect(twin.chunkCount).toBe(50);
      expect(twin.lastIndexed).toBe(1700000000000);
    });

    it('sets indexState to "never" when no index entry exists', () => {
      const twin = makeService().get('site-1')!;
      expect(twin.indexState).toBe('never');
    });

    it('computes completeness "none" with no data', () => {
      expect(makeService().get('site-1')!.completeness).toBe('none');
    });

    it('computes completeness "filesystem" with only installed dirs', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [], themes: [],
        installedPlugins: ['akismet'],
        updateSource: 'startup-scan', scanDepth: 'filesystem',
      });
      expect(makeService().get('site-1')!.completeness).toBe('filesystem');
    });

    it('computes completeness "metadata" with full WP-CLI data', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0',
        plugins: [{ name: 'akismet', title: 'Akismet', version: '5.3', status: 'active' }],
        themes: [],
        updateSource: 'lifecycle', scanDepth: 'full',
      });
      expect(makeService().get('site-1')!.completeness).toBe('metadata');
    });

    it('computes completeness "indexed" with plugins and index', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0',
        plugins: [{ name: 'akismet', title: 'Akismet', version: '5.3', status: 'active' }],
        themes: [], updateSource: 'lifecycle', scanDepth: 'full',
      });
      indexRegistry.update('site-1', { state: 'indexed', documentCount: 10, chunkCount: 20, siteName: 'My Blog' });
      expect(makeService().get('site-1')!.completeness).toBe('indexed');
    });

    it('sets asOf to oldest populated field timestamp', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [], themes: [], updateSource: 'lifecycle',
      });
      const twin = makeService().get('site-1')!;
      expect(twin.asOf).not.toBeNull();
      expect(twin.asOf).toBeGreaterThan(0);
    });

    it('records source provenance for each field', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [], themes: [], updateSource: 'lifecycle', scanDepth: 'full',
      });
      const twin = makeService().get('site-1')!;
      expect(twin.sources['wpVersion']).toBeDefined();
      expect(twin.sources['wpVersion']!.method).toBe('wp-cli');
      expect(twin.sources['wpVersion']!.requiresRunning).toBe(true);
    });

    it('marks filesystem-sourced fields as not requiring running site', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [], themes: [],
        installedPlugins: ['akismet'],
        updateSource: 'startup-scan', scanDepth: 'filesystem',
      });
      const twin = makeService().get('site-1')!;
      expect(twin.sources['installedPlugins']!.requiresRunning).toBe(false);
      expect(twin.sources['installedPlugins']!.method).toBe('filesystem');
    });
  });

  describe('getAll()', () => {
    it('returns a twin for every site in siteData', () => {
      siteData = makeSiteData([
        { id: 'site-1', name: 'Blog' },
        { id: 'site-2', name: 'Shop' },
      ]);
      const twins = makeService().getAll();
      expect(twins).toHaveLength(2);
      expect(twins.map((t) => t.siteId).sort()).toEqual(['site-1', 'site-2']);
    });

    it('returns empty array when no sites', () => {
      siteData = makeSiteData([]);
      expect(makeService().getAll()).toHaveLength(0);
    });
  });

  describe('getFreshness()', () => {
    it('returns empty report for twin with no sources', () => {
      const svc = makeService();
      const twin = svc.get('site-1')!;
      const report = svc.getFreshness(twin);
      // Only identity sources (local-site), no stale fields
      expect(report.staleFields).toHaveLength(0);
    });

    it('identifies stale fields older than 24 hours', () => {
      const oldTs = Date.now() - 25 * 60 * 60 * 1000; // 25h ago
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [], themes: [], updateSource: 'lifecycle',
      });
      // Manually backdate
      const all = metadataCache.getAll();
      all['site-1'].lastUpdated = oldTs;
      storage.set('nexus-ai_site_metadata', all);

      const svc = makeService();
      const twin = svc.get('site-1')!;
      const report = svc.getFreshness(twin);
      expect(report.staleFields.length).toBeGreaterThan(0);
      expect(report.stalestField).not.toBeNull();
    });

    it('identifies fields requiring running site', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [], themes: [], updateSource: 'lifecycle', scanDepth: 'full',
      });
      const svc = makeService();
      const twin = svc.get('site-1')!;
      const report = svc.getFreshness(twin);
      expect(report.requiresRunningFields.length).toBeGreaterThan(0);
      expect(report.requiresRunningFields).toContain('wpVersion');
    });
  });

  describe('format()', () => {
    it('returns a markdown string', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [{ name: 'akismet', title: 'Akismet', version: '5.3', status: 'active' }],
        themes: [], updateSource: 'lifecycle', scanDepth: 'full',
      });
      const svc = makeService();
      const twin = svc.get('site-1')!;
      const output = svc.format(twin);
      expect(output).toContain('My Blog');
      expect(output).toContain('7.0');
      expect(output).toContain('active'); // shows plugin count summary
    });

    it('includes source provenance when show_sources=true', () => {
      metadataCache.set('site-1', {
        wpVersion: '7.0', plugins: [], themes: [], updateSource: 'lifecycle',
      });
      const svc = makeService();
      const twin = svc.get('site-1')!;
      const output = svc.format(twin, { showSources: true });
      expect(output).toContain('Sources');
      expect(output).toContain('wp-cli');
    });
  });
});
