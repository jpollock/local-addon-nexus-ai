import type Database from 'better-sqlite3';
import type { AgentStateHandle, AgentResult } from '../agent-sdk/types';

export interface AgentRunRow {
  id: number;
  agentName: string;
  startedAt: number;
  finishedAt: number;
  status: 'success' | 'error' | 'timeout';
  error?: string;
  summary?: string;
  findingsCount: number;
  logFile?: string;
  reportFile?: string;
  /**
   * WP-57 · the LOG correlator (`grep run=<id>`).
   *
   * Written since WP-19 and never read back — `SELECT *` fetched the column
   * and this mapping dropped it, so the run history had no way to reach the
   * lines a run produced. Returned now.
   */
  runId?: string;
  /**
   * WP-57 · the LEDGER correlator (`WHERE correlation = <id>`).
   *
   * Absent for a run the frame never wrote — the frame is lazy, and storing an
   * id that names no events would be a join to nothing.
   */
  taskId?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_state (
  agent_name  TEXT    NOT NULL,
  key         TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (agent_name, key)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name  TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  status      TEXT    NOT NULL,
  error       TEXT,
  summary     TEXT,
  findings_count INTEGER DEFAULT 0
);
`;

export class AgentStateStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA);
    // Migrations: add columns introduced after initial schema
    try { this.db.exec(`ALTER TABLE agent_runs ADD COLUMN summary TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE agent_runs ADD COLUMN findings_count INTEGER DEFAULT 0`); } catch {}
    try { this.db.exec(`ALTER TABLE agent_runs ADD COLUMN log_file TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE agent_runs ADD COLUMN report_file TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE agent_runs ADD COLUMN run_id TEXT`); } catch {}
    // WP-57 · the ledger join. Additive and guarded, like every column above:
    // an existing database gains it, a new one is created with it, and
    // `agent_runs` is user history that is never rebuilt.
    try { this.db.exec(`ALTER TABLE agent_runs ADD COLUMN task_id TEXT`); } catch {}
  }

  get<T>(agentName: string, key: string): T | undefined {
    const row = this.db
      .prepare('SELECT value FROM agent_state WHERE agent_name = ? AND key = ?')
      .get(agentName, key) as { value: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
  }

  set(agentName: string, key: string, value: unknown): void {
    this.db
      .prepare(`
        INSERT INTO agent_state (agent_name, key, value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(agent_name, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(agentName, key, JSON.stringify(value), Date.now());
  }

  delete(agentName: string, key: string): void {
    this.db
      .prepare('DELETE FROM agent_state WHERE agent_name = ? AND key = ?')
      .run(agentName, key);
  }

  clear(agentName: string): void {
    this.db
      .prepare('DELETE FROM agent_state WHERE agent_name = ?')
      .run(agentName);
  }

  buildHandle(agentName: string): AgentStateHandle {
    const store = this;
    return {
      get: <T>(key: string) => store.get<T>(agentName, key),
      set: (key: string, value: unknown) => store.set(agentName, key, value),
      delete: (key: string) => store.delete(agentName, key),
      scratch: {},
      isCoolingDown(key: string, durationMs: number): boolean {
        const ts = store.get<number>(agentName, `_cooldown:${key}`);
        if (ts === undefined) return false;
        return Date.now() - ts < durationMs;
      },
      setCooldown(key: string): void {
        store.set(agentName, `_cooldown:${key}`, Date.now());
      },
    };
  }

  recordRun(result: AgentResult): void {
    const findingsCount = result.findings?.length ?? 0;
    this.db
      .prepare('INSERT INTO agent_runs (agent_name, started_at, finished_at, status, error, summary, findings_count, log_file, report_file, run_id, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(result.agentName, result.startedAt, result.finishedAt, result.status, result.error ?? null, result.summary ?? null, findingsCount, result.logFile ?? null, result.reportFile ?? null, result.runId ?? null, result.taskId ?? null);

    this.db.prepare(`
      DELETE FROM agent_runs
      WHERE agent_name = ?
        AND id NOT IN (
          SELECT id FROM agent_runs WHERE agent_name = ? ORDER BY id DESC LIMIT 100
        )
    `).run(result.agentName, result.agentName);
  }

  getLastRun(agentName: string): AgentResult | undefined {
    const row = this.db
      .prepare('SELECT * FROM agent_runs WHERE agent_name = ? ORDER BY id DESC LIMIT 1')
      .get(agentName) as { agent_name: string; started_at: number; finished_at: number; status: string; error: string | null } | undefined;
    if (!row) return undefined;
    return {
      agentName: row.agent_name,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status as AgentResult['status'],
      error: row.error ?? undefined,
    };
  }

  getRunHistory(agentName: string, limit = 20): AgentRunRow[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_runs WHERE agent_name = ? ORDER BY id DESC LIMIT ?')
      .all(agentName, limit) as Array<{
        id: number; agent_name: string; started_at: number; finished_at: number;
        status: string; error: string | null; summary: string | null; findings_count: number;
        log_file: string | null; report_file: string | null;
        run_id: string | null; task_id: string | null;
      }>;
    return rows.map(r => ({
      id: r.id,
      agentName: r.agent_name,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status as 'success' | 'error' | 'timeout',
      error: r.error ?? undefined,
      summary: r.summary ?? undefined,
      findingsCount: r.findings_count ?? 0,
      logFile: r.log_file ?? undefined,
      reportFile: r.report_file ?? undefined,
      // WP-57 · both ids returned. `run_id` was fetched and dropped here since
      // WP-19; the history had no route to either the log or the ledger.
      runId: r.run_id ?? undefined,
      taskId: r.task_id ?? undefined,
    }));
  }
}
