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

  constructor(dbPath: string) {
    this.dbPath = dbPath;
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
      return db.openTable(name);
    }

    // Create table with seed record to establish schema, then delete seed
    const table = await db.createTable(name, [createSeedRecord()]);
    await table.delete('id = "__seed__"');
    return table;
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
    const db = this.getDb();
    const name = this.tableName(siteId);
    const existing = await db.tableNames();

    if (!existing.includes(name)) {
      return; // Table doesn't exist, nothing to optimize
    }

    const table = await db.openTable(name);

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
    const db = this.getDb();
    const name = this.tableName(siteId);
    const existing = await db.tableNames();

    if (!existing.includes(name)) {
      return [];
    }

    const table = await db.openTable(name);
    const vecArray = Array.from(queryVector);

    // Over-fetch for deduplication, then re-limit
    const fetchLimit = options.limit * 3;
    let query = table.vectorSearch(vecArray)
      .distanceType('cosine')
      .limit(fetchLimit);

    if (options.postType) {
      query = query.where(`\`postType\` = '${options.postType}'`);
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
   * Hybrid search across multiple sites — vector + FTS combined via RRF.
   * Calls tableNames() once to avoid filesystem lock contention.
   *
   * Uses Reciprocal Rank Fusion to merge vector and keyword results:
   * RRF score = 1/(k + rank_vector) + 1/(k + rank_fts)
   * This surfaces results that appear in BOTH searches highest,
   * while still returning good vector-only or keyword-only results.
   */
  async searchAcrossSites(
    siteIds: string[],
    queryVector: Float32Array | number[],
    options: SearchOptions & { queryText?: string },
    concurrency = 5,
  ): Promise<Map<string, SearchResult[]>> {
    const db = this.getDb();
    const existingNames = new Set(await db.tableNames());
    const searchable = siteIds.filter((id) => existingNames.has(this.tableName(id)));

    const results = new Map<string, SearchResult[]>();
    const vecArray = Array.from(queryVector);
    const limit = options.limit ?? 3;
    const relevanceFloor = options.relevanceFloor ?? 0.25; // lowered for hybrid
    const RRF_K = 60;

    for (let i = 0; i < searchable.length; i += concurrency) {
      const batch = searchable.slice(i, i + concurrency);
      await Promise.all(batch.map(async (siteId) => {
        try {
          const table = await db.openTable(this.tableName(siteId));

          // Vector search
          let vecQuery = table.vectorSearch(vecArray).distanceType('cosine').limit(limit * 3);
          if (options.postType) vecQuery = vecQuery.where(`\`postType\` = '${options.postType}'`);
          const vecRaw = await vecQuery.toArray();

          const vecRows = vecRaw
            .map((row: Record<string, unknown>) => ({
              id: row.id as string, title: row.title as string,
              content: row.content as string, postType: row.postType as string,
              postId: row.postId as number, metadata: row.metadata as string,
              score: 1 - ((row._distance as number) ?? 0),
            }))
            .filter((r) => r.score >= relevanceFloor);

          // FTS search (keyword) — only if queryText provided and FTS index exists
          let ftsRows: typeof vecRows = [];
          if (options.queryText) {
            try {
              const ftsRaw = await table.query()
                .fullTextSearch(options.queryText, { columns: ['content', 'title'] })
                .limit(limit * 3)
                .toArray();
              ftsRows = ftsRaw.map((row: Record<string, unknown>, idx: number) => ({
                id: row.id as string, title: row.title as string,
                content: row.content as string, postType: row.postType as string,
                postId: row.postId as number, metadata: row.metadata as string,
                score: 1 / (RRF_K + idx + 1), // rank-based score for FTS
              }));
            } catch { /* FTS index not yet built — vector only */ }
          }

          // RRF fusion: combine vector rank + FTS rank
          const scoreMap = new Map<string, { row: typeof vecRows[0]; rrfScore: number }>();

          vecRows.forEach((r, rank) => {
            const rrfScore = 1 / (RRF_K + rank + 1);
            scoreMap.set(r.id, { row: r, rrfScore });
          });

          ftsRows.forEach((r, rank) => {
            const rrfScore = 1 / (RRF_K + rank + 1);
            const existing = scoreMap.get(r.id);
            if (existing) {
              existing.rrfScore += rrfScore; // appears in both — boost
            } else {
              scoreMap.set(r.id, { row: r, rrfScore });
            }
          });

          // Deduplicate by postId, keep best RRF score per post
          const bestByPost = new Map<number, { row: typeof vecRows[0]; rrfScore: number }>();
          for (const { row, rrfScore } of scoreMap.values()) {
            const existing = bestByPost.get(row.postId);
            if (!existing || rrfScore > existing.rrfScore) bestByPost.set(row.postId, { row, rrfScore });
          }

          const hits: SearchResult[] = Array.from(bestByPost.values())
            .sort((a, b) => b.rrfScore - a.rrfScore)
            .slice(0, limit)
            .map(({ row, rrfScore }) => ({ ...row, score: rrfScore }));

          if (hits.length > 0) results.set(siteId, hits);
        } catch { /* site not indexed */ }
      }));
    }

    return results;
  }

  async delete(siteId: string, documentIds: string[]): Promise<void> {
    const db = this.getDb();
    const name = this.tableName(siteId);
    const existing = await db.tableNames();

    if (!existing.includes(name)) return;

    const table = await db.openTable(name);
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
    const db = this.getDb();
    const name = this.tableName(siteId);
    const existing = await db.tableNames();

    if (!existing.includes(name)) {
      return { siteId, documentCount: 0, chunkCount: 0, lastIndexed: 0 };
    }

    const table = await db.openTable(name);
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
    this.db = null;
  }
}
