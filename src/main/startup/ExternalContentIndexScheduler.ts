// src/main/startup/ExternalContentIndexScheduler.ts
import pLimit from 'p-limit';
import { resolveTransport } from '../transport';
import type { SiteTransport } from '../transport/types';
import type { ExternalContentIndexService } from '../events/ExternalContentIndexService';
import { makeSingleFlight } from './singleFlight';

export interface ExternalContentIndexSchedulerOptions {
  graphService: { getDb?: () => any };
  services: any;
  indexService: ExternalContentIndexService;
  intervalMs?: number;
  stalenessThresholdMs?: number;
  logger: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
  /** Optional — when absent the job simply is not timed. */
  jobRunStore?: import('../background/JobRunStore').JobRunStore;
}

export interface ExternalContentIndexResult {
  scanned: number;
  skipped: number;
  failed: number;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 3;

/**
 * Add `sites.content_indexed_at` if it is missing.
 *
 * Shared because the scheduler is not the only writer: `nexusHostIndex`
 * (`nexus host index <alias>`) stamps the same column, and it can run in a
 * process where the scheduler is disabled and has therefore never run. Both
 * writers must be able to guarantee the column exists.
 *
 * Best-effort: a failure here must never break the operation that needed it.
 * Returns true when the column is present afterwards.
 */
export function ensureContentIndexedAtColumn(
  db: any,
  logger?: { info: (...a: any[]) => void; warn: (...a: any[]) => void },
): boolean {
  if (!db) return false;
  try {
    const exists = db.prepare(
      `SELECT COUNT(*) as c FROM pragma_table_info('sites') WHERE name='content_indexed_at'`
    ).get() as { c: number };
    if (!exists.c) {
      db.exec(`ALTER TABLE sites ADD COLUMN content_indexed_at INTEGER`);
      logger?.info('[ExternalContentIndex] Added column sites.content_indexed_at');
    }
    return true;
  } catch (err: any) {
    logger?.warn('[ExternalContentIndex] Could not add content_indexed_at column:', err?.message);
    return false;
  }
}

/**
 * Content-index registered external SSH hosts on an interval. Mirrors
 * ExternalRefreshScheduler's shape exactly. Independent SSH session per host
 * per cycle — no ControlMaster to piggyback on (see Spec 4a §6), so this does
 * NOT try to share a connection with ExternalRefreshScheduler.
 */
export class ExternalContentIndexScheduler {
  private readonly graphService: ExternalContentIndexSchedulerOptions['graphService'];
  private readonly services: any;
  private readonly indexService: ExternalContentIndexService;
  private readonly logger: ExternalContentIndexSchedulerOptions['logger'];
  private readonly jobRunStore?: import('../background/JobRunStore').JobRunStore;
  private currentIntervalMs: number;
  private currentStalenessThresholdMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Coalesces overlapping cycles so the timer and a manual run never double SSH load (P1-7). */
  private readonly runGuard = makeSingleFlight<ExternalContentIndexResult>();
  private columnEnsured = false;

  constructor(options: ExternalContentIndexSchedulerOptions) {
    this.graphService = options.graphService;
    this.services = options.services;
    this.indexService = options.indexService;
    this.logger = options.logger;
    this.jobRunStore = options.jobRunStore;
    this.currentIntervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.currentStalenessThresholdMs = options.stalenessThresholdMs ?? this.currentIntervalMs;
  }

  start(): void {
    if (this.timer !== null) {
      this.logger.info('[ExternalContentIndexScheduler] Already running — start() ignored');
      return;
    }
    this.timer = setInterval(() => {
      this.runCycleNow().catch((err) =>
        this.logger.error('[ExternalContentIndexScheduler] Cycle failed:', err?.message ?? err));
    }, this.currentIntervalMs);
    this.logger.info(
      `[ExternalContentIndexScheduler] Started (every ${Math.round(this.currentIntervalMs / 3600000)}h)`);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('[ExternalContentIndexScheduler] Stopped');
    }
  }

  restart(intervalMs: number): void {
    this.currentIntervalMs = intervalMs;
    this.currentStalenessThresholdMs = intervalMs;
    this.stop();
    this.start();
  }

  private ensureColumn(db: any): void {
    if (this.columnEnsured) return;
    ensureContentIndexedAtColumn(db, this.logger);
    this.columnEnsured = true;
  }

  runCycleNow(): Promise<ExternalContentIndexResult> {
    // P1-7: coalesce — an overlapping call (timer re-entry, or a manual run during a scheduled
    // cycle) awaits the running cycle instead of starting a second one against the same hosts.
    return this.runGuard(() => this._runCycleNow());
  }

  private async _runCycleNow(): Promise<ExternalContentIndexResult> {
    const startedAt = Date.now();
    try {
      const result: ExternalContentIndexResult = { scanned: 0, skipped: 0, failed: 0 };
      const now = Date.now();

    const db = this.graphService.getDb?.();
    if (!db) return result;
    this.ensureColumn(db);

    let rows: Array<{ id: string; name: string; account_id: string; environment: string | null; content_indexed_at: number | null }>;
    try {
      rows = db.prepare(
        `SELECT id, name, account_id, environment, content_indexed_at
         FROM sites
         WHERE source = 'external' AND is_active = 1`
      ).all();
    } catch (err: any) {
      this.logger.warn('[ExternalContentIndexScheduler] Could not read hosts:', err?.message ?? err);
      return result;
    }

    const due = rows.filter((r) => {
      const fresh = r.content_indexed_at != null
        && (now - r.content_indexed_at) <= this.currentStalenessThresholdMs;
      if (fresh) result.skipped++;
      return !fresh;
    });

    const limit = pLimit(CONCURRENCY);
    await Promise.all(due.map((row) => limit(async () => {
      try {
        const target = `ssh:${row.account_id}/${row.name}@${row.environment ?? 'production'}`;
        const transport = await resolveTransport({ ssh_target: target }, this.services, 'wpcli_read');

        if (transport && typeof transport === 'object' && 'content' in transport) {
          this.logger.info(`[ExternalContentIndexScheduler] ${row.name}: skipped (${
            (transport as any).content?.[0]?.text ?? 'not resolvable'})`);
          result.skipped++;
          return;
        }

        await this.indexService.indexOne(transport as SiteTransport, row.id, row.name);
        try {
          db.prepare('UPDATE sites SET content_indexed_at = ? WHERE id = ?').run(Date.now(), row.id);
        } catch { /* best-effort staleness stamp */ }
        result.scanned++;
      } catch (err: any) {
        this.logger.warn(`[ExternalContentIndexScheduler] ${row.name} failed:`, err?.message ?? err);
        result.failed++;
      }
    })));

      this.logger.info(
        `[ExternalContentIndexScheduler] Cycle done — scanned ${result.scanned}, `
        + `skipped ${result.skipped}, failed ${result.failed}`);
      return result;
    } finally {
      this.jobRunStore?.record('externalContentIndex', startedAt, Date.now() - startedAt);
    }
  }
}
