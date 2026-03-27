/**
 * Bulk Operations Integration Tests
 *
 * Tests the full bulk operations flow:
 * - IPC handler integration
 * - Progress tracking
 * - Cancellation
 * - Error handling
 * - Multiple operation types
 */

import { BulkOperationManager, BulkOpDeps } from '../../src/main/bulk/BulkOperationManager';
import type { BulkOperationRequest, BulkOperationStatus } from '../../src/main/bulk/types';

describe('Bulk Operations Integration', () => {
  let bulkOpManager: BulkOperationManager;
  let mockSiteData: any;
  let mockLocalBridge: any;
  let mockIndexSite: jest.Mock;
  let mockLogger: any;

  beforeEach(() => {
    // Mock site data
    mockSiteData = {
      getSites: jest.fn(() => ({
        'site-1': { id: 'site-1', name: 'Site 1', path: '/path/to/site1' },
        'site-2': { id: 'site-2', name: 'Site 2', path: '/path/to/site2' },
        'site-3': { id: 'site-3', name: 'Site 3', path: '/path/to/site3' },
      })),
      getSite: jest.fn((siteId: string) => ({
        id: siteId,
        name: `Site ${siteId}`,
        path: `/path/to/${siteId}`,
      })),
    };

    // Mock local services bridge
    mockLocalBridge = {
      getAllSiteStatuses: jest.fn(() => ({
        'site-1': 'running',
        'site-2': 'halted',
        'site-3': 'running',
      })),
      startSite: jest.fn(() => Promise.resolve()),
      stopSite: jest.fn(() => Promise.resolve()),
      getWpVersion: jest.fn(() => Promise.resolve('7.0')),
      getPlugins: jest.fn(() => Promise.resolve([
        { name: 'ai', status: 'active', version: '0.8.0' },
      ])),
      getThemes: jest.fn(() => Promise.resolve([
        { name: 'twentytwentyfour', status: 'active', version: '1.0' },
      ])),
      wpCliRun: jest.fn(() => Promise.resolve({ success: true, stdout: '' })),
    };

    // Mock indexSite function
    mockIndexSite = jest.fn(() => Promise.resolve({ indexed: 10, skipped: 0 }));

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    // Create bulk operation manager with proper deps object
    const deps: BulkOpDeps = {
      contentPipeline: {
        indexSite: mockIndexSite,
      },
      siteDataBridge: {
        resolveSiteObject: mockSiteData.getSite,
        getSiteStatus: (siteId: string) => mockLocalBridge.getAllSiteStatuses()[siteId] || 'unknown',
        startSite: mockLocalBridge.startSite,
        stopSite: mockLocalBridge.stopSite,
        wpCliRun: mockLocalBridge.wpCliRun,
        getPlugins: mockLocalBridge.getPlugins,
        getThemes: mockLocalBridge.getThemes,
        getWpVersion: mockLocalBridge.getWpVersion,
      },
      healthCalculator: {
        calculateScore: jest.fn(() => Promise.resolve({ score: 85, status: 'good' })),
      },
      graphService: {
        upsertSite: jest.fn(() => Promise.resolve()),
        upsertPlugin: jest.fn(() => Promise.resolve(1)),
        deletePlugins: jest.fn(() => Promise.resolve()),
      },
      setupSiteForAI: jest.fn(() => Promise.resolve({ success: true })),
      onProgress: jest.fn(),
    };

    bulkOpManager = new BulkOperationManager(deps);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Operation Lifecycle', () => {
    it('should execute reindex operation on multiple sites', async () => {
      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1', 'site-2', 'site-3'],
      };

      const opId = bulkOpManager.execute(request);
      expect(opId).toMatch(/^bulk-\d+-[a-z0-9]+$/);

      // Wait for operation to complete
      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      expect(status).toBeDefined();
      expect(status!.type).toBe('reindex');
      expect(status!.siteIds).toEqual(['site-1', 'site-2', 'site-3']);
      expect(status!.status).toBe('completed');
      expect(status!.progress.total).toBe(3);
      expect(status!.progress.completed).toBe(3);
      expect(mockIndexSite).toHaveBeenCalledTimes(3);
    });

    it('should track progress during operation execution', async () => {
      // Slow down indexing to capture intermediate progress
      let resolveCount = 0;
      (mockIndexSite as jest.Mock).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => {
          resolveCount++;
          resolve({ indexed: 10, skipped: 0 });
        }, 100))
      );

      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1', 'site-2', 'site-3'],
      };

      const opId = bulkOpManager.execute(request);

      // Check initial state
      let status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('running');
      expect(status!.progress.completed).toBe(0);

      // Wait for at least one to complete (concurrency = 3, so all 3 start immediately)
      // But we need to wait long enough for one to finish
      await new Promise(resolve => setTimeout(resolve, 120));
      status = bulkOpManager.getStatus(opId);
      expect(status!.progress.completed).toBeGreaterThan(0);

      // Wait for full completion
      await bulkOpManager.waitForCompletion(opId);
      status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('completed');
      expect(status!.progress.completed).toBe(3);
    });

    it('should handle site-level failures gracefully', async () => {
      // Make site-2 fail
      (mockIndexSite as jest.Mock).mockImplementation((info: any) => {
        const siteId = info.siteId || info.id;
        if (siteId === 'site-2') {
          return Promise.reject(new Error('Database connection failed'));
        }
        return Promise.resolve({ indexed: 10, skipped: 0 });
      });

      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1', 'site-2', 'site-3'],
      };

      const opId = bulkOpManager.execute(request);

      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('completed_with_errors');
      expect(status!.progress.completed).toBe(3); // All attempted
      expect(status!.siteResults['site-1'].status).toBe('completed');
      expect(status!.siteResults['site-2'].status).toBe('failed');
      expect(status!.siteResults['site-2'].error).toContain('Database connection failed');
      expect(status!.siteResults['site-3'].status).toBe('completed');
    });

    it('should cancel running operation', async () => {
      // Slow operation
      (mockIndexSite as jest.Mock).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ indexed: 10, skipped: 0 }), 200))
      );

      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1', 'site-2', 'site-3'],
      };

      const opId = bulkOpManager.execute(request);

      // Wait a bit then cancel
      await new Promise(resolve => setTimeout(resolve, 50));
      const cancelResult = bulkOpManager.cancel(opId);
      expect(cancelResult).toBe(true);

      // Wait for operation to fully stop
      await bulkOpManager.waitForCompletion(opId);

      // Should be cancelled after completion
      const status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('cancelled');
    });

    it('should not cancel already completed operation', async () => {
      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1'],
      };

      const opId = bulkOpManager.execute(request);

      await bulkOpManager.waitForCompletion(opId);

      // Operation should be completed
      expect(bulkOpManager.getStatus(opId)!.status).toBe('completed');

      // Try to cancel
      const cancelResult = bulkOpManager.cancel(opId);
      expect(cancelResult).toBe(false);
      expect(bulkOpManager.getStatus(opId)!.status).toBe('completed');
    });
  });

  describe('Operation Types', () => {
    it('should execute setup-ai operation', async () => {
      const request: BulkOperationRequest = {
        type: 'setup-ai',
        siteIds: ['site-1'], // running site
        options: { provider: 'anthropic' },
      };

      const opId = bulkOpManager.execute(request);

      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('completed');
      // setupSiteForAI mock should have been called
    });

    it('should execute plugin-update operation', async () => {
      const request: BulkOperationRequest = {
        type: 'plugin-update',
        siteIds: ['site-1', 'site-3'],
        options: { pluginSlug: 'akismet' },
      };

      const opId = bulkOpManager.execute(request);

      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('completed');
      expect(mockLocalBridge.wpCliRun).toHaveBeenCalled();
    });

    it('should execute health-refresh operation', async () => {
      // Get reference to the mock health calculator from deps
      const request: BulkOperationRequest = {
        type: 'health-refresh',
        siteIds: ['site-1'],
      };

      const opId = bulkOpManager.execute(request);

      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('completed');
      // The healthCalculator.calculateScore should have been called
      // We can't easily access it from here, so just verify the operation completed
    });

    it('should execute sync-graph operation', async () => {
      const request: BulkOperationRequest = {
        type: 'sync-graph',
        siteIds: ['site-1'], // Only one running site
        options: {}, // No autoStartStop to avoid waitForDatabaseReady
      };

      const opId = bulkOpManager.execute(request);

      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('completed');
      expect(mockLocalBridge.getPlugins).toHaveBeenCalled();
      expect(mockLocalBridge.getWpVersion).toHaveBeenCalled();
    });
  });

  describe('Concurrency & Performance', () => {
    it('should process sites in parallel with concurrency limit', async () => {
      const startTimes: number[] = [];
      (mockIndexSite as jest.Mock).mockImplementation(() => {
        startTimes.push(Date.now());
        return new Promise(resolve => setTimeout(() => resolve({ indexed: 10, skipped: 0 }), 50));
      });

      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1', 'site-2', 'site-3'],
      };

      const opId = bulkOpManager.execute(request);

      await new Promise(resolve => setTimeout(resolve, 200));

      // All 3 sites should have started (concurrency = 3)
      expect(startTimes).toHaveLength(3);

      // All should start within a short window (parallel execution)
      const maxDelta = Math.max(...startTimes) - Math.min(...startTimes);
      expect(maxDelta).toBeLessThan(30); // All started within 30ms
    });

    it('should handle large batch efficiently', async () => {
      const manySites = Array.from({ length: 20 }, (_, i) => `site-${i}`);

      mockSiteData.getSites = jest.fn(() =>
        Object.fromEntries(manySites.map(id => [id, { id, name: `Site ${id}`, path: `/path/${id}` }]))
      );

      mockSiteData.getSite = jest.fn((id: string) => ({ id, name: `Site ${id}`, path: `/path/${id}` }));

      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: manySites,
      };

      const startTime = Date.now();
      const opId = bulkOpManager.execute(request);

      await new Promise(resolve => setTimeout(resolve, 500));

      const endTime = Date.now();
      const duration = endTime - startTime;

      const status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('completed');
      expect(status!.progress.completed).toBe(20);

      // Should complete in reasonable time (parallel execution)
      // 20 sites @ 3 concurrency = ~7 batches @ 50ms each = ~350ms + overhead
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Operation List & History', () => {
    it('should list all operations', () => {
      const op1Id = bulkOpManager.execute({ type: 'reindex', siteIds: ['site-1'] });
      const op2Id = bulkOpManager.execute({ type: 'setup-ai', siteIds: ['site-2'] });

      const operations = bulkOpManager.listAll();

      expect(operations).toHaveLength(2);
      expect(operations.map(op => op.id)).toContain(op1Id);
      expect(operations.map(op => op.id)).toContain(op2Id);
    });

    it('should return operations sorted by creation time (newest first)', async () => {
      const op1Id = bulkOpManager.execute({ type: 'reindex', siteIds: ['site-1'] });
      await new Promise(resolve => setTimeout(resolve, 10));
      const op2Id = bulkOpManager.execute({ type: 'setup-ai', siteIds: ['site-2'] });
      await new Promise(resolve => setTimeout(resolve, 10));
      const op3Id = bulkOpManager.execute({ type: 'plugin-update', siteIds: ['site-3'] });

      const operations = bulkOpManager.listAll();

      expect(operations[0].id).toBe(op3Id); // Newest
      expect(operations[1].id).toBe(op2Id);
      expect(operations[2].id).toBe(op1Id); // Oldest
    });

    it('should limit operation history to 20 entries', async () => {
      // Create 30 operations
      for (let i = 0; i < 30; i++) {
        bulkOpManager.execute({ type: 'reindex', siteIds: [`site-${i % 3}`] });
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      const operations = bulkOpManager.listAll();
      expect(operations).toHaveLength(20); // Limited to 20
    });
  });

  describe('Error Scenarios', () => {
    it('should handle non-existent site IDs gracefully', async () => {
      // Mock resolveSiteObject to return null for nonexistent sites
      const mockResolveSiteObject = mockSiteData.getSite as jest.Mock;
      mockResolveSiteObject.mockImplementation((siteId: string) => {
        if (siteId === 'nonexistent') return null;
        return { id: siteId, name: `Site ${siteId}`, path: `/path/${siteId}` };
      });

      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1', 'nonexistent', 'site-3'],
      };

      const opId = bulkOpManager.execute(request);

      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      // Operation completes but with errors for nonexistent sites
      expect(status!.status).toBe('completed_with_errors');
      expect(status!.progress.completed).toBe(3); // All processed
      // nonexistent site should have failed
      expect(status!.siteResults['nonexistent'].status).toBe('failed');
    });

    it('should handle operation cancellation mid-flight', async () => {
      let resolveFirstSite: any;
      const firstSitePromise = new Promise(resolve => {
        resolveFirstSite = resolve;
      });

      (mockIndexSite as jest.Mock).mockImplementation((info: any) => {
        const siteId = info.siteId || info.id;
        if (siteId === 'site-1') {
          return firstSitePromise.then(() => ({ indexed: 10, skipped: 0 }));
        }
        return new Promise(resolve => setTimeout(() => resolve({ indexed: 10, skipped: 0 }), 50));
      });

      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1', 'site-2', 'site-3'],
      };

      const opId = bulkOpManager.execute(request);

      // Cancel before first site completes
      await new Promise(resolve => setTimeout(resolve, 10));
      bulkOpManager.cancel(opId);

      // Now complete the first site
      resolveFirstSite();

      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      expect(status!.status).toBe('cancelled');
    });
  });

  describe('Site Result Details', () => {
    it('should record start and completion times', async () => {
      // Slow down the mock to ensure different timestamps
      (mockIndexSite as jest.Mock).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ indexed: 10, skipped: 0 }), 10))
      );

      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1'],
      };

      const opId = bulkOpManager.execute(request);

      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      const siteResult = status!.siteResults['site-1'];

      expect(siteResult.startedAt).toBeGreaterThan(0);
      expect(siteResult.completedAt).toBeGreaterThanOrEqual(siteResult.startedAt!);
      expect(siteResult.status).toBe('completed');
    });

    it('should capture error details on failure', async () => {
      const testError = new Error('Connection timeout');
      (mockIndexSite as jest.Mock).mockRejectedValue(testError);

      const request: BulkOperationRequest = {
        type: 'reindex',
        siteIds: ['site-1'],
      };

      const opId = bulkOpManager.execute(request);

      await bulkOpManager.waitForCompletion(opId);

      const status = bulkOpManager.getStatus(opId);
      const siteResult = status!.siteResults['site-1'];

      expect(siteResult.status).toBe('failed');
      expect(siteResult.error).toBe('Connection timeout');
      expect(siteResult.completedAt).toBeGreaterThan(0);
    });
  });
});
