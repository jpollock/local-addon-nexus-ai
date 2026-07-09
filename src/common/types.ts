// ---------------------------------------------------------------------------
// Startup lifecycle
// ---------------------------------------------------------------------------

/**
 * Status of the addon's async initialization pipeline. Exposed to the renderer
 * so the dashboard can show an actionable error (with a hint when we recognize
 * the failure mode) instead of an indefinite "Waiting for initialization..."
 * when a service fails to boot.
 */
export interface StartupStatus {
  /** true once every phase has resolved and the MCP server is listening */
  ready: boolean;
  /** name of the phase currently running, or the phase that failed */
  phase: string | null;
  /** null while healthy; set when the outer init catch block fires */
  error: {
    message: string;
    name: string;
    code: string | null;
    /** phase that was active when the error was thrown */
    phase: string;
    /** user-actionable remediation when we recognize the error shape */
    hint: string | null;
  } | null;
}

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
  // Smart Search fields (empty string default for Nexus-indexed docs)
  post_date_gmt: string;
  post_modified_gmt: string;
  doc_url: string;
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

export type AIProvider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'local-gateway';

/** Per-environment on/off flags for one WPE operation type */
export interface WpeEnvFlags {
  development?: boolean;
  staging?: boolean;
  production?: boolean;
}

/**
 * Granular per-operation permissions for WPE access control.
 * Replaces wpeAllowedEnvironments. Missing keys fall back to DEFAULT_OPERATION_PERMISSIONS.
 */
export interface WpeOperationPermissions {
  pull?:       WpeEnvFlags;  // local_wpe_pull
  wpcli_read?: WpeEnvFlags;  // WP-CLI read-only: plugin list, core version, user list, option get, site health
  wpcli?:      WpeEnvFlags;  // WP-CLI write: plugin install/update/activate, core update, post create/update/delete
  push?:       WpeEnvFlags;  // local_wpe_push
  delete?:     WpeEnvFlags;  // delete-install, delete-site, promote-environment, update-install, purge-cache
}

/** A site-level override for one or more operations on a specific install+environment */
export interface WpeSiteException {
  installName: string;   // WPE install name (e.g. "mystore")
  environment: string;   // 'production' | 'staging' | 'development'
  overrides: {
    pull?:       boolean;
    wpcli_read?: boolean;
    wpcli?:      boolean;
    push?:       boolean;
    delete?:     boolean;
  };
}

export interface NexusSettings {
  autoIndex: boolean;
  excludedSiteIds: string[];
  aiProvider?: AIProvider;
  aiModel?: string;      // Model name within provider
  onboardingDismissed?: boolean;
  useLocalGateway?: boolean; // Route all AI requests through Local AI Gateway
  wpeSyncIntervalHours?: number; // How often to auto-sync WPE sites (default: 8)
  wpeSyncAutoEnabled?: boolean;  // Whether WPE SSH metadata sync is enabled (default: false — opt-in)
  haltedSiteRefreshIntervalHours?: number; // How often to refresh halted local sites (default: 24)
  wpeRefreshIntervalHours?: number;         // How often to run WPE SSH refresh cycle (default: 24)
  wpeRefreshAutoEnabled?: boolean;          // Whether WPE SSH site-info refresh is enabled (default: false — opt-in)
  wpeAccountFilter?: string[] | null;       // Account IDs to deep-scan; null/undefined = all accounts
  /** WPE environment types Nexus is allowed to access. Default: staging + development only.
   *  Set to include 'production' to enable production access. */
  wpeAllowedEnvironments?: ('production' | 'staging' | 'development')[];
  /** Granular per-operation permissions. Replaces wpeAllowedEnvironments. */
  wpeOperationPermissions?: WpeOperationPermissions;
  /** Per-install, per-environment overrides for individual operations. */
  wpeSiteExceptions?: WpeSiteException[];
  /** Hours between scheduled local site content index runs. 0 or undefined = manual only. */
  localContentIndexIntervalHours?: number;
  /** Whether the opportunistic content indexer is enabled. Default: false. */
  localContentIndexAutoEnabled?: boolean;
  /** Whether the WPE onboarding banner has been dismissed. */
  wpeBannerDismissed?: boolean;
  /** Whether the "not connected to WPE" callout has been dismissed by Local-only users. */
  wpeNotConnectedBannerDismissed?: boolean;
  /** Whether WPE content index scheduler is enabled (default: false — opt-in) */
  wpeContentIndexAutoEnabled?: boolean;
  /** How often to run WPE content index in hours (default: 24h) */
  wpeContentIndexIntervalHours?: number;
}

export interface SiteAIConfig {
  /** Which AI provider this site is configured to use */
  provider: AIProvider;
  /** Which model (optional) */
  model?: string;
  /** Unix timestamp when this was configured */
  configuredAt: number;
  /** Whether Local AI Gateway was active when this site was configured */
  useLocalGateway?: boolean;
}

// ===== Unified Search Types =====

export type SearchIntent = 'content' | 'metadata' | 'both';

export interface MetadataSearchResult {
  type: 'site-metadata';
  matchKind: 'plugin' | 'theme' | 'wp-version' | 'php-version';
  siteId: string;
  siteName: string;
  siteSource: 'local' | 'wpe';
  field: string;    // e.g. "elementor/elementor.php"
  value: string;    // e.g. "active · v3.21.0"
  score: number;    // 0–1
}

export interface ContentSearchResult {
  type: 'content';
  siteId: string;
  siteName: string;
  postId: number;
  title: string;
  excerpt: string;
  postType: string;
  score: number;
}

export type UnifiedSearchResult = MetadataSearchResult | ContentSearchResult;

export interface UnifiedSearchResponse {
  intent: SearchIntent;
  metadataResults: MetadataSearchResult[];
  contentResults: ContentSearchResult[];
}

// ===== Fleet Completeness Types =====

export interface FleetCompleteness {
  total: number;
  scanned: number;    // L1: site known to Nexus
  configured: number; // L2: active plugins/users known
  searchable: number; // L3: content indexed
  lastUpdatedMs: number | null;
  /** false when graph.db is not yet ready — renderer should retry in a few seconds */
  graphReady: boolean;
}

// ===== AI Assistant Types =====

/**
 * Filter spec returned by AI for fleet-filter intent.
 * The handler executes this against real data — AI must NOT fabricate sites[].
 */
export interface AssistantFilter {
  phpSort?: 'asc' | 'desc';          // oldest/newest PHP first
  wpSort?:  'asc' | 'desc';          // oldest/newest WP first
  phpEolOnly?: boolean;               // only sites on EOL PHP
  phpVersion?: { op: '<' | '>' | '<=' | '>='; version: string };
  pluginSlug?: string;                // e.g. "elementor"
  pluginCategory?: string;            // e.g. "form-builder"
  contentQuery?: string;              // falls through to vector search
}

export interface QueryPlan {
  intent: 'fleet-filter' | 'content-search' | 'site-info' | 'action' | 'explanation';
  summary: string;
  /** Filter spec for fleet-filter intent — handler executes against real data */
  filter?: AssistantFilter;
  /** Populated by handler from real data — AI must NOT fill this in */
  sites?: Array<{
    id?: string;
    name: string;
    meta: string;
    tag?: string;
    tagKind?: 'warn' | 'ok' | 'info';
    source: 'local' | 'wpe';
  }>;
  contentResults?: Array<{
    siteId: string;
    siteName: string;
    title: string;
    excerpt: string;
    score: number;
  }>;
  actions?: Array<{
    label: string;
    kind: 'primary' | 'secondary';
    ipcChannel?: string;
    ipcPayload?: unknown;
  }>;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

export interface AssistantContext {
  mode: 'fleet' | 'site';
  // Fleet fields
  localSiteCount?: number;
  wpeSiteCount?: number;
  indexedCount?: number;
  fleetInsights?: FleetInsight[];
  // Site fields
  siteId?: string;
  siteName?: string;
  phpVersion?: string | null;
  wpVersion?: string | null;
  pluginCount?: number;
  activePlugins?: string[];
  installedPluginCount?: number;
  activeTheme?: string;
  postCount?: number;
  userCount?: number;
  scanDepth?: 'filesystem' | 'full';
  indexState?: string;
  documentCount?: number;
  linkedWpeInstall?: string | null;
  siteStatus?: 'running' | 'halted' | 'unknown';
  siteUrl?: string | null;
  inactivePluginCount?: number;
  lastIndexedAgo?: string | null;
  lastPostAt?: string | null;
  wpSettings?: Record<string, string | number | undefined>;
}

export interface FleetInsight {
  kind: 'warning' | 'info' | 'action';
  title: string;
  detail: string;
  ipcChannel?: string;
  ipcPayload?: unknown;
}

export interface AssistantResponse {
  plan: QueryPlan;
  rawText: string;
}

// ===== Site Data Resolver Types =====

/** Which data path answered a resolver query. */
export interface DataProvenance {
  level: 'live' | 'configured' | 'searchable' | 'scanned' | 'external-api';
  source: string;
  ageSeconds: number | null;
  caveat: string | null;
}

export interface ResolvedData<T> {
  data: T;
  provenance: DataProvenance;
}

export interface ResolvedPluginInfo {
  name: string;
  slug: string;
  version: string;
  status: 'active' | 'inactive';
  updateAvailable?: string | null;
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

// ---------------------------------------------------------------------------
// Bulk Operations (Sprint 3)
// ---------------------------------------------------------------------------

export interface BulkOperationStatus {
  id: string;
  type: string;
  siteIds: string[];
  siteNames?: Record<string, string>;
  status: 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
  progress: { completed: number; total: number; errors: string[] };
  siteResults: Record<string, {
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt: number;
    completedAt?: number;
    error?: string;
  }>;
  createdAt: number;
  completedAt: number | null;
}

// ---------------------------------------------------------------------------
// Site Groups (Sprint 3)
// ---------------------------------------------------------------------------

/** Maps to Local's native SiteGroup type */
export interface SiteGroupInfo {
  id: string;
  name: string;
  siteIds: string[];
  index: number;
}

// ---------------------------------------------------------------------------
// Health Trends (Sprint 3)
// ---------------------------------------------------------------------------

export interface HealthTrend {
  siteId: string;
  snapshots: { score: number; timestamp: number }[];
}

// ---------------------------------------------------------------------------
// Dashboard v2 (Sprint 3)
// ---------------------------------------------------------------------------

export interface DashboardV2Stats {
  healthDistribution: { healthy: number; warning: number; critical: number };
  actionItems: { filterId: string; label: string; count: number; severity: string }[];
  groupSummaries: { groupId: string; name: string; siteCount: number; avgHealth: number }[];
  recentBulkOps: BulkOperationStatus[];
}

// ---------------------------------------------------------------------------
// Credential Sync (Sprint 4)
// ---------------------------------------------------------------------------

export interface CredentialSyncStatus {
  lastSync: number | null;
  providers: string[];
  success: boolean;
  error?: string;
}

export interface CredentialSyncResult {
  siteId: string;
  siteName: string;
  success: boolean;
  providers: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// AI Status (Sprint 4)
// ---------------------------------------------------------------------------

export interface SiteAiStatus {
  siteId: string;
  aiPlugin: 'active' | 'inactive' | 'not_installed';
  credentialsSynced: boolean;
  lastSync: number | null;
  providers: string[];
  proxyConfigured: boolean;
  ollamaAvailable: boolean;
}

export interface AiProxyInfo {
  url: string;
  port: number;
  running: boolean;
  models: string[];
  toolCapableModels: string[];
  toolCount: number;
}

// ---------------------------------------------------------------------------
// Database Scanner
// ---------------------------------------------------------------------------

export interface DbTableInfo {
  name: string;
  rows: number;
  dataSizeBytes: number;
  indexSizeBytes: number;
  totalSizeBytes: number;
}

export interface DbRevisionInfo {
  totalCount: number;
  estimatedSizeBytes: number;
  topPosts: Array<{ postId: number; postTitle: string; revisionCount: number }>;
}

export interface DbTransientInfo {
  expiredCount: number;
  totalCount: number;
  estimatedSizeBytes: number;
}

export interface DbOrphanInfo {
  orphanedPostMeta: number;
  orphanedCommentMeta: number;
  orphanedUserMeta: number;
  /** Top meta keys by orphan count */
  topOrphanedMetaKeys: Array<{ metaKey: string; count: number }>;
}

export interface DbDraftTrashInfo {
  autoDraftCount: number;
  trashedPostCount: number;
  estimatedSizeBytes: number;
}

export interface DbPluginTableInfo {
  leftoverTables: string[];
  /** same tables with plugin attribution where known */
  leftoverTablesWithAttribution: Array<{ tableName: string; likelyPlugin: string | null }>;
  customTables: DbTableInfo[];
}

export interface DbWooCommerceInfo {
  sessionCount: number;
  estimatedSessionSizeBytes: number;
  oldLogCount: number;
}

export interface DbScanResult {
  siteId: string;
  siteName: string;
  scannedAt: number;
  wpVersion: string;
  isWooCommerceActive: boolean;
  tables: DbTableInfo[];
  revisions: DbRevisionInfo;
  transients: DbTransientInfo;
  orphans: DbOrphanInfo;
  draftsAndTrash: DbDraftTrashInfo;
  pluginTables: DbPluginTableInfo;
  wooCommerce: DbWooCommerceInfo | null;
  autoload: {
    totalSizeBytes: number;
    topOptions: Array<{ optionName: string; sizeBytes: number; likelyPlugin: string | null }>;
    inactivePluginOptions: number;
  };
  healthScore: number;
  summary: string[];
  durationMs: number;
}

export interface DbCleanResult {
  siteId: string;
  siteName: string;
  dryRun: boolean;
  cleanedAt: number;
  items: Array<{
    type: string;
    label: string;
    rowsAffected: number;
    success: boolean;
    error?: string;
  }>;
  totalRowsAffected: number;
  estimatedSpaceFreedBytes: number;
}
