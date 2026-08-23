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
      running: 0,
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

    expect(summary).toEqual({ succeeded: 1, failed: 0, skipped: 0, running: 0, pending: 2, total: 3 });
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
 * WP-68 / D9 — what a halted Local site does under each setting.
 *
 * Measured 2026-08-22: all 45 Local sites recorded
 * `MySQL not available — site may not be running`. WP-67 correctly stopped
 * calling that a success; calling it a failure is the opposite overstatement.
 *
 * **Every dispatcher sends `autoStartStop: true`** — a bulk operation that
 * reaches a halted Local site starts it, collects, and stops it again. The
 * skip path below is the explicit opt-out (`INDEX_ALL_FLEET`, which is the
 * deliberate "running sites only" variant), not the default; it exists so
 * that a caller which chooses not to start sites still reports honestly
 * rather than recording a failure for work it declined to do.
 */
describe('WP-68 — a halted Local site is started by default, and reports honestly when it is not', () => {
  const HALTED = 'Ck3bTFmxY';

  function managerWith(status: string, indexSite = jest.fn(async () => ({ errors: [] }))) {
    const started: string[] = [];
    const deps: any = {
      contentPipeline: { indexSite },
      siteDataBridge: {
        resolveSiteObject: (id: string) => ({ id, name: 'thelocalshed', path: '/tmp/s', services: { mysql: { port: 3306 } } }),
        getSiteStatus: () => status,
        startSite: jest.fn(async (id: string) => { started.push(id); }),
        stopSite: jest.fn(async () => undefined),
        wpCliRun: jest.fn(async () => ({ stdout: 'ready', success: true })),
        getPlugins: jest.fn(async () => []), getThemes: jest.fn(async () => []),
        getWpVersion: jest.fn(async () => '6.5'), getOption: jest.fn(async () => null),
      },
      healthCalculator: { calculateScore: jest.fn() },
      onProgress: jest.fn(),
    };
    return { manager: new BulkOperationManager(deps), deps, started };
  }

  test('halted with autoStartStop OFF: did not run, named, and nothing is indexed', async () => {
    const indexSite = jest.fn(async () => ({ errors: [] }));
    const { manager } = managerWith('halted', indexSite);

    const id = manager.execute({ type: 'reindex', siteIds: [HALTED], options: { autoStartStop: false } });
    await manager.waitForCompletion(id);
    const result = manager.getStatus(id)!.siteResults[HALTED];

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('thelocalshed is not running');
    expect(indexSite).not.toHaveBeenCalled();
  });

  // The counterpart. Without it, "always skip" passes the case above and the
  // whole operation would quietly stop working.
  test('running with autoStartStop OFF: indexes and reports succeeded', async () => {
    const indexSite = jest.fn(async () => ({ errors: [] }));
    const { manager } = managerWith('running', indexSite);

    const id = manager.execute({ type: 'reindex', siteIds: [HALTED], options: { autoStartStop: false } });
    await manager.waitForCompletion(id);

    expect(manager.getStatus(id)!.siteResults[HALTED].status).toBe('completed');
    expect(indexSite).toHaveBeenCalled();
  });

  // THE DEFAULT PATH. Every dispatcher sends `autoStartStop: true`, so this is
  // what pressing "Index content" over 45 stopped sites does: 45 sites started,
  // indexed and stopped — not 45 rows saying did not run.
  test('halted with autoStartStop ON (the default): the site is started and indexed', async () => {
    const indexSite = jest.fn(async () => ({ errors: [] }));
    const { manager, started } = managerWith('halted', indexSite);

    const id = manager.execute({ type: 'reindex', siteIds: [HALTED], options: { autoStartStop: true } });
    await manager.waitForCompletion(id);

    expect(started).toEqual([HALTED]);
    expect(manager.getStatus(id)!.siteResults[HALTED].status).toBe('completed');
    expect(indexSite).toHaveBeenCalled();
  }, 15000);
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
      // WP-68: the name now comes from the graph, so the fake has to hold one.
      // `wpe-1` resolving to `acmeprod` is what `requireWpeInstallName` reads.
      getDb: () => ({ prepare: () => ({ get: () => ({ name: 'acmeprod' }) }) }),
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

    const outcome = await service.indexOneWpeContent('wpe-1');

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

    const outcome = await service.indexOneWpeContent('wpe-1');

    expect(outcome.ran).toBe(true);
  });

  /**
   * D12. A read that FAILED is not a site with nothing in it.
   *
   * On 2026-08-22 this distinction was the whole difference between
   * "Did not run — No content returned by the extractor" and the truth, which
   * was that 106 reachable installs holding up to 215 posts each had their
   * reads fail. `coverage.truncatedReason === 'page-failed'` is how the
   * extractor already says so; nothing read it.
   */
  test('a page-failed read throws with the transport reason, and is not a skip', async () => {
    const service = makeService(async () => ({
      posts: [],
      coverage: {
        pageSize: 200, pagesFetched: 0, rowsReturned: 0, complete: false,
        truncatedReason: 'page-failed',
        truncatedDetail: 'the first page failed: ssh: Connection refused',
        customFields: 'not-attempted',
      },
    }));

    await expect(service.indexOneWpeContent('wpe-1')).rejects.toThrow('Connection refused');
  });

  // The counterpart: a site that really is empty stays a skip, or "always
  // throw on zero posts" would pass the case above and every empty install
  // would start reporting as broken.
  test('a genuinely empty site is still did-not-run, not a failure', async () => {
    const service = makeService(async () => ({
      posts: [],
      coverage: {
        pageSize: 200, pagesFetched: 1, rowsReturned: 0, complete: true,
        customFields: 'collected',
      },
    }));

    const outcome = await service.indexOneWpeContent('wpe-1');

    expect(outcome.ran).toBe(false);
    expect((outcome as any).reason).not.toMatch(/refused|failed/i);
  });

  /**
   * The other half of D12. `acfsupport` read six pages and indexed none of
   * them; the log knew that and the reason string said "No content returned
   * by the extractor", which implies nothing came back at all.
   */
  test('rows read but nothing indexable says so, with the count', async () => {
    const service = makeService(async () => ({
      posts: [],
      coverage: {
        pageSize: 200, pagesFetched: 1, rowsReturned: 6, complete: true,
        customFields: 'collected',
      },
    }));

    const outcome = await service.indexOneWpeContent('wpe-1');

    expect(outcome.ran).toBe(false);
    expect((outcome as any).reason).toContain('6');
    expect((outcome as any).reason).toMatch(/indexable/i);
  });

  // The third exit: a genuine error. `syncContent` catches it and must not
  // resolve indistinguishably from either of the two above.
  test('an extractor failure throws rather than resolving', async () => {
    const service = makeService(async () => { throw new Error('SSH connection refused'); });

    await expect(service.indexOneWpeContent('wpe-1')).rejects.toThrow('SSH connection refused');
  });
});

/**
 * Concurrency must stay BELOW WP Engine's cap, not sit on it.
 *
 * WPE allows five concurrent SSH connections per user, account-wide, shared
 * with the schedulers, agent runs and the CLI. At MAX_CONCURRENCY 5 a fleet
 * sweep consumed the whole account quota by itself, so anything else running
 * alongside was refused — and so was the sweep, if anything else got in first.
 *
 * The assertion is the invariant (headroom below 5), not the literal, so
 * tuning 3 down further stays green and tuning it back to the cap does not.
 */
describe('WP-68 — bulk concurrency leaves headroom under the WPE connection cap', () => {
  const WPE_CONNECTION_CAP = 5;

  test('never runs more sites at once than the cap allows room for', async () => {
    let inFlight = 0;
    let peak = 0;

    const { manager } = makeManager({
      contentPipeline: {
        indexSite: async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise(r => setTimeout(r, 15));
          inFlight--;
          return { errors: [] };
        },
      },
    });

    const ids = Array.from({ length: 12 }, (_, i) => `local${i}`);
    const id = manager.execute({ type: 'reindex', siteIds: ids, options: { autoStartStop: false } });
    await manager.waitForCompletion(id);

    expect(peak).toBeGreaterThan(1);              // still parallel, not serialised
    expect(peak).toBeLessThan(WPE_CONNECTION_CAP); // and not sitting on the cap
    expect(summarizeBulkOperation(manager.getStatus(id)!).succeeded).toBe(12);
  });
});

/**
 * Display names are resolved at the chokepoint, not trusted to callers.
 *
 * Seen live 2026-08-23: a bulk_reindex dispatched over MCP (ids only) rendered
 * five raw `wpe-<uuid>`s in the Operations panel — the D13 schema fix carries
 * names when a caller supplies them, but the MCP tool never did, and neither
 * does any caller that doesn't happen to hold Local's store. The graph is the
 * authority for remote names (WP-68); `execute()` fills the gaps itself so
 * every dispatcher — UI, IPC, MCP — shows names without each one re-learning
 * the lookup.
 */
describe('WP-68 — execute() resolves missing site names at the chokepoint', () => {
  test('wpe and local ids get names; a caller-supplied name is not overwritten', async () => {
    const { manager } = makeManager({
      siteDataBridge: {
        resolveSiteObject: (id: string) =>
          id === LOCAL_ID ? { id, name: 'jeremypollockblog', path: '/tmp/s', services: {} } : null,
        getSiteStatus: () => 'running',
        startSite: jest.fn(), stopSite: jest.fn(),
        wpCliRun: jest.fn(async () => ({ stdout: '', success: true })),
        getPlugins: jest.fn(async () => []), getThemes: jest.fn(async () => []),
        getWpVersion: jest.fn(async () => '6.5'), getOption: jest.fn(async () => null),
      },
      graphService: {
        upsertSite: jest.fn(), upsertPlugin: jest.fn(), deletePlugins: jest.fn(), updateSiteSettings: jest.fn(),
        getDb: () => ({
          prepare: (sql: string) => ({
            get: (id: string) => (id === WPE_ID && sql.includes('FROM sites') ? { name: 'dbrains' } : undefined),
          }),
        }),
      },
      wpeOps: { syncSingleSite: jest.fn(), indexOne: jest.fn(async () => ({ ran: true as const })) },
    });

    const id = manager.execute({
      type: 'reindex',
      siteIds: [LOCAL_ID, WPE_ID],
      siteNames: { [LOCAL_ID]: 'A Name The Caller Chose' },
    });
    await manager.waitForCompletion(id);
    const names = manager.getStatus(id)!.siteNames!;

    expect(names[LOCAL_ID]).toBe('A Name The Caller Chose'); // caller wins
    expect(names[WPE_ID]).toBe('dbrains');                    // graph fills the gap
  });

  test('an unresolvable id stays unnamed rather than failing the dispatch', async () => {
    const { manager } = makeManager({
      graphService: {
        upsertSite: jest.fn(), upsertPlugin: jest.fn(), deletePlugins: jest.fn(), updateSiteSettings: jest.fn(),
        getDb: () => { throw new Error('graph down'); },
      },
      wpeOps: { syncSingleSite: jest.fn(), indexOne: jest.fn(async () => ({ ran: true as const })) },
    });

    const id = manager.execute({ type: 'reindex', siteIds: [WPE_ID] });
    await manager.waitForCompletion(id);

    expect(manager.getStatus(id)!.siteResults[WPE_ID].status).toBe('completed');
  });
});
