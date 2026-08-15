/**
 * The local ledger — append-only spine of the satellite (architecture doc §4).
 *
 * SQLite via better-sqlite3 (already a repo dependency). Events are immutable;
 * corrections are new events with `causation` set. Idempotency by event id:
 * re-appending an existing id is a harmless no-op (at-least-once delivery, §4.5).
 */
import Database from 'better-sqlite3';
import { EventEnvelope } from '../envelope/types';
import { validateEnvelope } from '../envelope/validate';
import { MIGRATIONS } from './migrations';

export interface QueryOptions {
  topicPrefix?: string; // e.g. 'state.plugin.' or 'task.'
  correlation?: string;
  entityId?: string; // matches any role in the entity block
  afterId?: string; // exclusive cursor (ULID-ordered)
  limit?: number;
}

export class Ledger {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const getVersion = this.db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`);
    const current = Number((getVersion.get() as { value: string } | undefined)?.value ?? '0');
    const apply = this.db.transaction((sql: string, version: number) => {
      this.db.exec(sql);
      this.db
        .prepare(
          `INSERT INTO _meta (key, value) VALUES ('schema_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run(String(version));
    });
    for (let v = current; v < MIGRATIONS.length; v++) {
      apply(MIGRATIONS[v], v + 1);
    }
  }

  /** Validate + append. Returns false if the id already existed (idempotent replay). */
  append(event: EventEnvelope): boolean {
    const e = validateEnvelope(event);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events
           (id, recorded_at, observed_at, topic, schema, entity, actor, source, access,
            correlation, causation, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        e.id,
        e.recorded_at,
        e.observed_at,
        e.topic,
        e.schema,
        JSON.stringify(e.entity),
        JSON.stringify(e.actor),
        JSON.stringify(e.source),
        JSON.stringify(e.access),
        e.correlation ?? null,
        e.causation ?? null,
        JSON.stringify(e.payload)
      );
    return result.changes === 1;
  }

  get(id: string): EventEnvelope | undefined {
    const row = this.db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as
      | Record<string, string>
      | undefined;
    return row ? rowToEnvelope(row) : undefined;
  }

  /** ULID ids sort lexicographically = coarse time order; cursors are just ids. */
  query(opts: QueryOptions = {}): EventEnvelope[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.topicPrefix) {
      where.push(`topic LIKE ?`);
      params.push(`${opts.topicPrefix}%`);
    }
    if (opts.correlation) {
      where.push(`correlation = ?`);
      params.push(opts.correlation);
    }
    if (opts.entityId) {
      where.push(`entity LIKE ?`);
      params.push(`%${JSON.stringify(opts.entityId).slice(1, -1)}%`);
    }
    if (opts.afterId) {
      where.push(`id > ?`);
      params.push(opts.afterId);
    }
    const sql = `SELECT * FROM events
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY id ASC LIMIT ?`;
    params.push(opts.limit ?? 500);
    const rows = this.db.prepare(sql).all(...params) as Record<string, string>[];
    return rows.map(rowToEnvelope);
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number }).n;
  }

  /** Escape hatch for fold workers sharing the connection/transactions. */
  raw(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

function rowToEnvelope(row: Record<string, string>): EventEnvelope {
  return {
    id: row.id,
    recorded_at: row.recorded_at,
    observed_at: row.observed_at,
    topic: row.topic,
    schema: row.schema,
    entity: JSON.parse(row.entity),
    actor: JSON.parse(row.actor),
    source: JSON.parse(row.source),
    access: JSON.parse(row.access),
    correlation: row.correlation ?? undefined,
    causation: row.causation ?? undefined,
    payload: JSON.parse(row.payload),
  };
}
