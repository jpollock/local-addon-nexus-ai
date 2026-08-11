import { sweepOrphanedLocalRows, FleetCountsDeps } from '../../../src/main/fleet/collectFleetCounts';

/**
 * Minimal fake matching the subset of better-sqlite3's Database that
 * sweepOrphanedLocalRows actually uses:
 *   SELECT id FROM sites WHERE source = 'local' AND is_active = 1
 *   UPDATE sites SET is_active = 0, updated_at = ? WHERE id = ?
 * Routes by the SQL verb rather than trying to be a real SQL engine.
 */
function makeFakeDb(activeLocalRowIds: string[]) {
  const selectRows = activeLocalRowIds.map((id) => ({ id }));
  const deactivated: string[] = [];

  const db = {
    prepare: (sql: string) => {
      if (sql.trim().startsWith('SELECT')) {
        return {
          all: () => selectRows,
          run: () => {
            throw new Error(`unexpected run() on a SELECT statement: ${sql}`);
          },
        };
      }
      if (sql.trim().startsWith('UPDATE')) {
        return {
          all: () => {
            throw new Error(`unexpected all() on an UPDATE statement: ${sql}`);
          },
          run: (...args: unknown[]) => {
            deactivated.push(String(args[1]));
            return { changes: 1 };
          },
        };
      }
      throw new Error(`fake db does not know how to handle SQL: ${sql}`);
    },
  };

  return { db, deactivated };
}

describe('sweepOrphanedLocalRows — circuit breaker', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('the breaker fires: an empty local store with active graph rows sweeps nothing', () => {
    const { db, deactivated } = makeFakeDb(['sentinel-1', 'sentinel-2']);
    const deps: FleetCountsDeps = {
      getSites: () => ({}),
      getDb: () => db as never,
    };

    const swept = sweepOrphanedLocalRows(deps);

    expect(swept).toBe(0);
    expect(deactivated).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain('0 sites');
    expect(message).toContain('2 active local row');
  });

  test('the breaker does not over-fire: a non-empty store still sweeps genuine orphans', () => {
    const { db, deactivated } = makeFakeDb(['live-site', 'dead-sentinel-1', 'dead-sentinel-2']);
    const deps: FleetCountsDeps = {
      getSites: () => ({ 'live-site': {} }),
      getDb: () => db as never,
    };

    const swept = sweepOrphanedLocalRows(deps);

    expect(swept).toBe(2);
    expect(deactivated.sort()).toEqual(['dead-sentinel-1', 'dead-sentinel-2']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('an empty store with an empty graph is not a breaker case — nothing to refuse', () => {
    const { db, deactivated } = makeFakeDb([]);
    const deps: FleetCountsDeps = {
      getSites: () => ({}),
      getDb: () => db as never,
    };

    expect(sweepOrphanedLocalRows(deps)).toBe(0);
    expect(deactivated).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
