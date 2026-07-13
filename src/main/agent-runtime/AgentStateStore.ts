import type Database from 'better-sqlite3';
import type { AgentStateHandle, AgentResult } from '../agent-sdk/types';

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
  error       TEXT
);
`;

export class AgentStateStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA);
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
    };
  }

  recordRun(result: AgentResult): void {
    this.db
      .prepare('INSERT INTO agent_runs (agent_name, started_at, finished_at, status, error) VALUES (?, ?, ?, ?, ?)')
      .run(result.agentName, result.startedAt, result.finishedAt, result.status, result.error ?? null);

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
}
