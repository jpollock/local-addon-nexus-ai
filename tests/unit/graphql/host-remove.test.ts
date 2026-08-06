/**
 * `nexusHostRemove` / `nexusHostRemoveSite` (Task 9).
 *
 * A connection alias can have zero, one, or many sites registered under it
 * (Task 8). `nexusHostRemove` forgets the whole connection and must cascade
 * to deactivate every site under it — before this task it deactivated a
 * single `ssh:<alias>` row, which is no longer a real site id under the
 * per-site model, so removing a connection left every site under it still
 * active. `nexusHostRemoveSite` is the new scoped-down command: forget one
 * site, leave the connection and its siblings registered.
 *
 * Follows the fixture/mocking conventions of host-add.test.ts: a fake `db`
 * that mirrors the two shapes `findExternalSites` prepares (scoped-by-site
 * and connection-wide) over the same `upserted` array, and `upsertSite`
 * upserts by id (replace-in-place) so a later query sees prior writes.
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
        graphService: {
          upsertSite: async (s: any) => {
            const idx = upserted.findIndex((r) => r.id === s.id);
            if (idx >= 0) upserted[idx] = { ...upserted[idx], ...s };
            else upserted.push(s);
          },
          getDb: () => db,
        },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      },
      registry: {},
    } as any,
  };
}

const profiles = (store: Record<string, any>) => store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] ?? {};

/** Seed two active site rows under `alias`, plus a registered connection profile. */
function seedTwoSites(c: ReturnType<typeof ctx>, alias: string, siteA: string, siteB: string) {
  c.store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] = {
    [alias]: { alias, wpCliPath: '/usr/local/bin/wp', firstSeenAt: 1, lastSeenAt: 1 },
  };
  c.upserted.push(
    {
      id: `ssh:${alias}/${siteA}`, name: siteA, domain: `${siteA}.example.com`,
      source: 'external', host: 'external', account_id: alias, environment: 'production',
      is_active: true, created_at: 1, updated_at: 1,
    },
    {
      id: `ssh:${alias}/${siteB}`, name: siteB, domain: `${siteB}.example.com`,
      source: 'external', host: 'external', account_id: alias, environment: 'production',
      is_active: true, created_at: 1, updated_at: 1,
    },
  );
}

describe('nexusHostRemove — cascades to every site under the connection', () => {
  it('removing a connection deactivates every site with that account_id', async () => {
    const c = ctx();
    seedTwoSites(c, 'hostinger-test', 'site-a', 'site-b');

    const result = await (createResolvers(c.context).Mutation as any).nexusHostRemove(
      null, { alias: 'hostinger-test' },
    );

    expect(result.removed).toBe(true);
    expect(profiles(c.store)).toEqual({});

    const rows = c.upserted.filter((s) => s.account_id === 'hostinger-test');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.is_active).toBe(false);
    }
  });

  it('reports removed:false for an unknown alias and deactivates nothing', async () => {
    const c = ctx();
    const result = await (createResolvers(c.context).Mutation as any).nexusHostRemove(
      null, { alias: 'nope' },
    );
    expect(result.removed).toBe(false);
    expect(c.upserted).toHaveLength(0);
  });
});

describe('nexusHostRemoveSite — removes one site, leaves siblings', () => {
  it('deactivates exactly the named site', async () => {
    const c = ctx();
    seedTwoSites(c, 'hostinger-test', 'site-a', 'site-b');

    const result = await (createResolvers(c.context).Mutation as any).nexusHostRemoveSite(
      null, { alias: 'hostinger-test', site: 'site-a' },
    );

    expect(result.removed).toBe(true);
    const siteA = c.upserted.find((s) => s.id === 'ssh:hostinger-test/site-a');
    const siteB = c.upserted.find((s) => s.id === 'ssh:hostinger-test/site-b');
    expect(siteA.is_active).toBe(false);
    expect(siteB.is_active).toBe(true);

    // The connection itself is untouched — still registered.
    expect(profiles(c.store)['hostinger-test']).toBeDefined();
  });

  it('reports not-removed for a site that does not exist under the connection', async () => {
    const c = ctx();
    seedTwoSites(c, 'hostinger-test', 'site-a', 'site-b');

    const result = await (createResolvers(c.context).Mutation as any).nexusHostRemoveSite(
      null, { alias: 'hostinger-test', site: 'nonexistent' },
    );

    expect(result.removed).toBe(false);
    // Neither existing site was touched.
    const siteA = c.upserted.find((s) => s.id === 'ssh:hostinger-test/site-a');
    const siteB = c.upserted.find((s) => s.id === 'ssh:hostinger-test/site-b');
    expect(siteA.is_active).toBe(true);
    expect(siteB.is_active).toBe(true);
  });
});
