/**
 * Tests for HaltedSiteRefreshScheduler — Phase 3.2
 *
 * The scheduler runs a background cron that re-runs filesystem scans on
 * halted Local sites whose digital twin is stale (older than intervalMs).
 * Running sites are skipped because the lifecycle hook handles them.
 */
import { HaltedSiteRefreshScheduler } from '../../../src/main/startup/HaltedSiteRefreshScheduler';
import type { StartupSiteScanner } from '../../../src/main/startup/StartupSiteScanner';
import type { SiteMetadataCache } from '../../../src/main/metadata/SiteMetadataCache';
import type { SiteDataAccessor } from '../../../src/main/mcp/types';

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

function makeScanner(overrides: Partial<Pick<StartupSiteScanner, 'scanSite' | 'scan'>> = {}): jest.Mocked<Pick<StartupSiteScanner, 'scanSite' | 'scan'>> {
  return {
    scanSite: overrides.scanSite ?? jest.fn().mockResolvedValue(undefined),
    scan: overrides.scan ?? jest.fn().mockResolvedValue(undefined),
  } as any;
}

interface MockSiteMetadata {
  lastUpdated: number;
  scanDepth?: 'filesystem' | 'full';
}

function makeMetadataCache(entries: Record<string, MockSiteMetadata> = {}): jest.Mocked<Pick<SiteMetadataCache, 'get'>> {
  return {
    get: jest.fn((siteId: string) => {
      const entry = entries[siteId];
      if (!entry) return null;
      return {
        wpVersion: '7.0',
        plugins: [],
        themes: [],
        updateSource: 'startup-scan' as const,
        scanDepth: entry.scanDepth ?? 'filesystem',
        lastUpdated: entry.lastUpdated,
      };
    }),
  } as any;
}

function makeSiteData(sites: Array<{ id: string; name: string; path: string }>): jest.Mocked<SiteDataAccessor> {
  return {
    getSites: jest.fn(() => {
      const result: Record<string, any> = {};
      for (const site of sites) {
        result[site.id] = { id: site.id, name: site.name, path: site.path };
      }
      return result;
    }),
    getSite: jest.fn((id: string) => sites.find((s) => s.id === id) ?? null),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HaltedSiteRefreshScheduler', () => {
  const intervalMs = 10_000; // small for tests

  // A timestamp that is "stale" (older than intervalMs)
  const staleTimestamp = Date.now() - intervalMs - 1000;
  // A timestamp that is "fresh" (younger than intervalMs)
  const freshTimestamp = Date.now() - (intervalMs / 2);

  const siteA = { id: 'site-a', name: 'Site A', path: '/sites/a' };
  const siteB = { id: 'site-b', name: 'Site B', path: '/sites/b' };
  const siteC = { id: 'site-c', name: 'Site C', path: '/sites/c' };

  describe('runNow()', () => {
    it('skips running sites', async () => {
      const scanner = makeScanner();
      const metadataCache = makeMetadataCache({
        'site-a': { lastUpdated: staleTimestamp }, // stale but running
      });
      const siteData = makeSiteData([siteA]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: (id) => id === 'site-a',
        intervalMs,
        logger,
      });

      await scheduler.runNow();

      expect(scanner.scanSite).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Skipping running site'));
    });

    it('skips sites with fresh twins (last updated within intervalMs)', async () => {
      const scanner = makeScanner();
      const metadataCache = makeMetadataCache({
        'site-a': { lastUpdated: freshTimestamp }, // halted but fresh
      });
      const siteData = makeSiteData([siteA]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: () => false,
        intervalMs,
        logger,
      });

      await scheduler.runNow();

      expect(scanner.scanSite).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Skipping fresh site'));
    });

    it('scans halted sites with stale twins', async () => {
      const scanner = makeScanner();
      const metadataCache = makeMetadataCache({
        'site-a': { lastUpdated: staleTimestamp },
      });
      const siteData = makeSiteData([siteA]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: () => false,
        intervalMs,
        logger,
      });

      await scheduler.runNow();

      expect(scanner.scanSite).toHaveBeenCalledTimes(1);
      expect(scanner.scanSite).toHaveBeenCalledWith('site-a');
    });

    it('scans halted sites with no prior twin (never scanned)', async () => {
      const scanner = makeScanner();
      // No entries in metadataCache — site has never been scanned
      const metadataCache = makeMetadataCache({});
      const siteData = makeSiteData([siteA]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: () => false,
        intervalMs,
        logger,
      });

      await scheduler.runNow();

      expect(scanner.scanSite).toHaveBeenCalledTimes(1);
      expect(scanner.scanSite).toHaveBeenCalledWith('site-a');
    });

    it('processes all eligible sites in one cycle', async () => {
      const scanner = makeScanner();
      const metadataCache = makeMetadataCache({
        'site-a': { lastUpdated: staleTimestamp }, // halted + stale → scan
        'site-b': { lastUpdated: freshTimestamp },  // halted + fresh → skip
        'site-c': { lastUpdated: staleTimestamp }, // running + stale → skip
      });
      const siteData = makeSiteData([siteA, siteB, siteC]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: (id) => id === 'site-c',
        intervalMs,
        logger,
      });

      await scheduler.runNow();

      // Only site-a should be scanned
      expect(scanner.scanSite).toHaveBeenCalledTimes(1);
      expect(scanner.scanSite).toHaveBeenCalledWith('site-a');
      expect(scanner.scanSite).not.toHaveBeenCalledWith('site-b');
      expect(scanner.scanSite).not.toHaveBeenCalledWith('site-c');
    });

    it('continues processing remaining sites if one scan fails', async () => {
      const scanner = makeScanner({
        scanSite: jest.fn()
          .mockRejectedValueOnce(new Error('Disk read error'))
          .mockResolvedValueOnce(undefined),
      });
      const metadataCache = makeMetadataCache({
        'site-a': { lastUpdated: staleTimestamp },
        'site-b': { lastUpdated: staleTimestamp },
      });
      const siteData = makeSiteData([siteA, siteB]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: () => false,
        intervalMs,
        logger,
      });

      await scheduler.runNow();

      // Both sites should have been attempted
      expect(scanner.scanSite).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to scan site'),
        expect.any(String),
      );
    });

    it('handles empty site list gracefully', async () => {
      const scanner = makeScanner();
      const metadataCache = makeMetadataCache({});
      const siteData = makeSiteData([]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: () => false,
        intervalMs,
        logger,
      });

      await scheduler.runNow();

      expect(scanner.scanSite).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('No sites found'));
    });
  });

  describe('start() / stop()', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('stop() prevents further scans from running', async () => {
      const scanner = makeScanner();
      const metadataCache = makeMetadataCache({
        'site-a': { lastUpdated: staleTimestamp },
      });
      const siteData = makeSiteData([siteA]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: () => false,
        intervalMs,
        logger,
      });

      scheduler.start();
      scheduler.stop();

      // Advance time past multiple intervals
      jest.advanceTimersByTime(intervalMs * 3);

      // No scans should have fired
      expect(scanner.scanSite).not.toHaveBeenCalled();
    });

    it('start() is idempotent — does not double-register the interval', async () => {
      const scanner = makeScanner();
      const metadataCache = makeMetadataCache({
        'site-a': { lastUpdated: staleTimestamp },
      });
      const siteData = makeSiteData([siteA]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: () => false,
        intervalMs,
        logger,
      });

      scheduler.start();
      scheduler.start(); // second call should be a no-op

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Already running'),
      );

      // Advance exactly one interval — should fire exactly once (not twice)
      jest.advanceTimersByTime(intervalMs);
      // Allow the async runNow() to execute
      await Promise.resolve();
      await Promise.resolve();

      expect(scanner.scanSite).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });

    it('fires the refresh cycle after intervalMs has elapsed', async () => {
      const scanner = makeScanner();
      const metadataCache = makeMetadataCache({
        'site-a': { lastUpdated: staleTimestamp },
      });
      const siteData = makeSiteData([siteA]);
      const logger = makeLogger();

      const scheduler = new HaltedSiteRefreshScheduler({
        scanner: scanner as any,
        metadataCache: metadataCache as any,
        siteData,
        isSiteRunning: () => false,
        intervalMs,
        logger,
      });

      scheduler.start();

      // Before interval fires — no scans
      jest.advanceTimersByTime(intervalMs - 1);
      expect(scanner.scanSite).not.toHaveBeenCalled();

      // At exactly intervalMs — scan fires
      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();

      expect(scanner.scanSite).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });
  });
});
