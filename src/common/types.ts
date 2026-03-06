// ---------------------------------------------------------------------------
// Vector Store
// ---------------------------------------------------------------------------

export interface VectorDocument {
  /** Unique ID: wp_{siteId}_{postId} or wp_{siteId}_{postId}_chunk_{n} */
  id: string;
  siteId: string;
  title: string;
  content: string;
  postType: string;
  postId: number;
  chunkIndex: number;
  vector: Float32Array;
  /** JSON-serialized metadata (excerpt, author, date, categories, tags, etc.) */
  metadata: string;
  indexedAt: number;
}

export interface SearchOptions {
  limit: number;
  postType?: string;
  /** Minimum relevance score (0-1). Results below this threshold are filtered out. Default: 0.3 */
  relevanceFloor?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  content: string;
  postType: string;
  postId: number;
  score: number;
  metadata: string;
}

export interface SiteIndexStats {
  siteId: string;
  documentCount: number;
  chunkCount: number;
  lastIndexed: number;
}

// ---------------------------------------------------------------------------
// Content Extraction
// ---------------------------------------------------------------------------

export interface ExtractedPost {
  id: number;
  title: string;
  content: string;
  cleanedContent: string;
  excerpt: string;
  postType: string;
  postStatus: string;
  author: string;
  date: string;
  categories: string[];
  tags: string[];
  customFields: Record<string, string>;
}

export interface ExtractedContent {
  posts: ExtractedPost[];
  siteInfo: {
    name: string;
    url: string;
    wpVersion: string;
  };
  extractedAt: number;
  customTables?: CustomTableInfo[];
  warnings?: string[];
  activeThemeSlug?: string;
  activePluginSlugs?: string[];
  users?: UserSummary;
  permalinks?: PermalinkInfo;
  health?: SiteHealthInfo;
}

export interface CustomTableInfo {
  name: string;
  prefix: string;
  rowCount: number;
  pluginGuess: string;
}

export interface UserSummary {
  totalUsers: number;
  roleBreakdown: Record<string, number>;
  customRoles: string[];
}

export interface RestApiInfo {
  namespaces: string[];
  customNamespaces: string[];
  routeCount: number;
}

export interface PermalinkInfo {
  structure: string;
  totalRewriteRules: number;
}

export interface SiteHealthInfo {
  searchEngineVisibility: boolean;
  language: string;
  timezone: string;
  defaultRole: string;
}

export interface SiteStructure {
  themes: ThemeInfo[];
  plugins: PluginInfo[];
  phpVersion: string;
  wpVersion: string;
  isMultisite: boolean;
  hasWooCommerce: boolean;
  hasACF: boolean;
  customTables?: CustomTableInfo[];
  users?: UserSummary;
  restApi?: RestApiInfo;
  permalinks?: PermalinkInfo;
  health?: SiteHealthInfo;
}

export interface ThemeInfo {
  name: string;
  slug: string;
  version: string;
  isActive: boolean;
  isChildTheme: boolean;
  parentTheme?: string;
}

export interface PluginInfo {
  name: string;
  slug: string;
  version: string;
  isActive: boolean;
  description: string;
}

// ---------------------------------------------------------------------------
// Index Registry
// ---------------------------------------------------------------------------

export interface IndexEntry {
  siteId: string;
  siteName: string;
  lastIndexed: number;
  documentCount: number;
  chunkCount: number;
  durationMs: number;
  structure: SiteStructure | null;
  state: 'indexed' | 'indexing' | 'error' | 'stale';
  error?: string;
}

// ---------------------------------------------------------------------------
// Content Pipeline
// ---------------------------------------------------------------------------

export interface IndexResult {
  siteId: string;
  documentsIndexed: number;
  chunksIndexed: number;
  durationMs: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

export interface OllamaModel {
  name: string;
  size: number;
  sizeGB: string;
  parameterSize: string;
  quantization: string;
  family: string;
}

export interface OllamaStatus {
  available: boolean;
  version?: string;
  models: OllamaModel[];
  recommended?: OllamaModel;
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export interface McpConnectionInfo {
  url: string;
  authToken: string;
  port: number;
  version: string;
  tools: string[];
}

// ---------------------------------------------------------------------------
// IPC Responses
// ---------------------------------------------------------------------------

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type ChatProvider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'wpe-gateway';

export interface NexusSettings {
  autoIndex: boolean;
  excludedSiteIds: string[];
  chatProvider?: ChatProvider;
  chatModel?: string;      // Model name within provider
}

// ===== Sprint 1: Visibility Types (Renderer-Safe) =====

/**
 * Event timeline entry for UI display
 */
export interface EventTimelineEntry {
  id: number;
  siteId: string;
  siteName: string;
  eventType: string;
  timestamp: number;
  status: 'pending' | 'processed' | 'failed';
  summary: string;
  details: any;
}

/**
 * Event statistics for dashboard
 */
export interface EventStats {
  total: number;
  today: number;
  yesterday: number;
  pending: number;
  failed: number;
  byType: Record<string, number>;
  healthStatus: 'good' | 'warning' | 'error';
}

/**
 * Storage health for visualization
 */
export interface StorageHealth {
  graphDb: {
    sizeBytes: number;
    path: string;
    eventCount: number;
    oldestEvent: number | null;
    newestEvent: number | null;
  };
  vectorDb: {
    sizeBytes: number;
    path: string;
    tableCount: number;
  };
  pendingEvents: number;
  failedEvents: number;
}

/**
 * Issue for proactive alerts
 */
export interface Issue {
  id: string;
  type: string;
  severity: 'warning' | 'error';
  title: string;
  description: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Search & Discovery (Sprint 2)
// ---------------------------------------------------------------------------

/**
 * Health score breakdown for a site
 */
export interface HealthBreakdown {
  overall: number;
  factors: {
    security: number;
    performance: number;
    maintenance: number;
    activity: number;
    stability: number;
  };
  issues: string[];
  recommendations: string[];
}

/**
 * Smart filter for fleet-wide filtering
 */
export interface SmartFilter {
  id: string;
  category: 'security' | 'maintenance' | 'activity' | 'health';
  label: string;
  description: string;
  count: number;
  severity: 'info' | 'warning' | 'error';
}

/**
 * Saved query for reusable searches
 */
export interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  filters: {
    contentTypes?: string[];
    siteIds?: string[];
    searchText?: string;
  };
  createdAt: number;
  lastRun: number | null;
  resultCount: number;
  pinned: boolean;
}
