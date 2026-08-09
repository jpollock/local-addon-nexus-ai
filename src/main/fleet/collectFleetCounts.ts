/**
 * The I/O seam for fleet counting. Everything upstream (`FleetCounts`,
 * `localReconciliation`) is pure and unit-tested; this file is the only place
 * in the fleet module family that touches Local's site store and the
 * better-sqlite3 graph handle, which is why it carries no unit test of its
 * own — there is nothing here to test that isn't either a database mock (not
 * worth building) or already covered by Tasks 1 and 3.
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
}

export function collectFleetCounts(deps: FleetCountsDeps): FleetCounts {
  const localSiteIds = Object.keys(deps.getSites() ?? {});

  let graphRows: Array<{ id: string; source: 'wpe' | 'external'; wpeSiteId: string | null }> = [];
  try {
    const db = deps.getDb();
    if (db) {
      // The graph column is snake_case; FleetCounts takes camelCase. Map once,
      // on the way out of the database, so nothing downstream sees both shapes.
      const rows = db
        .prepare(
          "SELECT id, source, wpe_site_id FROM sites WHERE source IN ('wpe','external') AND is_active = 1",
        )
        .all() as Array<{ id: unknown; source: unknown; wpe_site_id: unknown }>;
      graphRows = rows.map((r) => ({
        id: String(r.id),
        source: r.source as 'wpe' | 'external',
        wpeSiteId: r.wpe_site_id == null ? null : String(r.wpe_site_id),
      }));
    }
  } catch {
    // Graph may not be ready. Local still counts; the remote populations report zero
    // with their scope labels intact rather than the whole call failing.
  }

  return computeFleetCounts({ localSiteIds, graphRows });
}

/** Deactivates graph local rows whose site no longer exists in Local. Returns the count. */
export function sweepOrphanedLocalRows(deps: FleetCountsDeps): number {
  const db = deps.getDb();
  if (!db) return 0;

  const rows = db
    .prepare("SELECT id FROM sites WHERE source = 'local' AND is_active = 1")
    .all() as Array<{ id: string }>;
  const orphans = findOrphanedLocalRows(
    rows.map((r) => String(r.id)),
    Object.keys(deps.getSites() ?? {}),
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
