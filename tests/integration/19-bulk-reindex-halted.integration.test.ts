/**
 * Integration tests: BulkOperationManager auto-start/stop for halted sites
 *
 * Critical behaviors under test:
 * 1. Individual startSite() called per halted site (one call per halted site, not batch)
 * 2. Selective stop — only auto-started sites are stopped after the operation;
 *    sites that were already running when the operation began are NOT stopped
 * 3. Partial start failure — if one site fails to start, the other halted site
 *    still gets indexed (errors are isolated per-site)
 * 4. All halted sites start successfully — all get indexed and all get stopped
 */

import { BulkOperationManager, BulkOpDeps } from '../../src/main/bulk/BulkOperationManager';
import type { BulkOperationRequest } from '../../src/main/bulk/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a BulkOpDeps object with controllable mocks. */
function makeDeps(overrides: Partial<{
  startSite: jest.Mock;
  stopSite: jest.Mock;
  getSiteStatus: jest.Mock;
  indexSite: jest.Mock;
  wpCliRun: jest.Mock;
  resolveSiteObject: jest.Mock;
}> = {}): { deps: BulkOpDeps; mocks: ReturnType<typeof buildMocks> } {
  const mocks = buildMocks(overrides);
  const deps: BulkOpDeps = {
    contentPipeline: { indexSite: mocks.indexSite },
    siteDataBridge: {
      resolveSiteObject: mocks.resolveSiteObject,
      getSiteStatus: mocks.getSiteStatus,
      startSite: mocks.startSite,
      stopSite: mocks.stopSite,
      wpCliRun: mocks.wpCliRun,
      getPlugins: jest.fn(() => Promise.resolve([])),
      getThemes: jest.fn(() => Promise.resolve([])),
      getWpVersion: jest.fn(() => Promise.resolve('7.0')),
    },
    healthCalculator: {
      calculateScore: jest.fn(() => Promise.resolve({ score: 85, status: 'good' })),
    },
    onProgress: jest.fn(),
  };
  return { deps, mocks };
}

function buildMocks(overrides: Partial<{
  startSite: jest.Mock;
  stopSite: jest.Mock;
  getSiteStatus: jest.Mock;
  indexSite: jest.Mock;
  wpCliRun: jest.Mock;
  resolveSiteObject: jest.Mock;
}>) {
  return {
    startSite: overrides.startSite ?? jest.fn(() => Promise.resolve()),
    stopSite: overrides.stopSite ?? jest.fn(() => Promise.resolve()),
    // Default: site-1 and site-3 are running; site-2 and site-4 are halted
    getSiteStatus: overrides.getSiteStatus ?? jest.fn((siteId: string) =>
      ['site-1', 'site-3'].includes(siteId) ? 'running' : 'halted'
    ),
    indexSite: overrides.indexSite ?? jest.fn(() => Promise.resolve({ indexed: 5, skipped: 0 })),
    // wpCliRun returns "ready" immediately so waitForDatabaseReady resolves first poll
    wpCliRun: overrides.wpCliRun ?? jest.fn(() => Promise.resolve({ success: true, stdout: 'ready' })),
    resolveSiteObject: overrides.resolveSiteObject ?? jest.fn((siteId: string) => ({
      id: siteId,
      name: `Site ${siteId}`,
      path: `/sites/${siteId}`,
      services: { mysql: { port: 3306 } },
    })),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('BulkOperationManager — auto-start/stop for halted sites', () => {
  beforeEach(() => {
    // Use fake timers to avoid the 2-second post-start delay and 1-second
    // waitForDatabaseReady poll delay from slowing down the test suite.
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Helper: run an operation with fake timers advancing automatically
  // -------------------------------------------------------------------------

  /**
   * Execute a BulkOperation and resolve all timer-based delays, then wait for
   * the operation to finish. Returns the final status.
   */
  async function runWithFakeTimers(
    manager: BulkOperationManager,
    request: BulkOperationRequest,
  ) {
    const opId = manager.execute(request);

    // Alternate between advancing timers and flushing micro-tasks until the
    // operation completes. We cap iterations to avoid an infinite loop.
    const completion = manager.waitForCompletion(opId);
    let iterations = 0;
    const maxIterations = 50;

    while (iterations++ < maxIterations) {
      // Flush pending promises (micro-tasks)
      await Promise.resolve();
      // Advance all pending timer callbacks
      jest.runAllTimers();
      // Check if the promise has settled
      let settled = false;
      const race = await Promise.race([
        completion.then(() => { settled = true; }),
        Promise.resolve(),
      ]);
      if (settled) break;
    }

    // Final flush to let any last callbacks run
    await Promise.resolve();

    return manager.getStatus(opId);
  }

  // -------------------------------------------------------------------------
  // Test 1: Individual startSite() called per halted site, not a batch call
  // -------------------------------------------------------------------------
  it('calls startSite() individually for each halted site, not as a single batch', async () => {
    const { deps, mocks } = makeDeps();
    const manager = new BulkOperationManager(deps);

    const request: BulkOperationRequest = {
      type: 'reindex',
      // site-1 running, site-2 halted, site-3 running, site-4 halted
      siteIds: ['site-1', 'site-2', 'site-3', 'site-4'],
      options: { autoStartStop: true },
    };

    const status = await runWithFakeTimers(manager, request);

    // Two halted sites → startSite called exactly twice, once per halted site
    expect(mocks.startSite).toHaveBeenCalledTimes(2);
    expect(mocks.startSite).toHaveBeenCalledWith('site-2');
    expect(mocks.startSite).toHaveBeenCalledWith('site-4');

    // Confirm the operation completed (not errored due to halted sites)
    expect(status!.status).toBe('completed');
    // All 4 sites were indexed
    expect(mocks.indexSite).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // Test 2: Selective stop — only auto-started sites are stopped
  // -------------------------------------------------------------------------
  it('stops only auto-started halted sites, not sites that were already running', async () => {
    const { deps, mocks } = makeDeps();
    const manager = new BulkOperationManager(deps);

    const request: BulkOperationRequest = {
      type: 'reindex',
      // site-1 is running, site-2 is halted
      siteIds: ['site-1', 'site-2'],
      options: { autoStartStop: true },
    };

    await runWithFakeTimers(manager, request);

    // stopSite called exactly once — only for the halted site that was auto-started
    expect(mocks.stopSite).toHaveBeenCalledTimes(1);
    expect(mocks.stopSite).toHaveBeenCalledWith('site-2');

    // The already-running site-1 must NOT have been stopped
    expect(mocks.stopSite).not.toHaveBeenCalledWith('site-1');
  });

  // -------------------------------------------------------------------------
  // Test 3: Partial start failure — other halted site still gets indexed
  // -------------------------------------------------------------------------
  it('indexes the successful site when one halted site fails to start', async () => {
    const startSite = jest.fn((siteId: string) => {
      if (siteId === 'site-2') {
        return Promise.reject(new Error('Failed to start site-2'));
      }
      return Promise.resolve();
    });

    const { deps, mocks } = makeDeps({ startSite });
    const manager = new BulkOperationManager(deps);

    const request: BulkOperationRequest = {
      type: 'reindex',
      // site-2 and site-4 are halted; site-2 will fail to start
      siteIds: ['site-2', 'site-4'],
      options: { autoStartStop: true },
    };

    const status = await runWithFakeTimers(manager, request);

    // site-2 failed to start — its result should be 'failed'
    expect(status!.siteResults['site-2'].status).toBe('failed');
    expect(status!.siteResults['site-2'].error).toContain('Failed to start site-2');

    // site-4 started successfully and was indexed
    expect(status!.siteResults['site-4'].status).toBe('completed');
    expect(mocks.indexSite).toHaveBeenCalledTimes(1);

    // Overall operation should be completed_with_errors (not failed entirely)
    expect(status!.status).toBe('completed_with_errors');
  });

  // -------------------------------------------------------------------------
  // Test 4: All halted sites start — all get indexed and all get stopped
  // -------------------------------------------------------------------------
  it('indexes all sites and stops all of them when all halted sites start successfully', async () => {
    // Override getSiteStatus so all sites are halted
    const getSiteStatus = jest.fn(() => 'halted');
    const { deps, mocks } = makeDeps({ getSiteStatus });
    const manager = new BulkOperationManager(deps);

    const request: BulkOperationRequest = {
      type: 'reindex',
      siteIds: ['site-2', 'site-4'],
      options: { autoStartStop: true },
    };

    const status = await runWithFakeTimers(manager, request);

    // Both sites were started
    expect(mocks.startSite).toHaveBeenCalledTimes(2);
    expect(mocks.startSite).toHaveBeenCalledWith('site-2');
    expect(mocks.startSite).toHaveBeenCalledWith('site-4');

    // Both sites were indexed
    expect(mocks.indexSite).toHaveBeenCalledTimes(2);

    // Both auto-started sites were stopped after indexing
    expect(mocks.stopSite).toHaveBeenCalledTimes(2);
    expect(mocks.stopSite).toHaveBeenCalledWith('site-2');
    expect(mocks.stopSite).toHaveBeenCalledWith('site-4');

    // Operation succeeded cleanly
    expect(status!.status).toBe('completed');
    expect(status!.siteResults['site-2'].status).toBe('completed');
    expect(status!.siteResults['site-4'].status).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // Additional: autoStartStop disabled — no starts or stops
  // -------------------------------------------------------------------------
  it('does not start or stop any site when autoStartStop is not set', async () => {
    const { deps, mocks } = makeDeps();
    const manager = new BulkOperationManager(deps);

    const request: BulkOperationRequest = {
      type: 'reindex',
      // site-2 is halted, but autoStartStop is absent
      siteIds: ['site-1', 'site-2'],
      // No autoStartStop option — sites are NOT auto-started
    };

    await runWithFakeTimers(manager, request);

    expect(mocks.startSite).not.toHaveBeenCalled();
    expect(mocks.stopSite).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Additional: already-running sites are not started
  // -------------------------------------------------------------------------
  it('does not call startSite for sites that are already running', async () => {
    // All three sites are running
    const getSiteStatus = jest.fn(() => 'running');
    const { deps, mocks } = makeDeps({ getSiteStatus });
    const manager = new BulkOperationManager(deps);

    const request: BulkOperationRequest = {
      type: 'reindex',
      siteIds: ['site-1', 'site-2', 'site-3'],
      options: { autoStartStop: true },
    };

    const status = await runWithFakeTimers(manager, request);

    // No sites needed starting
    expect(mocks.startSite).not.toHaveBeenCalled();
    expect(mocks.stopSite).not.toHaveBeenCalled();
    // All sites were indexed
    expect(mocks.indexSite).toHaveBeenCalledTimes(3);
    expect(status!.status).toBe('completed');
  });
});
