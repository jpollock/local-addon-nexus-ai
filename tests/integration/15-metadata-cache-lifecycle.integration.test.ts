/**
 * Integration tests for metadata cache lifecycle integration
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SiteMetadataCache } from '../../src/main/metadata/SiteMetadataCache';
import { registerLifecycleHooks, LifecycleContext, LocalSiteRef } from '../../src/main/content/lifecycle-hooks';
import { ContentPipeline } from '../../src/main/content/ContentPipeline';
import { IndexRegistry, RegistryStorage } from '../../src/main/content/IndexRegistry';

const PROJECT_ROOT = path.join(__dirname, '..', '..');

/**
 * Mock LocalServicesBridge that simulates WordPress data
 */
class MockLocalServicesBridge {
  async getWpVersion(siteId: string): Promise<string> {
    return '7.0.1';
  }

  async getPlugins(siteId: string): Promise<any[]> {
    return [
      { name: 'ai', title: 'AI', version: '0.6.0', status: 'active', file: 'ai/ai.php' },
      { name: 'akismet', title: 'Akismet', version: '5.3', status: 'inactive', file: 'akismet/akismet.php' },
    ];
  }

  async getThemes(siteId: string): Promise<any[]> {
    return [
      { name: 'twentytwentyfour', title: 'Twenty Twenty-Four', version: '1.0', status: 'active' },
      { name: 'twentytwentythree', title: 'Twenty Twenty-Three', version: '1.0', status: 'inactive' },
    ];
  }
}

/**
 * Mock lifecycle context with hooks
 */
class MockLifecycleContext implements LifecycleContext {
  private callbacks: {
    siteStarted: Array<(site: LocalSiteRef) => void | Promise<void>>;
    siteStopped: Array<(site: LocalSiteRef) => void | Promise<void>>;
    siteRemoved: Array<(site: LocalSiteRef) => void | Promise<void>>;
  } = {
    siteStarted: [],
    siteStopped: [],
    siteRemoved: [],
  };

  public hooks = {
    addAction: (hook: string, callback: (...args: any[]) => void | Promise<void>): void => {
      if (hook === 'siteStarted') {
        this.callbacks.siteStarted.push(callback as any);
      } else if (hook === 'siteStopped') {
        this.callbacks.siteStopped.push(callback as any);
      } else if (hook === 'siteRemoved') {
        this.callbacks.siteRemoved.push(callback as any);
      }
    }
  };

  async triggerSiteStarted(site: LocalSiteRef): Promise<void> {
    for (const cb of this.callbacks.siteStarted) {
      await cb(site);
    }
  }

  async triggerSiteRemoved(site: LocalSiteRef): Promise<void> {
    for (const cb of this.callbacks.siteRemoved) {
      await cb(site);
    }
  }
}

describe('Metadata Cache Lifecycle Integration', () => {
  let tmpDir: string;
  let metadataCache: SiteMetadataCache;
  let mockStorage: Record<string, any>;
  let mockContext: MockLifecycleContext;
  let mockLocalServices: MockLocalServicesBridge;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-metadata-lifecycle-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockStorage = {};
    const registryStorage: RegistryStorage = {
      get: (key: string) => mockStorage[key] ?? null,
      set: (key: string, value: any) => { mockStorage[key] = value; },
    };

    metadataCache = new SiteMetadataCache(registryStorage);
    mockContext = new MockLifecycleContext();
    mockLocalServices = new MockLocalServicesBridge();

    // Mock content pipeline (we don't actually index in this test)
    const mockPipeline = {
      indexSite: jest.fn().mockResolvedValue({
        documentsIndexed: 0,
        chunksIndexed: 0,
        durationMs: 0,
        errors: [],
      }),
      removeSite: jest.fn().mockResolvedValue(undefined),
    } as any;

    const mockIndexRegistry = {
      update: jest.fn(),
    } as any;

    const mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
    };

    // Register lifecycle hooks with metadata cache
    registerLifecycleHooks(
      mockContext,
      mockPipeline,
      mockIndexRegistry,
      mockLogger,
      Promise.resolve(), // readyPromise
      registryStorage,
      mockLocalServices as any,
      metadataCache,
    );
  });

  describe('siteStarted hook', () => {
    it('should populate metadata cache when site starts', async () => {
      const site: LocalSiteRef = {
        id: 'test-site',
        name: 'Test Site',
        path: '/tmp/test-site',
      };

      // Before site starts, cache should be empty
      expect(metadataCache.get('test-site')).toBeNull();

      // Trigger siteStarted hook
      await mockContext.triggerSiteStarted(site);

      // After site starts, cache should be populated
      const metadata = metadataCache.get('test-site');
      expect(metadata).not.toBeNull();
      expect(metadata!.wpVersion).toBe('7.0.1');
      expect(metadata!.plugins).toHaveLength(2);
      expect(metadata!.plugins[0].name).toBe('ai');
      expect(metadata!.plugins[0].status).toBe('active');
      expect(metadata!.plugins[1].name).toBe('akismet');
      expect(metadata!.plugins[1].status).toBe('inactive');
      expect(metadata!.themes).toHaveLength(2);
      expect(metadata!.activeTheme).toBe('twentytwentyfour');
      expect(metadata!.updateSource).toBe('lifecycle');
    });

    it('should mark cache with lifecycle update source', async () => {
      const site: LocalSiteRef = {
        id: 'test-site',
        name: 'Test Site',
        path: '/tmp/test-site',
      };

      await mockContext.triggerSiteStarted(site);

      const metadata = metadataCache.get('test-site');
      expect(metadata!.updateSource).toBe('lifecycle');
    });

    it('should refresh cache if site starts again', async () => {
      const site: LocalSiteRef = {
        id: 'test-site',
        name: 'Test Site',
        path: '/tmp/test-site',
      };

      // First start
      await mockContext.triggerSiteStarted(site);
      const firstMetadata = metadataCache.get('test-site');
      const firstTimestamp = firstMetadata!.lastUpdated;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second start (simulates restart)
      await mockContext.triggerSiteStarted(site);
      const secondMetadata = metadataCache.get('test-site');
      const secondTimestamp = secondMetadata!.lastUpdated;

      // Timestamp should be updated
      expect(secondTimestamp).toBeGreaterThan(firstTimestamp);

      // Data should still be correct
      expect(secondMetadata!.wpVersion).toBe('7.0.1');
      expect(secondMetadata!.plugins).toHaveLength(2);
    });
  });

  describe('siteRemoved hook', () => {
    it('should invalidate metadata cache when site is removed', async () => {
      const site: LocalSiteRef = {
        id: 'test-site',
        name: 'Test Site',
        path: '/tmp/test-site',
      };

      // Start site to populate cache
      await mockContext.triggerSiteStarted(site);
      expect(metadataCache.get('test-site')).not.toBeNull();

      // Remove site
      await mockContext.triggerSiteRemoved(site);

      // Cache should be cleared
      expect(metadataCache.get('test-site')).toBeNull();
    });

    it('should not affect other sites when one is removed', async () => {
      const siteA: LocalSiteRef = {
        id: 'site-a',
        name: 'Site A',
        path: '/tmp/site-a',
      };

      const siteB: LocalSiteRef = {
        id: 'site-b',
        name: 'Site B',
        path: '/tmp/site-b',
      };

      // Start both sites
      await mockContext.triggerSiteStarted(siteA);
      await mockContext.triggerSiteStarted(siteB);

      expect(metadataCache.get('site-a')).not.toBeNull();
      expect(metadataCache.get('site-b')).not.toBeNull();

      // Remove site A
      await mockContext.triggerSiteRemoved(siteA);

      // Site A cache should be cleared, site B should remain
      expect(metadataCache.get('site-a')).toBeNull();
      expect(metadataCache.get('site-b')).not.toBeNull();
      expect(metadataCache.get('site-b')!.wpVersion).toBe('7.0.1');
    });
  });

  describe('age tracking', () => {
    it('should track cache age correctly', async () => {
      const site: LocalSiteRef = {
        id: 'test-site',
        name: 'Test Site',
        path: '/tmp/test-site',
      };

      await mockContext.triggerSiteStarted(site);

      const withAge = metadataCache.getWithAge('test-site');
      expect(withAge).not.toBeNull();
      expect(withAge!.ageMs).toBeLessThan(1000); // Less than 1 second old
      expect(withAge!.isStale).toBe(false);

      const ageString = metadataCache.getAgeString('test-site');
      expect(ageString).toBe('Just now');
    });
  });
});
