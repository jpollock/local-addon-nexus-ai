/**
 * SiteDigitalTwin — unified read model for a WordPress site.
 *
 * A plain data structure assembled on demand from four stores:
 *   - SiteMetadataCache  (filesystem + WP-CLI scans)
 *   - IndexRegistry      (content indexing state)
 *   - GraphService       (graph-side plugins/themes/WPE link/usage)
 *   - siteData           (Local's own site record — identity)
 *
 * The twin is a VIEW, not a store. Nothing writes to it directly.
 * Call SiteDigitalTwinService.get(siteId) to assemble one on demand.
 *
 * Design principles:
 *   - Every optional field has a corresponding sources entry that records
 *     where it came from, when, and whether it required a running site.
 *   - "completeness" summarises the overall data quality in one enum so
 *     tools can make a single branch decision ("do I have enough to answer?").
 *   - "asOf" is the timestamp of the oldest populated field — the weakest
 *     link in the data. Use it to surface freshness to users.
 */

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export type DataMethod =
  | 'filesystem'   // Read from disk without WP-CLI (always available)
  | 'wp-cli'       // WP-CLI invocation (requires running site)
  | 'capi'         // WP Engine CAPI call (requires network)
  | 'local-graph'  // GraphService SQLite (persisted from previous sync)
  | 'index'        // ContentPipeline / IndexRegistry
  | 'local-site';  // Local's own siteData service

export interface FieldSource {
  method: DataMethod;
  timestamp: number;        // Unix ms when this field was last updated
  requiresRunning: boolean; // Whether this data needs the site process running
}

// ---------------------------------------------------------------------------
// Plugin / theme shapes (minimal — mirrors existing types)
// ---------------------------------------------------------------------------

export interface TwinPlugin {
  name: string;
  title?: string;
  version?: string;
  status?: 'active' | 'inactive'; // absent when filesystem-only
  file?: string;
}

export interface TwinTheme {
  name: string;
  title?: string;
  version?: string;
  status?: 'active' | 'inactive'; // absent when filesystem-only
}

// ---------------------------------------------------------------------------
// Usage snapshot (WPE only)
// ---------------------------------------------------------------------------

export interface TwinUsage {
  period: string;          // 'YYYY-MM'
  visits?: number;
  bandwidthBytes?: number;
  storageBytes?: number;
  recordedAt: number;      // when this was fetched from CAPI
}

// ---------------------------------------------------------------------------
// Completeness levels
// ---------------------------------------------------------------------------

/**
 * 'none'       — no data in any store
 * 'filesystem' — WP version + installed plugin/theme dir names (no status)
 * 'metadata'   — full WP-CLI scan: plugin/theme status, post counts, etc.
 * 'indexed'    — metadata + content indexed in vector store
 */
export type TwinCompleteness = 'none' | 'filesystem' | 'metadata' | 'indexed';

// ---------------------------------------------------------------------------
// The twin
// ---------------------------------------------------------------------------

export interface SiteDigitalTwin {
  // Identity (always present — comes from Local's siteData)
  siteId: string;
  siteName: string;
  domain: string;
  path: string;
  source: 'local' | 'wpe';

  // ── Core WP attributes ────────────────────────────────────────────────────
  wpVersion?: string;
  phpVersion?: string;
  mysqlVersion?: string;
  siteUrl?: string;
  adminEmail?: string;
  isMultisite?: boolean;

  // ── Plugins & themes ──────────────────────────────────────────────────────
  /** Full plugin list with active/inactive status. Set on 'metadata' scans. */
  plugins?: TwinPlugin[];
  /** Full theme list with active/inactive status. Set on 'metadata' scans. */
  themes?: TwinTheme[];
  activeTheme?: string;
  /** Dir names only from filesystem scan — no status. Set on 'filesystem' scans. */
  installedPlugins?: string[];
  /** Dir names only from filesystem scan — no status. Set on 'filesystem' scans. */
  installedThemes?: string[];

  // ── Content stats ─────────────────────────────────────────────────────────
  postCount?: number;
  postCountByType?: Record<string, number>;
  lastPostAt?: number;

  // ── Index state ───────────────────────────────────────────────────────────
  indexState?: 'indexed' | 'indexing' | 'stale' | 'error' | 'never';
  documentCount?: number;
  chunkCount?: number;
  lastIndexed?: number;

  // ── WPE link ──────────────────────────────────────────────────────────────
  wpeInstallId?: string;
  wpeEnvironment?: string;
  wpeDomain?: string;
  wpeAccountId?: string;

  // ── Usage (WPE only) ──────────────────────────────────────────────────────
  usage?: TwinUsage;

  // ── Provenance ────────────────────────────────────────────────────────────
  /**
   * Per-field source information. Keys match field names on SiteDigitalTwin.
   * A field may have data but no sources entry if it was inferred.
   */
  sources: Partial<Record<string, FieldSource>>;

  // ── Computed ──────────────────────────────────────────────────────────────
  /**
   * Overall data quality summary.
   * 'none'       — nothing in any store
   * 'filesystem' — WP version + installed dirs, no status
   * 'metadata'   — full WP-CLI data (plugin status, post counts)
   * 'indexed'    — metadata + content in vector store
   */
  completeness: TwinCompleteness;

  /**
   * Timestamp of the oldest populated field (weakest link).
   * null if no data exists.
   */
  asOf: number | null;
}

// ---------------------------------------------------------------------------
// Freshness report (computed from sources)
// ---------------------------------------------------------------------------

export interface FieldFreshness {
  field: string;
  ageMs: number;
  method: DataMethod;
  requiresRunning: boolean;
}

export interface TwinFreshnessReport {
  stalestField: FieldFreshness | null;
  freshestField: FieldFreshness | null;
  /** Fields older than 24 hours */
  staleFields: FieldFreshness[];
  /** Fields that can't be populated without a running site */
  requiresRunningFields: string[];
}
