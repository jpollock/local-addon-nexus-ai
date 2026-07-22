import type { AgentDatabase } from '@nexus-ai/agent-sdk';
import type { DayAggregate } from './access-logs';

export interface LogSource {
  site: string;
  provider: string;
  bucket: string;
  region: string;
  prefix: string;
  enabled: number;
  created_at: number;
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
  connected: boolean;
  enabled: boolean;
  aggregateDays: number;
  ledgerDays: number;
  approxBytes: number;
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
  db.exec(SCHEMA);
}

export function getSource(db: AgentDatabase, site: string): LogSource | undefined {
  return db.prepare('SELECT * FROM sources WHERE site = ?').get(site) as LogSource | undefined;
}

export function upsertSource(db: AgentDatabase, s: Omit<LogSource, 'created_at'>): void {
  db.prepare(`
    INSERT INTO sources (site, provider, bucket, region, prefix, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site) DO UPDATE SET
      provider = excluded.provider, bucket = excluded.bucket,
      region = excluded.region, prefix = excluded.prefix
  `).run(s.site, s.provider, s.bucket, s.region, s.prefix, s.enabled, Date.now());
}

export function setEnabled(db: AgentDatabase, site: string, enabled: boolean): void {
  db.prepare('UPDATE sources SET enabled = ? WHERE site = ?').run(enabled ? 1 : 0, site);
}

export function getEnabledSites(db: AgentDatabase): string[] {
  return (db.prepare('SELECT site FROM sources WHERE enabled = 1').all() as { site: string }[]).map(r => r.site);
}

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

export function storageStats(db: AgentDatabase): StorageStats[] {
  const sources = db.prepare('SELECT * FROM sources').all() as LogSource[];
  return sources.map(src => {
    const agg = db.prepare('SELECT COUNT(*) as n, SUM(LENGTH(json)) as b FROM aggregates WHERE site = ?').get(src.site) as { n: number; b: number | null };
    const led = db.prepare('SELECT COUNT(*) as n FROM ledger WHERE site = ?').get(src.site) as { n: number };
    return { site: src.site, connected: true, enabled: src.enabled === 1, aggregateDays: agg.n, ledgerDays: led.n, approxBytes: agg.b ?? 0 };
  });
}
