/**
 * WP-67 — a bulk result reports what was OBSERVED, not what was attempted.
 *
 * Measured 2026-08-22: the Operations tab reported "413 sites · 413 succeeded,
 * 0 failed, 0 pending" for `Index content` when three sites did the work. 45
 * local sites wrote `state: 'error'` into the IndexRegistry and were reported
 * as "Success" in the same second; 365 WP Engine installs returned from
 * `syncContent` having extracted zero posts, leaving no record in either
 * direction. `executeSingle` decided success by whether `executeByType` threw,
 * and all three implementations beneath it returned normally on failure.
 *
 * The contract is now: THROW means failed, and the returned `SiteOpOutcome`
 * says whether the work ran. Three recorded states, because "did not run" is
 * not the same thing as "failed" and collapsing them loses the more alarming
 * case.
 *
 * Every case here has its counterpart, deliberately: a suite that only proves
 * a failing site is reported as failed passes on a stub that reports
 * everything as failed.
 */
import { BulkOperationManager } from '../../../src/main/bulk/BulkOperationManager';
import { summarizeBulkOperation } from '../../../src/main/bulk/summary';
import { ContentPipeline } from '../../../src/main/content/ContentPipeline';
import { IndexRegistry } from '../../../src/main/content/IndexRegistry';
import { WPESyncService } from '../../../src/main/events/WPESyncService';

const LOCAL_ID = 'Ck3bTFmxY';
const WPE_ID = 'wpe-e5944134-c8e7-4f23-aaab-a38d472f2c1f';

/** In-memory RegistryStorage — get/set is the whole surface IndexRegistry uses. */
function makeStorage(): any {
  const bag: Record<string, any> = {};
  return { get: (k: string) => bag[k], set: (k: string, v: any) => { bag[k] = v; } };
}

/**
 * A REAL ContentPipeline driven down the path the 45 local sites took.
 *
 * `isAvailable` false is what a halted site looks like to the pipeline: it
 * pushes 'MySQL not available — site may not be running' onto `errors`,
 * extracts no posts, writes `state: 'error'` to the IndexRegistry, and then
 * RETURNS that IndexResult rather than throwing.
 *
 * Built from the real class on purpose. A hand-written `{errors: [...]}` would
 * test this file's idea of an IndexResult, not the one production returns —
 * and the shape is the entire subject of the case.
 */
function makeFailingRealPipeline() {
  const indexRegistry = new IndexRegistry(makeStorage());
  const pipeline = new ContentPipeline({
    vectorStore: {} as any,
    embeddingService: {} as any,
    mysqlExtractor: { isAvailable: () => false, extract: async () => ({ posts: [] }) } as any,
    fileScanner: { scan: async () => null } as any,
    indexRegistry,
  });
  return { pipeline, indexRegistry };
}

function makeManager(over: any = {}) {
  const deps: any = {
    contentPipeline: { indexSite: jest.fn(async () => ({ siteId: LOCAL_ID, documentsIndexed: 3, chunksIndexed: 9, durationMs: 12, errors: [] })) },
    siteDataBridge: {
      resolveSiteObject: (id: string) => ({ id, name: id, path: '/tmp/site', services: { mysql: { port: 3306 } } }),
      getSiteStatus: () => 'running',
      startSite: jest.fn(async () => undefined),
      stopSite: jest.fn(async () => undefined),
      wpCliRun: jest.fn(async () => ({ stdout: '', success: true })),
      getPlugins: jest.fn(async () => []),
      getThemes: jest.fn(async () => []),
      getWpVersion: jest.fn(async () => '6.5'),
      getOption: jest.fn(async () => null),
    },
    healthCalculator: { calculateScore: jest.fn(async () => ({})) },
    onProgress: jest.fn(),
    ...over,
  };
  return { manager: new BulkOperationManager(deps), deps };
}

async function run(manager: BulkOperationManager, siteIds: string[], siteNames: Record<string, string> = {}) {
  const id = manager.execute({ type: 'reindex', siteIds, siteNames });
  await manager.waitForCompletion(id);
  return manager.getStatus(id)!;
}

describe('WP-67 — a bulk result reports what was observed', () => {
  // Case 1. The counterpart. Without this, "report everything as failed" passes
  // every other case in this file.
  test('a site that genuinely indexes is reported as succeeded', async () => {
    const { manager } = makeManager();
    const status = await run(manager, [LOCAL_ID]);

    expect(status.siteResults[LOCAL_ID].status).toBe('completed');
    expect(summarizeBulkOperation(status)).toMatchObject({ succeeded: 1, failed: 0, skipped: 0 });
  });

  // Case 2. The 45. The registry and the panel must not write both words about
  // the same site in the same second.
  test('a real ContentPipeline error-shaped result is reported as failed, not succeeded', async () => {
    const { pipeline, indexRegistry } = makeFailingRealPipeline();
    const { manager } = makeManager({ contentPipeline: pipeline });

    const status = await run(manager, [LOCAL_ID]);

    // What the pipeline itself recorded — this is the ground truth the panel contradicted.
    expect(indexRegistry.get(LOCAL_ID)!.state).toBe('error');

    expect(status.siteResults[LOCAL_ID].status).toBe('failed');
    expect(status.siteResults[LOCAL_ID].error).toContain('MySQL not available');
    expect(summarizeBulkOperation(status)).toMatchObject({ succeeded: 0, failed: 1, skipped: 0 });
  });

  // Case 3. The 365. Not success, and not failure either.
  test('an indexer that returns early having done nothing is recorded as did-not-run', async () => {
    const { manager } = makeManager({
      wpeOps: {
        syncSingleSite: jest.fn(async () => undefined),
        indexOne: jest.fn(async () => ({ ran: false, reason: 'No content found to index' })),
      },
    });

    const status = await run(manager, [WPE_ID], { [WPE_ID]: 'acmeprod' });
    const result = status.siteResults[WPE_ID];

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('No content found to index');
    // Explicitly neither of the other two — collapsing them is the defect.
    expect(result.status).not.toBe('completed');
    expect(result.status).not.toBe('failed');
    expect(status.progress.errors).not.toContain(WPE_ID);
    expect(summarizeBulkOperation(status)).toMatchObject({ succeeded: 0, failed: 0, skipped: 1 });
  });

  // Case 4. A summary asserted only on a single-state batch never tests the
  // arithmetic. `413 succeeded` was true of the counter and false of the world.
  test('the summary totals are derived from a mixed batch of all three states', async () => {
    const OK = 'localOk1';
    const BAD = 'localBad1';
    const SKIP = 'wpe-11111111-2222-3333-4444-555555555555';

    const { pipeline } = makeFailingRealPipeline();
    const { manager } = makeManager({
      contentPipeline: {
        indexSite: async (info: any) =>
          info.siteId === BAD
            ? pipeline.indexSite(info)
            : { siteId: info.siteId, documentsIndexed: 2, chunksIndexed: 4, durationMs: 5, errors: [] },
      },
      wpeOps: {
        syncSingleSite: jest.fn(async () => undefined),
        indexOne: jest.fn(async () => ({ ran: false, reason: 'No content found to index' })),
      },
    });

    const status = await run(manager, [OK, BAD, SKIP], { [SKIP]: 'acmeprod' });

    expect(summarizeBulkOperation(status)).toEqual({
      succeeded: 1,
      failed: 1,
      skipped: 1,
      pending: 0,
      total: 3,
    });
  });

  // `getStatus` caps `siteResults` at 500 entries, and this fleet's selection
  // was 413 — so a selection CAN carry ids the results map does not. Counting
  // the map instead of the selection would let those sites vanish from the
  // totals rather than show as pending, which is the same class of error as
  // the one this packet fixes: a number that is true of the bookkeeping and
  // false of the world.
  test('a site with no recorded result counts as pending, not as absent', () => {
    const summary = summarizeBulkOperation({
      siteIds: ['a', 'b', 'c'],
      siteResults: { a: { status: 'completed' } },
    });

    expect(summary).toEqual({ succeeded: 1, failed: 0, skipped: 0, pending: 2, total: 3 });
  });

  // The headline arithmetic, in miniature: the shape that printed "413 succeeded".
  test('a batch where nothing ran does not report a single success', async () => {
    const ids = ['wpe-a', 'wpe-b', 'wpe-c'];
    const { manager } = makeManager({
      wpeOps: {
        syncSingleSite: jest.fn(async () => undefined),
        indexOne: jest.fn(async () => ({ ran: false, reason: 'No content found to index' })),
      },
    });

    const status = await run(manager, ids);
    const summary = summarizeBulkOperation(status);

    expect(summary.succeeded).toBe(0);
    expect(summary.skipped).toBe(3);
  });
});

/**
 * The cases above drive the bulk seam with a stubbed WP Engine adapter. These
 * drive the REAL `WPESyncService`, because the translation from `syncContent`'s
 * three exits into an outcome is itself production code — and it is the exact
 * code that reported 365 installs as indexed.
 */
describe('WP-67 — WPESyncService.indexOneWpeContent reports each of syncContent\'s exits', () => {
  function makeService(extract: () => Promise<any>) {
    const graphService: any = {
      getDb: () => ({ prepare: () => ({ get: () => undefined }) }),
      upsertContent: jest.fn().mockResolvedValue(undefined),
      upsertSite: jest.fn().mockResolvedValue(undefined),
    };
    const indexRegistry = new IndexRegistry(makeStorage());
    return new WPESyncService({
      graphService,
      localServices: { remoteWpCliRun: jest.fn().mockResolvedValue({ stdout: '', success: true }) } as any,
      remoteContentExtractor: { extract: jest.fn(extract) } as any,
      // One vector per chunk, whatever the chunker produced.
      embeddingService: { embedBatch: jest.fn(async (xs: any[]) => xs.map(() => [0.1, 0.2])) } as any,
      vectorStore: { upsert: jest.fn().mockResolvedValue(undefined) } as any,
      indexRegistry,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    });
  }

  // The 365. Zero posts extracted, and the old code returned void here —
  // indistinguishable from the success path to every caller.
  test('zero posts extracted is did-not-run, with a reason', async () => {
    const service = makeService(async () => ({ posts: [] }));

    const outcome = await service.indexOneWpeContent('wpe-1', 'acmeprod');

    expect(outcome.ran).toBe(false);
    expect(outcome).toHaveProperty('reason');
  });

  // The counterpart: real posts must still report as having run, or "always
  // skip" would pass the case above.
  test('posts extracted and embedded is reported as having run', async () => {
    const service = makeService(async () => ({
      posts: [{
        id: 1, postType: 'post', title: 'Hello', postStatus: 'publish',
        author: '1', date: '2026-01-01T00:00:00Z', cleanedContent: 'body text', excerpt: '',
      }],
    }));

    const outcome = await service.indexOneWpeContent('wpe-1', 'acmeprod');

    expect(outcome.ran).toBe(true);
  });

  // The third exit: a genuine error. `syncContent` catches it and must not
  // resolve indistinguishably from either of the two above.
  test('an extractor failure throws rather than resolving', async () => {
    const service = makeService(async () => { throw new Error('SSH connection refused'); });

    await expect(service.indexOneWpeContent('wpe-1', 'acmeprod')).rejects.toThrow('SSH connection refused');
  });
});
