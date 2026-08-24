/**
 * Sheet 18 — the combined 'index' op: ONE run covers both depths.
 *
 * Metadata first (a metadata failure is the run failing to read the place at
 * all), then content; the per-site outcome is the CONTENT step's, verbatim,
 * so a gatewayless place lands as did-not-run with the gateway reason — the
 * declaration's "stops at the API facts" group, where it stopped, stated.
 */
import { BulkOperationManager } from '../../../src/main/bulk/BulkOperationManager';

function makeManager(over: {
  syncSingleSite?: jest.Mock;
  indexOne?: jest.Mock;
  refreshSite?: jest.Mock;
  indexSite?: jest.Mock;
} = {}) {
  const calls: string[] = [];
  const localCalls = calls; // one ordered log across arms
  const syncSingleSite = over.syncSingleSite ?? jest.fn(async () => { calls.push('sync'); });
  const indexOne = over.indexOne ?? jest.fn(async () => { calls.push('index'); return { ran: true as const }; });
  const refreshSite = over.refreshSite ?? jest.fn(async () => { calls.push('ext-refresh'); });
  const indexSite = over.indexSite ?? jest.fn(async () => { calls.push('ext-index'); return { ran: true as const }; });
  const manager = new BulkOperationManager({
    contentPipeline: { indexSite: jest.fn(async () => { localCalls.push('local-index'); }) },
    siteDataBridge: {
      resolveSiteObject: (id: string) => ({ id, name: `site-${id}` }),
      getSiteStatus: () => 'running',
      startSite: jest.fn(), stopSite: jest.fn(),
      wpCliRun: jest.fn(async () => ({ stdout: '{}', success: true })),
      getPlugins: jest.fn(async () => []),
      getThemes: jest.fn(async () => []),
      getWpVersion: jest.fn(async () => { localCalls.push('local-sync'); return '6.8'; }),
      getOption: jest.fn(async () => ''),
    } as any,
    healthCalculator: { calculateScore: jest.fn() } as any,
    graphService: {
      upsertSite: jest.fn(), upsertPlugin: jest.fn(), upsertTheme: jest.fn(),
      deletePlugins: jest.fn(), deleteThemes: jest.fn(), getDb: () => null,
    } as any,
    onProgress: jest.fn(),
    wpeOps: { syncSingleSite, indexOne },
    externalOps: { refreshSite, indexSite },
  });
  return { manager, calls, syncSingleSite, indexOne, refreshSite, indexSite };
}

async function run(manager: BulkOperationManager, siteIds: string[]) {
  const id = manager.execute({ type: 'index', siteIds, siteNames: {} });
  await manager.waitForCompletion(id);
  return manager.getStatus(id)!;
}

describe("the combined 'index' op", () => {
  test('wpe: metadata runs before content, and success is the content outcome', async () => {
    const { manager, calls } = makeManager();
    const status = await run(manager, ['wpe-abc']);
    expect(calls).toEqual(['sync', 'index']);
    expect(status.status).toBe('completed');
    expect(Object.values(status.siteResults)[0].status).toBe('completed');
  });

  test('a gatewayless place lands as did-not-run with the gateway reason — stopped at the API facts', async () => {
    const { manager, syncSingleSite } = makeManager({
      indexOne: jest.fn(async () => ({ ran: false as const, reason: 'AutoscaleAlpha has no SSH gateway' })),
    });
    const status = await run(manager, ['wpe-auto']);
    expect(syncSingleSite).toHaveBeenCalled();                    // the API slice DID land
    const r = Object.values(status.siteResults)[0] as any;
    expect(r.status).not.toBe('completed');
    expect(JSON.stringify(r)).toContain('no SSH gateway');
  });

  test('a metadata failure fails the place — content never runs', async () => {
    const { manager, indexOne } = makeManager({
      syncSingleSite: jest.fn(async () => { throw new Error('CAPI 502'); }),
    });
    const status = await run(manager, ['wpe-abc']);
    expect(indexOne).not.toHaveBeenCalled();
    expect(Object.values(status.siteResults)[0].status).toBe('failed');
  });

  test('local: metadata (graph sync) runs before the content index', async () => {
    const { manager, calls } = makeManager();
    await run(manager, ['LocA']);
    expect(calls.indexOf('local-sync')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('local-index')).toBeGreaterThan(calls.indexOf('local-sync'));
  });

  test('external: refresh then index through the ssh adapters', async () => {
    const { manager, calls } = makeManager();
    await run(manager, ['ssh:alias/site']);
    expect(calls).toEqual(['ext-refresh', 'ext-index']);
  });
});
