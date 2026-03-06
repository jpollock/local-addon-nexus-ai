/**
 * HealthTrendTracker (Sprint 3)
 * Records health score snapshots over time for trend visualization.
 * Uses the same SQLite database as GraphService.
 */

export interface HealthSnapshot {
  siteId: string;
  score: number;
  timestamp: number;
}

export interface DbLike {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): { changes: number };
  };
}

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

export class HealthTrendTracker {
  constructor(private db: DbLike) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_health_snapshots_site_ts
        ON health_snapshots (site_id, timestamp)
    `);
  }

  record(siteId: string, score: number): void {
    const now = Date.now();
    const since = now - ONE_HOUR_MS;

    const recent = this.db
      .prepare('SELECT score FROM health_snapshots WHERE site_id = ? AND timestamp > ? ORDER BY timestamp DESC LIMIT 1')
      .get(siteId, since);

    if (recent && recent.score === score) {
      return; // duplicate within the last hour — skip
    }

    this.db
      .prepare('INSERT INTO health_snapshots (site_id, score, timestamp) VALUES (?, ?, ?)')
      .run(siteId, score, now);
  }

  getSiteTrend(siteId: string, days: number): HealthSnapshot[] {
    const since = Date.now() - days * ONE_DAY_MS;

    const rows = this.db
      .prepare('SELECT site_id, score, timestamp FROM health_snapshots WHERE site_id = ? AND timestamp > ? ORDER BY timestamp ASC')
      .all(siteId, since);

    return rows.map((r: any) => ({
      siteId: r.site_id,
      score: r.score,
      timestamp: r.timestamp,
    }));
  }

  getFleetTrend(days: number): { timestamp: number; avgScore: number }[] {
    const now = Date.now();
    const result: { timestamp: number; avgScore: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = now - (i + 1) * ONE_DAY_MS;
      const dayEnd = now - i * ONE_DAY_MS;

      const row = this.db
        .prepare('SELECT AVG(score) as avg FROM health_snapshots WHERE timestamp >= ? AND timestamp < ?')
        .get(dayStart, dayEnd);

      if (row && row.avg !== null) {
        result.push({ timestamp: dayStart, avgScore: row.avg });
      }
    }

    return result;
  }

  prune(keepDays: number): number {
    const cutoff = Date.now() - keepDays * ONE_DAY_MS;

    const info = this.db
      .prepare('DELETE FROM health_snapshots WHERE timestamp < ?')
      .run(cutoff);

    return info.changes;
  }
}
