// src/main/vector-store/SqliteVecStore.ts
import Database from 'better-sqlite3';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sqliteVec = require('sqlite-vec') as { load: (db: unknown) => void; serialize: (vec: Float32Array) => Uint8Array };
import { VECTOR_DIMENSIONS } from '../../common/constants';
import { VectorDocument, SearchOptions, SearchResult, SiteIndexStats } from '../../common/types';
import type { IVectorStore } from './IVectorStore';

export class SqliteVecStore implements IVectorStore {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    sqliteVec.load(this.db);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }

  private get conn(): Database.Database {
    if (!this.db) throw new Error('SqliteVecStore not initialized. Call initialize() first.');
    return this.db;
  }

  private static validateSiteId(siteId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(siteId)) {
      throw new Error(`Invalid siteId "${siteId}": must contain only letters, numbers, hyphens, and underscores.`);
    }
    return siteId;
  }

  private static validatePostType(postType: string): string {
    if (!/^[a-z0-9_-]+$/i.test(postType)) {
      throw new Error(`Invalid postType "${postType}": must contain only letters, numbers, hyphens, and underscores.`);
    }
    return postType;
  }

  private tablePrefix(siteId: string): string {
    SqliteVecStore.validateSiteId(siteId);
    return `site_${siteId}`;
  }

  private ensureTables(siteId: string): void {
    const p = this.tablePrefix(siteId);
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS "${p}_docs" (
        id TEXT PRIMARY KEY,
        site_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        post_type TEXT NOT NULL,
        post_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        metadata TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        post_date_gmt TEXT,
        post_modified_gmt TEXT,
        doc_url TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS "${p}_vec" USING vec0(
        embedding FLOAT[${VECTOR_DIMENSIONS}]
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS "${p}_fts" USING fts5(title, content);
    `);
  }

  // Implemented in Task 2
  async upsert(siteId: string, documents: VectorDocument[]): Promise<void> {
    if (!this.db) throw new Error('SqliteVecStore not initialized. Call initialize() first.');
    if (documents.length === 0) return;
    this.ensureTables(siteId);
    const p = this.tablePrefix(siteId);

    const getRowid = this.conn.prepare<[string]>(`SELECT rowid FROM "${p}_docs" WHERE id = ?`);
    const deleteVec = this.conn.prepare<[number]>(`DELETE FROM "${p}_vec" WHERE rowid = ?`);
    const deleteFts = this.conn.prepare<[number]>(`DELETE FROM "${p}_fts" WHERE rowid = ?`);
    const deleteDoc = this.conn.prepare<[string]>(`DELETE FROM "${p}_docs" WHERE id = ?`);
    const insertDoc = this.conn.prepare(
      `INSERT INTO "${p}_docs" (id, site_id, title, content, post_type, post_id, chunk_index, metadata, indexed_at, post_date_gmt, post_modified_gmt, doc_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // vec0 v0.1.9 does not accept a parameterised rowid — use LAST_INSERT_ROWID() instead
    const insertVec = this.conn.prepare(`INSERT INTO "${p}_vec" (rowid, embedding) VALUES (LAST_INSERT_ROWID(), ?)`);
    const insertFts = this.conn.prepare(`INSERT INTO "${p}_fts" (rowid, title, content) VALUES (LAST_INSERT_ROWID(), ?, ?)`);

    const upsertAll = this.conn.transaction((docs: VectorDocument[]) => {
      for (const doc of docs) {
        const existing = getRowid.get(doc.id) as { rowid: number } | undefined;
        if (existing) {
          deleteVec.run(existing.rowid);
          deleteFts.run(existing.rowid);
          deleteDoc.run(doc.id);
        }
        insertDoc.run(
          doc.id, doc.siteId, doc.title, doc.content, doc.postType,
          doc.postId, doc.chunkIndex, doc.metadata, doc.indexedAt,
          doc.post_date_gmt ?? null, doc.post_modified_gmt ?? null, doc.doc_url ?? null,
        );
        // Serialize Float32Array to raw IEEE-754 bytes; vec0 accepts a BLOB blob
        insertVec.run(Buffer.from(doc.vector.buffer));
        insertFts.run(doc.title, doc.content);
      }
    });

    upsertAll(documents);
  }

  // Implemented in Task 3
  async search(_siteId: string, _queryVector: Float32Array | number[], _options: SearchOptions): Promise<SearchResult[]> {
    return [];
  }

  // Implemented in Task 4
  async searchAcrossSites(
    _siteIds: string[],
    _queryVector: Float32Array | number[],
    _options: SearchOptions & { queryText?: string; excludedTypes?: string[] },
    _concurrency = 5,
  ): Promise<Map<string, SearchResult[]>> {
    return new Map();
  }

  // Implemented in Task 5
  async lookupById(_siteId: string, _docId: string): Promise<{ id: string; content: string; title: string } | null> { return null; }
  async delete(_siteId: string, _documentIds: string[]): Promise<void> { /* Task 5 */ }
  async dropSite(_siteId: string): Promise<void> { /* Task 5 */ }
  async dropAllTables(): Promise<number> { return 0; }
  async listSites(): Promise<string[]> { return []; }
  async cleanupExcludedTypes(
    _excludedTypes: string[],
    _onProgress?: (current: number, total: number, tableName: string) => void,
  ): Promise<{ tablesScanned: number; docsRemoved: number }> { return { tablesScanned: 0, docsRemoved: 0 }; }

  // Implemented in Task 2 (needed by upsert tests)
  async getSiteStats(siteId: string): Promise<SiteIndexStats> {
    const p = this.tablePrefix(siteId);
    const tableExists = this.conn.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
    ).get(`${p}_docs`);
    if (!tableExists) return { siteId, documentCount: 0, chunkCount: 0, lastIndexed: 0 };

    const row = this.conn.prepare(
      `SELECT COUNT(*) as chunk_count, COUNT(DISTINCT post_id) as doc_count, COALESCE(MAX(indexed_at), 0) as last_indexed FROM "${p}_docs"`,
    ).get() as { chunk_count: number; doc_count: number; last_indexed: number };

    return { siteId, documentCount: row.doc_count, chunkCount: row.chunk_count, lastIndexed: row.last_indexed };
  }

  // No-op — SQLite doesn't need LanceDB-style compaction
  async optimize(_siteId: string): Promise<void> { /* intentional no-op */ }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
