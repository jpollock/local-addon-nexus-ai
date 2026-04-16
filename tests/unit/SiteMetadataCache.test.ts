/**
 * Unit tests for SiteMetadataCache
 */
import { SiteMetadataCache, SiteMetadata } from '../../src/main/metadata/SiteMetadataCache';
import type { RegistryStorage } from '../../src/main/content/IndexRegistry';

describe('SiteMetadataCache', () => {
  let cache: SiteMetadataCache;
  let mockStorage: Record<string, any>;

  beforeEach(() => {
    mockStorage = {};
    const storage: RegistryStorage = {
      get: (key: string) => mockStorage[key] ?? null,
      set: (key: string, value: any) => { mockStorage[key] = value; },
    };
    cache = new SiteMetadataCache(storage);
  });

  describe('set() and get()', () => {
    it('should store and retrieve metadata', () => {
      const metadata: Omit<SiteMetadata, 'lastUpdated'> = {
        wpVersion: '7.0.1',
        plugins: [
          { name: 'ai', title: 'AI', version: '0.6.0', status: 'active' },
          { name: 'akismet', title: 'Akismet', version: '5.3', status: 'inactive' },
        ],
        themes: [
          { name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' },
        ],
        activeTheme: 'twentytwentyfour',
        updateSource: 'lifecycle',
      };

      cache.set('test-site', metadata);
      const retrieved = cache.get('test-site');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.wpVersion).toBe('7.0.1');
      expect(retrieved!.plugins).toHaveLength(2);
      expect(retrieved!.plugins[0].name).toBe('ai');
      expect(retrieved!.themes).toHaveLength(1);
      expect(retrieved!.activeTheme).toBe('twentytwentyfour');
      expect(retrieved!.updateSource).toBe('lifecycle');
      expect(retrieved!.lastUpdated).toBeGreaterThan(0);
    });

    it('should return null for non-existent site', () => {
      const retrieved = cache.get('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should add timestamp automatically', () => {
      const beforeSet = Date.now();
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'manual',
      });
      const afterSet = Date.now();

      const retrieved = cache.get('test-site');
      expect(retrieved!.lastUpdated).toBeGreaterThanOrEqual(beforeSet);
      expect(retrieved!.lastUpdated).toBeLessThanOrEqual(afterSet);
    });
  });

  describe('getWithAge()', () => {
    it('should calculate age correctly', () => {
      // Set metadata with fake old timestamp
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      // Manually update timestamp to simulate old data
      const allMetadata = cache.getAll();
      allMetadata['test-site'].lastUpdated = oneHourAgo;
      mockStorage['nexus-ai_site_metadata'] = allMetadata;

      const withAge = cache.getWithAge('test-site');
      expect(withAge).not.toBeNull();
      expect(withAge!.ageMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 100); // ~1 hour, with 100ms tolerance
      expect(withAge!.isStale).toBe(false); // Not stale yet (< 24 hours)
    });

    it('should mark data as stale when > 24 hours old', () => {
      const twoDaysAgo = Date.now() - (48 * 60 * 60 * 1000);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      // Manually update timestamp
      const allMetadata = cache.getAll();
      allMetadata['test-site'].lastUpdated = twoDaysAgo;
      mockStorage['nexus-ai_site_metadata'] = allMetadata;

      const withAge = cache.getWithAge('test-site');
      expect(withAge!.isStale).toBe(true);
    });

    it('should return null for non-existent site', () => {
      const withAge = cache.getWithAge('non-existent');
      expect(withAge).toBeNull();
    });
  });

  describe('update()', () => {
    it('should update specific fields without removing others', () => {
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [{ name: 'ai', title: 'AI', version: '0.6.0', status: 'active' }],
        themes: [],
        updateSource: 'lifecycle',
      });

      cache.update('test-site', {
        wpVersion: '7.0.2',
      });

      const retrieved = cache.get('test-site');
      expect(retrieved!.wpVersion).toBe('7.0.2');
      expect(retrieved!.plugins).toHaveLength(1); // Preserved
      expect(retrieved!.plugins[0].name).toBe('ai'); // Preserved
    });

    it('should update timestamp on update', () => {
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      const beforeUpdate = Date.now();
      cache.update('test-site', { wpVersion: '7.0.2' });
      const afterUpdate = Date.now();

      const retrieved = cache.get('test-site');
      expect(retrieved!.lastUpdated).toBeGreaterThanOrEqual(beforeUpdate);
      expect(retrieved!.lastUpdated).toBeLessThanOrEqual(afterUpdate);
    });

    it('should throw if updating non-existent site', () => {
      expect(() => {
        cache.update('non-existent', { wpVersion: '7.0.1' });
      }).toThrow('Cannot update metadata for non-existent');
    });
  });

  describe('invalidate()', () => {
    it('should remove metadata for a site', () => {
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      expect(cache.get('test-site')).not.toBeNull();

      cache.invalidate('test-site');
      expect(cache.get('test-site')).toBeNull();
    });

    it('should not affect other sites', () => {
      cache.set('site-a', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });
      cache.set('site-b', {
        wpVersion: '6.9.4',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      cache.invalidate('site-a');

      expect(cache.get('site-a')).toBeNull();
      expect(cache.get('site-b')).not.toBeNull();
      expect(cache.get('site-b')!.wpVersion).toBe('6.9.4');
    });
  });

  describe('isStale()', () => {
    it('should return false for fresh data', () => {
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      expect(cache.isStale('test-site')).toBe(false);
    });

    it('should return true for data > 24 hours old', () => {
      const twoDaysAgo = Date.now() - (48 * 60 * 60 * 1000);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      // Manually update timestamp
      const allMetadata = cache.getAll();
      allMetadata['test-site'].lastUpdated = twoDaysAgo;
      mockStorage['nexus-ai_site_metadata'] = allMetadata;

      expect(cache.isStale('test-site')).toBe(true);
    });

    it('should return true for non-existent site', () => {
      expect(cache.isStale('non-existent')).toBe(true);
    });
  });

  describe('getAgeString()', () => {
    it('should return "Just now" for fresh data', () => {
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      const ageString = cache.getAgeString('test-site');
      expect(ageString).toBe('Just now');
    });

    it('should return "Xm ago" for data < 1 hour old', () => {
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      // Manually update timestamp
      const allMetadata = cache.getAll();
      allMetadata['test-site'].lastUpdated = fiveMinutesAgo;
      mockStorage['nexus-ai_site_metadata'] = allMetadata;

      const ageString = cache.getAgeString('test-site');
      expect(ageString).toBe('5m ago');
    });

    it('should return "Xh ago" for data < 24 hours old', () => {
      const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      // Manually update timestamp
      const allMetadata = cache.getAll();
      allMetadata['test-site'].lastUpdated = threeHoursAgo;
      mockStorage['nexus-ai_site_metadata'] = allMetadata;

      const ageString = cache.getAgeString('test-site');
      expect(ageString).toBe('3h ago');
    });

    it('should return "Xd ago" for data >= 24 hours old', () => {
      const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      // Manually update timestamp
      const allMetadata = cache.getAll();
      allMetadata['test-site'].lastUpdated = twoDaysAgo;
      mockStorage['nexus-ai_site_metadata'] = allMetadata;

      const ageString = cache.getAgeString('test-site');
      expect(ageString).toBe('2d ago');
    });

    it('should return "Never cached" for non-existent site', () => {
      const ageString = cache.getAgeString('non-existent');
      expect(ageString).toBe('Never cached');
    });
  });

  // --- New fields and field-preservation behaviour (added with digital twin) ---

  describe('scanDepth and new fields', () => {
    it('defaults scanDepth to "full" when not supplied', () => {
      cache.set('site1', { wpVersion: '7.0', plugins: [], themes: [], updateSource: 'lifecycle' });
      expect(cache.get('site1')!.scanDepth).toBe('full');
    });

    it('preserves supplied scanDepth', () => {
      cache.set('site1', { wpVersion: '7.0', plugins: [], themes: [], updateSource: 'startup-scan', scanDepth: 'filesystem' });
      expect(cache.get('site1')!.scanDepth).toBe('filesystem');
    });

    it('stores new twin fields', () => {
      cache.set('site1', {
        wpVersion: '7.0',
        phpVersion: '8.2',
        mysqlVersion: '8.0.35',
        siteUrl: 'http://site1.local',
        adminEmail: 'admin@site1.local',
        postCount: 42,
        postCountByType: { post: 40, page: 2 },
        lastPostAt: 1700000000000,
        installedPlugins: ['akismet', 'woocommerce'],
        installedThemes: ['twentytwentyfive'],
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });
      const m = cache.get('site1')!;
      expect(m.mysqlVersion).toBe('8.0.35');
      expect(m.siteUrl).toBe('http://site1.local');
      expect(m.adminEmail).toBe('admin@site1.local');
      expect(m.postCount).toBe(42);
      expect(m.postCountByType).toEqual({ post: 40, page: 2 });
      expect(m.lastPostAt).toBe(1700000000000);
      expect(m.installedPlugins).toEqual(['akismet', 'woocommerce']);
      expect(m.installedThemes).toEqual(['twentytwentyfive']);
    });
  });

  describe('set() field-preservation (filesystem fields survive full-scan overwrite)', () => {
    it('preserves phpVersion from previous write when new write omits it', () => {
      // Filesystem scan populates phpVersion
      cache.set('site1', {
        wpVersion: '7.0', phpVersion: '8.2', plugins: [], themes: [],
        updateSource: 'startup-scan', scanDepth: 'filesystem',
      });
      // Lifecycle write doesn't supply phpVersion (WP-CLI doesn't return it)
      cache.set('site1', {
        wpVersion: '7.0', plugins: [], themes: [], updateSource: 'lifecycle',
      });
      expect(cache.get('site1')!.phpVersion).toBe('8.2');
    });

    it('preserves mysqlVersion from previous write', () => {
      cache.set('site1', { wpVersion: '7.0', mysqlVersion: '8.0.35', plugins: [], themes: [], updateSource: 'lifecycle' });
      cache.set('site1', { wpVersion: '7.0.1', plugins: [], themes: [], updateSource: 'manual' });
      expect(cache.get('site1')!.mysqlVersion).toBe('8.0.35');
    });

    it('preserves installedPlugins from filesystem scan when full scan overwrites', () => {
      cache.set('site1', {
        wpVersion: '7.0', installedPlugins: ['akismet', 'woocommerce'],
        plugins: [], themes: [], updateSource: 'startup-scan', scanDepth: 'filesystem',
      });
      cache.set('site1', {
        wpVersion: '7.0',
        plugins: [{ name: 'akismet', title: 'Akismet', version: '5.3', status: 'active' }],
        themes: [], updateSource: 'lifecycle', scanDepth: 'full',
      });
      expect(cache.get('site1')!.installedPlugins).toEqual(['akismet', 'woocommerce']);
    });

    it('allows explicit override of preserved fields', () => {
      cache.set('site1', { wpVersion: '7.0', phpVersion: '8.1', plugins: [], themes: [], updateSource: 'startup-scan' });
      cache.set('site1', { wpVersion: '7.0', phpVersion: '8.2', plugins: [], themes: [], updateSource: 'lifecycle' });
      expect(cache.get('site1')!.phpVersion).toBe('8.2');
    });
  });

  describe('clear()', () => {
    it('should remove all cached metadata', () => {
      cache.set('site-a', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });
      cache.set('site-b', {
        wpVersion: '6.9.4',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      expect(cache.get('site-a')).not.toBeNull();
      expect(cache.get('site-b')).not.toBeNull();

      cache.clear();

      expect(cache.get('site-a')).toBeNull();
      expect(cache.get('site-b')).toBeNull();
    });
  });
});
