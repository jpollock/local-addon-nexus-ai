/**
 * FleetHealthScheduler
 *
 * Background cron that periodically calculates health scores for all local
 * sites and emits `site.health.degraded` webhooks for any that fall below
 * the configured threshold.
 *
 * Results are persisted to RegistryStorage so the Activity tab can display
 * recent scheduled check history.
 *
 * Pattern mirrors HaltedSiteRefreshScheduler — same start/stop/runNow API.
 */

import type { WebhookEmitter } from '../webhooks/WebhookEmitter';
import type { HealthScoreCalculator } from '../health/HealthScoreCalculator';
import type { SiteDataAccessor } from '../mcp/types';
import type { RegistryStorage } from '../content/IndexRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours
const DEFAULT_DEGRADED_THRESHOLD = 70;
const HISTORY_STORAGE_KEY = 'nexus_fleet_health_history';
const MAX_HISTORY_ENTRIES = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FleetHealthCheckResult {
  /** ISO timestamp when the check ran */
  timestamp: string;
  /** Number of sites evaluated */
  checked: number;
  /** Number of sites below the degraded threshold */
  degraded: number;
  /** Per-site scores for the check run */
  siteScores: Array<{ siteId: string; siteName: string; score: number }>;
}

export interface FleetHealthSchedulerOptions {
  healthCalculator: HealthScoreCalculator;
  siteData: SiteDataAccessor;
  /** Used to fetch site PHP version / domain for scoring */
  localServices: {
    getAllSiteStatuses: () => Record<string, string>;
  };
  webhookEmitter: WebhookEmitter;
  registryStorage: RegistryStorage;
  /** How often to run the check. Default: 8 hours. */
  intervalMs?: number;
  /** Score below which a site is considered degraded. Default: 70. */
  degradedThreshold?: number;
  logger: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
}

// ---------------------------------------------------------------------------
// FleetHealthScheduler
// ---------------------------------------------------------------------------

export class FleetHealthScheduler {
  private readonly intervalMs: number;
  private readonly degradedThreshold: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: FleetHealthSchedulerOptions) {
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.degradedThreshold = opts.degradedThreshold ?? DEFAULT_DEGRADED_THRESHOLD;
  }

  /**
   * Start the scheduler. Idempotent — safe to call multiple times.
   */
  start(): void {
    if (this.timer !== null) {
      this.opts.logger.info('[FleetHealthScheduler] Already running — start() ignored');
      return;
    }

    this.opts.logger.info(
      `[FleetHealthScheduler] Starting — interval ${Math.round(this.intervalMs / 3600000)}h, degraded threshold ${this.degradedThreshold}`,
    );

    this.timer = setInterval(() => {
      this.runNow().catch((err) => {
        this.opts.logger.error(
          '[FleetHealthScheduler] Scheduled check error:',
          (err as Error).message,
        );
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
      this.opts.logger.info('[FleetHealthScheduler] Stopped');
    }
  }

  /**
   * Run one health check cycle immediately.
   * Returns a summary of checked and degraded site counts.
   */
  async runNow(): Promise<{ checked: number; degraded: number }> {
    const { healthCalculator, siteData, webhookEmitter, registryStorage, logger } = this.opts;

    const sites = Object.values(siteData.getSites());

    if (sites.length === 0) {
      logger.info('[FleetHealthScheduler] No sites found — nothing to check');
      return { checked: 0, degraded: 0 };
    }

    logger.info(`[FleetHealthScheduler] Checking health for ${sites.length} site(s)...`);

    const siteScores: FleetHealthCheckResult['siteScores'] = [];
    let degraded = 0;

    for (const site of sites) {
      try {
        const siteInfo = {
          phpVersion: undefined as string | undefined,
          domain: site.domain,
        };

        const breakdown = await healthCalculator.calculateScore(site.id, siteInfo);
        const score = breakdown.overall;

        siteScores.push({ siteId: site.id, siteName: site.name, score });

        if (score < this.degradedThreshold) {
          degraded++;
          logger.info(
            `[FleetHealthScheduler] Site "${site.name}" is degraded (score ${score} < threshold ${this.degradedThreshold})`,
          );

          // Emit webhook — fire-and-forget
          webhookEmitter.emit('site.health.degraded', {
            siteId: site.id,
            siteName: site.name,
            score,
            threshold: this.degradedThreshold,
            issues: breakdown.issues,
          }).catch(() => {
            // WebhookEmitter already logs its own errors
          });
        }
      } catch (err) {
        logger.warn(
          `[FleetHealthScheduler] Could not score site "${site.name}":`,
          (err as Error).message,
        );
      }
    }

    const result: FleetHealthCheckResult = {
      timestamp: new Date().toISOString(),
      checked: sites.length,
      degraded,
      siteScores,
    };

    // Persist to history (capped at MAX_HISTORY_ENTRIES)
    this.appendHistory(registryStorage, result);

    logger.info(
      `[FleetHealthScheduler] Check complete — ${sites.length} checked, ${degraded} degraded`,
    );

    return { checked: sites.length, degraded };
  }

  /**
   * Get the stored history of past health check results.
   */
  static getHistory(registryStorage: RegistryStorage): FleetHealthCheckResult[] {
    return (registryStorage.get(HISTORY_STORAGE_KEY) as FleetHealthCheckResult[]) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private appendHistory(registryStorage: RegistryStorage, result: FleetHealthCheckResult): void {
    const history = FleetHealthScheduler.getHistory(registryStorage);
    history.push(result);

    // Keep only the most recent entries
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.splice(0, history.length - MAX_HISTORY_ENTRIES);
    }

    registryStorage.set(HISTORY_STORAGE_KEY, history);
  }
}
