/**
 * Bulk operations across all three sources.
 *
 * Before this, BulkOperationManager resolved every site id through Local's own
 * store (`resolveSiteObject` → `siteData.getSite`), so a WP Engine or external
 * id failed with "Site not found". On a real machine that is 334 of 369 rows,
 * which made the Sites table's selection-scoped actions broken for almost every
 * row they could be pointed at.
 */
import { siteSourceOf, wpeInstallIdOf } from '../../../src/main/bulk/siteSource';
import { BulkOperationManager } from '../../../src/main/bulk/BulkOperationManager';

// Real id shapes, read from a live graph.db.
const LOCAL_ID = 'Ck3bTFmxY';
const WPE_ID = 'wpe-e5944134-c8e7-4f23-aaab-a38d472f2c1f';
const WPE_INSTALL = 'e5944134-c8e7-4f23-aaab-a38d472f2c1f';
const EXT_ID = 'ssh:hostinger-test/palegreen-capybara-114180';
const EXT_BARE_ID = 'ssh:hostinger-test';

describe('siteSourceOf', () => {
  test('classifies the three real id shapes', () => {
    expect(siteSourceOf(LOCAL_ID)).toBe('local');
    expect(siteSourceOf(WPE_ID)).toBe('wpe');
    expect(siteSourceOf(EXT_ID)).toBe('external');
    expect(siteSourceOf(EXT_BARE_ID)).toBe('external');
  });

  test('strips the wpe- prefix to the CAPI install id', () => {
    // syncSingleSite calls capiGetInstall, which does not know the prefixed form.
    expect(wpeInstallIdOf(WPE_ID)).toBe(WPE_INSTALL);
    expect(wpeInstallIdOf(WPE_INSTALL)).toBe(WPE_INSTALL);
  });
});

function makeManager(over: any = {}) {
  const calls: string[] = [];
  const deps: any = {
    contentPipeline: { indexSite: jest.fn(async () => ({ documentCount: 1 })) },
    siteDataBridge: {
      resolveSiteObject: (id: string) => {
        if (siteSourceOf(id) !== 'local') throw new Error(`Site not found: ${id}`);
        return { id, name: id, services: { mysql: { port: 3306 } } };
      },
      getSiteStatus: () => 'running',
      startSite: jest.fn(async () => { calls.push('startSite'); }),
      stopSite: jest.fn(async () => { calls.push('stopSite'); }),
      wpCliRun: jest.fn(async () => ({ stdout: '', success: true })),
      getPlugins: jest.fn(async () => []),
      getThemes: jest.fn(async () => []),
      getWpVersion: jest.fn(async () => '6.5'),
      getOption: jest.fn(async () => null),
    },
    healthCalculator: { calculateScore: jest.fn(async () => ({})) },
    graphService: {
      upsertSite: jest.fn(async () => undefined),
      upsertPlugin: jest.fn(async () => 1),
      deletePlugins: jest.fn(async () => undefined),
      updateSiteSettings: jest.fn(),
    },
    onProgress: jest.fn(),
    wpeOps: {
      syncSingleSite: jest.fn(async (installId: string) => { calls.push(`wpe:sync:${installId}`); }),
      indexOne: jest.fn(async (siteId: string) => { calls.push(`wpe:index:${siteId}`); }),
    },
    externalOps: {
      refreshSite: jest.fn(async (siteId: string) => { calls.push(`ext:refresh:${siteId}`); }),
      indexSite: jest.fn(async (siteId: string) => { calls.push(`ext:index:${siteId}`); }),
    },
    ...over,
  };
  return { mgr: new BulkOperationManager(deps), deps, calls };
}

async function runAndWait(mgr: any, request: any) {
  const opId = mgr.execute(request);
  const id = typeof opId === 'string' ? opId : await opId;
  await mgr.waitForCompletion(id);
  return mgr.getStatus(id);
}

describe('BulkOperationManager routes by source', () => {
  test('sync-graph reaches the WPE path with the unprefixed install id', async () => {
    const { mgr, calls } = makeManager();
    const status = await runAndWait(mgr, {
      type: 'sync-graph', siteIds: [WPE_ID], siteNames: { [WPE_ID]: 'dbrains' }, options: {},
    });
    expect(calls).toContain(`wpe:sync:${WPE_INSTALL}`);
    expect(status.progress.errors).toEqual([]);
  });

  test('reindex reaches the WPE content path', async () => {
    const { mgr, calls } = makeManager();
    const status = await runAndWait(mgr, {
      type: 'reindex', siteIds: [WPE_ID], siteNames: { [WPE_ID]: 'dbrains' }, options: {},
    });
    expect(calls).toContain(`wpe:index:${WPE_ID}`);
    expect(status.progress.errors).toEqual([]);
  });

  test('sync-graph reaches the external refresh path', async () => {
    const { mgr, calls } = makeManager();
    const status = await runAndWait(mgr, {
      type: 'sync-graph', siteIds: [EXT_ID], siteNames: { [EXT_ID]: 'shop' }, options: {},
    });
    expect(calls).toContain(`ext:refresh:${EXT_ID}`);
    expect(status.progress.errors).toEqual([]);
  });

  test('reindex reaches the external index path', async () => {
    const { mgr, calls } = makeManager();
    const status = await runAndWait(mgr, {
      type: 'reindex', siteIds: [EXT_ID], siteNames: { [EXT_ID]: 'shop' }, options: {},
    });
    expect(calls).toContain(`ext:index:${EXT_ID}`);
    expect(status.progress.errors).toEqual([]);
  });

  test('a local site still takes the Local path', async () => {
    const { mgr, deps } = makeManager();
    const status = await runAndWait(mgr, {
      type: 'reindex', siteIds: [LOCAL_ID], siteNames: { [LOCAL_ID]: 'My Site' }, options: {},
    });
    expect(deps.contentPipeline.indexSite).toHaveBeenCalled();
    expect(status.progress.errors).toEqual([]);
  });

  test('a mixed selection routes each id to its own backend', async () => {
    // The whole point: one action over a selection spanning all three.
    const { mgr, calls, deps } = makeManager();
    const ids = [LOCAL_ID, WPE_ID, EXT_ID];
    const status = await runAndWait(mgr, {
      type: 'reindex', siteIds: ids,
      siteNames: { [LOCAL_ID]: 'a', [WPE_ID]: 'b', [EXT_ID]: 'c' }, options: {},
    });
    expect(deps.contentPipeline.indexSite).toHaveBeenCalledTimes(1);
    expect(calls).toContain(`wpe:index:${WPE_ID}`);
    expect(calls).toContain(`ext:index:${EXT_ID}`);
    expect(status.progress.errors).toEqual([]);
    expect(status.progress.completed).toBe(3);
  });

  test('auto-start never fires for a remote site', async () => {
    // startSite/getSiteStatus are Local process controls. Nexus does not start
    // or stop a remote host, and calling them with a wpe- id would throw.
    const { mgr, deps, calls } = makeManager({
      siteDataBridge: {
        ...makeManager().deps.siteDataBridge,
        getSiteStatus: () => 'halted',
      },
    });
    await runAndWait(mgr, {
      type: 'sync-graph', siteIds: [WPE_ID, EXT_ID],
      siteNames: { [WPE_ID]: 'b', [EXT_ID]: 'c' }, options: { autoStartStop: true },
    });
    expect(calls).not.toContain('startSite');
    expect(deps.siteDataBridge.startSite).not.toHaveBeenCalled();
  });

  test('a Local-only operation on a remote site fails with a reason, not "Site not found"', async () => {
    // start/stop/setup-ai have no remote meaning. The error must say so rather
    // than surface Local's lookup miss, which reads like a missing site.
    const { mgr } = makeManager();
    const status = await runAndWait(mgr, {
      type: 'start', siteIds: [WPE_ID], siteNames: { [WPE_ID]: 'b' }, options: {},
    });
    expect(status.progress.errors).toEqual([WPE_ID]);
    const error = status.siteResults[WPE_ID].error;
    expect(error).toMatch(/not supported/i);
    expect(error).toMatch(/wpe/i);
    expect(error).not.toMatch(/Site not found/);
  });

  test('a missing adapter is reported honestly, not silently skipped', async () => {
    // If the deps were never wired, the op must fail loudly. A silent success
    // would report "refreshed 331 installs" having done nothing.
    const { mgr } = makeManager({ wpeOps: undefined });
    const status = await runAndWait(mgr, {
      type: 'sync-graph', siteIds: [WPE_ID], siteNames: { [WPE_ID]: 'b' }, options: {},
    });
    expect(status.progress.errors).toEqual([WPE_ID]);
    expect(status.siteResults[WPE_ID].error).toMatch(/not available/i);
  });
});
