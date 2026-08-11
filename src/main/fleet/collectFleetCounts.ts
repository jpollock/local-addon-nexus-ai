/**
 * The I/O seam for fleet counting. Everything upstream (`FleetCounts`,
 * `localReconciliation`) is pure and unit-tested. `collectFleetCounts` itself
 * still carries no unit test of its own — nothing in it beyond plumbing a
 * database mock (not worth building) that Tasks 1 and 3 don't already cover.
 * `sweepOrphanedLocalRows` is the exception: its empty-store circuit breaker
 * (see below) is real logic guarding against permanent data loss, and is
 * covered in `tests/unit/fleet/sweep-circuit-breaker.test.ts` against a
 * minimal in-memory `FleetCountsDeps` mock.
 */

import { computeFleetCounts, FleetCounts } from './FleetCounts';
import { findOrphanedLocalRows } from './localReconciliation';

export interface FleetCountsDeps {
  /** Local's own site store, keyed by site id. */
  getSites: () => Record<string, unknown>;
  /** better-sqlite3 handle, or null when the graph is not ready. */
  getDb: () => {
    prepare: (sql: string) => { all: (...a: unknown[]) => unknown[]; run: (...a: unknown[]) => unknown };
  } | null;
  /** Optional: WPE account filter from settings. */
  getWpeAccountFilter?: () => string[] | null;
  /** Optional: Site rows for needs-attention calculation. */
  getSiteRows?: () => Array<{ id: string; knowledge: 'Unknown' | 'Basic' | 'Familiar' | 'Deep'; lastSyncFailed: boolean }>;
  /** Optional: Pending items per site. */
  getPendingBySite?: () => Record<string, number>;
  /** Optional: Index registry entries. */
  getIndexEntries?: () => Array<{ siteId: string; state: 'indexed' | 'stale' | 'indexing' | 'error' | 'never'; documentCount: number }>;
}

export function collectFleetCounts(deps: FleetCountsDeps): FleetCounts {
  const localSiteIds = Object.keys(deps.getSites() ?? {});

  let graphRows: Array<{
    id: string;
    source: 'wpe' | 'external';
    wpeSiteId: string | null;
    accountId: string | null;
    lastSyncAt: number | null;
    contentIndexedAt: number | null;
  }> = [];
  try {
    const db = deps.getDb();
    if (db) {
      // The graph column is snake_case; FleetCounts takes camelCase. Map once,
      // on the way out of the database, so nothing downstream sees both shapes.
      const rows = db
        .prepare(
          "SELECT id, source, wpe_site_id, account_id, last_sync_at, content_indexed_at FROM sites WHERE source IN ('wpe','external') AND is_active = 1",
        )
        .all() as Array<{
          id: unknown;
          source: unknown;
          wpe_site_id: unknown;
          account_id: unknown;
          last_sync_at: unknown;
          content_indexed_at: unknown;
        }>;
      graphRows = rows.map((r) => ({
        id: String(r.id),
        source: r.source as 'wpe' | 'external',
        wpeSiteId: r.wpe_site_id == null ? null : String(r.wpe_site_id),
        accountId: r.account_id == null ? null : String(r.account_id),
        lastSyncAt: r.last_sync_at == null ? null : Number(r.last_sync_at),
        contentIndexedAt: r.content_indexed_at == null ? null : Number(r.content_indexed_at),
      }));
    }
  } catch {
    // Graph may not be ready. Local still counts; the remote populations report zero
    // with their scope labels intact rather than the whole call failing.
  }

  // Optional extended inputs — defaults make them null when unavailable.
  const wpeAccountFilter = deps.getWpeAccountFilter?.() ?? null;
  const siteRows = deps.getSiteRows?.() ?? null;
  const pendingBySite = deps.getPendingBySite?.() ?? null;
  const indexEntries = deps.getIndexEntries?.() ?? null;

  return computeFleetCounts({
    localSiteIds,
    graphRows,
    wpeAccountFilter,
    siteRows,
    pendingBySite,
    indexEntries,
  });
}

/** Deactivates graph local rows whose site no longer exists in Local. Returns the count. */
export function sweepOrphanedLocalRows(deps: FleetCountsDeps): number {
  const db = deps.getDb();
  if (!db) return 0;

  const rows = db
    .prepare("SELECT id FROM sites WHERE source = 'local' AND is_active = 1")
    .all() as Array<{ id: string }>;
  const localStoreIds = Object.keys(deps.getSites() ?? {});

  // Circuit breaker. findOrphanedLocalRows has no threshold of its own — if
  // localStoreIds is empty, every active source='local' graph row is "orphaned"
  // in one pass. An empty store CAN be genuine (a user with zero local sites),
  // in which case refusing here is a false negative: those rows really are
  // orphans and we leave them stale. But the trade is asymmetric, not close.
  // Refusing wrongly just leaves stale rows — cosmetic, and self-correcting the
  // next time the sweep runs against a good read. Sweeping wrongly soft-deletes
  // (is_active = 0) every local site's graph row below, and GraphService's
  // cleanupOldData (GraphService.ts, retention sweep) later hard-deletes
  // is_active=0 rows *and their content* once they age past the retention
  // window — a single bad read compounds into permanent data loss. So: refuse
  // to sweep when the store is empty but the graph is not. Deliberately not a
  // proportional/percentage threshold — an empty store is a specific, legible
  // shape of a bad read; a percentage cutoff would just be a guess.
  if (localStoreIds.length === 0 && rows.length > 0) {
    console.warn(
      `[sweepOrphanedLocalRows] Refusing to sweep: Local's store reports 0 sites while the graph holds ${rows.length} active local row(s). This looks like a bad read (site data not ready, wrong container, etc.), not a mass deletion — leaving the rows untouched.`,
    );
    return 0;
  }

  const orphans = findOrphanedLocalRows(
    rows.map((r) => String(r.id)),
    localStoreIds,
  );

  // findOrphanedLocalRows does not dedupe its input, and orphans.length feeds
  // directly into the "Deactivated N graph rows" log line. That's safe here,
  // deliberately: `id` is the sites table's TEXT PRIMARY KEY (schema.sql), so
  // this SELECT cannot return the same id twice — SQLite enforces uniqueness
  // on the primary key at the storage layer, not just at the ORM layer. If
  // this query is ever changed to source ids from a non-unique column, that
  // guarantee breaks and this comment (and the count) needs revisiting.
  for (const id of orphans) {
    db.prepare('UPDATE sites SET is_active = 0, updated_at = ? WHERE id = ?').run(Date.now(), id);
  }
  return orphans.length;
}

export interface OrphanSweepDeps extends FleetCountsDeps {
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

/**
 * Startup wiring for the orphan sweep. Calls `sweepOrphanedLocalRows`, logs the
 * outcome, and swallows any error so a sweep failure can never block addon
 * startup. `sweepOrphanedLocalRows` (and the pure `findOrphanedLocalRows`
 * beneath it) has no internal error handling by design — this is its only
 * catcher, which is also why it is broken out as its own function: the
 * try/catch and logging are the one piece of this feature that couldn't be
 * exercised in a test without either invoking Local's real `main()` bootstrap
 * (impractical — it requires `@getflywheel/local/main`, Electron, and a real
 * service container) or duplicating the wiring logic inside the test. Extracting
 * it gives the startup wiring the same "stub the deps, assert the behaviour"
 * coverage the rest of the fleet module family already gets.
 */
export function runOrphanSweep(deps: OrphanSweepDeps): void {
  try {
    const swept = sweepOrphanedLocalRows(deps);
    if (swept > 0) {
      deps.logger.info(`[NexusAI] Deactivated ${swept} graph rows for deleted local sites`);
    }
  } catch (err) {
    deps.logger.warn('[NexusAI] Local row reconciliation failed:', (err as Error).message);
  }
}
