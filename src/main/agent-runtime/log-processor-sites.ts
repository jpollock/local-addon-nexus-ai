import * as fs from 'fs';
import * as path from 'path';

/**
 * Read-only window onto log-processor's own sqlite file (agents/log-processor/db.ts) for the
 * renderer, the same way GET_SITES reads graph.db directly rather than routing a plain SELECT
 * through the agent runtime.
 *
 * The shape follows the v3 model: ONE bucket for the whole account, and installs derived from the
 * install ids inside the log filenames — not a per-site bucket binding. See
 * handoff_log_sources_v3/DECISIONS.md §1 for why the per-site table it replaced could not work.
 *
 * Extracted from the IPC handler (src/main/ipc-handlers.ts) so it can be unit-tested against a
 * temp directory instead of the real, non-empty `~/Library/Application Support/.../agents/` tree
 * this addon writes to on a real machine.
 */

export interface LogProcessorBucket {
  bucket: string;
  region: string;
  prefix: string;
  lastScannedAt: number | null;
}

export interface LogProcessorInstallRow {
  /** WPE install id, as parsed out of the log filenames. */
  site: string;
  /** Apache-style objects only — `.access.log.gz` share the folder and are never ingested. */
  objectCount: number;
  bytes: number;
  oldestObjectAt: string | null;
  newestObjectAt: string | null;
  /** One real filename, so the UI can show the shape rather than describe it. */
  sampleKey: string | null;
  lastSyncedAt: number | null;
}

export interface LogProcessorState {
  bucket: LogProcessorBucket | null;
  installs: LogProcessorInstallRow[];
}

function openReadonly(agentsDir: string): InstanceType<typeof import('better-sqlite3')> | null {
  const dbPath = path.join(agentsDir, 'log-processor', 'logs.sqlite');
  if (!fs.existsSync(dbPath)) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
  return new BetterSqlite3(dbPath, { readonly: true });
}

/**
 * Everything the Sites tab renders: the account's bucket and every install found in it.
 *
 * Each table is read behind its own guard. They are all created by the same initSchema() call, so
 * in practice they coexist — the guards exist for a database written by an older build (or a
 * partial test fixture), where a missing table must read as "no data" rather than crash the tab.
 */
export function getLogProcessorState(agentsDir: string): LogProcessorState {
  const db = openReadonly(agentsDir);
  if (!db) return { bucket: null, installs: [] };
  try {
    let bucket: LogProcessorBucket | null = null;
    try {
      const row = db.prepare(
        'SELECT bucket, region, prefix, last_scanned_at FROM bucket_config WHERE id = 1',
      ).get() as { bucket: string; region: string; prefix: string; last_scanned_at: number | null } | undefined;
      if (row) {
        bucket = { bucket: row.bucket, region: row.region, prefix: row.prefix, lastScannedAt: row.last_scanned_at ?? null };
      }
    } catch { /* pre-v3 database — no bucket connected as far as this UI is concerned */ }

    let scans: Array<{
      site: string; object_count: number; bytes: number;
      oldest_object_at: string | null; newest_object_at: string | null; sample_key: string | null;
    }> = [];
    try {
      scans = db.prepare(
        'SELECT site, object_count, bytes, oldest_object_at, newest_object_at, sample_key FROM install_scan ORDER BY site',
      ).all() as typeof scans;
    } catch { /* never scanned — an empty install table is the honest answer */ }

    let lastSynced: Array<{ site: string; t: number }> = [];
    try {
      lastSynced = db.prepare('SELECT site, MAX(processed_at) as t FROM ledger GROUP BY site').all() as typeof lastSynced;
    } catch { /* ledger absent — report no sync data rather than crash */ }
    const lastSyncedBySite = new Map(lastSynced.map(r => [r.site, r.t]));

    return {
      bucket,
      installs: scans.map(r => ({
        site: r.site,
        objectCount: r.object_count,
        bytes: r.bytes,
        oldestObjectAt: r.oldest_object_at,
        newestObjectAt: r.newest_object_at,
        sampleKey: r.sample_key,
        lastSyncedAt: lastSyncedBySite.get(r.site) ?? null,
      })),
    };
  } finally {
    db.close();
  }
}

/**
 * Installs the agent can actually process — those with at least one apache-style object in the
 * connected bucket. This is the same set the Sites tab makes switchable, so Run Now cannot offer
 * a target the schedule would refuse; per BEHAVIOR.md §4 every consumer derives from one set
 * rather than keeping its own copy.
 */
export function getLogProcessorConnectedSites(agentsDir: string): string[] {
  return getLogProcessorState(agentsDir).installs
    .filter(i => i.objectCount > 0)
    .map(i => i.site);
}
