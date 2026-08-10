import type { AgentDatabase } from '@nexus-ai/agent-sdk';
import type { DayAggregate } from './access-logs';

/**
 * Legacy per-site binding — one row per site, each with its own bucket/region/prefix.
 * Superseded by `bucket_config` + `install_scan`: WP Engine writes every install of an account
 * into ONE flat prefix and separates them by filename, so a per-site prefix was a fact the user
 * had to invent (handoff_log_sources_v3/DECISIONS.md §1). The table survives only so
 * `migrateFromPerSiteSources` can read it once; nothing writes to it any more.
 */
export interface LogSource {
  site: string;
  provider: string;
  bucket: string;
  region: string;
  prefix: string;
  enabled: number;
  created_at: number;
}

/** The one bucket for the whole account. Singleton — `id` is pinned to 1. */
export interface BucketConfig {
  bucket: string;
  region: string;
  prefix: string;
  last_scanned_at: number | null;
  created_at: number;
}

/**
 * Per-install scan cache. Derived from a bucket listing, never typed by a user: the install id
 * is parsed out of each object's filename and joined by exact name against the WP Engine fleet
 * Local already holds. A row here means "this install has objects in the bucket".
 *
 * `site` is the raw WPE install name, not a graph.db id — a documented exception to the picker's
 * usual id convention, because the join to the log filenames depends on it (DATA-MODEL.md §2).
 */
export interface InstallScan {
  site: string;
  object_count: number;
  bytes: number;
  oldest_object_at: string | null;
  newest_object_at: string | null;
  sample_key: string | null;
  scanned_at: number;
}

export interface LedgerEntry {
  site: string;
  file_date: string;
  files: number;
  bytes: number;
  lines: number;
  processed_at: number;
}

export interface StorageStats {
  site: string;
  /** Apache-style objects seen for this install in the last bucket scan. 0 = none, or never scanned. */
  objectCount: number;
  aggregateDays: number;
  ledgerDays: number;
  approxBytes: number;
  /** MAX(ledger.processed_at) — derived, never stored separately. */
  lastSyncedAt: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  site        TEXT PRIMARY KEY,
  provider    TEXT NOT NULL DEFAULT 's3',
  bucket      TEXT NOT NULL,
  region      TEXT NOT NULL DEFAULT 'us-east-1',
  prefix      TEXT NOT NULL DEFAULT '',
  enabled     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bucket_config (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  bucket           TEXT NOT NULL,
  region           TEXT NOT NULL DEFAULT 'us-east-1',
  prefix           TEXT NOT NULL DEFAULT '',
  last_scanned_at  INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS install_scan (
  site              TEXT PRIMARY KEY,
  object_count      INTEGER NOT NULL DEFAULT 0,
  bytes             INTEGER NOT NULL DEFAULT 0,
  oldest_object_at  TEXT,
  newest_object_at  TEXT,
  sample_key        TEXT,
  scanned_at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  site          TEXT NOT NULL,
  file_date     TEXT NOT NULL,
  files         INTEGER NOT NULL,
  bytes         INTEGER NOT NULL,
  lines         INTEGER NOT NULL,
  processed_at  INTEGER NOT NULL,
  PRIMARY KEY (site, file_date)
);
CREATE TABLE IF NOT EXISTS aggregates (
  site              TEXT NOT NULL,
  day               TEXT NOT NULL,
  json              TEXT NOT NULL,
  taxonomy_version  TEXT NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (site, day)
);
`;

export function initSchema(db: AgentDatabase): void {
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
}

// ---------------------------------------------------------------------------
// meta — small key/value scratch for one-time markers (migration state)
// ---------------------------------------------------------------------------

export function getMeta(db: AgentDatabase, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: AgentDatabase, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// ---------------------------------------------------------------------------
// bucket_config — one bucket for the whole account
// ---------------------------------------------------------------------------

export function getBucketConfig(db: AgentDatabase): BucketConfig | undefined {
  return db.prepare('SELECT bucket, region, prefix, last_scanned_at, created_at FROM bucket_config WHERE id = 1')
    .get() as BucketConfig | undefined;
}

export function setBucketConfig(
  db: AgentDatabase, cfg: { bucket: string; region: string; prefix: string },
): void {
  db.prepare(`
    INSERT INTO bucket_config (id, bucket, region, prefix, last_scanned_at, created_at)
    VALUES (1, ?, ?, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      bucket = excluded.bucket, region = excluded.region, prefix = excluded.prefix
  `).run(cfg.bucket, cfg.region, cfg.prefix, Date.now());
}

export function setLastScannedAt(db: AgentDatabase, at: number): void {
  db.prepare('UPDATE bucket_config SET last_scanned_at = ? WHERE id = 1').run(at);
}

/** Change bucket — clears the install cache, because those rows described the OLD bucket. */
export function clearBucketConfig(db: AgentDatabase): void {
  db.prepare('DELETE FROM bucket_config WHERE id = 1').run();
  db.prepare('DELETE FROM install_scan').run();
}

// ---------------------------------------------------------------------------
// install_scan — what the last bucket scan found, per install
// ---------------------------------------------------------------------------

export function saveInstallScan(db: AgentDatabase, row: Omit<InstallScan, 'scanned_at'> & { scanned_at?: number }): void {
  db.prepare(`
    INSERT INTO install_scan (site, object_count, bytes, oldest_object_at, newest_object_at, sample_key, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site) DO UPDATE SET
      object_count = excluded.object_count, bytes = excluded.bytes,
      oldest_object_at = excluded.oldest_object_at, newest_object_at = excluded.newest_object_at,
      sample_key = excluded.sample_key, scanned_at = excluded.scanned_at
  `).run(
    row.site, row.object_count, row.bytes,
    row.oldest_object_at, row.newest_object_at, row.sample_key,
    row.scanned_at ?? Date.now(),
  );
}

export function getInstallScan(db: AgentDatabase, site: string): InstallScan | undefined {
  return db.prepare('SELECT * FROM install_scan WHERE site = ?').get(site) as InstallScan | undefined;
}

export function listInstallScans(db: AgentDatabase): InstallScan[] {
  return db.prepare('SELECT * FROM install_scan ORDER BY site').all() as InstallScan[];
}

/**
 * Replace the whole install cache in one shot. A scan is a complete picture of the bucket, so an
 * install that has dropped out of it must lose its row — leaving stale rows behind would keep a
 * switch live for an install with nothing left to read.
 */
export function replaceInstallScans(db: AgentDatabase, rows: Array<Omit<InstallScan, 'scanned_at'>>): void {
  const at = Date.now();
  db.prepare('DELETE FROM install_scan').run();
  for (const r of rows) saveInstallScan(db, { ...r, scanned_at: at });
}

// ---------------------------------------------------------------------------
// Migration off the per-site `sources` model
// ---------------------------------------------------------------------------

export interface SourcesMigration {
  /** How many legacy rows were read. */
  rows: number;
  /** The bucket/region/prefix adopted as the account-level config. */
  chosen: { bucket: string; region: string; prefix: string };
  /** Distinct locations that disagreed with `chosen`, with the sites that named them. */
  discarded: Array<{ bucket: string; region: string; prefix: string; sites: string[] }>;
  /** Aggregate rows deleted (see wipeAggregatesAndLedger). */
  aggregatesWiped: number;
  ledgerWiped: number;
}

const MIGRATION_KEY = 'sourcesMigratedAt';
const MIGRATION_NOTICE_KEY = 'sourcesMigrationNotice';

/**
 * One-time move from per-site `sources` rows to the account-level `bucket_config`.
 *
 * Runs at most once (guarded by a `meta` marker), and only when there is something to move:
 * legacy rows present and no bucket config yet. Rows mostly share one bucket; the most common
 * location wins and the rest are surfaced through `discarded` — DATA-MODEL.md §2 asks for a
 * one-time notice rather than a silent discard, so the caller logs it and it is also parked in
 * `meta` for later inspection.
 *
 * It also wipes `aggregates` and `ledger`. That is not housekeeping — every aggregate computed
 * under the old model is suspect. The old `runSync` listed by shared date prefix and attributed
 * EVERY install's lines to whichever single site it had been called for, so any account with more
 * than one site in scope has cross-contaminated day rows. Wiping forces a clean re-sync; keeping
 * them would leave wrong numbers that look authoritative and never self-correct.
 */
export function migrateFromPerSiteSources(db: AgentDatabase): SourcesMigration | null {
  if (getMeta(db, MIGRATION_KEY)) return null;
  if (getBucketConfig(db)) { setMeta(db, MIGRATION_KEY, String(Date.now())); return null; }

  let rows: LogSource[];
  try {
    rows = db.prepare('SELECT * FROM sources').all() as LogSource[];
  } catch {
    // No legacy table at all (fresh install, or a partial test fixture) — nothing to migrate.
    setMeta(db, MIGRATION_KEY, String(Date.now()));
    return null;
  }
  if (rows.length === 0) {
    setMeta(db, MIGRATION_KEY, String(Date.now()));
    return null;
  }

  const groups = new Map<string, { bucket: string; region: string; prefix: string; sites: string[] }>();
  for (const r of rows) {
    const key = `${r.bucket} ${r.region} ${r.prefix}`;
    const g = groups.get(key) ?? { bucket: r.bucket, region: r.region, prefix: r.prefix, sites: [] };
    g.sites.push(r.site);
    groups.set(key, g);
  }
  const ordered = Array.from(groups.values()).sort((a, b) => b.sites.length - a.sites.length);
  const winner = ordered[0];
  const discarded = ordered.slice(1);

  setBucketConfig(db, { bucket: winner.bucket, region: winner.region, prefix: winner.prefix });
  const wiped = wipeAggregatesAndLedger(db);

  const result: SourcesMigration = {
    rows: rows.length,
    chosen: { bucket: winner.bucket, region: winner.region, prefix: winner.prefix },
    discarded,
    aggregatesWiped: wiped.aggregates,
    ledgerWiped: wiped.ledger,
  };
  setMeta(db, MIGRATION_KEY, String(Date.now()));
  if (discarded.length > 0) setMeta(db, MIGRATION_NOTICE_KEY, JSON.stringify(discarded));
  return result;
}

/** The one-time "these locations disagreed" notice, if the migration recorded one. */
export function getMigrationNotice(db: AgentDatabase): SourcesMigration['discarded'] | undefined {
  const raw = getMeta(db, MIGRATION_NOTICE_KEY);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as SourcesMigration['discarded']; } catch { return undefined; }
}

export function clearMigrationNotice(db: AgentDatabase): void {
  db.prepare('DELETE FROM meta WHERE key = ?').run(MIGRATION_NOTICE_KEY);
}

/** Drop every derived row. Callers own the "why" — see migrateFromPerSiteSources. */
export function wipeAggregatesAndLedger(db: AgentDatabase): { aggregates: number; ledger: number } {
  const a = db.prepare('DELETE FROM aggregates').run() as { changes: number };
  const l = db.prepare('DELETE FROM ledger').run() as { changes: number };
  return { aggregates: a.changes, ledger: l.changes };
}

// ---------------------------------------------------------------------------
// ledger + aggregates
// ---------------------------------------------------------------------------

export function getLedger(db: AgentDatabase, site: string): Record<string, LedgerEntry> {
  const rows = db.prepare('SELECT * FROM ledger WHERE site = ?').all(site) as LedgerEntry[];
  return Object.fromEntries(rows.map(r => [r.file_date, r]));
}

export function markLedger(db: AgentDatabase, entry: LedgerEntry): void {
  db.prepare(`
    INSERT INTO ledger (site, file_date, files, bytes, lines, processed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(site, file_date) DO UPDATE SET
      files = excluded.files, bytes = excluded.bytes,
      lines = excluded.lines, processed_at = excluded.processed_at
  `).run(entry.site, entry.file_date, entry.files, entry.bytes, entry.lines, entry.processed_at);
}

export function getAggregate(db: AgentDatabase, site: string, day: string): DayAggregate | undefined {
  const row = db.prepare('SELECT json FROM aggregates WHERE site = ? AND day = ?').get(site, day) as { json: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.json) as DayAggregate; } catch { return undefined; }
}

export function saveAggregate(db: AgentDatabase, agg: DayAggregate): void {
  db.prepare(`
    INSERT INTO aggregates (site, day, json, taxonomy_version, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(site, day) DO UPDATE SET
      json = excluded.json, taxonomy_version = excluded.taxonomy_version, updated_at = excluded.updated_at
  `).run(agg.site, agg.day, JSON.stringify(agg), agg.taxonomyVersion, Date.now());
}

export function getAggregatesInRange(
  db: AgentDatabase, site: string, from: string, to: string,
): { day: string; agg: DayAggregate }[] {
  const rows = db.prepare(
    'SELECT day, json FROM aggregates WHERE site = ? AND day >= ? AND day <= ? ORDER BY day',
  ).all(site, from, to) as { day: string; json: string }[];
  return rows.flatMap(r => {
    try { return [{ day: r.day, agg: JSON.parse(r.json) as DayAggregate }]; } catch { return []; }
  });
}

export function evict(db: AgentDatabase, site?: string, olderThanDays = 180): number {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - olderThanDays);
  const c = cutoff.toISOString().slice(0, 10);
  if (site) {
    const r = db.prepare('DELETE FROM aggregates WHERE site = ? AND day < ?').run(site, c) as { changes: number };
    db.prepare('DELETE FROM ledger WHERE site = ? AND file_date < ?').run(site, c);
    return r.changes;
  }
  const r = db.prepare('DELETE FROM aggregates WHERE day < ?').run(c) as { changes: number };
  db.prepare('DELETE FROM ledger WHERE file_date < ?').run(c);
  return r.changes;
}

/**
 * Per-site local footprint. The site set is the union of every table that can name one — an
 * install can have objects in the bucket but no aggregates yet (scanned, never synced), and it
 * can have aggregates but no scan row (synced, then dropped out of the bucket). Keying off any
 * single table hides one of those.
 */
export function storageStats(db: AgentDatabase): StorageStats[] {
  const sites = (db.prepare(`
    SELECT site FROM install_scan
    UNION SELECT site FROM aggregates
    UNION SELECT site FROM ledger
    ORDER BY site
  `).all() as { site: string }[]).map(r => r.site);

  return sites.map(site => {
    const agg = db.prepare('SELECT COUNT(*) as n, SUM(LENGTH(json)) as b FROM aggregates WHERE site = ?')
      .get(site) as { n: number; b: number | null };
    const led = db.prepare('SELECT COUNT(*) as n, MAX(processed_at) as last FROM ledger WHERE site = ?')
      .get(site) as { n: number; last: number | null };
    const scan = db.prepare('SELECT object_count FROM install_scan WHERE site = ?')
      .get(site) as { object_count: number } | undefined;
    return {
      site,
      objectCount: scan?.object_count ?? 0,
      aggregateDays: agg.n,
      ledgerDays: led.n,
      approxBytes: agg.b ?? 0,
      lastSyncedAt: led.last ?? null,
    };
  });
}
