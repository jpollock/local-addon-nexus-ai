import * as lancedb from '@lancedb/lancedb';
import { Index } from '@lancedb/lancedb';
import * as path from 'path';
import * as fs from 'fs';
import { SITE_TABLE_PREFIX, VECTOR_DIMENSIONS } from '../../common/constants';
import { VectorDocument, SearchOptions, SearchResult, SiteIndexStats } from '../../common/types';
import { createSeedRecord, toRecord } from './schema';

export class VectorStore {
  private db: lancedb.Connection | null = null;
  private dbPath: string;
  private migratedTables = new Set<string>();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Validate a post type string before interpolating it into a LanceDB
   * WHERE/DELETE clause. WordPress post types are ASCII slugs (letters,
   * digits, hyphens, underscores). Anything else is rejected to prevent
   * query injection via malicious MCP tool arguments.
   */
  private static validatePostType(postType: string): string {
    if (!/^[a-z0-9_-]+$/i.test(postType)) {
      throw new Error(
        `Invalid postType "${postType}": must contain only letters, numbers, hyphens, and underscores.`,
      );
    }
    return postType;
  }

  async initialize(): Promise<void> {
    fs.mkdirSync(this.dbPath, { recursive: true });
    this.db = await lancedb.connect(this.dbPath);
  }

  private getDb(): lancedb.Connection {
    if (!this.db) {
      throw new Error('VectorStore not initialized. Call initialize() first.');
    }
    return this.db;
  }

  private tableName(siteId: string): string {
    return `${SITE_TABLE_PREFIX}${siteId}_content`;
  }

  private async getOrCreateTable(siteId: string): Promise<lancedb.Table> {
    const db = this.getDb();
    const name = this.tableName(siteId);
    const existing = await db.tableNames();

    if (existing.includes(name)) {
      const table = await db.openTable(name);
      if (!this.migratedTables.has(name)) {
        await this.migrateTableSchema(table);
        this.migratedTables.add(name);
      }
      return table;
    }

    // Create table with seed record to establish schema, then delete seed
    const table = await db.createTable(name, [createSeedRecord()]);
    await table.delete('id = "__seed__"');
    this.migratedTables.add(name); // fresh table has correct schema
    return table;
  }

  /**
   * Migration-aware table open for read paths. Returns null if the table does
   * not exist yet. Runs schema migration exactly once per table per session.
   */
  private async getTable(siteId: string): Promise<lancedb.Table | null> {
    const db = this.getDb();
    const name = this.tableName(siteId);
    const existing = await db.tableNames();
    if (!existing.includes(name)) return null;
    const table = await db.openTable(name);
    if (!this.migratedTables.has(name)) {
      await this.migrateTableSchema(table);
      this.migratedTables.add(name);
    }
    return table;
  }

  /**
   * Look up a single document by its exact ID. Returns null if not found or table missing.
   * Used by SmartSearchHandler to retrieve a reference document for similarity search.
   */
  async lookupById(siteId: string, docId: string): Promise<{ id: string; content: string; title: string } | null> {
    // Validate docId — atlas-search IDs are "type:number" or plain alphanumeric slugs.
    // Reject anything that could break the LanceDB WHERE clause.
    if (!/^[a-zA-Z0-9:_\-]+$/.test(docId)) return null;
    const table = await this.getTable(siteId);
    if (!table) return null;
    try {
      const rows = await table.query().where(`id = '${docId}'`).limit(1).toArray();
      if (!rows.length) return null;
      return {
        id: rows[0].id as string,
        content: rows[0].content as string,
        title: rows[0].title as string,
      };
    } catch {
      return null;
    }
  }

  private async migrateTableSchema(table: lancedb.Table): Promise<void> {
    try {
      const schema = await table.schema();
      const fieldNames = schema.fields.map((f) => f.name);
      const newCols: Array<{ name: string; valueSql: string }> = [];

      if (!fieldNames.includes('post_date_gmt')) {
        newCols.push({ name: 'post_date_gmt', valueSql: "cast('' as varchar)" });
      }
      if (!fieldNames.includes('post_modified_gmt')) {
        newCols.push({ name: 'post_modified_gmt', valueSql: "cast('' as varchar)" });
      }
      if (!fieldNames.includes('doc_url')) {
        newCols.push({ name: 'doc_url', valueSql: "cast('' as varchar)" });
      }

      if (newCols.length > 0) {
        await table.addColumns(newCols);
      }
    } catch (err) {
      console.warn('[VectorStore] Schema migration failed (non-fatal):', err);
      // Migration is best-effort — search still works without new columns
    }
  }

  async upsert(siteId: string, documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) return;

    const table = await this.getOrCreateTable(siteId);

    // Delete existing documents by ID (LanceDB has no native upsert)
    const ids = documents.map((d) => d.id);
    for (const id of ids) {
      try {
        await table.delete(`id = "${id}"`);
      } catch {
        // Row may not exist — that's fine
      }
    }

    // Insert new records
    const records = documents.map(toRecord);
    await table.add(records);

    // Create/update FTS index on content field for hybrid search
    try {
      await table.createIndex('content', {
        config: Index.fts({ withPosition: false }),
        replace: true,
      });
    } catch {
      // FTS index creation is best-effort — vector search still works without it
    }
  }

  /**
   * Optimize table: compaction, cleanup, and incremental index updates
   * Should be called periodically after data changes to maintain performance
   */
  async optimize(siteId: string): Promise<void> {
    const table = await this.getTable(siteId);

    if (!table) {
      return; // Table doesn't exist, nothing to optimize
    }

    // Run optimization:
    // - Compaction: merge small fragments into larger ones
    // - Cleanup: remove old versions (default 7 days)
    // - Index update: add newly-ingested data to existing indexes
    await table.optimize();
  }

  async search(
    siteId: string,
    queryVector: Float32Array | number[],
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const table = await this.getTable(siteId);

    if (!table) {
      return [];
    }
    const vecArray = Array.from(queryVector);

    // Over-fetch for deduplication, then re-limit
    const fetchLimit = options.limit * 3;
    let query = table.vectorSearch(vecArray)
      .distanceType('cosine')
      .limit(fetchLimit);

    if (options.postType) {
      query = query.where(`\`postType\` = '${VectorStore.validatePostType(options.postType)}'`);
    }

    const rawResults = await query.toArray();

    const relevanceFloor = options.relevanceFloor ?? 0.3;

    // Map to SearchResult with cosine similarity score
    let results = rawResults.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      title: row.title as string,
      content: row.content as string,
      postType: row.postType as string,
      postId: row.postId as number,
      // Cosine distance → similarity: 1 - distance
      score: 1 - ((row._distance as number) ?? 0),
      metadata: row.metadata as string,
    }));

    // Apply relevance floor
    results = results.filter((r) => r.score >= relevanceFloor);

    // Deduplicate by postId: keep highest-scoring chunk per post
    const bestByPost = new Map<number, SearchResult>();
    for (const r of results) {
      const existing = bestByPost.get(r.postId);
      if (!existing || r.score > existing.score) {
        bestByPost.set(r.postId, r);
      }
    }

    // Re-limit to requested count
    return Array.from(bestByPost.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  }

  /**
   * Hybrid search across multiple sites — vector similarity + FTS keyword boost.
   * Calls tableNames() once to avoid filesystem lock contention.
   *
   * Scoring:
   * - Vector search: cosine similarity score (0-1). Primary signal.
   * - FTS keyword search: exact word match. Results included even if below
   *   vector threshold, displayed with a fixed 0.45 "keyword match" score.
   * - Results in both: cosine score boosted by 0.1.
   *
   * Excluded post types are filtered from results.
   */
  async searchAcrossSites(
    siteIds: string[],
    queryVector: Float32Array | number[],
    options: SearchOptions & { queryText?: string; excludedTypes?: string[] },
    concurrency = 5,
  ): Promise<Map<string, SearchResult[]>> {
    // Validate before entering the per-site try/catch loop, which would
    // otherwise swallow the error as a "site not indexed" failure.
    if (options.postType) VectorStore.validatePostType(options.postType);
    (options.excludedTypes ?? []).forEach((t) => VectorStore.validatePostType(t));

    const db = this.getDb();
    const existingNames = new Set(await db.tableNames());
    const searchable = siteIds.filter((id) => existingNames.has(this.tableName(id)));

    const results = new Map<string, SearchResult[]>();
    const vecArray = Array.from(queryVector);
    const limit = options.limit ?? 3;
    const vectorFloor = options.relevanceFloor ?? 0.35;
    const excludedTypes = new Set(options.excludedTypes ?? []);

    for (let i = 0; i < searchable.length; i += concurrency) {
      const batch = searchable.slice(i, i + concurrency);
      await Promise.all(batch.map(async (siteId) => {
        try {
          const table = await this.getTable(siteId);
          if (!table) return;

          // Vector search — primary signal, cosine similarity score
          let vecQuery = table.vectorSearch(vecArray).distanceType('cosine').limit(limit * 4);
          if (options.postType) vecQuery = vecQuery.where(`\`postType\` = '${VectorStore.validatePostType(options.postType)}'`);
          const vecRaw = await vecQuery.toArray();

          type Row = { id: string; title: string; content: string; postType: string; postId: number; metadata: string; score: number };
          const vecMap = new Map<string, Row>();
          for (const row of vecRaw as Record<string, unknown>[]) {
            const score = 1 - ((row._distance as number) ?? 0);
            if (score >= vectorFloor && !excludedTypes.has(row.postType as string)) {
              vecMap.set(row.id as string, {
                id: row.id as string, title: row.title as string,
                content: row.content as string, postType: row.postType as string,
                postId: row.postId as number, metadata: row.metadata as string, score,
              });
            }
          }

          // FTS keyword search — catches exact terms vector misses (e.g. 'cornstarch')
          const ftsIds = new Set<string>();
          const ftsExtra = new Map<string, Row>();
          if (options.queryText) {
            try {
              const ftsRaw = await table.query()
                .fullTextSearch(options.queryText, { columns: ['content', 'title'] })
                .limit(limit * 2)
                .toArray();
              for (const row of ftsRaw as Record<string, unknown>[]) {
                if (excludedTypes.has(row.postType as string)) continue;
                ftsIds.add(row.id as string);
                if (!vecMap.has(row.id as string)) {
                  // FTS-only result: include with a keyword-match score
                  ftsExtra.set(row.id as string, {
                    id: row.id as string, title: row.title as string,
                    content: row.content as string, postType: row.postType as string,
                    postId: row.postId as number, metadata: row.metadata as string,
                    score: 0.45, // fixed "keyword match" score
                  });
                }
              }
            } catch { /* FTS index not built yet — vector only */ }
          }

          // Boost vector results that also appear in FTS
          for (const [id, row] of vecMap) {
            if (ftsIds.has(id)) row.score = Math.min(1.0, row.score + 0.1);
          }

          // Merge vector + FTS-only results
          const allRows = [...vecMap.values(), ...ftsExtra.values()];

          // Deduplicate by postId, keep highest score per post
          const bestByPost = new Map<number, Row>();
          for (const row of allRows) {
            const existing = bestByPost.get(row.postId);
            if (!existing || row.score > existing.score) bestByPost.set(row.postId, row);
          }

          const hits = Array.from(bestByPost.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

          if (hits.length > 0) results.set(siteId, hits);
        } catch { /* site not indexed */ }
      }));
    }

    return results;
  }

  /**
   * Remove documents of excluded post types from all vector tables.
   * Returns { tablesScanned, docsRemoved }.
   */
  async cleanupExcludedTypes(
    excludedTypes: string[],
    onProgress?: (current: number, total: number, tableName: string) => void,
  ): Promise<{ tablesScanned: number; docsRemoved: number }> {
    const db = this.getDb();
    const tables = await db.tableNames();
    let docsRemoved = 0;

    const typeList = excludedTypes.map((t) => `'${VectorStore.validatePostType(t)}'`).join(', ');
    const whereClause = `postType IN (${typeList})`;

    for (let i = 0; i < tables.length; i++) {
      const name = tables[i];
      onProgress?.(i + 1, tables.length, name);
      try {
        const table = await db.openTable(name);
        if (!this.migratedTables.has(name)) {
          await this.migrateTableSchema(table);
          this.migratedTables.add(name);
        }
        // Count before to know if anything was removed
        const before = (await table.query().select(['postType']).where(whereClause).limit(10000).toArray()).length;
        if (before > 0) {
          await table.delete(whereClause);
          docsRemoved += before;
        }
      } catch { /* table may be empty or schema mismatch */ }
    }

    return { tablesScanned: tables.length, docsRemoved };
  }

  /** Drop ALL lance tables (full reset). Returns count of tables dropped. */
  async dropAllTables(): Promise<number> {
    const db = this.getDb();
    const tables = await db.tableNames();
    for (const name of tables) {
      try { await db.dropTable(name); } catch { /* ignore */ }
    }
    return tables.length;
  }

  async delete(siteId: string, documentIds: string[]): Promise<void> {
    // Sentinel: ['__all__'] clears the entire site table
    if (documentIds.length === 1 && documentIds[0] === '__all__') {
      try {
        const table = await this.getTable(siteId);
        if (table) {
          await table.delete('id IS NOT NULL');
        }
      } catch (err) {
        console.warn('[VectorStore] deleteAll failed:', err);
      }
      return;
    }

    const table = await this.getTable(siteId);

    if (!table) return;

    for (const id of documentIds) {
      try {
        await table.delete(`id = "${id}"`);
      } catch {
        // Ignore missing rows
      }
    }
  }

  async dropSite(siteId: string): Promise<void> {
    const db = this.getDb();
    const name = this.tableName(siteId);
    const existing = await db.tableNames();

    if (existing.includes(name)) {
      await db.dropTable(name);
    }
  }

  async getSiteStats(siteId: string): Promise<SiteIndexStats> {
    const table = await this.getTable(siteId);

    if (!table) {
      return { siteId, documentCount: 0, chunkCount: 0, lastIndexed: 0 };
    }
    const count = await table.countRows();

    // Get the most recent indexedAt value
    const rows = await table
      .search(new Array(VECTOR_DIMENSIONS).fill(0))
      .limit(1)
      .toArray();

    const lastIndexed = rows.length > 0 ? (rows[0].indexedAt as number) : 0;

    // Count unique postIds to get document count (vs chunk count)
    const allRows = await table
      .search(new Array(VECTOR_DIMENSIONS).fill(0))
      .limit(count)
      .toArray();

    const uniquePostIds = new Set(allRows.map((r: Record<string, unknown>) => r.postId));

    return {
      siteId,
      documentCount: uniquePostIds.size,
      chunkCount: count,
      lastIndexed,
    };
  }

  async listSites(): Promise<string[]> {
    const db = this.getDb();
    const tables = await db.tableNames();
    const prefix = SITE_TABLE_PREFIX;
    const suffix = '_content';

    return tables
      .filter((t) => t.startsWith(prefix) && t.endsWith(suffix))
      .map((t) => t.slice(prefix.length, -suffix.length));
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
