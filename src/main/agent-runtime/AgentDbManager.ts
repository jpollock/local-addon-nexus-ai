import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
import type { AgentDatabase } from '../agent-sdk/types';

export class AgentDbManager {
  // Map key: `${agentName}:${dbName}`
  private cache = new Map<string, InstanceType<typeof BetterSqlite3>>();

  constructor(private readonly agentsDir: string) {}

  open(agentName: string, dbName: string): AgentDatabase {
    const key = `${agentName}:${dbName}`;
    const existing = this.cache.get(key);
    if (existing) return existing as unknown as AgentDatabase;

    const agentDir = path.join(this.agentsDir, agentName);
    fs.mkdirSync(agentDir, { recursive: true });
    const db = new BetterSqlite3(path.join(agentDir, `${dbName}.sqlite`));
    db.pragma('journal_mode = WAL');
    this.cache.set(key, db);
    return db as unknown as AgentDatabase;
  }

  closeAgent(agentName: string): void {
    for (const [key, db] of this.cache.entries()) {
      if (key.startsWith(`${agentName}:`)) {
        try { db.close(); } catch { /* ignore */ }
        this.cache.delete(key);
      }
    }
  }

  closeAll(): void {
    for (const db of this.cache.values()) {
      try { db.close(); } catch { /* ignore */ }
    }
    this.cache.clear();
  }
}
