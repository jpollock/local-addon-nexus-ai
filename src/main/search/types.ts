/**
 * Search System Types
 *
 * Type definitions for unified search, filtering, and result ranking.
 */

/**
 * Search filters for refining results
 */
export interface SearchFilters {
  contentTypes?: string[];  // ['post', 'plugin', 'theme', 'user']
  siteIds?: string[];       // Filter by specific sites
  dateRange?: {
    start: number;          // Timestamp
    end: number;            // Timestamp
  };
  healthMin?: number;       // Minimum health score (0-100)
  healthMax?: number;       // Maximum health score (0-100)
}

/**
 * Search options for pagination and sorting
 */
export interface SearchOptions {
  limit?: number;           // Results per page (default: 20)
  offset?: number;          // Page offset (default: 0)
  sortBy?: 'relevance' | 'date' | 'health' | 'title';
  vectorSearch?: boolean;   // Enable/disable vector search (default: true)
}

/**
 * Single unified search result
 */
export interface UnifiedSearchResult {
  type: 'post' | 'plugin' | 'theme' | 'user' | 'setting';
  siteId: string;
  siteName: string;
  siteHealth: number;        // 0-100
  title: string;
  excerpt: string;
  metadata: Record<string, any>;
  score: number;             // Relevance score (0-1)
  lastUpdated: number;       // Timestamp
}

/**
 * Search results with pagination metadata
 */
export interface SearchResults {
  results: UnifiedSearchResult[];
  total: number;
  facets: SearchFacets;
}

/**
 * Result facets for filtering UI
 */
export interface SearchFacets {
  types: Record<string, number>;       // { post: 10, plugin: 5, ... }
  sites: Record<string, number>;       // { site-id: 3, ... }
  healthRanges: {
    critical: number;  // 0-49
    warning: number;   // 50-79
    good: number;      // 80-100
  };
}

/**
 * Vector search result (internal)
 */
export interface VectorResult {
  siteId: string;
  siteName: string;
  type: 'post';
  title: string;
  excerpt: string;
  metadata: Record<string, any>;
  score: number;
  lastUpdated: number;
}

/**
 * Metadata search result (internal)
 */
export interface MetadataResult {
  siteId: string;
  siteName: string;
  type: 'plugin' | 'theme' | 'user';
  title: string;
  excerpt: string;
  metadata: Record<string, any>;
  score: number;
  lastUpdated: number;
}
