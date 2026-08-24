// src/main/vector-store/SqliteVecStore.ts
import Database from 'better-sqlite3';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sqliteVec = require('sqlite-vec') as { load: (db: unknown) => void; serialize: (vec: Float32Array) => Uint8Array };
import { VECTOR_DIMENSIONS } from '../../common/constants';
import { VectorDocument, SearchOptions, SearchResult, SiteIndexStats } from '../../common/types';
import type { IVectorStore } from './IVectorStore';
import { applyMetadataFilters } from './metadata-filters';
import type { MetadataFilter } from '../../common/types';
import { secureDbFile } from '../db/secureDbFile';

export class SqliteVecStore implements IVectorStore {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    sqliteVec.load(this.db);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    // Restrict the db + WAL/SHM to 0600 — they hold indexed site content and embeddings, and
    // were created world-readable (0644) while every log is 0600 (P1-4).
    secureDbFile(this.dbPath);
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
        insertVec.run(Buffer.from(doc.vector.buffer, doc.vector.byteOffset, doc.vector.byteLength));
        insertFts.run(doc.title, doc.content);
      }
    });

    upsertAll(documents);
  }

  // Implemented in Task 3
  async search(
    siteId: string,
    queryVector: Float32Array | number[],
    options: SearchOptions & { queryText?: string },
  ): Promise<SearchResult[]> {
    // Validate postType early — before any DB access — to prevent injection
    if (options.postType) {
      SqliteVecStore.validatePostType(options.postType);
    }

    const p = this.tablePrefix(siteId);
    const tableExists = this.conn.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
    ).get(`${p}_docs`);
    if (!tableExists) return [];

    const mode = options.searchMode ?? 'semantic';
    const vec = queryVector instanceof Float32Array ? queryVector : new Float32Array(queryVector);

    // Mode branching: hybrid, keyword, or semantic (default)
    if (mode === 'hybrid' && options.queryText) {
      return this.searchHybrid(siteId, vec, options.queryText, options);
    }

    if (mode === 'keyword' && options.queryText) {
      // Pure BM25 keyword search
      const limit = options.limit ?? 10;
      const bm25Rows = this.searchBM25(siteId, options.queryText, limit * 3, options.postType);
      if (bm25Rows.length === 0) return [];

      const placeholders = bm25Rows.map(() => '?').join(', ');
      const rowidParams = bm25Rows.map(r => r.rowid);

      type RawDoc = {
        rowid: number;
        id: string;
        title: string;
        content: string;
        post_type: string;
        post_id: number;
        metadata: string;
      };

      const docRows = this.conn.prepare(
        `SELECT rowid, id, title, content, post_type, post_id, metadata FROM "${p}_docs" WHERE rowid IN (${placeholders})`,
      ).all(...rowidParams) as RawDoc[];

      const byPostId = new Map<number, SearchResult>();
      const bm25RankMap = new Map<number, number>();
      bm25Rows.forEach((r, i) => bm25RankMap.set(r.rowid, i + 1));

      for (const doc of docRows) {
        const rank = bm25RankMap.get(doc.rowid) ?? 1000;
        const score = 1 / (60 + rank); // RRF-style scoring for consistency

        const existing = byPostId.get(doc.post_id);
        if (!existing || score > existing.score) {
          byPostId.set(doc.post_id, {
            id: doc.id,
            title: doc.title,
            content: doc.content,
            postType: doc.post_type,
            postId: doc.post_id,
            score,
            metadata: doc.metadata,
          });
        }
      }

      return Array.from(byPostId.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    }

    // Default: semantic (vector-only) search
    const limit = options.limit ?? 10;
    const relevanceFloor = options.relevanceFloor ?? 0.3;
    const fetchLimit = limit * 3;
    // Convert to raw IEEE-754 bytes — sqliteVec.serialize does not exist in v0.1.9
    const blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);

    // Step 1: ANN search — preferred simpler form per vec0 v0.1.9
    const vecRows = this.conn.prepare(
      `SELECT rowid, distance FROM "${p}_vec" WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
    ).all(blob, fetchLimit) as Array<{ rowid: number; distance: number }>;

    if (vecRows.length === 0) return [];

    // Step 2: fetch doc metadata for the matching rowids
    const rowidToDistance = new Map(vecRows.map(r => [r.rowid, r.distance]));
    const placeholders = vecRows.map(() => '?').join(', ');
    const rowidParams = vecRows.map(r => r.rowid);

    type RawDoc = {
      rowid: number;
      id: string;
      title: string;
      content: string;
      post_type: string;
      post_id: number;
      metadata: string;
    };

    let docRows: RawDoc[];
    if (options.postType) {
      docRows = this.conn.prepare(
        `SELECT rowid, id, title, content, post_type, post_id, metadata FROM "${p}_docs" WHERE rowid IN (${placeholders}) AND post_type = ?`,
      ).all(...rowidParams, options.postType) as RawDoc[];
    } else {
      docRows = this.conn.prepare(
        `SELECT rowid, id, title, content, post_type, post_id, metadata FROM "${p}_docs" WHERE rowid IN (${placeholders})`,
      ).all(...rowidParams) as RawDoc[];
    }

    // Step 3: compute scores, apply relevanceFloor, dedup by postId (keep best chunk)
    // cosine_sim = 1 - L2² / 2  (exact for unit-normalised vectors; stable for non-unit test vecs)
    const byPostId = new Map<number, SearchResult>();
    for (const doc of docRows) {
      const distance = rowidToDistance.get(doc.rowid) ?? 1;
      const score = 1 - (distance * distance) / 2;
      if (score < relevanceFloor) continue;
      const existing = byPostId.get(doc.post_id);
      if (!existing || score > existing.score) {
        byPostId.set(doc.post_id, {
          id: doc.id,
          title: doc.title,
          content: doc.content,
          postType: doc.post_type,
          postId: doc.post_id,
          score,
          metadata: doc.metadata,
        });
      }
    }

    return Array.from(byPostId.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * FTS5 BM25 keyword search helper
   */
  private searchBM25(
    siteId: string,
    queryText: string,
    fetchLimit: number,
    postTypeFilter?: string,
  ): Array<{ rowid: number; rank: number; post_id: number }> {
    const p = this.tablePrefix(siteId);

    // Sanitize query text for FTS5: remove special chars, split into words
    const sanitized = queryText
      .replace(/[^a-zA-Z0-9\s]/g, ' ')  // Remove special chars
      .split(/\s+/)
      .filter(w => w.length > 2)  // Keep words longer than 2 chars
      .join(' ');

    if (!sanitized) return [];

    // FTS5 rank is negative (better = more negative)
    // Query FTS5 table directly, then join docs
    // The table name MUST be quoted, exactly as at creation and in the sibling
    // read at hasKeywordMatch (D8): site ids carry hyphens (local nanoids, WPE
    // UUIDs), and a bare identifier reads `--` as a line comment and `-` as a
    // syntax error. FTS5's MATCH accepts a quoted table name on the left — the
    // previous NOTE here claiming otherwise was the defect.
    // fetchLimit is the number of candidate rows to pull (callers widen it when
    // post-fetch metadata filtering will discard many).
    const ftsLimit = Math.max(1, Math.floor(fetchLimit));
    const ftsRows = this.conn.prepare(
      `SELECT rowid, rank FROM "${p}_fts" WHERE "${p}_fts" MATCH ? ORDER BY rank LIMIT ${ftsLimit}`
    ).all(sanitized) as Array<{ rowid: number; rank: number }>;

    if (ftsRows.length === 0) return [];

    // Join with docs table to get post_id
    const placeholders = ftsRows.map(() => '?').join(', ');
    const rowidParams = ftsRows.map(r => r.rowid);

    let sql = `SELECT rowid, post_id FROM "${p}_docs" WHERE rowid IN (${placeholders})`;
    const params: any[] = rowidParams;

    if (postTypeFilter) {
      sql += ` AND post_type = ?`;
      params.push(postTypeFilter);
    }

    const docRows = this.conn.prepare(sql).all(...params) as Array<{ rowid: number; post_id: number }>;

    // Merge rank from FTS with post_id from docs
    const rowidToRank = new Map(ftsRows.map(r => [r.rowid, r.rank]));
    return docRows.map(d => ({
      rowid: d.rowid,
      rank: rowidToRank.get(d.rowid) ?? 0,
      post_id: d.post_id,
    }));
  }

  /**
   * Hybrid search: Vector ANN + BM25 + metadata fusion
   */
  private async searchHybrid(
    siteId: string,
    queryVector: Float32Array,
    queryText: string,
    options: SearchOptions,
  ): Promise<SearchResult[]> {
    const p = this.tablePrefix(siteId);
    const limit = options.limit ?? 10;
    const relevanceFloor = options.relevanceFloor ?? 0.3;
    // When metadataFilters are present, post-fetch filtering discards candidates,
    // so a limit*3 pool can leave far fewer than `limit` results (poor recall).
    // Widen the candidate pool substantially in that case so filtering has enough
    // to work with. Capped so huge indexes stay bounded.
    const hasFilters = (options.metadataFilters?.length ?? 0) > 0;
    const FILTERED_FETCH_CAP = 1000;
    const fetchLimit = hasFilters ? Math.max(limit * 3, FILTERED_FETCH_CAP) : limit * 3;
    const blob = Buffer.from(queryVector.buffer, queryVector.byteOffset, queryVector.byteLength);

    // Step 1: Run vector ANN and BM25 in parallel (same widened pool for both)
    const vecRows = this.conn.prepare(
      `SELECT rowid, distance FROM "${p}_vec" WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
    ).all(blob, fetchLimit) as Array<{ rowid: number; distance: number }>;

    const bm25Rows = this.searchBM25(siteId, queryText, fetchLimit, options.postType);

    if (vecRows.length === 0 && bm25Rows.length === 0) return [];

    // Step 2: Build rank maps for RRF fusion
    const vecRankMap = new Map<number, number>(); // rowid -> rank (1-based)
    vecRows.forEach((r, i) => vecRankMap.set(r.rowid, i + 1));

    const bm25RankMap = new Map<number, number>();
    bm25Rows.forEach((r, i) => bm25RankMap.set(r.rowid, i + 1));

    // Step 3: Reciprocal Rank Fusion (k=60 is standard)
    const rrfScore = (rank: number, k = 60): number => 1 / (k + rank);
    const allRowids = new Set([...vecRankMap.keys(), ...bm25RankMap.keys()]);
    const fusedScores = new Map<number, number>();

    for (const rowid of allRowids) {
      const vecRank = vecRankMap.get(rowid) ?? 1000;
      const bm25Rank = bm25RankMap.get(rowid) ?? 1000;
      fusedScores.set(rowid, rrfScore(vecRank) + rrfScore(bm25Rank));
    }

    // Step 4: Fetch doc metadata for all matching rowids
    const placeholders = Array.from(allRowids).map(() => '?').join(', ');
    const rowidParams = Array.from(allRowids);

    type RawDoc = {
      rowid: number;
      id: string;
      title: string;
      content: string;
      post_type: string;
      post_id: number;
      metadata: string;
    };

    const docRows = this.conn.prepare(
      `SELECT rowid, id, title, content, post_type, post_id, metadata FROM "${p}_docs" WHERE rowid IN (${placeholders})`,
    ).all(...rowidParams) as RawDoc[];

    // Step 5: Apply metadata filters (Pass 1 — build candidates)
    // RRF scores are tiny (~0.03 max), so we normalize to 0-1 for final output
    // and apply the relevanceFloor on the normalized scale (top result ≈ 1.0).
    const byPostId = new Map<number, SearchResult>();

    for (const doc of docRows) {
      // postType filter — vector-matched docs bypass the BM25 postType filter,
      // so enforce it here for ALL candidates.
      if (options.postType && doc.post_type !== options.postType) continue;

      let score = fusedScores.get(doc.rowid) ?? 0;

      // Parse metadata for custom fields
      const meta = JSON.parse(doc.metadata);
      const custom = meta.customFields ?? {};

      // Metadata filters (exclude if doesn't match)
      if (options.metadataFilters && options.metadataFilters.length > 0
          && !applyMetadataFilters(custom, options.metadataFilters)) {
        continue;
      }

      // Dedup by postId (keep best chunk)
      const existing = byPostId.get(doc.post_id);
      if (!existing || score > existing.score) {
        byPostId.set(doc.post_id, {
          id: doc.id,
          title: doc.title,
          content: doc.content,
          postType: doc.post_type,
          postId: doc.post_id,
          score,
          metadata: doc.metadata,
        });
      }
    }

    // Pass 2: normalize scores to 0-1 (min-max by peak), apply relevanceFloor
    const candidates = Array.from(byPostId.values());
    if (candidates.length === 0) return [];

    const maxScore = Math.max(...candidates.map(c => c.score));
    if (maxScore > 0) {
      for (const c of candidates) {
        c.score = c.score / maxScore;
      }
    }

    return candidates
      .filter(c => c.score >= relevanceFloor)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Implemented in Task 4
  async searchAcrossSites(
    siteIds: string[],
    queryVector: Float32Array | number[],
    options: SearchOptions & { queryText?: string; excludedTypes?: string[] },
    _concurrency = 5,
  ): Promise<Map<string, SearchResult[]>> {
    if (options.postType) SqliteVecStore.validatePostType(options.postType);
    (options.excludedTypes ?? []).forEach(t => SqliteVecStore.validatePostType(t));

    const results = new Map<string, SearchResult[]>();
    const vec = queryVector instanceof Float32Array ? queryVector : new Float32Array(queryVector);
    // Serialize to raw IEEE-754 bytes — same pattern as search()
    const blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const limit = options.limit ?? 3;
    const vectorFloor = options.relevanceFloor ?? 0.35;
    const excludedTypes = new Set(options.excludedTypes ?? []);

    for (const siteId of siteIds) {
      const p = this.tablePrefix(siteId);
      const tableExists = this.conn.prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
      ).get(`${p}_docs`);
      if (!tableExists) continue;

      try {
        type RawDocRow = {
          id: string;
          title: string;
          content: string;
          post_type: string;
          post_id: number;
          metadata: string;
        };

        // ── Vector ANN search — primary relevance signal ─────────────────────
        const vecRows = this.conn.prepare(
          `SELECT d.id, d.title, d.content, d.post_type, d.post_id, d.metadata, v.distance
           FROM (SELECT rowid, distance FROM "${p}_vec" WHERE embedding MATCH ? AND k = ? ORDER BY distance) v
           JOIN "${p}_docs" d ON d.rowid = v.rowid
           ORDER BY v.distance`,
        ).all(blob, limit * 4) as (RawDocRow & { distance: number })[];

        // Build id → SearchResult map: only entries above floor, not in excluded types
        // cosine_sim = 1 - L2² / 2  (exact for unit-normalised vectors; stable for non-unit test vecs)
        const vecMap = new Map<string, SearchResult>();
        for (const row of vecRows) {
          const score = 1 - (row.distance * row.distance) / 2;
          if (score >= vectorFloor && !excludedTypes.has(row.post_type)) {
            vecMap.set(row.id, {
              id: row.id,
              title: row.title,
              content: row.content,
              postType: row.post_type,
              postId: row.post_id,
              score,
              metadata: row.metadata,
            });
          }
        }

        // ── FTS5 keyword search — catches exact terms the vector misses ───────
        const ftsMatchIds = new Set<string>();
        const ftsExtraMap = new Map<string, SearchResult>();

        if (options.queryText) {
          try {
            // Two-step: get rowids from FTS5 (table name — not alias — required for MATCH
            // in this SQLite version), then look up doc metadata by rowid.
            const ftsHits = this.conn.prepare(
              `SELECT rowid FROM "${p}_fts" WHERE "${p}_fts" MATCH ? LIMIT ?`,
            ).all(options.queryText, limit * 2) as { rowid: number }[];

            if (ftsHits.length > 0) {
              const ftsPh = ftsHits.map(() => '?').join(', ');
              const ftsRowids = ftsHits.map(r => r.rowid);
              const ftsDocs = this.conn.prepare(
                `SELECT id, title, content, post_type, post_id, metadata
                 FROM "${p}_docs" WHERE rowid IN (${ftsPh})`,
              ).all(...ftsRowids) as RawDocRow[];

              for (const row of ftsDocs) {
                if (excludedTypes.has(row.post_type)) continue;
                ftsMatchIds.add(row.id);
                if (!vecMap.has(row.id)) {
                  // FTS-only result: fixed score 0.45
                  ftsExtraMap.set(row.id, {
                    id: row.id,
                    title: row.title,
                    content: row.content,
                    postType: row.post_type,
                    postId: row.post_id,
                    score: 0.45,
                    metadata: row.metadata,
                  });
                }
              }
            }
          } catch {
            // FTS table not yet populated or invalid query syntax — vector-only for this site
          }
        }

        // ── Boost overlap: vector results that also appear in FTS ─────────────
        for (const [id, result] of vecMap) {
          if (ftsMatchIds.has(id)) {
            result.score = Math.min(1.0, result.score + 0.1);
          }
        }

        // ── Merge, dedup by postId (keep best score), sort, slice ─────────────
        const allResults = [...vecMap.values(), ...ftsExtraMap.values()];
        const bestByPostId = new Map<number, SearchResult>();
        for (const result of allResults) {
          const existing = bestByPostId.get(result.postId);
          if (!existing || result.score > existing.score) {
            bestByPostId.set(result.postId, result);
          }
        }

        const hits = Array.from(bestByPostId.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        if (hits.length > 0) {
          results.set(siteId, hits);
        }
      } catch {
        // Site search failed — skip this site
      }
    }

    return results;
  }

  /**
   * D23 — the census: how many POSTS on this site match a metadata filter,
   * evaluated over the FULL document population, never a retrieval candidate
   * set. `search()` decides which rows to SHOW (ranked by the query);
   * membership in a structured filter must not depend on how the caller
   * worded the query — the Meridian gate measured 9 vs 20 of 200 true
   * matches for the same filter under two phrasings.
   *
   * One row per post (metadata is identical across a post's chunks).
   * Throws UnorderableFilterError like the filter itself — a census over a
   * filter that cannot work must refuse, not report zero.
   */
  countMetadataMatches(
    siteId: string,
    filters: MetadataFilter[],
    postType?: string,
  ): { matched: number; examined: number } {
    if (!this.conn) throw new Error('SqliteVecStore not initialized');
    if (postType) SqliteVecStore.validatePostType(postType);
    const p = this.tablePrefix(siteId);
    const tableExists = this.conn
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
      .get(`${p}_docs`);
    if (!tableExists) return { matched: 0, examined: 0 };

    let sql = `SELECT post_type, metadata FROM "${p}_docs" GROUP BY post_id`;
    const params: unknown[] = [];
    if (postType) {
      sql = `SELECT post_type, metadata FROM "${p}_docs" WHERE post_type = ? GROUP BY post_id`;
      params.push(postType);
    }
    const rows = this.conn.prepare(sql).all(...params) as Array<{ post_type: string; metadata: string }>;

    let matched = 0;
    for (const row of rows) {
      let custom: Record<string, unknown> = {};
      try {
        const meta = JSON.parse(row.metadata);
        if (meta && typeof meta.customFields === 'object' && meta.customFields) custom = meta.customFields;
      } catch {
        /* malformed metadata → no fields; the filter fails closed on it */
      }
      if (applyMetadataFilters(custom, filters)) matched++;
    }
    return { matched, examined: rows.length };
  }

  // Implemented in Task 5
  async lookupById(siteId: string, docId: string): Promise<{ id: string; content: string; title: string } | null> {
    if (!/^[a-zA-Z0-9:_\-]+$/.test(docId)) return null;
    const p = this.tablePrefix(siteId);
    const tableExists = this.conn.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(`${p}_docs`);
    if (!tableExists) return null;
    const row = this.conn.prepare(`SELECT id, title, content FROM "${p}_docs" WHERE id = ?`).get(docId) as
      | { id: string; title: string; content: string }
      | undefined;
    return row ?? null;
  }

  async getAllDocuments(siteId: string): Promise<Array<{
    id: string;
    postId: number;
    postType: string;
    title: string;
    content: string;
    embedding: Float32Array;
    metadata: string;
  }>> {
    const p = this.tablePrefix(siteId);

    // Return [] if site hasn't been indexed yet
    const tableExists = this.conn
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
      .get(`${p}_docs`);
    if (!tableExists) return [];

    // Join _docs to _vec on rowid, one row per post (chunk_index = 0)
    // chunk_index = 0 is the first (or only) chunk per post — representative embedding
    const rows = this.conn
      .prepare(`
        SELECT d.id, d.post_id, d.post_type, d.title, d.content, d.metadata,
               v.embedding
        FROM "${p}_docs" d
        JOIN "${p}_vec" v ON d.rowid = v.rowid
        WHERE d.chunk_index = 0
      `)
      .all() as Array<{
        id: string;
        post_id: number;
        post_type: string;
        title: string;
        content: string;
        metadata: string;
        embedding: Buffer;
      }>;

    return rows.map(row => ({
      id: row.id,
      postId: row.post_id,
      postType: row.post_type,
      title: row.title,
      content: row.content,
      metadata: row.metadata,
      // sqlite-vec returns embedding as a raw Buffer (BLOB) — convert to Float32Array
      embedding: new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      ),
    }));
  }

  async delete(siteId: string, documentIds: string[]): Promise<void> {
    const p = this.tablePrefix(siteId);
    const tableExists = this.conn.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(`${p}_docs`);
    if (!tableExists) return;

    const getRowid = this.conn.prepare<[string]>(`SELECT rowid FROM "${p}_docs" WHERE id = ?`);
    const deleteVec = this.conn.prepare<[number]>(`DELETE FROM "${p}_vec" WHERE rowid = ?`);
    const deleteFts = this.conn.prepare<[number]>(`DELETE FROM "${p}_fts" WHERE rowid = ?`);
    const deleteDoc = this.conn.prepare<[string]>(`DELETE FROM "${p}_docs" WHERE id = ?`);

    if (documentIds.length === 1 && documentIds[0] === '__all__') {
      this.conn.transaction(() => {
        this.conn.exec(`DELETE FROM "${p}_vec"`);
        this.conn.exec(`DELETE FROM "${p}_fts"`);
        this.conn.exec(`DELETE FROM "${p}_docs"`);
      })();
      return;
    }

    this.conn.transaction(() => {
      for (const id of documentIds) {
        const existing = getRowid.get(id) as { rowid: number } | undefined;
        if (existing) {
          deleteVec.run(existing.rowid);
          deleteFts.run(existing.rowid);
          deleteDoc.run(id);
        }
      }
    })();
  }

  async dropSite(siteId: string): Promise<void> {
    const p = this.tablePrefix(siteId);
    this.conn.transaction(() => {
      this.conn.exec(`DROP TABLE IF EXISTS "${p}_fts"`);
      this.conn.exec(`DROP TABLE IF EXISTS "${p}_vec"`);
      this.conn.exec(`DROP TABLE IF EXISTS "${p}_docs"`);
    })();
  }

  async dropAllTables(): Promise<number> {
    const sites = await this.listSites();
    for (const siteId of sites) {
      await this.dropSite(siteId);
    }
    return sites.length;
  }

  async listSites(): Promise<string[]> {
    const rows = this.conn.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'site_%_docs' ORDER BY name`,
    ).all() as { name: string }[];
    // Strip "site_" prefix and "_docs" suffix. For local/WPE ids (identity-mapped
    // by vectorSiteId — no invalid characters, so nothing was ever sanitized) this
    // DOES recover the original siteId exactly. For external multi-site ids (which
    // contained a `:` or `/` and were therefore sanitized + hash-suffixed), the
    // sanitization and hashing in vectorSiteId() are one-way — this returns the
    // opaque, non-reversible table key, not the original siteId.
    return rows.map(({ name }) => name.slice('site_'.length, -'_docs'.length));
  }

  async cleanupExcludedTypes(
    excludedTypes: string[],
    onProgress?: (current: number, total: number, tableName: string) => void,
  ): Promise<{ tablesScanned: number; docsRemoved: number }> {
    if (excludedTypes.length === 0) return { tablesScanned: 0, docsRemoved: 0 };
    excludedTypes.forEach(t => SqliteVecStore.validatePostType(t));

    const sites = await this.listSites();
    let docsRemoved = 0;
    const placeholders = excludedTypes.map(() => '?').join(', ');

    for (let i = 0; i < sites.length; i++) {
      const siteId = sites[i];
      const p = this.tablePrefix(siteId);
      onProgress?.(i + 1, sites.length, `${p}_docs`);

      try {
        const toDelete = this.conn.prepare(
          `SELECT rowid, id FROM "${p}_docs" WHERE post_type IN (${placeholders})`,
        ).all(...excludedTypes) as { rowid: number; id: string }[];

        if (toDelete.length === 0) continue;

        const deleteVec = this.conn.prepare<[number]>(`DELETE FROM "${p}_vec" WHERE rowid = ?`);
        const deleteFts = this.conn.prepare<[number]>(`DELETE FROM "${p}_fts" WHERE rowid = ?`);
        const deleteDoc = this.conn.prepare<[string]>(`DELETE FROM "${p}_docs" WHERE id = ?`);

        this.conn.transaction(() => {
          for (const { rowid, id } of toDelete) {
            deleteVec.run(rowid);
            deleteFts.run(rowid);
            deleteDoc.run(id);
          }
        })();

        docsRemoved += toDelete.length;
      } catch { /* skip site on error */ }
    }

    return { tablesScanned: sites.length, docsRemoved };
  }

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

  // No-op — sqlite-vec doesn't need compaction
  async optimize(_siteId: string): Promise<void> { /* intentional no-op */ }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
