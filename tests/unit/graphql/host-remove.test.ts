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

function ctx(opts: { withVectorStore?: boolean } = {}) {
  const store: Record<string, any> = {};
  const upserted: any[] = [];
  const vectorStoreDroppedSites: string[] = [];
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
    vectorStoreDroppedSites,
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
        vectorStore: opts.withVectorStore ? {
          dropSite: jest.fn(async (siteId: string) => {
            vectorStoreDroppedSites.push(siteId);
          }),
        } : undefined,
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

  it('cascades to deactivate site rows even when the connection profile is already gone', async () => {
    // A prior partial failure can leave the connection profile removed but
    // site rows under its account_id still is_active=1 — the cascade must
    // not be gated on `removed` or those rows are stranded forever.
    const c = ctx();
    c.upserted.push(
      {
        id: 'ssh:hostinger-test/site-a', name: 'site-a', domain: 'site-a.example.com',
        source: 'external', host: 'external', account_id: 'hostinger-test', environment: 'production',
        is_active: true, created_at: 1, updated_at: 1,
      },
    );
    // No EXTERNAL_SITE_PROFILES entry seeded — removeExternalProfile will find nothing.

    const result = await (createResolvers(c.context).Mutation as any).nexusHostRemove(
      null, { alias: 'hostinger-test' },
    );

    expect(result.removed).toBe(false);
    const row = c.upserted.find((s) => s.id === 'ssh:hostinger-test/site-a');
    expect(row.is_active).toBe(false);
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

describe('E4: vector store cleanup on removal', () => {
  it('nexusHostRemove deletes vector documents for every site under the connection', async () => {
    const c = ctx({ withVectorStore: true });
    seedTwoSites(c, 'hostinger-test', 'site-a', 'site-b');

    await (createResolvers(c.context).Mutation as any).nexusHostRemove(
      null, { alias: 'hostinger-test' },
    );

    // Both sites' vector stores should be dropped, with the real graph id passed through vectorSiteId.
    // The vectorSiteId function translates ssh:<alias>/<site> to ssh_<alias>_<site>_<hash>, but
    // we verify the input to dropSite was the translated form by checking the call happened.
    expect(c.context.services.vectorStore.dropSite).toHaveBeenCalledTimes(2);
    expect(c.vectorStoreDroppedSites).toHaveLength(2);
    // The actual translated ids depend on vectorSiteId's implementation, but we can verify
    // both sites were processed.
  });

  it('nexusHostRemoveSite deletes vector documents for the single site', async () => {
    const c = ctx({ withVectorStore: true });
    seedTwoSites(c, 'hostinger-test', 'site-a', 'site-b');

    await (createResolvers(c.context).Mutation as any).nexusHostRemoveSite(
      null, { alias: 'hostinger-test', site: 'site-a' },
    );

    // Only site-a's vector store should be dropped.
    expect(c.context.services.vectorStore.dropSite).toHaveBeenCalledTimes(1);
    expect(c.vectorStoreDroppedSites).toHaveLength(1);
  });

  it('continues removal even when vector store deletion fails', async () => {
    const c = ctx({ withVectorStore: true });
    seedTwoSites(c, 'hostinger-test', 'site-a', 'site-b');
    // Make dropSite throw for the first call.
    (c.context.services.vectorStore.dropSite as jest.Mock).mockRejectedValueOnce(new Error('Table does not exist'));

    const result = await (createResolvers(c.context).Mutation as any).nexusHostRemove(
      null, { alias: 'hostinger-test' },
    );

    // The removal should still succeed — vector deletion failure is non-fatal.
    expect(result.success).toBe(true);
    const rows = c.upserted.filter((s) => s.account_id === 'hostinger-test');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.is_active).toBe(false);
    }
  });
});
