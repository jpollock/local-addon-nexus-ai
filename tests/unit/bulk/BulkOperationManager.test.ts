/**
 * BulkOperationManager — correctness and memory tests (Phase 0.2)
 *
 * Covers the fixed concurrency loop, per-site error isolation, cancellation,
 * auto-start/stop, memory bounds, and history capping.
 */
import { BulkOperationManager, BulkOpDeps } from '../../../src/main/bulk/BulkOperationManager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides: Partial<BulkOpDeps> = {}): BulkOpDeps {
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
        services: { mysql: { port: 3306 } },
      })),
      getSiteStatus: jest.fn().mockReturnValue('running'),
      startSite: jest.fn().mockResolvedValue(undefined),
      stopSite: jest.fn().mockResolvedValue(undefined),
      wpCliRun: jest.fn().mockResolvedValue({ stdout: 'ready', success: true }),
      getPlugins: jest.fn().mockResolvedValue([]),
      getThemes: jest.fn().mockResolvedValue([]),
      getWpVersion: jest.fn().mockResolvedValue('6.5.0'),
      getOption: jest.fn().mockResolvedValue(null),
    },
    healthCalculator: {
      calculateScore: jest.fn().mockResolvedValue({ score: 80 }),
    },
    onProgress: jest.fn(),
    ...overrides,
  };
}

/** Generate N unique site IDs */
function siteIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `site-${i + 1}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BulkOperationManager (Phase 0.2 fixes)', () => {
  let deps: BulkOpDeps;
  let manager: BulkOperationManager;

  beforeEach(() => {
    deps = createMockDeps();
    manager = new BulkOperationManager(deps);
  });

  // ---------------------------------------------------------------------------
  // Test 1: Concurrency limit never exceeded
  // ---------------------------------------------------------------------------
  it('1. never exceeds MAX_CONCURRENCY (5) simultaneous site operations', async () => {
    let peak = 0;
    let active = 0;

    (deps.contentPipeline.indexSite as jest.Mock).mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      // Yield to allow other promises to start
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
    });

    const opId = manager.execute({ type: 'reindex', siteIds: siteIds(12) });
    await manager.waitForCompletion(opId);

    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Test 2: One site failing does not abort others
  // ---------------------------------------------------------------------------
  it('2. one site failing does not abort other sites', async () => {
    const visited = new Set<string>();

    (deps.contentPipeline.indexSite as jest.Mock).mockImplementation(async (info: any) => {
      visited.add(info.siteId);
      if (info.siteId === 'site-3') throw new Error('disk full');
    });

    const ids = siteIds(6);
    const opId = manager.execute({ type: 'reindex', siteIds: ids });
    await manager.waitForCompletion(opId);

    // All sites visited
    for (const id of ids) {
      expect(visited.has(id)).toBe(true);
    }

    const status = manager.getStatus(opId)!;
    expect(status.status).toBe('completed_with_errors');
    expect(status.siteResults['site-3'].status).toBe('failed');
    // Every other site completed
    for (const id of ids.filter((s) => s !== 'site-3')) {
      expect(status.siteResults[id].status).toBe('completed');
    }
  });

  // ---------------------------------------------------------------------------
  // Test 3: Cancellation marks remaining pending sites
  // ---------------------------------------------------------------------------
  it('3. cancellation marks remaining pending sites as failed', async () => {
    const blockers: Array<() => void> = [];

    (deps.contentPipeline.indexSite as jest.Mock).mockImplementation(async () => {
      await new Promise<void>((resolve) => blockers.push(resolve));
    });

    const opId = manager.execute({ type: 'reindex', siteIds: siteIds(8) });

    // Wait for the first wave (up to 5) to start
    await new Promise<void>((resolve) => setImmediate(resolve));

    manager.cancel(opId);

    // Unblock the active ones
    blockers.forEach((r) => r());

    await manager.waitForCompletion(opId);

    const status = manager.getStatus(opId)!;
    expect(status.status).toBe('cancelled');

    // Pending sites (those never started) must be marked failed with cancel message
    const cancelledSites = Object.values(status.siteResults).filter(
      (r) => r.error === 'Operation cancelled',
    );
    expect(cancelledSites.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Auto-start/stop — starts halted site, runs op, stops it
  // ---------------------------------------------------------------------------
  it('4. auto-start/stop starts a halted site, runs the op, then stops it', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });

    try {
      (deps.siteDataBridge.getSiteStatus as jest.Mock).mockReturnValue('halted');

      const opId = manager.execute({
        type: 'reindex',
        siteIds: ['halted-site'],
        options: { autoStartStop: true },
      });

      // Advance past the 2000ms site startup delay and any DB poll delays
      jest.runAllTimers();
      await Promise.resolve(); // flush microtasks
      jest.runAllTimers();
      await Promise.resolve();
      jest.runAllTimers();
      await Promise.resolve();

      await manager.waitForCompletion(opId);

      expect(deps.siteDataBridge.startSite).toHaveBeenCalledWith('halted-site');
      expect(deps.siteDataBridge.stopSite).toHaveBeenCalledWith('halted-site');

      const status = manager.getStatus(opId)!;
      expect(status.siteResults['halted-site'].status).toBe('completed');
    } finally {
      jest.useRealTimers();
    }
  });

  // ---------------------------------------------------------------------------
  // Test 5: Memory — 50 consecutive operations don't accumulate without bound
  // ---------------------------------------------------------------------------
  it('5. 50 consecutive operations keep history capped at MAX_HISTORY (20)', async () => {
    for (let i = 0; i < 50; i++) {
      const opId = manager.execute({ type: 'reindex', siteIds: ['s1'] });
      await manager.waitForCompletion(opId);
    }

    // listAll respects MAX_HISTORY
    const list = manager.listAll();
    expect(list.length).toBeLessThanOrEqual(20);
  });

  // ---------------------------------------------------------------------------
  // Test 6: getStatus() returns correct progress counts
  // ---------------------------------------------------------------------------
  it('6. getStatus returns correct progress counts throughout execution', async () => {
    const ids = siteIds(3);
    const opId = manager.execute({ type: 'reindex', siteIds: ids });
    await manager.waitForCompletion(opId);

    const status = manager.getStatus(opId)!;
    expect(status.progress.completed).toBe(3);
    expect(status.progress.total).toBe(3);
    expect(status.progress.errors).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 7: cancel() returns true for running op, false otherwise
  // ---------------------------------------------------------------------------
  it('7. cancel() returns true for a running op and false for unknown/done', async () => {
    const blockers: Array<() => void> = [];
    (deps.contentPipeline.indexSite as jest.Mock).mockImplementation(async () => {
      await new Promise<void>((resolve) => blockers.push(resolve));
    });

    const opId = manager.execute({ type: 'reindex', siteIds: ['s1'] });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(manager.cancel(opId)).toBe(true);
    expect(manager.cancel('no-such-id')).toBe(false);

    blockers.forEach((r) => r());
    await manager.waitForCompletion(opId);

    expect(manager.cancel(opId)).toBe(false); // already done
  });

  // ---------------------------------------------------------------------------
  // Test 8: Empty siteIds list completes immediately
  // ---------------------------------------------------------------------------
  it('8. empty siteIds list completes immediately with status=completed', () => {
    const opId = manager.execute({ type: 'reindex', siteIds: [] });
    const status = manager.getStatus(opId)!;
    expect(status.status).toBe('completed');
    expect(status.progress.total).toBe(0);
    expect(status.progress.completed).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 9: All sites succeed → status is 'completed'
  // ---------------------------------------------------------------------------
  it('9. all sites succeed → final status is completed', async () => {
    const opId = manager.execute({ type: 'reindex', siteIds: siteIds(4) });
    await manager.waitForCompletion(opId);

    expect(manager.getStatus(opId)!.status).toBe('completed');
  });

  // ---------------------------------------------------------------------------
  // Test 10: Some sites fail → status is 'completed_with_errors'
  // ---------------------------------------------------------------------------
  it('10. some sites fail → final status is completed_with_errors', async () => {
    (deps.contentPipeline.indexSite as jest.Mock).mockRejectedValueOnce(
      new Error('timeout'),
    );

    const opId = manager.execute({ type: 'reindex', siteIds: siteIds(3) });
    await manager.waitForCompletion(opId);

    expect(manager.getStatus(opId)!.status).toBe('completed_with_errors');
  });

  // ---------------------------------------------------------------------------
  // Test 11: All sites fail → status is 'completed_with_errors'
  //          (not 'failed' — 'failed' is reserved for abort; the operation itself
  //           ran to completion, just every site errored)
  // ---------------------------------------------------------------------------
  it('11. all sites fail → final status is completed_with_errors (not failed)', async () => {
    (deps.contentPipeline.indexSite as jest.Mock).mockRejectedValue(
      new Error('always fails'),
    );

    const opId = manager.execute({ type: 'reindex', siteIds: siteIds(3) });
    await manager.waitForCompletion(opId);

    const status = manager.getStatus(opId)!;
    // When every site errors the operation is still "completed" (with errors)
    expect(status.status).toBe('completed_with_errors');
    expect(status.progress.errors).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // Test 12: Op history is capped at MAX_HISTORY
  // ---------------------------------------------------------------------------
  it('12. op history is capped at MAX_HISTORY (20) after many operations', async () => {
    // Run 25 empty operations (complete instantly)
    const allIds: string[] = [];
    for (let i = 0; i < 25; i++) {
      allIds.push(manager.execute({ type: 'reindex', siteIds: [] }));
    }

    const list = manager.listAll();
    expect(list.length).toBe(20);

    // Sorted descending by createdAt
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].createdAt).toBeGreaterThanOrEqual(list[i].createdAt);
    }
  });

  // ---------------------------------------------------------------------------
  // Bonus: tracked-set concurrency — completed promise is removed from active set
  // ---------------------------------------------------------------------------
  it('bonus. completed promises are removed from active set (no stale references)', async () => {
    // If the tracked-set removal is broken a site can run twice or be counted
    // twice. We verify call count matches site count exactly.
    const callCount = { value: 0 };
    (deps.contentPipeline.indexSite as jest.Mock).mockImplementation(async () => {
      callCount.value++;
    });

    const ids = siteIds(10);
    const opId = manager.execute({ type: 'reindex', siteIds: ids });
    await manager.waitForCompletion(opId);

    expect(callCount.value).toBe(10);

    const status = manager.getStatus(opId)!;
    expect(status.progress.completed).toBe(10);
  });
});
