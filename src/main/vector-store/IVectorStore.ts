// src/main/vector-store/IVectorStore.ts
import { VectorDocument, SearchOptions, SearchResult, SiteIndexStats } from '../../common/types';

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
