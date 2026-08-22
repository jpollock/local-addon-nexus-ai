/**
 * Two remaining claims the product was making that were not true.
 *
 * 1. **D4** — `get_site_structure` answered `Site "x" not found` for a WP
 *    Engine install or external SSH host that IS registered and whose data is
 *    fine. The tool is Local-only at all three of its tiers; "not found" told
 *    the caller the site was gone.
 *
 * 2. **The auto-sync sentence.** The stale-data warning ended "or wait for the
 *    next auto-sync", unconditionally. `wpeSyncAutoEnabled` is opt-in and
 *    defaults FALSE (`src/common/types.ts:377`), so on a stock install nothing
 *    is scheduled and waiting never helps. Same defect class as naming an
 *    unregistered tool, one layer over: a remedy sentence is a claim, and this
 *    one was a claim about the reader's own settings.
 */
import { getSiteStructureHandler } from '../../../src/main/mcp/modules/site-context/get-site-structure';
import { staleSyncWarning } from '../../../src/main/mcp/modules/wpe/helpers';
import type { NexusServices } from '../../../src/main/mcp/types';

type GraphRow = { id: string; name: string; source: string; account_id: string | null };

function servicesWithGraph(rows: GraphRow[], localSites: Record<string, unknown> = {}): NexusServices {
  return {
    siteData: {
      getSite: (id: string) => (localSites as Record<string, { id: string }>)[id],
      getSites: () => localSites,
    },
    graphService: {
      getDb: () => ({
        prepare: (sql: string) => ({
          all: (...params: unknown[]) => {
            const wanted = String(params[0] ?? '');
            return sql.includes('LOWER(name)')
              ? rows.filter((r) => r.name.toLowerCase() === wanted.toLowerCase())
              : rows.filter((r) => r.name === wanted);
          },
        }),
      }),
    },
    indexRegistry: { get: () => undefined, listAll: () => [] },
    twinService: { get: () => null },
    fileScanner: { scan: async () => { throw new Error('should not be reached'); } },
  } as never as NexusServices;
}

describe('D4 — get_site_structure does not report a registered remote site as missing', () => {
  test('a WP Engine install is told the tool cannot reach it, not that it is absent', async () => {
    const services = servicesWithGraph([
      { id: 'wpe-1', name: 'cedarvalehealt', source: 'wpe', account_id: 'acc-1' },
    ]);

    const r = await getSiteStructureHandler.execute({ site: 'cedarvalehealt' }, services);

    expect(r.isError).toBe(true);
    const text = r.content[0].text;
    // The exact wrong answer, named.
    expect(text).not.toBe('Site "cedarvalehealt" not found');
    expect(text).not.toContain('not found');
    expect(text).toContain('WP Engine install');
    expect(text).toContain('registered and its data is fine');
    expect(text).toContain('nexus_get_site_twin');
  });

  test('an external SSH host is named as one — the reporter\'s actual reproduction', async () => {
    const services = servicesWithGraph([
      { id: 'ssh-1', name: 'piedmontdermgroup', source: 'external', account_id: 'hostinger' },
    ]);

    const r = await getSiteStructureHandler.execute({ site: 'piedmontdermgroup' }, services);

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('external SSH host');
    expect(r.content[0].text).not.toContain('not found');
  });

  test('a name in NEITHER store is still an honest "not found"', async () => {
    // The decline must not become a blanket excuse: a genuinely absent site
    // has to keep saying so, or the tool has traded one wrong answer for
    // another. This is the other direction of the same guard.
    const services = servicesWithGraph([]);

    const r = await getSiteStructureHandler.execute({ site: 'no-such-site' }, services);

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('Site "no-such-site" not found');
  });

  test('the description says Local-only, so an agent can avoid the call', () => {
    const d = getSiteStructureHandler.definition.description;
    expect(d).toContain('LOCAL SITES ONLY');
    expect(d).toContain('nexus_get_site_twin');
  });
});

describe('the stale-sync warning does not promise a schedule that is switched off', () => {
  const DAY = 24 * 3600 * 1000;

  function servicesWithSync(settings: Record<string, unknown> | null): NexusServices {
    return {
      graphService: {
        getDb: () => ({
          prepare: () => ({ get: () => ({ latest: Date.now() - 3 * DAY }) }),
        }),
      },
      registryStorage: { get: () => settings },
    } as never as NexusServices;
  }

  test('with auto-sync OFF (the default) it says so instead of saying "wait"', async () => {
    const w = await staleSyncWarning(servicesWithSync({ wpeSyncIntervalHours: 8 }));

    expect(w).toContain('wpe_sync_sites');
    expect(w).toContain('Automatic WPE sync is off');
    // The sentence that was false for every default install.
    expect(w).not.toContain('wait for the next');
  });

  test('with auto-sync ON it offers waiting, because then waiting works', async () => {
    const w = await staleSyncWarning(servicesWithSync({ wpeSyncIntervalHours: 8, wpeSyncAutoEnabled: true }));

    expect(w).toContain('wpe_sync_sites');
    expect(w).toContain('wait for the next scheduled sync');
    expect(w).not.toContain('Automatic WPE sync is off');
  });

  test('absent settings are treated as the default — off, not on', async () => {
    // `registryStorage.get` returning null is a fresh install, which is
    // exactly the population the false sentence was worst for.
    const w = await staleSyncWarning(servicesWithSync(null));

    expect(w).toContain('Automatic WPE sync is off');
  });

  test('fresh data still produces no warning at all', async () => {
    const services = {
      graphService: {
        getDb: () => ({ prepare: () => ({ get: () => ({ latest: Date.now() - 60_000 }) }) }),
      },
      registryStorage: { get: () => ({ wpeSyncIntervalHours: 8 }) },
    } as never as NexusServices;

    expect(await staleSyncWarning(services)).toBe('');
  });
});
