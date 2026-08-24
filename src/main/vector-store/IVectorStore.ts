// src/main/vector-store/IVectorStore.ts
import { VectorDocument, SearchOptions, SearchResult, SiteIndexStats, MetadataFilter } from '../../common/types';

export interface IVectorStore {
  initialize(): Promise<void>;
  upsert(siteId: string, documents: VectorDocument[]): Promise<void>;
  search(siteId: string, queryVector: Float32Array | number[], options: SearchOptions): Promise<SearchResult[]>;
  searchAcrossSites(
    siteIds: string[],
    queryVector: Float32Array | number[],
    options: SearchOptions & { queryText?: string; excludedTypes?: string[] },
    concurrency?: number,
  ): Promise<Map<string, SearchResult[]>>;
  lookupById(siteId: string, docId: string): Promise<{ id: string; content: string; title: string } | null>;
  /**
   * D23 — how many posts match a metadata filter, evaluated over the FULL
   * document population (never a retrieval candidate set). Optional so
   * alternative stores degrade to "no census available" rather than lying.
   */
  countMetadataMatches?(
    siteId: string,
    filters: MetadataFilter[],
    postType?: string,
  ): { matched: number; examined: number };
  /**
   * Returns all indexed documents for a site, one entry per post (chunk_index = 0).
   * Includes embeddings for semantic clustering and analysis.
   * Returns [] when the site has no index.
   *
   * Primary consumer: SEO Insights agent build_topic_map and find_overlap_candidates.
   */
  getAllDocuments(siteId: string): Promise<Array<{
    id: string;
    postId: number;
    postType: string;
    title: string;
    content: string;
    embedding: Float32Array;
    metadata: string;
  }>>;
  delete(siteId: string, documentIds: string[]): Promise<void>;
  dropSite(siteId: string): Promise<void>;
  dropAllTables(): Promise<number>;
  getSiteStats(siteId: string): Promise<SiteIndexStats>;
  listSites(): Promise<string[]>;
  optimize(siteId: string): Promise<void>;
  close(): Promise<void>;
  cleanupExcludedTypes(
    excludedTypes: string[],
    onProgress?: (current: number, total: number, tableName: string) => void,
  ): Promise<{ tablesScanned: number; docsRemoved: number }>;
}
