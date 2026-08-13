// src/main/startup/ExternalRefreshScheduler.ts
import pLimit from 'p-limit';
import { resolveTransport } from '../transport';
import { collectExternalHostData, type BatchRunner } from './collectExternalHostData';
import { writeExternalHostData, type GraphWriter } from './writeExternalHostData';
import { makeSingleFlight } from './singleFlight';

export interface ExternalRefreshSchedulerOptions {
  graphService: GraphWriter & { getDb?: () => any };
  /** Passed straight to resolveTransport; the scheduler never inspects it. */
  services: any;
  intervalMs?: number;
  /** Skip a host synced more recently than this. Default: same as intervalMs. */
  stalenessThresholdMs?: number;
  logger: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
  /** Optional — when absent the job simply is not timed. */
  jobRunStore?: import('../background/JobRunStore').JobRunStore;
}

export interface ExternalRefreshResult {
  scanned: number;
  skipped: number;
  failed: number;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Unrelated servers, so this bounds LOCAL resource use — not a remote limit as WPE's 5 does. */
const CONCURRENCY = 3;

/**
 * Refresh L1+L2 metadata for registered external SSH hosts on an interval.
 *
 * Mirrors WpeRefreshScheduler, with two deliberate differences:
 *  - routes through resolveTransport (the one router) rather than WP Engine's
 *    SSH bridge, so target resolution and command policy stay in one place;
 *  - collects in four batched round trips because external SSH has no
 *    ControlMaster. See buildExternalWpCliBatch.
 *
 * Opt-in: index.ts only starts it when externalRefreshAutoEnabled is true.
 * Nexus does not connect to a third party's server on a timer unless asked.
 */
export class ExternalRefreshScheduler {
  private readonly graphService: ExternalRefreshSchedulerOptions['graphService'];
  private readonly services: any;
  private readonly logger: ExternalRefreshSchedulerOptions['logger'];
  private readonly jobRunStore?: import('../background/JobRunStore').JobRunStore;
  private currentIntervalMs: number;
  private currentStalenessThresholdMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Coalesces overlapping cycles so the timer and a manual run never double SSH load (P1-7). */
  private readonly runGuard = makeSingleFlight<ExternalRefreshResult>();

  constructor(options: ExternalRefreshSchedulerOptions) {
    this.graphService = options.graphService;
    this.services = options.services;
    this.logger = options.logger;
    this.jobRunStore = options.jobRunStore;
    this.currentIntervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.currentStalenessThresholdMs = options.stalenessThresholdMs ?? this.currentIntervalMs;
  }

  /** Idempotent — a second call while running is a no-op. */
  start(): void {
    if (this.timer !== null) {
      this.logger.info('[ExternalRefreshScheduler] Already running — start() ignored');
      return;
    }
    this.timer = setInterval(() => {
      this.runCycleNow().catch((err) =>
        this.logger.error('[ExternalRefreshScheduler] Cycle failed:', err?.message ?? err));
    }, this.currentIntervalMs);
    this.logger.info(
      `[ExternalRefreshScheduler] Started (every ${Math.round(this.currentIntervalMs / 3600000)}h)`);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('[ExternalRefreshScheduler] Stopped');
    }
  }

  restart(intervalMs: number): void {
    this.currentIntervalMs = intervalMs;
    this.currentStalenessThresholdMs = intervalMs;
    this.stop();
    this.start();
  }

  /**
   * Run one cycle across all stale external hosts. Never throws: a host that
   * fails is counted and logged, and the rest of the cycle continues.
   */
  runCycleNow(): Promise<ExternalRefreshResult> {
    // P1-7: coalesce — an overlapping call (timer re-entry, or a manual run during a scheduled
    // cycle) awaits the running cycle instead of starting a second one against the same hosts.
    return this.runGuard(() => this._runCycleNow());
  }

  private async _runCycleNow(): Promise<ExternalRefreshResult> {
    const startedAt = Date.now();
    try {
      const result: ExternalRefreshResult = { scanned: 0, skipped: 0, failed: 0 };
      const now = Date.now();

    let rows: Array<{ id: string; name: string; account_id: string; environment: string | null; ssh_last_sync_at: number | null }>;
    try {
      const db = this.graphService.getDb?.();
      if (!db) return result;   // startup race — try again next cycle
      rows = db.prepare(
        `SELECT id, name, account_id, environment, ssh_last_sync_at
         FROM sites
         WHERE source = 'external' AND is_active = 1`
      ).all();
    } catch (err: any) {
      this.logger.warn('[ExternalRefreshScheduler] Could not read hosts:', err?.message ?? err);
      return result;
    }

    const due = rows.filter((r) => {
      const fresh = r.ssh_last_sync_at != null
        && (now - r.ssh_last_sync_at) <= this.currentStalenessThresholdMs;
      if (fresh) result.skipped++;
      return !fresh;
    });

    const limit = pLimit(CONCURRENCY);
    await Promise.all(due.map((row) => limit(async () => {
      try {
        const target = `ssh:${row.account_id}/${row.name}@${row.environment ?? 'production'}`;
        const transport = await resolveTransport({ ssh_target: target }, this.services, 'wpcli_read');

        // A `content` key means refused or unresolvable. A permission refusal is
        // a skip, not a failure — the user configured it that way on purpose.
        if (transport && typeof transport === 'object' && 'content' in transport) {
          this.logger.info(`[ExternalRefreshScheduler] ${row.name}: skipped (${
            (transport as any).content?.[0]?.text ?? 'not resolvable'})`);
          result.skipped++;
          return;
        }

        const data = await collectExternalHostData(transport as unknown as BatchRunner, this.logger);
        await writeExternalHostData(this.graphService, row.id, row.name, data, Date.now(), this.logger);
        result.scanned++;
      } catch (err: any) {
        this.logger.warn(`[ExternalRefreshScheduler] ${row.name} failed:`, err?.message ?? err);
        result.failed++;
      }
    })));

      this.logger.info(
        `[ExternalRefreshScheduler] Cycle done — scanned ${result.scanned}, `
        + `skipped ${result.skipped}, failed ${result.failed}`);
      return result;
    } finally {
      this.jobRunStore?.record('externalRefresh', startedAt, Date.now() - startedAt);
    }
  }
}
