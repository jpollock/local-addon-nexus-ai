/**
 * `wpe_sync_sites` — the tool the product spent eight error messages naming.
 *
 * The cases below are organised around the two complaints those messages
 * actually made (see `sync-remedy.ts`), because the failure this packet is
 * guarding against is not "the tool errors" — it is "the tool exists, resolves,
 * succeeds, and does not fix what the message said it would."
 */
import { syncSitesHandler } from '../../../src/main/mcp/modules/wpe/sync-sites';
import { WPE_SYNC_TOOL } from '../../../src/main/mcp/modules/wpe/sync-remedy';
import type { NexusServices } from '../../../src/main/mcp/types';

type Row = { id: string; name: string; remote_install_id: string | null; account_id: string | null };

interface Harness {
  services: NexusServices;
  sync: {
    syncAllWPESites: jest.Mock;
    syncSingleSite: jest.Mock;
    indexAllWpeContent: jest.Mock;
    indexOneWpeContent: jest.Mock;
  };
  capiGetInstalls: jest.Mock;
}

function makeHarness(opts: {
  rows?: Row[];
  withService?: boolean;
  capiAvailable?: boolean;
  capiInstalls?: Array<{ id: string; name: string }>;
  syncAllResult?: unknown;
  indexAllResult?: { indexed: number; errors: number };
} = {}): Harness {
  const {
    rows = [],
    withService = true,
    capiAvailable = true,
    capiInstalls = [],
    syncAllResult = { success: true, synced: 3, skipped: 1, failed: 0, errors: [] },
    indexAllResult = { indexed: 2, errors: 0 },
  } = opts;

  const sync = {
    syncAllWPESites: jest.fn(async () => syncAllResult),
    syncSingleSite: jest.fn(async () => undefined),
    indexAllWpeContent: jest.fn(async () => indexAllResult),
    indexOneWpeContent: jest.fn(async () => undefined),
  };

  const capiGetInstalls = jest.fn(async () => capiInstalls);

  const services = {
    graphService: {
      getDb: () => ({
        prepare: (_sql: string) => ({
          all: (name: string) => rows.filter((r) => r.name === name),
        }),
      }),
    },
    localServices: {
      isCAPIAvailable: () => capiAvailable,
      capiGetInstalls,
    },
    wpeSyncService: withService ? sync : undefined,
  } as never as NexusServices;

  return { services, sync, capiGetInstalls };
}

const ROW_A: Row = { id: 'wpe-uuid-a', name: 'alpha-prod', remote_install_id: 'inst-a', account_id: 'acc-1' };

function textOf(r: { content: Array<{ text: string }> }): string {
  return r.content[0].text;
}

describe('wpe_sync_sites — definition', () => {
  test('is registered under the name the remedy strings use', () => {
    expect(syncSitesHandler.definition.name).toBe(WPE_SYNC_TOOL);
  });

  test('is unavailable without the sync service, and available with it', () => {
    const { definition } = syncSitesHandler;
    expect(definition.isAvailable!(makeHarness({ withService: false }).services)).toBe(false);
    expect(definition.isAvailable!(makeHarness().services)).toBe(true);
  });
});

describe('wpe_sync_sites — metadata mode (the six messages about missing or stale rows)', () => {
  test('fleet-wide with no arguments, and reports skipped as well as synced', async () => {
    const h = makeHarness();
    const r = await syncSitesHandler.execute({}, h.services);

    expect(h.sync.syncAllWPESites).toHaveBeenCalledTimes(1);
    expect(h.sync.indexAllWpeContent).not.toHaveBeenCalled();
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toContain('3 synced');
    expect(textOf(r)).toContain('1 already fresh');
  });

  test('an all-skipped run explains itself rather than reading as a failure', async () => {
    // 0 synced is the normal result of running this twice, and "0 synced" on
    // its own reads as a broken tool to an agent that just followed a remedy.
    const h = makeHarness({ syncAllResult: { success: true, synced: 0, skipped: 12, failed: 0, errors: [] } });
    const r = await syncSitesHandler.execute({}, h.services);

    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toContain('Nothing was out of date');
    expect(textOf(r)).toContain('install_name');
  });

  test('a failed fleet sync surfaces the first real error, not a generic one', async () => {
    const h = makeHarness({
      syncAllResult: {
        success: false, synced: 0, skipped: 0, failed: 0,
        errors: [{ installId: 'sync', error: 'WP Engine API (CAPI) not available. Authenticate with WP Engine first.' }],
      },
    });
    const r = await syncSitesHandler.execute({}, h.services);

    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('Authenticate with WP Engine');
  });

  test('one install uses the graph row\'s CAPI id — not its name', async () => {
    // syncSingleSite takes an install id. Passing the name would 404 against
    // CAPI while the tool reported success at this layer.
    const h = makeHarness({ rows: [ROW_A] });
    const r = await syncSitesHandler.execute({ install_name: 'alpha-prod' }, h.services);

    expect(h.sync.syncSingleSite).toHaveBeenCalledWith('inst-a');
    expect(h.sync.syncAllWPESites).not.toHaveBeenCalled();
    expect(textOf(r)).toContain('alpha-prod');
  });

  test('an install absent from the graph is looked up through CAPI — the case six messages are written for', async () => {
    // This is the whole point of the metadata mode: "no WP Engine installs
    // found in graph" is not fixable from the graph.
    const h = makeHarness({ rows: [], capiInstalls: [{ id: 'inst-new', name: 'brand-new' }] });
    const r = await syncSitesHandler.execute({ install_name: 'brand-new' }, h.services);

    expect(h.capiGetInstalls).toHaveBeenCalled();
    expect(h.sync.syncSingleSite).toHaveBeenCalledWith('inst-new');
    expect(r.isError).toBeUndefined();
  });

  test('an install absent from the graph with no CAPI names wpe_login rather than "not found"', async () => {
    const h = makeHarness({ rows: [], capiAvailable: false });
    const r = await syncSitesHandler.execute({ install_name: 'brand-new' }, h.services);

    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('wpe_login');
    expect(h.sync.syncSingleSite).not.toHaveBeenCalled();
  });

  test('an install CAPI has never heard of says so, and syncs nothing', async () => {
    const h = makeHarness({ rows: [], capiInstalls: [{ id: 'inst-x', name: 'something-else' }] });
    const r = await syncSitesHandler.execute({ install_name: 'ghost' }, h.services);

    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('ghost');
    expect(h.sync.syncSingleSite).not.toHaveBeenCalled();
  });

  test('a name matching two installs DECLINES rather than syncing an arbitrary one', async () => {
    // CLAUDE.md, "Names collide across sources" / WP-58: an unordered pick is
    // a coin toss, and here the coin decides which production install gets an
    // SSH sweep run against it.
    const h = makeHarness({
      rows: [
        ROW_A,
        { id: 'wpe-uuid-b', name: 'alpha-prod', remote_install_id: 'inst-b', account_id: 'acc-2' },
      ],
    });
    const r = await syncSitesHandler.execute({ install_name: 'alpha-prod' }, h.services);

    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('matches 2 WP Engine installs');
    expect(textOf(r)).toContain('acc-1');
    expect(textOf(r)).toContain('acc-2');
    expect(h.sync.syncSingleSite).not.toHaveBeenCalled();
    expect(h.sync.syncAllWPESites).not.toHaveBeenCalled();
  });

  test('a thrown sync is reported as an error, not swallowed into a success line', async () => {
    const h = makeHarness({ rows: [ROW_A] });
    h.sync.syncSingleSite.mockRejectedValueOnce(new Error('ssh: connect to host failed'));
    const r = await syncSitesHandler.execute({ install_name: 'alpha-prod' }, h.services);

    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('ssh: connect to host failed');
  });
});

describe('wpe_sync_sites — content mode (the two messages about the search index)', () => {
  test('content: true fleet-wide indexes content, and does NOT take the metadata path', async () => {
    const h = makeHarness();
    const r = await syncSitesHandler.execute({ content: true }, h.services);

    expect(h.sync.indexAllWpeContent).toHaveBeenCalledTimes(1);
    expect(h.sync.syncAllWPESites).not.toHaveBeenCalled();
    expect(textOf(r)).toContain('2 install(s) indexed');
  });

  test('content: true for one install indexes exactly that install, by graph id AND name', async () => {
    const h = makeHarness({ rows: [ROW_A] });
    await syncSitesHandler.execute({ install_name: 'alpha-prod', content: true }, h.services);

    expect(h.sync.indexOneWpeContent).toHaveBeenCalledWith('wpe-uuid-a', 'alpha-prod');
    expect(h.sync.indexAllWpeContent).not.toHaveBeenCalled();
  });

  test('content: true for an install not in the graph points at the metadata mode first', async () => {
    // indexOneWpeContent needs a graph site id. Failing with "not found" here
    // would send the reader back to the tool that cannot help them.
    const h = makeHarness({ rows: [] });
    const r = await syncSitesHandler.execute({ install_name: 'brand-new', content: true }, h.services);

    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('not in the graph');
    expect(textOf(r)).toContain('without content: true');
    expect(h.sync.indexOneWpeContent).not.toHaveBeenCalled();
  });

  test('a zero/zero fleet index names both reachable causes instead of reporting success', async () => {
    // indexAllWpeContent returns {0,0} for "no installs" AND for "no SSH key /
    // no embedding service" — it warns to the log and returns. A bare success
    // line here is the silent-failure shape.
    const h = makeHarness({ indexAllResult: { indexed: 0, errors: 0 } });
    const r = await syncSitesHandler.execute({ content: true }, h.services);

    expect(textOf(r)).toContain('no active WP Engine installs');
    expect(textOf(r)).toContain('embedding service');
  });

  test('per-install failures are counted in the summary, not hidden', async () => {
    const h = makeHarness({ indexAllResult: { indexed: 5, errors: 2 } });
    const r = await syncSitesHandler.execute({ content: true }, h.services);

    expect(textOf(r)).toContain('5 install(s) indexed');
    expect(textOf(r)).toContain('2 failed');
  });
});

describe('wpe_sync_sites — the service itself missing', () => {
  test('says so rather than throwing into the chokepoint', async () => {
    const h = makeHarness({ withService: false });
    const r = await syncSitesHandler.execute({}, h.services);

    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('sync service is not available');
  });
});
