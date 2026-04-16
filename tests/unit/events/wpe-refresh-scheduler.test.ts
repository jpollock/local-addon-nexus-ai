/**
 * Tests for WpeRefreshScheduler — Phase 5
 *
 * Background cron that runs SSH WP-CLI scans on WPE installs whose digital
 * twin SSH data (plugins, themes, scalar fields) is stale (older than
 * stalenessThresholdMs, default 24h) or has never been synced via SSH.
 */
import { WpeRefreshScheduler } from '../../../src/main/startup/WpeRefreshScheduler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

type SiteRow = {
  id: string;
  name: string;
  remote_install_id: string;
  last_sync_at: number | null;
};

/**
 * Build a minimal mock GraphService.
 * `sites` is the list of rows returned by the WPE sites query.
 */
function makeGraphService(
  sites: SiteRow[] = [],
  opts: { dbAvailable?: boolean } = {}
): any {
  const dbAvailable = opts.dbAvailable ?? true;

  // Minimal in-memory db mock
  const db = dbAvailable
    ? {
        prepare: jest.fn((sql: string) => ({
          get: jest.fn((..._args: any[]) => {
            // pragma_table_info queries → pretend columns exist (c=1)
            if (sql.includes('pragma_table_info')) return { c: 1 };
            return undefined;
          }),
          all: jest.fn(() => sites),
          run: jest.fn(),
        })),
        exec: jest.fn(),
      }
    : null;

  return {
    getDb: jest.fn(() => db),
    deletePlugins: jest.fn().mockResolvedValue(undefined),
    upsertPlugin: jest.fn().mockResolvedValue(1),
    deleteThemes: jest.fn().mockResolvedValue(undefined),
    upsertTheme: jest.fn().mockResolvedValue(1),
  };
}

/**
 * Build a minimal mock LocalServicesBridge.
 * `sshAvailable` controls isSSHKeyAvailable().
 * `wpCliResult` is the default resolved value for remoteWpCliRun().
 */
function makeLocalServices(opts: {
  sshAvailable?: boolean;
  wpCliResult?: { success: boolean; stdout: string | null };
  wpCliImpl?: jest.Mock;
} = {}): any {
  const sshAvailable = opts.sshAvailable ?? true;
  const defaultResult = opts.wpCliResult ?? { success: true, stdout: '' };
  const wpCliImpl = opts.wpCliImpl ?? jest.fn().mockResolvedValue(defaultResult);

  return {
    isSSHKeyAvailable: jest.fn(() => sshAvailable),
    remoteWpCliRun: wpCliImpl,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WpeRefreshScheduler', () => {
  const intervalMs = 10_000; // small for tests

  // "stale" — older than intervalMs
  const staleTimestamp = Date.now() - intervalMs - 1000;
  // "fresh" — younger than intervalMs
  const freshTimestamp = Date.now() - Math.floor(intervalMs / 2);

  const installA: SiteRow = {
    id: 'wpe-aaa',
    name: 'install-a',
    remote_install_id: 'aaa',
    last_sync_at: staleTimestamp,
  };
  const installB: SiteRow = {
    id: 'wpe-bbb',
    name: 'install-b',
    remote_install_id: 'bbb',
    last_sync_at: freshTimestamp,
  };
  const installC: SiteRow = {
    id: 'wpe-ccc',
    name: 'install-c',
    remote_install_id: 'ccc',
    last_sync_at: null, // never SSH-synced
  };

  // -----------------------------------------------------------
  // runNow() — staleness filtering
  // -----------------------------------------------------------

  describe('runNow() — staleness filtering', () => {
    it('skips installs whose last_sync_at is within the staleness threshold', async () => {
      const graphService = makeGraphService([installB]); // fresh
      const localServices = makeLocalServices();
      const logger = makeLogger();

      const scheduler = new WpeRefreshScheduler({
        graphService,
        localServices,
        intervalMs,
        logger,
      });

      const result = await scheduler.runNow();

      expect(result.skipped).toBe(1);
      expect(result.scanned).toBe(0);
      expect(localServices.remoteWpCliRun).not.toHaveBeenCalled();
    });

    it('scans installs with a stale last_sync_at', async () => {
      const graphService = makeGraphService([installA]); // stale
      const localServices = makeLocalServices({
        wpCliResult: { success: true, stdout: '[]' },
      });
      const logger = makeLogger();

      const scheduler = new WpeRefreshScheduler({
        graphService,
        localServices,
        intervalMs,
        logger,
      });

      const result = await scheduler.runNow();

      expect(result.scanned).toBe(1);
      expect(result.skipped).toBe(0);
      expect(localServices.remoteWpCliRun).toHaveBeenCalled();
    });

    it('scans installs with null last_sync_at (never SSH-synced)', async () => {
      const graphService = makeGraphService([installC]); // never synced
      const localServices = makeLocalServices({
        wpCliResult: { success: true, stdout: '[]' },
      });
      const logger = makeLogger();

      const scheduler = new WpeRefreshScheduler({
        graphService,
        localServices,
        intervalMs,
        logger,
      });

      const result = await scheduler.runNow();

      expect(result.scanned).toBe(1);
      expect(result.skipped).toBe(0);
      expect(localServices.remoteWpCliRun).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------
  // runNow() — SSH key guard
  // -----------------------------------------------------------

  describe('runNow() — SSH key guard', () => {
    it('skips all installs when SSH key is unavailable', async () => {
      const graphService = makeGraphService([installA, installC]);
      const localServices = makeLocalServices({ sshAvailable: false });
      const logger = makeLogger();

      const scheduler = new WpeRefreshScheduler({
        graphService,
        localServices,
        intervalMs,
        logger,
      });

      const result = await scheduler.runNow();

      expect(result.scanned).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(localServices.remoteWpCliRun).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SSH key not available')
      );
    });
  });

  // -----------------------------------------------------------
  // runNow() — error isolation
  // -----------------------------------------------------------

  describe('runNow() — error isolation', () => {
    it('handles per-site SSH errors without aborting remaining installs', async () => {
      // installA → all 7 WP-CLI commands fail (simulates total SSH failure for that install)
      // installC → all succeed
      let callIndex = 0;
      const wpCliImpl = jest.fn().mockImplementation((_installName: string) => {
        callIndex++;
        // First 7 calls are for installA (7 parallel WP-CLI commands) — reject them all
        if (callIndex <= 7) {
          return Promise.reject(new Error('SSH connection timeout'));
        }
        // Remaining calls are for installC — succeed
        return Promise.resolve({ success: true, stdout: '[]' });
      });

      // Override refreshInstall to throw for installA:
      // the scheduler wraps Promise.all with per-command .catch(), so individual command
      // rejections are swallowed. We test the outer try/catch by making the db.prepare
      // throw for the first site's UPDATE (after all commands complete).
      const graphService = makeGraphService([installA, installC]);
      // Make the db run() throw only for the first call (installA's UPDATE)
      const db = graphService.getDb();
      let runCallCount = 0;
      const originalRun = db.prepare().run;
      db.prepare.mockImplementation((sql: string) => {
        const stmt = {
          get: jest.fn((..._args: any[]) => {
            if (sql.includes('pragma_table_info')) return { c: 1 };
            return undefined;
          }),
          all: jest.fn(() => [installA, installC]),
          run: jest.fn((..._args: any[]) => {
            if (sql.includes('UPDATE sites SET') && runCallCount === 0) {
              runCallCount++;
              throw new Error('Simulated DB write failure for installA');
            }
            runCallCount++;
          }),
        };
        return stmt;
      });

      const localServices = makeLocalServices({ wpCliImpl });
      const logger = makeLogger();

      const scheduler = new WpeRefreshScheduler({
        graphService,
        localServices,
        intervalMs,
        logger,
      });

      const result = await scheduler.runNow();

      // installA fails (DB throws), installC succeeds
      expect(result.failed).toBe(1);
      expect(result.scanned).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to refresh install'),
        expect.any(String)
      );
    });
  });

  // -----------------------------------------------------------
  // runNow() — return counts
  // -----------------------------------------------------------

  describe('runNow() — return counts', () => {
    it('returns correct scanned/skipped/failed counts across mixed installs', async () => {
      // installA = stale (scanned), installB = fresh (skipped), installC = never (scanned)
      const graphService = makeGraphService([installA, installB, installC]);
      const localServices = makeLocalServices({
        wpCliResult: { success: true, stdout: '[]' },
      });
      const logger = makeLogger();

      const scheduler = new WpeRefreshScheduler({
        graphService,
        localServices,
        intervalMs,
        logger,
      });

      const result = await scheduler.runNow();

      expect(result.scanned).toBe(2);  // A + C
      expect(result.skipped).toBe(1);  // B
      expect(result.failed).toBe(0);
    });
  });

  // -----------------------------------------------------------
  // start() / stop()
  // -----------------------------------------------------------

  describe('start() / stop()', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('stop() prevents further runs from firing', async () => {
      const graphService = makeGraphService([installA]);
      const localServices = makeLocalServices({
        wpCliResult: { success: true, stdout: '[]' },
      });
      const logger = makeLogger();

      const scheduler = new WpeRefreshScheduler({
        graphService,
        localServices,
        intervalMs,
        logger,
      });

      scheduler.start();
      scheduler.stop();

      // Advance past multiple intervals — no runs should fire
      jest.advanceTimersByTime(intervalMs * 3);

      expect(localServices.remoteWpCliRun).not.toHaveBeenCalled();
    });

    it('start() is idempotent — does not double-register the interval', async () => {
      const graphService = makeGraphService([installA]);
      const localServices = makeLocalServices({
        wpCliResult: { success: true, stdout: '[]' },
      });
      const logger = makeLogger();

      const scheduler = new WpeRefreshScheduler({
        graphService,
        localServices,
        intervalMs,
        logger,
      });

      scheduler.start();
      scheduler.start(); // second call must be a no-op

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Already running')
      );

      // Advance exactly one interval — should fire exactly once, not twice
      jest.advanceTimersByTime(intervalMs);
      // Flush promises
      await Promise.resolve();
      await Promise.resolve();

      // remoteWpCliRun is called 7 times per site (7 parallel WP-CLI commands),
      // so for 1 site × 1 cycle = 7 calls (not 14)
      const callCount = (localServices.remoteWpCliRun as jest.Mock).mock.calls.length;
      expect(callCount).toBeLessThanOrEqual(7); // at most one cycle worth

      scheduler.stop();
    });
  });
});
