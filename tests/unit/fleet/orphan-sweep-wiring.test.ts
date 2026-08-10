import { runOrphanSweep, OrphanSweepDeps } from '../../../src/main/fleet/collectFleetCounts';

/**
 * Covers the startup wiring `src/main/index.ts` uses at addon boot: real
 * `siteDataAccessor`/`graphService` cannot be constructed in a unit test (that
 * needs `@getflywheel/local/main`, Electron and a live service container), so
 * this stubs the same shape the real call site passes — `getSites`, `getDb`,
 * `logger` — and asserts the two properties that matter for a startup task
 * that can deactivate graph rows: it calls through with the right arguments,
 * and a thrown error is swallowed rather than ever reaching the caller.
 */
describe('runOrphanSweep — startup wiring', () => {
  test('sweeps through to the db and logs a count when rows are deactivated', () => {
    const deactivated: string[] = [];
    const selectRows = [{ id: 'live' }, { id: 'dead-sentinel' }];
    const db = {
      prepare: (sql: string) => {
        if (sql.trim().startsWith('SELECT')) {
          return { all: () => selectRows, run: () => { throw new Error('unexpected run on SELECT'); } };
        }
        return {
          all: () => { throw new Error('unexpected all on UPDATE'); },
          run: (...args: unknown[]) => {
            deactivated.push(String(args[1]));
            return { changes: 1 };
          },
        };
      },
    };

    const info = jest.fn();
    const warn = jest.fn();
    const deps: OrphanSweepDeps = {
      getSites: () => ({ live: {} }),
      getDb: () => db as never,
      logger: { info, warn },
    };

    expect(() => runOrphanSweep(deps)).not.toThrow();

    expect(deactivated).toEqual(['dead-sentinel']);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toContain('Deactivated 1 graph rows');
    expect(warn).not.toHaveBeenCalled();
  });

  test('logs nothing when there is nothing to sweep', () => {
    const info = jest.fn();
    const warn = jest.fn();
    const deps: OrphanSweepDeps = {
      getSites: () => ({ live: {} }),
      getDb: () => ({ prepare: () => ({ all: () => [], run: () => ({ changes: 0 }) }) }) as never,
      logger: { info, warn },
    };

    runOrphanSweep(deps);

    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test('a thrown error is swallowed, not propagated, and is logged as a warning', () => {
    const info = jest.fn();
    const warn = jest.fn();
    const deps: OrphanSweepDeps = {
      getSites: () => ({ live: {} }),
      getDb: () => {
        throw new Error('graph handle exploded');
      },
      logger: { info, warn },
    };

    // The call site relies on this never throwing — a sweep failure must not
    // be able to block the rest of addon startup.
    expect(() => runOrphanSweep(deps)).not.toThrow();

    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('[NexusAI] Local row reconciliation failed:');
    expect(warn.mock.calls[0][1]).toBe('graph handle exploded');
  });

  test('a throwing getSites is also swallowed', () => {
    const info = jest.fn();
    const warn = jest.fn();
    const deps: OrphanSweepDeps = {
      getSites: () => {
        throw new Error('site store unavailable');
      },
      getDb: () => ({ prepare: () => ({ all: () => [{ id: 'x' }], run: () => ({ changes: 0 }) }) }) as never,
      logger: { info, warn },
    };

    expect(() => runOrphanSweep(deps)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe('site store unavailable');
  });
});
