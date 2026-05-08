import Database from 'better-sqlite3';

const DEFAULT_FIELDS = ['post_title', 'post_content'];

export interface SemanticConfigData {
  fields: string[];
  type: string;
}

export class SemanticConfig {
  constructor(private db: InstanceType<typeof Database>) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_search_semantic_config (
        site_id    TEXT PRIMARY KEY,
        fields     TEXT NOT NULL,
        type       TEXT NOT NULL DEFAULT 'BASIC',
        updated_at INTEGER NOT NULL
      );
    `);
  }

  get(siteId: string): SemanticConfigData {
    const row = this.db.prepare(
      'SELECT fields, type FROM smart_search_semantic_config WHERE site_id = ?'
    ).get(siteId) as any;
    if (!row) return { fields: DEFAULT_FIELDS, type: 'BASIC' };
    return { fields: JSON.parse(row.fields), type: row.type };
  }

  set(siteId: string, fields: string[], type = 'BASIC'): SemanticConfigData {
    this.db.prepare(`
      INSERT INTO smart_search_semantic_config (site_id, fields, type, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(site_id) DO UPDATE SET fields = excluded.fields, type = excluded.type, updated_at = excluded.updated_at
    `).run(siteId, JSON.stringify(fields), type, Date.now());
    return { fields, type };
  }
}
