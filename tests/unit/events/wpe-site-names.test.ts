/**
 * D21 — WPE properties (CAPI Sites) get their portal display name persisted.
 *
 * Installs carry only the Site UUID (`sites.wpe_site_id`); the display name
 * lives only on the CAPI Site object, and until this landed nothing stored it
 * anywhere — the fleet collapse's core unit had no name. The derivation
 * heuristic is not an option: real property 009f590e… groups
 * `b68c7f0b6038, wootestingsstg, wootestingsdev`, whose production install's
 * name is a hex blob.
 *
 * Rules under test, all from the register entry:
 *  - name is stored as given, NULL when CAPI omits it — never fabricated
 *  - a later partial payload must not erase a name already held
 *  - pruning is gated on a non-empty successful fetch (the
 *    reconcileMissingInstalls rule: a CAPI fault must never empty the table)
 *  - the fetch is non-fatal to the sweep that carries it
 */
import { GraphService } from '../../../src/main/events/GraphService';
import { WPESyncService } from '../../../src/main/events/WPESyncService';

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

async function makeGraph(): Promise<GraphService> {
  const g = new GraphService(':memory:', silent);
  await g.initialize();
  return g;
}

describe('GraphService.wpe_sites — schema and write rules', () => {
  test('a fresh database has the table, empty', async () => {
    const g = await makeGraph();
    expect(await g.getWpeSites()).toEqual([]);
  });

  test('upsert stores id, name and account; a missing name is NULL, never the id', async () => {
    const g = await makeGraph();
    await g.upsertWpeSite({ id: 's-1', name: 'Alpine Outfitters', account_id: 'a-1' });
    await g.upsertWpeSite({ id: 's-2', account_id: 'a-1' }); // no name in the payload

    const rows = await g.getWpeSites();
    expect(rows.find((r) => r.id === 's-1')).toEqual({ id: 's-1', name: 'Alpine Outfitters', account_id: 'a-1' });
    expect(rows.find((r) => r.id === 's-2')).toEqual({ id: 's-2', name: null, account_id: 'a-1' });
  });

  test('a later NULL does not erase a name already held; a later name replaces it', async () => {
    const g = await makeGraph();
    await g.upsertWpeSite({ id: 's-1', name: 'Alpine Outfitters', account_id: 'a-1' });

    await g.upsertWpeSite({ id: 's-1', name: null }); // partial payload
    expect((await g.getWpeSites())[0]).toMatchObject({ name: 'Alpine Outfitters', account_id: 'a-1' });

    await g.upsertWpeSite({ id: 's-1', name: 'Alpine Outfitters Renamed' });
    expect((await g.getWpeSites())[0]).toMatchObject({ name: 'Alpine Outfitters Renamed' });
  });

  test('prune removes rows not in the keep list and reports the count', async () => {
    const g = await makeGraph();
    await g.upsertWpeSite({ id: 's-1', name: 'Keep' });
    await g.upsertWpeSite({ id: 's-2', name: 'Gone' });

    expect(g.pruneWpeSites(['s-1'])).toBe(1);
    expect((await g.getWpeSites()).map((r) => r.id)).toEqual(['s-1']);
  });

  test('prune with an empty keep list is a refusal, not a table wipe', async () => {
    const g = await makeGraph();
    await g.upsertWpeSite({ id: 's-1', name: 'Keep' });

    expect(g.pruneWpeSites([])).toBe(0);
    expect(await g.getWpeSites()).toHaveLength(1);
  });
});

/**
 * The sweep-level behaviour: syncAllWPESites carries the fetch. Installs are
 * empty so the per-install machinery is idle; the assertions are about what
 * reached (or survived in) wpe_sites.
 */
function makeService(graph: GraphService, capiGetSites: () => Promise<unknown>) {
  const localServices = {
    isCAPIAvailable: () => true,
    capiGetInstalls: async () => [],
    capiGetAccounts: async () => [],
    capiGetSites,
  } as never;
  return new WPESyncService({ graphService: graph, localServices, logger: silent } as never);
}

describe('syncAllWPESites — the D21 site-name fetch', () => {
  test('stores every listed Site; a Site with no name stores NULL', async () => {
    const g = await makeGraph();
    const svc = makeService(g, async () => [
      { id: 's-1', name: 'Alpine Outfitters', account: { id: 'a-1' } },
      { id: 's-2', account: { id: 'a-1' } },
      { name: 'no id — skipped' },
    ]);

    await svc.syncAllWPESites();

    const rows = await g.getWpeSites();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === 's-1')?.name).toBe('Alpine Outfitters');
    expect(rows.find((r) => r.id === 's-2')?.name).toBeNull();
  });

  test('accepts the {results: [...]} envelope shape', async () => {
    const g = await makeGraph();
    const svc = makeService(g, async () => ({ results: [{ id: 's-1', name: 'Enveloped' }] }));

    await svc.syncAllWPESites();

    expect((await g.getWpeSites())[0]).toMatchObject({ id: 's-1', name: 'Enveloped' });
  });

  test('a Site CAPI no longer lists is pruned on the next sweep', async () => {
    const g = await makeGraph();
    await makeService(g, async () => [
      { id: 's-1', name: 'Stays' }, { id: 's-2', name: 'Deleted in portal' },
    ]).syncAllWPESites();

    await makeService(g, async () => [{ id: 's-1', name: 'Stays' }]).syncAllWPESites();

    expect((await g.getWpeSites()).map((r) => r.id)).toEqual(['s-1']);
  });

  test('a failed fetch keeps every existing row and does not fail the sweep', async () => {
    const g = await makeGraph();
    await makeService(g, async () => [{ id: 's-1', name: 'Held' }]).syncAllWPESites();

    const result = await makeService(g, async () => { throw new Error('CAPI 502'); }).syncAllWPESites();

    expect(result.success).toBe(true);
    expect((await g.getWpeSites())[0]).toMatchObject({ id: 's-1', name: 'Held' });
  });

  test('an empty fetch stores nothing and prunes nothing', async () => {
    const g = await makeGraph();
    await makeService(g, async () => [{ id: 's-1', name: 'Held' }]).syncAllWPESites();

    await makeService(g, async () => []).syncAllWPESites();

    expect((await g.getWpeSites())).toHaveLength(1);
  });
});
