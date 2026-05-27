import type { NexusSettings } from '../../common/types';

export interface SchedulerDeps {
  bulkOpManager: {
    execute(op: {
      type: string;
      siteIds: string[];
      siteNames: Record<string, string>;
      options?: Record<string, any>;
    }): string;
  };
  siteData: { getSites(): Record<string, any> };
  getSettings(): NexusSettings;
  buildSiteNames(siteIds: string[]): Record<string, string>;
  logger: { info(msg: string): void; warn(msg: string): void };
}

/**
 * OpportunisticScheduler — fires a bulk reindex operation across all eligible
 * local sites on a configurable interval. Sites are started automatically if
 * halted (via autoStartStop) and stopped again once indexing completes.
 *
 * Enabled via NexusSettings.localContentIndexAutoEnabled (default: off).
 * Interval controlled by NexusSettings.localContentIndexIntervalHours (default: 8h).
 * Sites in NexusSettings.excludedSiteIds are skipped.
 */
export class OpportunisticScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start the scheduler. If autoEnabled is false, this is a no-op.
   * If already running, the existing timer is cleared first.
   */
  start(deps: SchedulerDeps): void {
    this.stop();
    const settings = deps.getSettings();
    if (!settings.localContentIndexAutoEnabled) return;

    const hours = settings.localContentIndexIntervalHours ?? 8;
    if (hours <= 0) return;

    const intervalMs = hours * 3_600_000;
    this.timer = setInterval(() => this.runCycle(deps), intervalMs);
    deps.logger.info(`[OpportunisticScheduler] Started — interval ${hours}h`);
  }

  /** Stop the scheduler and clear any pending timer. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Stop and re-start with fresh settings (called after settings change). */
  restart(deps: SchedulerDeps): void {
    this.stop();
    this.start(deps);
  }

  private runCycle(deps: SchedulerDeps): void {
    const settings = deps.getSettings();
    if (!settings.localContentIndexAutoEnabled) return;

    const excluded = new Set(settings.excludedSiteIds ?? []);
    const allSites = Object.values(deps.siteData.getSites()) as Array<{ id: string }>;
    const siteIds = allSites.map(s => s.id).filter(id => !excluded.has(id));

    if (siteIds.length === 0) {
      deps.logger.info('[OpportunisticScheduler] No eligible sites to index');
      return;
    }

    deps.logger.info(`[OpportunisticScheduler] Scheduled run — ${siteIds.length} sites`);
    deps.bulkOpManager.execute({
      type: 'reindex',
      siteIds,
      siteNames: deps.buildSiteNames(siteIds),
      options: { autoStartStop: true },
    });
  }
}
