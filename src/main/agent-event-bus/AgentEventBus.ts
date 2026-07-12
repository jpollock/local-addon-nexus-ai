import type Database from 'better-sqlite3';
import type { NexusEvent, EventHandler, Unsubscribe } from '../agent-sdk/types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace   TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  site_id     TEXT,
  payload     TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_ns_type ON agent_events(namespace, type);
`;

export function matchesPattern(eventKey: string, pattern: string): boolean {
  // Converts glob-style pattern to regex:
  // '.' → '\.' (literal dot), '*' → '.*' (any chars including dots)
  const regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
  return new RegExp(regexStr).test(eventKey);
}

type Subscription = { pattern: string; handler: EventHandler };

export class AgentEventBus {
  private db: Database.Database;
  private subscriptions: Map<string, Subscription> = new Map();
  private nextSubId = 0;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  publish(event: NexusEvent): void {
    // Persist first — durable before dispatch
    this.db
      .prepare(`
        INSERT INTO agent_events (namespace, type, site_id, payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(event.namespace, event.type, event.siteId ?? null, JSON.stringify(event.payload), event.createdAt);

    // Dispatch to matching subscribers
    for (const sub of this.subscriptions.values()) {
      if (matchesPattern(event.key, sub.pattern)) {
        try {
          const result = sub.handler(event);
          if (result instanceof Promise) result.catch(() => {}); // fire-and-forget
        } catch { /* handler errors must not crash the bus */ }
      }
    }
  }

  subscribe(pattern: string, handler: EventHandler): Unsubscribe {
    const id = String(this.nextSubId++);
    this.subscriptions.set(id, { pattern, handler });
    return () => { this.subscriptions.delete(id); };
  }

  replay(fromTimestamp: number, pattern?: string): NexusEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_events WHERE created_at >= ? ORDER BY created_at ASC')
      .all(fromTimestamp) as any[];

    return rows
      .map((row: any) => ({
        id: row.id,
        namespace: row.namespace,
        type: row.type,
        key: `${row.namespace}:${row.type}`,
        siteId: row.site_id ?? undefined,
        payload: JSON.parse(row.payload),
        createdAt: row.created_at,
      }))
      .filter((e: NexusEvent) => !pattern || matchesPattern(e.key, pattern));
  }

  pruneOldEvents(retentionDays: number): void {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM agent_events WHERE created_at < ?').run(cutoff);
  }
}
