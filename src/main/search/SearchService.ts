/**
 * SearchService
 *
 * Unified search orchestration across all data sources.
 * Combines vector search (content) with metadata search (plugins, themes, users).
 */
import type { VectorStore } from '../vector-store/VectorStore';
import type { GraphService } from '../events/GraphService';
import type { EmbeddingService } from '../embeddings/EmbeddingService';
import type { IndexRegistry } from '../content/IndexRegistry';
import type {
  SearchFilters,
  SearchOptions,
  SearchResults,
  UnifiedSearchResult,
  SearchFacets,
  VectorResult,
  MetadataResult,
} from './types';
import type { SearchResult as VectorSearchResult } from '../../common/types';

export class SearchService {
  constructor(
    private vectorStore: VectorStore,
    private graphService: GraphService,
    private embeddingService: EmbeddingService,
    private indexRegistry: IndexRegistry
  ) {}

  /**
   * Search across all sites and content types
   */
  async searchFleet(
    query: string,
    filters?: SearchFilters,
    options?: SearchOptions
  ): Promise<SearchResults> {
    // 1. Generate query embedding
    const [queryVector] = await this.embeddingService.embedBatch([query]);

    // 2. Vector search across all indexed sites
    const vectorResults = await this.searchAllSites(queryVector, filters);

    // 3. Metadata search in GraphService (plugins, themes, users)
    const metadataResults = await this.searchMetadata(query, filters);

    // 4. Merge and rank results
    const merged = this.mergeResults(vectorResults, metadataResults);

    // 5. Apply filters
    const filtered = this.applyFilters(merged, filters);

    // 6. Sort by relevance
    const sorted = this.sortByRelevance(filtered, options?.sortBy || 'relevance');

    // 7. Paginate
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;
    const paginated = sorted.slice(offset, offset + limit);

    return {
      results: paginated,
      total: sorted.length,
      facets: this.computeFacets(sorted),
    };
  }

  /**
   * Search vector store across all indexed sites
   */
  private async searchAllSites(
    queryVector: Float32Array,
    filters?: SearchFilters
  ): Promise<VectorResult[]> {
    const indexedSites = this.indexRegistry
      .listAll()
      .filter(e => e.state === 'indexed');

    const results: VectorResult[] = [];

    for (const entry of indexedSites) {
      // Skip if site filter doesn't include this site
      if (filters?.siteIds && !filters.siteIds.includes(entry.siteId)) {
        continue;
      }

      try {
        const siteResults: VectorSearchResult[] = await this.vectorStore.search(
          entry.siteId,
          queryVector,
          { limit: 10 }
        );

        // Parse metadata string to object
        results.push(
          ...siteResults.map(r => {
            let parsedMetadata: Record<string, any> = {};
            try {
              parsedMetadata = typeof r.metadata === 'string'
                ? JSON.parse(r.metadata)
                : r.metadata;
            } catch {
              // If parsing fails, use empty object
            }

            return {
              siteId: entry.siteId,
              siteName: entry.siteName,
              type: 'post' as const,
              title: r.title || 'Untitled',
              excerpt: r.content.slice(0, 200),
              metadata: parsedMetadata,
              score: r.score,
              lastUpdated: parsedMetadata.updated_at || Date.now(),
            };
          })
        );
      } catch (err) {
        // Skip sites that error (may not have content indexed)
      }
    }

    return results;
  }

  /**
   * Search metadata (plugins, themes, users)
   */
  private async searchMetadata(
    query: string,
    filters?: SearchFilters
  ): Promise<MetadataResult[]> {
    const results: MetadataResult[] = [];

    // Search plugins by name/slug
    if (!filters?.contentTypes || filters.contentTypes.includes('plugin')) {
      const plugins = await this.graphService.searchPlugins(query);
      results.push(...plugins);
    }

    // Search themes
    if (!filters?.contentTypes || filters.contentTypes.includes('theme')) {
      const themes = await this.graphService.searchThemes(query);
      results.push(...themes);
    }

    // Search users
    if (!filters?.contentTypes || filters.contentTypes.includes('user')) {
      const users = await this.graphService.searchUsers(query);
      results.push(...users);
    }

    return results;
  }

  /**
   * Merge vector and metadata results
   */
  private mergeResults(
    vectorResults: VectorResult[],
    metadataResults: MetadataResult[]
  ): UnifiedSearchResult[] {
    const merged: UnifiedSearchResult[] = [];

    // Add vector results (posts)
    for (const result of vectorResults) {
      merged.push({
        ...result,
        siteHealth: 0, // Will be populated later
      });
    }

    // Add metadata results (plugins, themes, users)
    for (const result of metadataResults) {
      merged.push({
        ...result,
        siteHealth: 0, // Will be populated later
      });
    }

    return merged;
  }

  /**
   * Apply filters to results
   */
  private applyFilters(
    results: UnifiedSearchResult[],
    filters?: SearchFilters
  ): UnifiedSearchResult[] {
    if (!filters) return results;

    let filtered = results;

    // Content type filter
    if (filters.contentTypes && filters.contentTypes.length > 0) {
      filtered = filtered.filter(r => filters.contentTypes!.includes(r.type));
    }

    // Site filter
    if (filters.siteIds && filters.siteIds.length > 0) {
      filtered = filtered.filter(r => filters.siteIds!.includes(r.siteId));
    }

    // Date range filter
    if (filters.dateRange) {
      filtered = filtered.filter(
        r =>
          r.lastUpdated >= filters.dateRange!.start &&
          r.lastUpdated <= filters.dateRange!.end
      );
    }

    // Health range filter
    if (filters.healthMin !== undefined) {
      filtered = filtered.filter(r => r.siteHealth >= filters.healthMin!);
    }
    if (filters.healthMax !== undefined) {
      filtered = filtered.filter(r => r.siteHealth <= filters.healthMax!);
    }

    return filtered;
  }

  /**
   * Sort results by relevance or other criteria
   */
  private sortByRelevance(
    results: UnifiedSearchResult[],
    sortBy: 'relevance' | 'date' | 'health' | 'title'
  ): UnifiedSearchResult[] {
    const sorted = [...results];

    switch (sortBy) {
      case 'relevance':
        sorted.sort((a, b) => b.score - a.score);
        break;
      case 'date':
        sorted.sort((a, b) => b.lastUpdated - a.lastUpdated);
        break;
      case 'health':
        sorted.sort((a, b) => b.siteHealth - a.siteHealth);
        break;
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }

    return sorted;
  }

  /**
   * Compute result facets (for filtering UI)
   */
  private computeFacets(results: UnifiedSearchResult[]): SearchFacets {
    return {
      types: this.countByType(results),
      sites: this.countBySite(results),
      healthRanges: this.countByHealthRange(results),
    };
  }

  /**
   * Count results by type
   */
  private countByType(results: UnifiedSearchResult[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const result of results) {
      counts[result.type] = (counts[result.type] || 0) + 1;
    }

    return counts;
  }

  /**
   * Count results by site
   */
  private countBySite(results: UnifiedSearchResult[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const result of results) {
      counts[result.siteId] = (counts[result.siteId] || 0) + 1;
    }

    return counts;
  }

  /**
   * Count results by health range
   */
  private countByHealthRange(results: UnifiedSearchResult[]): {
    critical: number;
    warning: number;
    good: number;
  } {
    let critical = 0;
    let warning = 0;
    let good = 0;

    for (const result of results) {
      if (result.siteHealth < 50) {
        critical++;
      } else if (result.siteHealth < 80) {
        warning++;
      } else {
        good++;
      }
    }

    return { critical, warning, good };
  }
}
