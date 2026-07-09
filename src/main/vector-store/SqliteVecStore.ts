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

  // Implemented in Task 2
  async upsert(_siteId: string, _documents: VectorDocument[]): Promise<void> {
    if (!this.db) throw new Error('SqliteVecStore not initialized. Call initialize() first.');
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
    return { siteId, documentCount: 0, chunkCount: 0, lastIndexed: 0 };
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
