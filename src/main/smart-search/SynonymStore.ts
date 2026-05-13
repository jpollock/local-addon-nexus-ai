import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface SynonymRule {
  id: string;
  siteId: string;
  synonyms: string;
  createdAt: number;
}

export class SynonymStore {
  constructor(private db: InstanceType<typeof Database>) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_search_synonyms (
        id         TEXT PRIMARY KEY,
        site_id    TEXT NOT NULL,
        synonyms   TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_synonyms_site
        ON smart_search_synonyms(site_id);
    `);
  }

  saveRule(siteId: string, synonyms: string, id?: string): SynonymRule {
    if (id) {
      this.db.prepare(
        'UPDATE smart_search_synonyms SET synonyms = ? WHERE id = ? AND site_id = ?'
      ).run(synonyms, id, siteId);
      const existing = this.db.prepare(
        'SELECT created_at FROM smart_search_synonyms WHERE id = ? AND site_id = ?'
      ).get(id, siteId) as any;
      return { id, siteId, synonyms, createdAt: existing?.created_at ?? Date.now() };
    }
    const newId = randomUUID();
    const now = Date.now();
    this.db.prepare(
      'INSERT INTO smart_search_synonyms (id, site_id, synonyms, created_at) VALUES (?, ?, ?, ?)'
    ).run(newId, siteId, synonyms, now);
    return { id: newId, siteId, synonyms, createdAt: now };
  }

  getRules(siteId: string, opts?: { offset?: number; limit?: number }): SynonymRule[] {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 1000;
    const rows = this.db.prepare(
      'SELECT id, site_id, synonyms, created_at FROM smart_search_synonyms WHERE site_id = ? ORDER BY created_at LIMIT ? OFFSET ?'
    ).all(siteId, limit, offset) as any[];
    return rows.map(r => ({ id: r.id, siteId: r.site_id, synonyms: r.synonyms, createdAt: r.created_at }));
  }

  getRule(siteId: string, id: string): SynonymRule | null {
    const row = this.db.prepare(
      'SELECT id, site_id, synonyms, created_at FROM smart_search_synonyms WHERE id = ? AND site_id = ?'
    ).get(id, siteId) as any;
    if (!row) return null;
    return { id: row.id, siteId: row.site_id, synonyms: row.synonyms, createdAt: row.created_at };
  }

  deleteRule(siteId: string, id: string): void {
    this.db.prepare('DELETE FROM smart_search_synonyms WHERE id = ? AND site_id = ?').run(id, siteId);
  }

  deleteAllRules(siteId: string): void {
    this.db.prepare('DELETE FROM smart_search_synonyms WHERE site_id = ?').run(siteId);
  }

  countRules(siteId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as c FROM smart_search_synonyms WHERE site_id = ?'
    ).get(siteId) as any;
    return row.c;
  }
}
