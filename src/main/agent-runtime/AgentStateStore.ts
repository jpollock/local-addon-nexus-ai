import type Database from 'better-sqlite3';
import type { AgentStateHandle } from '../agent-sdk/types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_state (
  agent_name  TEXT    NOT NULL,
  key         TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (agent_name, key)
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
}
