/**
 * Integration tests for metadata cache persistence and drift detection (Phase 1.5)
 *
 * Tests scenarios that validate the Digital Twin's ability to persist state
 * across restarts and detect drift when plugins are manually changed.
 */
import { SiteMetadataCache } from '../../src/main/metadata/SiteMetadataCache';
import { RegistryStorage } from '../../src/main/content/IndexRegistry';

describe('Metadata Cache Persistence (Phase 1.5)', () => {
  let storage: Record<string, any>;
  let registryStorage: RegistryStorage;

  beforeEach(() => {
    storage = {};
    registryStorage = {
      get: (key: string) => storage[key] ?? null,
      set: (key: string, value: any) => { storage[key] = value; },
    };
  });

  describe('Persistence across "restarts"', () => {
    it('should persist metadata across cache instance recreations', () => {
      // Simulate first session: create cache, populate it
      const cache1 = new SiteMetadataCache(registryStorage);
      cache1.set('site-1', {
        wpVersion: '7.0.1',
        plugins: [
          { name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' },
        ],
        themes: [
          { name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' },
        ],
        activeTheme: 'twentytwentyfour',
        updateSource: 'lifecycle',
      });

      // Simulate restart: create new cache instance with same storage
      const cache2 = new SiteMetadataCache(registryStorage);
      const metadata = cache2.get('site-1');

      expect(metadata).not.toBeNull();
      expect(metadata!.wpVersion).toBe('7.0.1');
      expect(metadata!.plugins).toHaveLength(1);
      expect(metadata!.plugins[0].name).toBe('ai');
      expect(metadata!.plugins[0].status).toBe('active');
    });

    it('should preserve metadata for multiple sites across recreations', () => {
      const cache1 = new SiteMetadataCache(registryStorage);

      // Populate multiple sites
      cache1.set('site-a', {
        wpVersion: '7.0.1',
        plugins: [{ name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' }],
        themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
        updateSource: 'lifecycle',
      });

      cache1.set('site-b', {
        wpVersion: '6.7.1',
        plugins: [{ name: 'akismet', title: 'Akismet', version: '5.3', status: 'inactive', file: 'akismet/akismet.php' }],
        themes: [{ name: 'twentytwentythree', title: 'Twenty Twenty-Three', version: '1.0', status: 'active' }],
        updateSource: 'manual',
      });

      // Simulate restart
      const cache2 = new SiteMetadataCache(registryStorage);

      const metadataA = cache2.get('site-a');
      const metadataB = cache2.get('site-b');

      expect(metadataA).not.toBeNull();
      expect(metadataB).not.toBeNull();
      expect(metadataA!.wpVersion).toBe('7.0.1');
      expect(metadataB!.wpVersion).toBe('6.7.1');
      expect(metadataA!.updateSource).toBe('lifecycle');
      expect(metadataB!.updateSource).toBe('manual');
    });

    it('should handle empty cache gracefully after restart', () => {
      const cache1 = new SiteMetadataCache(registryStorage);
      const metadata1 = cache1.get('nonexistent-site');
      expect(metadata1).toBeNull();

      // Simulate restart with empty cache
      const cache2 = new SiteMetadataCache(registryStorage);
      const metadata2 = cache2.get('nonexistent-site');
      expect(metadata2).toBeNull();
    });
  });

  describe('Setup AI persistence simulation', () => {
    it('should persist AI plugin status after setup-ai completes', () => {
      const cache = new SiteMetadataCache(registryStorage);

      // Simulate site start with no AI plugin
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
        updateSource: 'lifecycle',
      });

      // Verify no AI plugin initially
      let metadata = cache.get('test-site');
      expect(metadata!.plugins).toHaveLength(0);

      // Simulate setup-ai completing and refreshing cache
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [
          { name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' },
          { name: 'ai-provider-for-ollama', title: 'AI Provider for Ollama', version: '1.0.0', status: 'active', file: 'ai-provider-for-ollama/ai-provider-for-ollama.php' },
        ],
        themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
        activeTheme: 'twentytwentyfour',
        updateSource: 'setup-ai',
      });

      // Simulate restart: new cache instance
      const cache2 = new SiteMetadataCache(registryStorage);
      metadata = cache2.get('test-site');

      expect(metadata).not.toBeNull();
      expect(metadata!.plugins).toHaveLength(2);
      expect(metadata!.plugins.find(p => p.name === 'ai')).toBeTruthy();
      expect(metadata!.plugins.find(p => p.name === 'ai-provider-for-ollama')).toBeTruthy();
      expect(metadata!.updateSource).toBe('setup-ai');
    });

    it('should calculate correct cache age on retrieval', async () => {
      const cache1 = new SiteMetadataCache(registryStorage);
      cache1.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [{ name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' }],
        themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
        updateSource: 'setup-ai',
      });

      // Wait a bit for age to increase
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate restart with new cache instance
      const cache2 = new SiteMetadataCache(registryStorage);
      const withAge = cache2.getWithAge('test-site');

      expect(withAge).not.toBeNull();
      expect(withAge!.ageMs).toBeGreaterThan(0);
      expect(withAge!.ageMs).toBeLessThan(5000); // Less than 5 seconds
      expect(withAge!.isStale).toBe(false); // Not stale yet (< 24 hours)
    });
  });

  describe('Staleness detection', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should mark metadata as stale after 24 hours', () => {
      const cache = new SiteMetadataCache(registryStorage);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [{ name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' }],
        themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
        updateSource: 'lifecycle',
      });

      // Immediately after set: not stale
      let withAge = cache.getWithAge('test-site');
      expect(withAge!.isStale).toBe(false);

      // After 23 hours: not stale
      jest.advanceTimersByTime(23 * 60 * 60 * 1000);
      withAge = cache.getWithAge('test-site');
      expect(withAge!.isStale).toBe(false);

      // After 25 hours: stale
      jest.advanceTimersByTime(2 * 60 * 60 * 1000);
      withAge = cache.getWithAge('test-site');
      expect(withAge!.isStale).toBe(true);
    });

    it('should display human-readable age strings', () => {
      const cache = new SiteMetadataCache(registryStorage);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'manual',
      });

      // Just now
      expect(cache.getAgeString('test-site')).toBe('Just now');

      // 30 seconds
      jest.advanceTimersByTime(30 * 1000);
      expect(cache.getAgeString('test-site')).toBe('Just now');

      // 2 minutes
      jest.advanceTimersByTime(90 * 1000);
      expect(cache.getAgeString('test-site')).toBe('2m ago');

      // 45 minutes
      jest.advanceTimersByTime(43 * 60 * 1000);
      expect(cache.getAgeString('test-site')).toBe('45m ago');

      // 2 hours
      jest.advanceTimersByTime(75 * 60 * 1000);
      expect(cache.getAgeString('test-site')).toBe('2h ago');

      // 3 days
      jest.advanceTimersByTime(70 * 60 * 60 * 1000);
      expect(cache.getAgeString('test-site')).toBe('3d ago');
    });
  });

  describe('Drift detection scenario', () => {
    it('should detect when cached plugin status differs from live status', () => {
      const cache = new SiteMetadataCache(registryStorage);

      // Initial state: AI plugin active (from lifecycle hook)
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [{ name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' }],
        themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
        updateSource: 'lifecycle',
      });

      const cachedMetadata = cache.get('test-site');
      const cachedAiPlugin = cachedMetadata!.plugins.find(p => p.name === 'ai');
      expect(cachedAiPlugin!.status).toBe('active');

      // Simulate user manually deactivating AI plugin via wp-admin
      // This would be detected when we query WP-CLI next time
      const livePluginStatus = 'inactive'; // From WP-CLI

      // Drift detected!
      expect(cachedAiPlugin!.status).not.toBe(livePluginStatus);

      // Update cache with live data
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [{ name: 'ai', title: 'AI', version: '0.6.0', status: 'inactive', file: 'ai/ai.php' }],
        themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
        updateSource: 'manual',
      });

      const updatedMetadata = cache.get('test-site');
      const updatedAiPlugin = updatedMetadata!.plugins.find(p => p.name === 'ai');
      expect(updatedAiPlugin!.status).toBe('inactive');
    });

    it('should handle plugin being uninstalled (drift from active to missing)', () => {
      const cache = new SiteMetadataCache(registryStorage);

      // Initial: AI plugin installed and active
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [
          { name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' },
          { name: 'akismet', title: 'Akismet', version: '5.3', status: 'inactive', file: 'akismet/akismet.php' },
        ],
        themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
        updateSource: 'setup-ai',
      });

      expect(cache.get('test-site')!.plugins).toHaveLength(2);

      // User manually uninstalls AI plugin
      // Live WP-CLI query returns plugin list without 'ai'
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [
          { name: 'akismet', title: 'Akismet', version: '5.3', status: 'inactive', file: 'akismet/akismet.php' },
        ],
        themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
        updateSource: 'manual',
      });

      const updated = cache.get('test-site');
      expect(updated!.plugins).toHaveLength(1);
      expect(updated!.plugins.find(p => p.name === 'ai')).toBeUndefined();
    });
  });

  describe('Performance with many cached sites', () => {
    it('should handle 50 cached sites efficiently', () => {
      const cache = new SiteMetadataCache(registryStorage);

      // Populate cache with 50 sites
      for (let i = 1; i <= 50; i++) {
        cache.set(`site-${i}`, {
          wpVersion: '7.0.1',
          plugins: [
            { name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' },
            { name: 'akismet', title: 'Akismet', version: '5.3', status: i % 2 === 0 ? 'active' : 'inactive', file: 'akismet/akismet.php' },
          ],
          themes: [{ name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' }],
          activeTheme: 'twentytwentyfour',
          updateSource: 'lifecycle',
        });
      }

      // Verify all sites are cached
      for (let i = 1; i <= 50; i++) {
        const metadata = cache.get(`site-${i}`);
        expect(metadata).not.toBeNull();
        expect(metadata!.wpVersion).toBe('7.0.1');
        expect(metadata!.plugins).toHaveLength(2);
      }

      // Measure retrieval performance
      const start = performance.now();
      for (let i = 1; i <= 50; i++) {
        cache.get(`site-${i}`);
      }
      const duration = performance.now() - start;

      // Should be extremely fast (< 10ms for 50 lookups)
      expect(duration).toBeLessThan(10);
    });

    it('should handle cache invalidation for subset of sites', () => {
      const cache = new SiteMetadataCache(registryStorage);

      // Populate 10 sites
      for (let i = 1; i <= 10; i++) {
        cache.set(`site-${i}`, {
          wpVersion: '7.0.1',
          plugins: [],
          themes: [],
          updateSource: 'lifecycle',
        });
      }

      // Invalidate half
      for (let i = 1; i <= 5; i++) {
        cache.invalidate(`site-${i}`);
      }

      // First 5 should be null
      for (let i = 1; i <= 5; i++) {
        expect(cache.get(`site-${i}`)).toBeNull();
      }

      // Last 5 should still exist
      for (let i = 6; i <= 10; i++) {
        expect(cache.get(`site-${i}`)).not.toBeNull();
      }
    });
  });

  describe('Update source tracking', () => {
    it('should track lifecycle as update source', () => {
      const cache = new SiteMetadataCache(registryStorage);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'lifecycle',
      });

      expect(cache.get('test-site')!.updateSource).toBe('lifecycle');
    });

    it('should track setup-ai as update source', () => {
      const cache = new SiteMetadataCache(registryStorage);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'setup-ai',
      });

      expect(cache.get('test-site')!.updateSource).toBe('setup-ai');
    });

    it('should track manual refresh as update source', () => {
      const cache = new SiteMetadataCache(registryStorage);
      cache.set('test-site', {
        wpVersion: '7.0.1',
        plugins: [],
        themes: [],
        updateSource: 'manual',
      });

      expect(cache.get('test-site')!.updateSource).toBe('manual');
    });
  });
});
