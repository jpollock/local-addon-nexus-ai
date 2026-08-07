/**
 * `nexusHostList`'s connection→sites shape (Task 12).
 *
 * A connection alias is not a site — it can register zero, one, or many
 * sites under it (Task 3's `findExternalSites`). `nexusHostList` used to
 * return the flat `NexusHostEntry` (`wpPath`/`environment`) that described a
 * single site, which stopped making sense once a connection could hold more
 * than one. It now nests every site registered under each connection.
 */

import { createResolvers } from '../../../src/main/graphql/resolvers';
import { STORAGE_KEYS } from '../../../src/common/constants';

function ctx() {
  const store: Record<string, any> = {};
  const upserted: any[] = [];
  const db = {
    prepare: (sql: string) => ({
      all: (...args: any[]) => {
        if (sql.includes('account_id=? AND name=?')) {
          const [aliasArg, siteArg] = args;
          return upserted.filter((s) => s.is_active !== false && s.account_id === aliasArg && s.name === siteArg);
        }
        const [aliasArg] = args;
        return upserted.filter((s) => s.is_active !== false && s.account_id === aliasArg);
      },
    }),
  };
  return {
    upserted,
    store,
    db,
    context: {
      services: {
        registryStorage: {
          get: (k: string) => store[k],
          set: (k: string, v: unknown) => { store[k] = v; },
        },
        graphService: { getDb: () => db },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      },
      registry: {},
    } as any,
  };
}

function registerConnection(c: ReturnType<typeof ctx>, alias: string, wpCliPath: string | null = null) {
  c.store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] = {
    ...(c.store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] ?? {}),
    [alias]: { alias, wpCliPath, firstSeenAt: 1, lastSeenAt: 2 },
  };
}

function seedSite(c: ReturnType<typeof ctx>, alias: string, name: string, extra: Record<string, unknown> = {}) {
  c.upserted.push({
    id: `ssh:${alias}/${name}`, name, domain: `${name}.example.com`,
    source: 'external', host: 'external', account_id: alias, environment: 'production',
    is_active: true, created_at: 1, updated_at: 1, ...extra,
  });
}

describe('nexusHostList — sites nested under their connection', () => {
  it('lists every site under each connection', async () => {
    const c = ctx();
    registerConnection(c, 'hostinger-test');
    seedSite(c, 'hostinger-test', 'site-a');
    seedSite(c, 'hostinger-test', 'site-b');

    const result = await (createResolvers(c.context).Mutation as any).nexusHostList();

    expect(result.success).toBe(true);
    const host = result.hosts.find((h: any) => h.alias === 'hostinger-test');
    expect(host.sites).toHaveLength(2);
    expect(host.sites.map((s: any) => s.name).sort()).toEqual(['site-a', 'site-b']);
  });

  it('a connection with zero sites still appears, with an empty sites array', async () => {
    const c = ctx();
    registerConnection(c, 'empty-conn');

    const result = await (createResolvers(c.context).Mutation as any).nexusHostList();

    const host = result.hosts.find((h: any) => h.alias === 'empty-conn');
    expect(host).toBeDefined();
    expect(host.sites).toEqual([]);
  });

  it('reports name/domain/environment/wpVersion for each nested site', async () => {
    const c = ctx();
    registerConnection(c, 'hostinger-test', '/usr/local/bin/wp');
    seedSite(c, 'hostinger-test', 'site-a', { wp_version: '6.8.1' });

    const result = await (createResolvers(c.context).Mutation as any).nexusHostList();

    const host = result.hosts.find((h: any) => h.alias === 'hostinger-test');
    expect(host.wpCliPath).toBe('/usr/local/bin/wp');
    expect(host.sites[0]).toMatchObject({
      name: 'site-a',
      domain: 'site-a.example.com',
      environment: 'production',
      wpVersion: '6.8.1',
    });
  });

  it('does not throw when the graph database is unavailable', async () => {
    const c = ctx();
    registerConnection(c, 'hostinger-test');
    (c.context.services.graphService as any).getDb = () => undefined;

    const result = await (createResolvers(c.context).Mutation as any).nexusHostList();

    expect(result.success).toBe(true);
    const host = result.hosts.find((h: any) => h.alias === 'hostinger-test');
    expect(host.sites).toEqual([]);
  });
});
