/**
 * The fleet-wide content search resolvers must not search soft-deleted sites.
 *
 * `nexus host remove` and WPE deactivation set `is_active = 0`; nothing hard
 * deletes until the retention sweep runs. `nexusContentSearchAll` and its
 * sibling `nexusFleetSearch` selected `WHERE source IN ('wpe','external')`
 * with no `is_active` clause, so a removed host's previously indexed content
 * stayed searchable through both.
 *
 * A fake db is used rather than a real GraphService so these do not depend on
 * better-sqlite3's native ABI. It executes the resolver's own SQL against an
 * in-memory row set with a tiny predicate evaluator, so the assertion is about
 * which rows come back, not about the query text.
 */

import { createResolvers } from '../../../src/main/graphql/resolvers';

type Row = { id: string; name: string; source: string; is_active: number };

const ROWS: Row[] = [
  { id: 'ssh:live-host', name: 'live-host', source: 'external', is_active: 1 },
  { id: 'ssh:removed-host', name: 'removed-host', source: 'external', is_active: 0 },
  { id: 'wpe-live', name: 'live-install', source: 'wpe', is_active: 1 },
  { id: 'wpe-gone', name: 'gone-install', source: 'wpe', is_active: 0 },
  { id: 'local-1', name: 'mysite', source: 'local', is_active: 1 },
];

/**
 * Minimal SQL evaluator covering exactly the shapes these two resolvers use:
 * a SELECT over `sites` filtered by `source IN (...)` and optionally
 * `is_active = 1`.
 */
function makeDb() {
  return {
    prepare: (sql: string) => ({
      all: () => {
        const sourcesMatch = sql.match(/source IN \(([^)]*)\)/);
        const sources = sourcesMatch
          ? sourcesMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
          : null;
        const requiresActive = /is_active\s*=\s*1/.test(sql);
        return ROWS.filter(
          (r) => (!sources || sources.includes(r.source)) && (!requiresActive || r.is_active === 1),
        );
      },
      get: () => undefined,
    }),
  };
}

function makeContext(searchAcrossSites: jest.Mock) {
  return {
    services: {
      graphService: { getDb: () => makeDb() },
      vectorStore: { searchAcrossSites },
      embeddingService: { embed: jest.fn().mockResolvedValue(new Array(384).fill(0)) },
      indexRegistry: { get: jest.fn(), listAll: jest.fn().mockReturnValue([]) },
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      siteData: { getSite: jest.fn().mockReturnValue(undefined), getSites: jest.fn().mockReturnValue({}) },
    },
    registry: {},
  } as any;
}

describe.each([
  ['nexusContentSearchAll'],
  ['nexusFleetSearch'],
])('%s — soft-deleted remote sites', (resolverName) => {
  it('does not search a removed external host or a deactivated WPE install', async () => {
    const searchAcrossSites = jest.fn().mockResolvedValue(new Map());
    const resolvers = createResolvers(makeContext(searchAcrossSites));

    await (resolvers.Mutation as any)[resolverName](null, { query: 'anything', limit: 5 });

    expect(searchAcrossSites).toHaveBeenCalled();
    const searchedIds: string[] = searchAcrossSites.mock.calls[0][0];

    // vectorSiteId() rewrites `ssh:alias` -> `ssh_alias` at the vector-store
    // boundary, so assert against the translated form.
    expect(searchedIds).toContain('ssh_live-host');
    expect(searchedIds).toContain('wpe-live');
    expect(searchedIds).not.toContain('ssh_removed-host');
    expect(searchedIds).not.toContain('ssh:removed-host');
    expect(searchedIds).not.toContain('wpe-gone');
  });
});
