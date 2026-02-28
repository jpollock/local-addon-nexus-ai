import * as lancedb from '@lancedb/lancedb';
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

    let query = table.vectorSearch(vecArray).limit(options.limit);

    if (options.postType) {
      query = query.where(`\`postType\` = '${options.postType}'`);
    }

    const results = await query.toArray();

    return results.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      title: row.title as string,
      content: row.content as string,
      postType: row.postType as string,
      postId: row.postId as number,
      score: 1 - ((row._distance as number) ?? 0), // LanceDB returns L2 distance; convert to similarity
      metadata: row.metadata as string,
    }));
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
