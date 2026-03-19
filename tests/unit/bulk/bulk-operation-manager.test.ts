/**
 * Unit tests for BulkOperationManager
 */
import { BulkOperationManager, BulkOpDeps } from '../../../src/main/bulk/BulkOperationManager';
import type { BulkOperationStatus } from '../../../src/main/bulk/types';

function createMockDeps(overrides?: Partial<BulkOpDeps>): BulkOpDeps {
  return {
    contentPipeline: {
      indexSite: jest.fn().mockResolvedValue(undefined),
    },
    siteDataBridge: {
      resolveSiteObject: jest.fn().mockImplementation((siteId: string) => ({
        name: `Site ${siteId}`,
        domain: `${siteId}.local`,
        phpVersion: '8.1',
        path: `/path/to/${siteId}`,
        services: { mysql: { host: '127.0.0.1', port: 3307 } },
      })),
      getSiteStatus: jest.fn().mockReturnValue('running'),
      startSite: jest.fn().mockResolvedValue(undefined),
      stopSite: jest.fn().mockResolvedValue(undefined),
      wpCliRun: jest.fn().mockResolvedValue({ stdout: '[]', success: true }),
      getPlugins: jest.fn().mockResolvedValue([]),
      getThemes: jest.fn().mockResolvedValue([]),
      getWpVersion: jest.fn().mockResolvedValue('6.4.2'),
    },
    healthCalculator: {
      calculateScore: jest.fn().mockResolvedValue({ score: 85 }),
    },
    onProgress: jest.fn(),
    ...overrides,
  };
}

describe('BulkOperationManager', () => {
  let deps: BulkOpDeps;
  let manager: BulkOperationManager;

  beforeEach(() => {
    deps = createMockDeps();
    manager = new BulkOperationManager(deps);
  });

  // 1. execute() returns unique operation ID
  it('should return a unique operation ID on execute', () => {
    const id1 = manager.execute({ type: 'reindex', siteIds: ['site-1'] });
    const id2 = manager.execute({ type: 'reindex', siteIds: ['site-2'] });

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^bulk-/);
  });

  // 2. Concurrent execution respects max=3 limit
  it('should limit concurrency to 3 simultaneous operations', async () => {
    let peakConcurrent = 0;
    let currentConcurrent = 0;

    const slowIndexSite = jest.fn().mockImplementation(async () => {
      currentConcurrent++;
      peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 50));
      currentConcurrent--;
    });

    deps.contentPipeline.indexSite = slowIndexSite;

    const opId = manager.execute({
      type: 'reindex',
      siteIds: ['s1', 's2', 's3', 's4', 's5', 's6'],
    });

    await manager.waitForCompletion(opId);

    expect(peakConcurrent).toBeLessThanOrEqual(3);
    expect(peakConcurrent).toBeGreaterThanOrEqual(1);
    expect(slowIndexSite).toHaveBeenCalledTimes(6);
  });

  // 3. Per-site error isolation
  it('should isolate per-site errors without affecting other sites', async () => {
    deps.contentPipeline.indexSite = jest.fn().mockImplementation(async (info: any) => {
      if (info.siteId === 'site-bad') {
        throw new Error('Index failed');
      }
    });

    const opId = manager.execute({
      type: 'reindex',
      siteIds: ['site-ok', 'site-bad', 'site-ok2'],
    });

    await manager.waitForCompletion(opId);

    const status = manager.getStatus(opId)!;
    expect(status.status).toBe('completed_with_errors');
    expect(status.siteResults['site-ok'].status).toBe('completed');
    expect(status.siteResults['site-bad'].status).toBe('failed');
    expect(status.siteResults['site-bad'].error).toBe('Index failed');
    expect(status.siteResults['site-ok2'].status).toBe('completed');
    expect(status.progress.errors).toContain('site-bad');
    expect(status.progress.errors).not.toContain('site-ok');
  });

  // 4. Cancel stops pending operations
  it('should cancel pending operations when cancel is called', async () => {
    let resolvers: Array<() => void> = [];
    deps.contentPipeline.indexSite = jest.fn().mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
    });

    const opId = manager.execute({
      type: 'reindex',
      siteIds: ['s1', 's2', 's3', 's4', 's5'],
    });

    // Wait for first batch to start (concurrency=3)
    await new Promise((r) => setTimeout(r, 20));

    manager.cancel(opId);

    // Resolve the active operations
    resolvers.forEach((r) => r());

    await manager.waitForCompletion(opId);

    const status = manager.getStatus(opId)!;
    expect(status.status).toBe('cancelled');
  });

  // 5. Status transition: running -> completed
  it('should transition from running to completed on success', async () => {
    const opId = manager.execute({
      type: 'reindex',
      siteIds: ['site-1'],
    });

    // Before completion, status should be running
    const earlyStatus = manager.getStatus(opId)!;
    expect(['running', 'completed']).toContain(earlyStatus.status);

    await manager.waitForCompletion(opId);

    const finalStatus = manager.getStatus(opId)!;
    expect(finalStatus.status).toBe('completed');
    expect(finalStatus.completedAt).not.toBeNull();
  });

  // 6. Status transition: running -> completed_with_errors
  it('should transition to completed_with_errors when some sites fail', async () => {
    deps.contentPipeline.indexSite = jest.fn().mockImplementation(async (info: any) => {
      if (info.siteId === 'fail-site') {
        throw new Error('boom');
      }
    });

    const opId = manager.execute({
      type: 'reindex',
      siteIds: ['good-site', 'fail-site'],
    });

    await manager.waitForCompletion(opId);

    const status = manager.getStatus(opId)!;
    expect(status.status).toBe('completed_with_errors');
  });

  // 7. Progress callback called on each site completion
  it('should call onProgress callback for each site completion', async () => {
    const onProgress = jest.fn();
    deps.onProgress = onProgress;
    manager = new BulkOperationManager(deps);

    const opId = manager.execute({
      type: 'reindex',
      siteIds: ['s1', 's2', 's3'],
    });

    await manager.waitForCompletion(opId);

    // 3 per-site callbacks + 1 final completion callback
    expect(onProgress).toHaveBeenCalledTimes(4);

    // Each call should include the opId and a status object
    for (const call of onProgress.mock.calls) {
      expect(call[0]).toBe(opId);
      expect(call[1]).toHaveProperty('progress');
      expect(call[1]).toHaveProperty('siteResults');
    }
  });

  // 8. Empty siteIds returns completed immediately
  it('should complete immediately with empty siteIds', () => {
    const onProgress = jest.fn();
    deps.onProgress = onProgress;
    manager = new BulkOperationManager(deps);

    const opId = manager.execute({ type: 'reindex', siteIds: [] });

    const status = manager.getStatus(opId)!;
    expect(status.status).toBe('completed');
    expect(status.progress.total).toBe(0);
    expect(status.progress.completed).toBe(0);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  // 9. listAll returns sorted desc by createdAt, max 20
  it('should return operations sorted by createdAt desc, max 20', async () => {
    // Create 25 operations
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = manager.execute({ type: 'reindex', siteIds: [] });
      ids.push(id);
    }

    const list = manager.listAll();

    expect(list.length).toBe(20);

    // Verify sorted desc by createdAt
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].createdAt).toBeGreaterThanOrEqual(list[i].createdAt);
    }
  });

  // 10. Reindex executor calls contentPipeline.indexSite with correct args
  it('should call contentPipeline.indexSite with correct connection info on reindex', async () => {
    const indexSite = jest.fn().mockResolvedValue(undefined);
    deps.contentPipeline.indexSite = indexSite;

    const opId = manager.execute({
      type: 'reindex',
      siteIds: ['my-site'],
    });

    await manager.waitForCompletion(opId);

    expect(indexSite).toHaveBeenCalledTimes(1);
    expect(indexSite).toHaveBeenCalledWith({
      siteId: 'my-site',
      siteName: 'Site my-site',
      mysqlHost: '127.0.0.1',
      mysqlPort: 3307,
      mysqlUser: 'root',
      mysqlPassword: 'root',
      mysqlDatabase: 'local',
      sitePath: '/path/to/my-site',
    });
  });

  // 11. Plugin update executor calls wpCliRun, throws on failure
  it('should call wpCliRun for plugin-update and throw on failure', async () => {
    const wpCliRun = jest.fn().mockResolvedValue({ stdout: null, success: false });
    deps.siteDataBridge.wpCliRun = wpCliRun;

    const opId = manager.execute({
      type: 'plugin-update',
      siteIds: ['site-1'],
      options: { pluginSlug: 'akismet' },
    });

    await manager.waitForCompletion(opId);

    expect(wpCliRun).toHaveBeenCalledWith('site-1', [
      'plugin',
      'update',
      'akismet',
      '--format=json',
    ]);

    const status = manager.getStatus(opId)!;
    expect(status.siteResults['site-1'].status).toBe('failed');
    expect(status.siteResults['site-1'].error).toContain('Plugin update failed');
  });

  // 12. Start/stop executors call correct bridge methods
  it('should call startSite for start operations', async () => {
    const opId = manager.execute({
      type: 'start',
      siteIds: ['site-1', 'site-2'],
    });

    await manager.waitForCompletion(opId);

    expect(deps.siteDataBridge.startSite).toHaveBeenCalledWith('site-1');
    expect(deps.siteDataBridge.startSite).toHaveBeenCalledWith('site-2');
    expect(manager.getStatus(opId)!.status).toBe('completed');
  });

  it('should call stopSite for stop operations', async () => {
    const opId = manager.execute({
      type: 'stop',
      siteIds: ['site-1'],
    });

    await manager.waitForCompletion(opId);

    expect(deps.siteDataBridge.stopSite).toHaveBeenCalledWith('site-1');
    expect(manager.getStatus(opId)!.status).toBe('completed');
  });

  // 13. Health refresh calls calculateScore
  it('should call calculateScore with domain and phpVersion on health-refresh', async () => {
    const calculateScore = jest.fn().mockResolvedValue({ score: 90 });
    deps.healthCalculator.calculateScore = calculateScore;

    const opId = manager.execute({
      type: 'health-refresh',
      siteIds: ['site-1'],
    });

    await manager.waitForCompletion(opId);

    expect(calculateScore).toHaveBeenCalledWith('site-1', {
      domain: 'site-1.local',
      phpVersion: '8.1',
    });

    expect(manager.getStatus(opId)!.status).toBe('completed');
  });

  // Additional: getStatus returns null for unknown opId
  it('should return null for unknown operation ID', () => {
    expect(manager.getStatus('nonexistent')).toBeNull();
  });

  // Additional: cancel returns false for non-running or unknown ops
  it('should return false when cancelling unknown or completed operation', async () => {
    expect(manager.cancel('nonexistent')).toBe(false);

    const opId = manager.execute({ type: 'reindex', siteIds: [] });
    // Already completed (empty siteIds)
    expect(manager.cancel(opId)).toBe(false);
  });

  // 14. setup-ai calls setupSiteForAI for each running site
  it('should call setupSiteForAI for each site in setup-ai operation', async () => {
    const setupFn = jest.fn().mockResolvedValue({ success: true, message: 'Done' });
    deps.setupSiteForAI = setupFn;
    manager = new BulkOperationManager(deps);

    const opId = manager.execute({
      type: 'setup-ai',
      siteIds: ['site-1', 'site-2'],
      options: { enableOllama: true },
    });

    await manager.waitForCompletion(opId);

    expect(setupFn).toHaveBeenCalledTimes(2);
    expect(setupFn).toHaveBeenCalledWith('site-1', { enableOllama: true });
    expect(setupFn).toHaveBeenCalledWith('site-2', { enableOllama: true });

    const status = manager.getStatus(opId)!;
    expect(status.status).toBe('completed');
  });

  // 15. setup-ai skips halted sites
  it('should fail setup-ai for halted sites', async () => {
    const setupFn = jest.fn().mockResolvedValue({ success: true });
    deps.setupSiteForAI = setupFn;
    deps.siteDataBridge.getSiteStatus = jest.fn().mockReturnValue('halted');
    manager = new BulkOperationManager(deps);

    const opId = manager.execute({
      type: 'setup-ai',
      siteIds: ['halted-site'],
    });

    await manager.waitForCompletion(opId);

    expect(setupFn).not.toHaveBeenCalled();
    const status = manager.getStatus(opId)!;
    expect(status.siteResults['halted-site'].status).toBe('failed');
    expect(status.siteResults['halted-site'].error).toContain('not running');
  });

  // 16. setup-ai isolates per-site failures
  it('should isolate per-site failures in setup-ai', async () => {
    const setupFn = jest.fn().mockImplementation(async (siteId: string) => {
      if (siteId === 'bad-site') return { success: false, message: 'Plugin install failed' };
      return { success: true, message: 'OK' };
    });
    deps.setupSiteForAI = setupFn;
    manager = new BulkOperationManager(deps);

    const opId = manager.execute({
      type: 'setup-ai',
      siteIds: ['good-site', 'bad-site'],
    });

    await manager.waitForCompletion(opId);

    const status = manager.getStatus(opId)!;
    expect(status.siteResults['good-site'].status).toBe('completed');
    expect(status.siteResults['bad-site'].status).toBe('failed');
    expect(status.status).toBe('completed_with_errors');
  });

  // 17. setup-ai throws when setupSiteForAI not configured
  it('should fail setup-ai when setupSiteForAI dep not configured', async () => {
    // Default deps don't include setupSiteForAI
    const opId = manager.execute({
      type: 'setup-ai',
      siteIds: ['site-1'],
    });

    await manager.waitForCompletion(opId);

    const status = manager.getStatus(opId)!;
    expect(status.siteResults['site-1'].status).toBe('failed');
    expect(status.siteResults['site-1'].error).toContain('not configured');
  });
});
