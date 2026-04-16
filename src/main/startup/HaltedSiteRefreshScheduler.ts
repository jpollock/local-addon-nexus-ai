/**
 * HaltedSiteRefreshScheduler
 *
 * Background cron that periodically re-runs the filesystem scan on halted
 * Local sites whose digital twin is stale.
 *
 * Why: After the initial startup scan, halted sites never get refreshed
 * automatically. A site halted for days ends up with an outdated twin.
 * Running sites are handled by the lifecycle hook on site-start, so we
 * skip them here.
 *
 * Staleness check: a site is considered stale when its last metadata update
 * is older than `intervalMs` (defaults to 24 hours). Running sites are always
 * skipped — they get fresh data via the lifecycle hook.
 */

import type { StartupSiteScanner } from './StartupSiteScanner';
import type { SiteMetadataCache } from '../metadata/SiteMetadataCache';
import type { SiteDataAccessor } from '../mcp/types';

export interface HaltedSiteRefreshSchedulerOptions {
  scanner: StartupSiteScanner;
  metadataCache: SiteMetadataCache;
  siteData: SiteDataAccessor;
  /**
   * How often to run the refresh cycle (milliseconds).
   * Default: 24 hours.
   */
  intervalMs?: number;
  /**
   * Callback to determine whether a site is currently running.
   * Accepts a siteId and returns true if running.
   */
  isSiteRunning: (siteId: string) => boolean;
  logger: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class HaltedSiteRefreshScheduler {
  private readonly scanner: StartupSiteScanner;
  private readonly metadataCache: SiteMetadataCache;
  private readonly siteData: SiteDataAccessor;
  private readonly intervalMs: number;
  private readonly isSiteRunning: (siteId: string) => boolean;
  private readonly logger: HaltedSiteRefreshSchedulerOptions['logger'];

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: HaltedSiteRefreshSchedulerOptions) {
    this.scanner = options.scanner;
    this.metadataCache = options.metadataCache;
    this.siteData = options.siteData;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.isSiteRunning = options.isSiteRunning;
    this.logger = options.logger;
  }

  /**
   * Start the scheduler. Idempotent — calling start() while already running
   * is a no-op; the existing interval is preserved.
   */
  start(): void {
    if (this.timer !== null) {
      this.logger.info('[HaltedSiteRefreshScheduler] Already running — start() ignored');
      return;
    }

    this.logger.info(
      `[HaltedSiteRefreshScheduler] Starting — interval ${Math.round(this.intervalMs / 3600000)}h`
    );

    this.timer = setInterval(() => {
      this.runNow().catch((err) => {
        this.logger.error('[HaltedSiteRefreshScheduler] Refresh cycle error:', (err as Error).message);
      });
    }, this.intervalMs);
  }

  /**
   * Stop the scheduler. Safe to call multiple times.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('[HaltedSiteRefreshScheduler] Stopped');
    }
  }

  /**
   * Immediately run one refresh cycle.
   * - Skips running sites (lifecycle hook handles them on site-start).
   * - Skips sites whose twin is fresh (last updated < intervalMs ago).
   * - Calls scanner.scanSite(id) for every halted site with a stale twin.
   */
  async runNow(): Promise<void> {
    const sites = Object.values(this.siteData.getSites());

    if (sites.length === 0) {
      this.logger.info('[HaltedSiteRefreshScheduler] No sites found — nothing to refresh');
      return;
    }

    let scanned = 0;
    let skippedRunning = 0;
    let skippedFresh = 0;

    for (const site of sites) {
      // Running sites are handled by the lifecycle hook — skip them.
      if (this.isSiteRunning(site.id)) {
        skippedRunning++;
        this.logger.info(`[HaltedSiteRefreshScheduler] Skipping running site: ${site.name}`);
        continue;
      }

      // Check freshness — skip if last update is within the interval window.
      const metadata = this.metadataCache.get(site.id);
      if (metadata) {
        const ageMs = Date.now() - metadata.lastUpdated;
        if (ageMs < this.intervalMs) {
          skippedFresh++;
          this.logger.info(
            `[HaltedSiteRefreshScheduler] Skipping fresh site: ${site.name} (age ${Math.round(ageMs / 3600000)}h)`
          );
          continue;
        }
      }

      // Halted + stale (or never scanned) — run filesystem scan.
      this.logger.info(`[HaltedSiteRefreshScheduler] Refreshing halted site: ${site.name}`);
      try {
        await this.scanner.scanSite(site.id);
        scanned++;
      } catch (err) {
        this.logger.error(
          `[HaltedSiteRefreshScheduler] Failed to scan site ${site.name}:`,
          (err as Error).message
        );
      }
    }

    this.logger.info(
      `[HaltedSiteRefreshScheduler] Cycle done — ${scanned} scanned, ${skippedRunning} running (skipped), ${skippedFresh} fresh (skipped)`
    );
  }
}
