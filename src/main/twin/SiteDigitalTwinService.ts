/**
 * SiteDigitalTwinService
 *
 * Assembles SiteDigitalTwin objects on demand from the four existing stores.
 * Does NOT write to any store — it is a pure read model.
 *
 * Usage:
 *   const twin = twinService.get(siteId);
 *   const all  = twinService.getAll();
 *   const freshness = twinService.getFreshness(twin);
 */

import type {
  SiteDigitalTwin,
  TwinCompleteness,
  TwinFreshnessReport,
  FieldFreshness,
  FieldSource,
  DataMethod,
  CanAnswerResult,
  TwinPlugin,
  TwinTheme,
} from './SiteDigitalTwin';
import { HOUR_MS, DAY_MS } from './twin-helpers';
import type { SiteMetadataCache } from '../metadata/SiteMetadataCache';
import type { IndexRegistry } from '../content/IndexRegistry';
import type { SiteDataAccessor } from '../mcp/types';

interface TwinServiceDeps {
  siteData: SiteDataAccessor;
  metadataCache: SiteMetadataCache;
  indexRegistry: IndexRegistry;
  /** Optional: GraphService for graph-side data (WPE link, usage) */
  graphService?: any;
}

// Identity fields — always present, no staleness concern
const IDENTITY_FIELDS = new Set<string>([
  'siteId', 'siteName', 'domain', 'path', 'source', 'sources', 'completeness', 'asOf',
]);

export class SiteDigitalTwinService {
  constructor(private deps: TwinServiceDeps) {}

  /**
   * Assemble a SiteDigitalTwin for one site.
   * Returns null if the site doesn't exist in Local's siteData.
   */
  get(siteId: string): SiteDigitalTwin | null {
    const { siteData, metadataCache, indexRegistry, graphService } = this.deps;

    const site = siteData.getSite(siteId);
    if (!site) return null;

    const sources: Partial<Record<string, FieldSource>> = {};
    const twin: SiteDigitalTwin = {
      siteId: site.id,
      siteName: site.name,
      domain: site.domain ?? '',
      path: site.path ?? '',
      source: 'local',
      sources,
      completeness: 'none',
      asOf: null,
    };

    // ── Identity from siteData ────────────────────────────────────────────
    const siteTs = Date.now(); // siteData is always current
    sources['siteName'] = { method: 'local-site', timestamp: siteTs, requiresRunning: false };
    sources['domain']   = { method: 'local-site', timestamp: siteTs, requiresRunning: false };
    sources['path']     = { method: 'local-site', timestamp: siteTs, requiresRunning: false };

    // ── Metadata cache ────────────────────────────────────────────────────
    const meta = metadataCache.getWithAge(siteId);
    if (meta) {
      const metaTs = meta.lastUpdated;
      const method = (meta.scanDepth === 'filesystem') ? 'filesystem' : 'wp-cli';
      const requiresRunning = method === 'wp-cli';

      const src = (field: string): FieldSource => ({
        method,
        timestamp: metaTs,
        requiresRunning,
      });

      twin.wpVersion  = meta.wpVersion  || undefined;
      twin.phpVersion = meta.phpVersion || undefined;
      twin.mysqlVersion = meta.mysqlVersion || undefined;
      twin.siteUrl    = meta.siteUrl    || undefined;
      twin.adminEmail = meta.adminEmail || undefined;
      twin.activeTheme = meta.activeTheme || undefined;
      twin.postCount  = meta.postCount;
      twin.postCountByType = meta.postCountByType;
      twin.lastPostAt = meta.lastPostAt;
      twin.lastActiveSession = meta.lastActiveSession;
      twin.wpConfigMtime = meta.wpConfigMtime;

      if (meta.wpVersion)  sources['wpVersion']  = src('wpVersion');
      if (meta.phpVersion) sources['phpVersion']  = src('phpVersion');
      if (meta.mysqlVersion) sources['mysqlVersion'] = src('mysqlVersion');
      if (meta.siteUrl)    sources['siteUrl']     = src('siteUrl');
      if (meta.adminEmail) sources['adminEmail']  = src('adminEmail');
      if (meta.activeTheme) sources['activeTheme'] = src('activeTheme');
      if (meta.postCount != null) sources['postCount'] = src('postCount');
      if (meta.lastPostAt != null) sources['lastPostAt'] = src('lastPostAt');
      if (meta.lastActiveSession != null) sources['lastActiveSession'] = src('lastActiveSession');
      if (meta.wpConfigMtime != null) sources['wpConfigMtime'] = src('wpConfigMtime');

      // Plugins
      if (meta.plugins?.length) {
        twin.plugins = meta.plugins.map((p): TwinPlugin => ({
          name: p.name, title: p.title, version: p.version, status: p.status, file: p.file,
        }));
        sources['plugins'] = src('plugins');
      } else if (meta.installedPlugins?.length) {
        twin.installedPlugins = meta.installedPlugins;
        sources['installedPlugins'] = src('installedPlugins');
      }

      // Themes
      if (meta.themes?.length) {
        twin.themes = meta.themes.map((t): TwinTheme => ({
          name: t.name, title: t.title, version: t.version, status: t.status,
        }));
        sources['themes'] = src('themes');
      } else if (meta.installedThemes?.length) {
        twin.installedThemes = meta.installedThemes;
        sources['installedThemes'] = src('installedThemes');
      }
    }

    // ── IndexRegistry ─────────────────────────────────────────────────────
    const entry = indexRegistry.get(siteId);
    if (entry) {
      twin.indexState    = entry.state as any;
      twin.documentCount = entry.documentCount;
      twin.chunkCount    = entry.chunkCount;
      twin.lastIndexed   = entry.lastIndexed;

      const indexTs = entry.lastIndexed ?? Date.now();
      sources['indexState']    = { method: 'index', timestamp: indexTs, requiresRunning: false };
      sources['documentCount'] = { method: 'index', timestamp: indexTs, requiresRunning: false };
      sources['lastIndexed']   = { method: 'index', timestamp: indexTs, requiresRunning: false };
    } else {
      twin.indexState = 'never';
    }

    // ── GraphService (optional — WPE link + usage) ────────────────────────
    if (graphService) {
      try {
        const db = graphService.getDb?.();
        if (db) {
          // WPE link from sites table
          const graphRow = db.prepare(
            'SELECT source, remote_install_id, remote_domain, account_id, last_sync_at FROM sites WHERE id = ?'
          ).get(siteId) as any;

          if (graphRow?.source === 'wpe') {
            twin.source = 'wpe';
            twin.wpeInstallId = graphRow.remote_install_id ?? undefined;
            twin.wpeDomain    = graphRow.remote_domain ?? undefined;
            twin.wpeAccountId = graphRow.account_id ?? undefined;

            const graphTs = graphRow.last_sync_at ?? Date.now();
            if (twin.wpeInstallId) sources['wpeInstallId'] = { method: 'local-graph', timestamp: graphTs, requiresRunning: false };
            if (twin.wpeDomain)    sources['wpeDomain']    = { method: 'local-graph', timestamp: graphTs, requiresRunning: false };
            if (twin.wpeAccountId) sources['wpeAccountId'] = { method: 'local-graph', timestamp: graphTs, requiresRunning: false };
          }

          // Latest usage record
          const usageRows = graphService.getSiteUsage?.(siteId);
          if (usageRows?.length) {
            const u = usageRows[0]; // newest period first
            twin.usage = {
              period:         u.period,
              visits:         u.visits ?? undefined,
              bandwidthBytes: u.bandwidthBytes ?? undefined,
              storageBytes:   u.storageBytes ?? undefined,
              recordedAt:     u.recordedAt,
            };
            sources['usage'] = { method: 'capi', timestamp: u.recordedAt, requiresRunning: false };
          }
        }
      } catch {
        // GraphService is optional — fail silently
      }
    }

    // ── Computed: completeness + asOf ─────────────────────────────────────
    twin.completeness = computeCompleteness(twin);
    twin.asOf         = computeAsOf(sources);

    return twin;
  }

  /**
   * Assemble a SiteDigitalTwin for a WPE-only graph site (no Local siteData entry).
   * Used when the site was found in the GraphService `sites` table with source='wpe'.
   */
  getFromGraph(graphSite: any, graphService?: any): SiteDigitalTwin {
    const sources: Partial<Record<string, FieldSource>> = {};
    const graphTs: number = graphSite.last_sync_at ?? Date.now();

    const twin: SiteDigitalTwin = {
      siteId:     graphSite.id,
      siteName:   graphSite.name,
      domain:     graphSite.domain ?? graphSite.remote_domain ?? '',
      path:       '',
      source:     'wpe',
      sources,
      completeness: 'none',
      asOf: null,
    };

    const src = (method: DataMethod): FieldSource => ({
      method,
      timestamp: graphTs,
      requiresRunning: false,
    });

    // ── CAPI fields (always available for WPE sites) ─────────────────────
    if (graphSite.wp_version) {
      twin.wpVersion = graphSite.wp_version;
      sources['wpVersion'] = src('capi');
    }
    if (graphSite.php_version) {
      twin.phpVersion = graphSite.php_version;
      sources['phpVersion'] = src('capi');
    }
    // site_url from SSH scan takes precedence over domain
    const siteUrl = graphSite.site_url ?? graphSite.remote_domain ?? graphSite.domain;
    if (siteUrl) {
      twin.siteUrl = siteUrl;
      sources['siteUrl'] = graphSite.site_url ? src('wp-cli') : src('capi');
    }
    if (graphSite.remote_install_id) {
      twin.wpeInstallId = graphSite.remote_install_id;
      sources['wpeInstallId'] = src('capi');
    }
    if (graphSite.account_id) {
      twin.wpeAccountId = graphSite.account_id;
      sources['wpeAccountId'] = src('capi');
    }

    // ── SSH-enriched fields (populated by nexusWpeSiteDeepRefresh) ───────
    if (graphSite.admin_email) {
      twin.adminEmail = graphSite.admin_email;
      sources['adminEmail'] = src('wp-cli');
    }
    if (graphSite.active_theme) {
      twin.activeTheme = graphSite.active_theme;
      sources['activeTheme'] = src('wp-cli');
    }
    if (graphSite.post_count != null) {
      twin.postCount = graphSite.post_count;
      sources['postCount'] = src('wp-cli');
    }

    // ── Plugins + themes from graph DB (sync) ────────────────────────────
    const gs = graphService ?? this.deps.graphService;
    if (gs) {
      try {
        const db = gs.getDb?.();
        if (db) {
          const pluginRows = db.prepare(
            'SELECT slug, name, version, is_active FROM plugins WHERE site_id = ?'
          ).all(graphSite.id) as any[];
          if (pluginRows.length) {
            twin.plugins = pluginRows.map((p) => ({
              name:    p.slug,
              title:   p.name,
              version: p.version ?? undefined,
              status:  p.is_active ? 'active' : 'inactive' as 'active' | 'inactive',
            }));
            sources['plugins'] = src('wp-cli');
          }

          const themeRows = db.prepare(
            'SELECT slug, name, version, is_active FROM themes WHERE site_id = ?'
          ).all(graphSite.id) as any[];
          if (themeRows.length) {
            twin.themes = themeRows.map((t) => ({
              name:    t.slug,
              title:   t.name,
              version: t.version ?? undefined,
              status:  t.is_active ? 'active' : 'inactive' as 'active' | 'inactive',
            }));
            sources['themes'] = src('wp-cli');
          }
        }
      } catch { /* fail silently — graph data is optional */ }

      // Usage data
      try {
        const usageRows = gs.getSiteUsage?.(graphSite.id);
        if (usageRows?.length) {
          const u = usageRows[0];
          twin.usage = {
            period:         u.period,
            visits:         u.visits ?? undefined,
            bandwidthBytes: u.bandwidthBytes ?? undefined,
            storageBytes:   u.storageBytes ?? undefined,
            recordedAt:     u.recordedAt,
          };
          sources['usage'] = src('capi');
        }
      } catch { /* optional — fail silently */ }
    }

    twin.completeness = computeCompleteness(twin);
    twin.asOf         = computeAsOf(sources);

    return twin;
  }

  /**
   * Assemble twins for all sites known to Local's siteData.
   */
  getAll(): SiteDigitalTwin[] {
    const sites = Object.values(this.deps.siteData.getSites());
    return sites
      .map((s: any) => this.get(s.id))
      .filter((t): t is SiteDigitalTwin => t !== null);
  }

  /**
   * Compute a freshness report for a twin — which fields are stale,
   * which require a running site, and what the stalest/freshest fields are.
   */
  getFreshness(twin: SiteDigitalTwin): TwinFreshnessReport {
    const now = Date.now();
    const entries: FieldFreshness[] = Object.entries(twin.sources)
      .map(([field, src]) => ({
        field,
        ageMs: now - src!.timestamp,
        method: src!.method,
        requiresRunning: src!.requiresRunning,
      }));

    const sorted = [...entries].sort((a, b) => b.ageMs - a.ageMs);
    const stale  = entries.filter((e) => e.ageMs > DAY_MS);
    const requiresRunning = entries
      .filter((e) => e.requiresRunning)
      .map((e) => e.field);

    return {
      stalestField:  sorted[0]   ?? null,
      freshestField: sorted[sorted.length - 1] ?? null,
      staleFields:   stale,
      requiresRunningFields: requiresRunning,
    };
  }

  /**
   * Decide whether the twin can answer a question about a specific field.
   *
   * Returns:
   *   can: false   — field has no data; tool should skip or prompt for refresh
   *   can: true    — data exists; confidence indicates how fresh it is
   *   reason       — present when can=false or confidence='stale'; what to do
   *
   * Usage:
   *   const { can, confidence, reason } = twinService.canAnswer(twin, 'plugins');
   *   if (!can) return `Cannot answer: ${reason}`;
   *   if (confidence === 'stale') lines.push(`> ⚠️ ${reason}`);
   */
  canAnswer(twin: SiteDigitalTwin, field: keyof SiteDigitalTwin): CanAnswerResult {
    if (IDENTITY_FIELDS.has(field as string)) {
      return { can: true, confidence: 'high' };
    }

    const src = twin.sources[field as string];
    const hasValue = twin[field] !== undefined && twin[field] !== null;

    if (!src && !hasValue) {
      return {
        can: false,
        confidence: 'stale',
        reason: 'No data available — run nexus_site_refresh to populate',
      };
    }

    if (!src) {
      // Value exists but no provenance — treat as current (inferred/structural)
      return { can: true, confidence: 'high' };
    }

    if (!hasValue) {
      // Source entry exists but field came back empty — data was collected, nothing found
      const hint = src.requiresRunning
        ? 'start the site and run nexus_site_refresh'
        : 'run nexus_site_refresh';
      return { can: false, confidence: 'stale', reason: `Field not populated — ${hint}` };
    }

    const ageMs = Date.now() - src.timestamp;

    if (ageMs > DAY_MS) {
      const hint = src.requiresRunning
        ? 'start the site and run nexus_site_refresh to refresh'
        : 'run nexus_site_refresh to refresh';
      return {
        can: true,
        confidence: 'stale',
        reason: `Data from ${formatAge(ageMs)} — ${hint}`,
      };
    }

    if (ageMs > HOUR_MS) {
      return { can: true, confidence: 'medium' };
    }

    return { can: true, confidence: 'high' };
  }

  /**
   * Format a twin as a human-readable markdown summary.
   * Used by MCP tools that display site information.
   */
  format(twin: SiteDigitalTwin, opts: { showSources?: boolean } = {}): string {
    const lines: string[] = [];
    const age = twin.asOf
      ? formatAge(Date.now() - twin.asOf)
      : 'no data';

    const completenessLabel: Record<TwinCompleteness, string> = {
      none:       '❌ No data',
      filesystem: '🔶 Filesystem only',
      metadata:   '✅ Metadata (WP-CLI)',
      indexed:    '✅ Fully indexed',
    };

    lines.push(`### ${twin.siteName}`);
    lines.push(`**Completeness:** ${completenessLabel[twin.completeness]}  |  **As of:** ${age}`);
    lines.push('');

    if (twin.wpVersion)  lines.push(`- **WordPress:** ${twin.wpVersion}`);
    if (twin.phpVersion) lines.push(`- **PHP:** ${twin.phpVersion}`);
    if (twin.siteUrl)    lines.push(`- **URL:** ${twin.siteUrl}`);

    if (twin.plugins?.length) {
      const active = twin.plugins.filter((p) => p.status === 'active').length;
      lines.push(`- **Plugins:** ${active} active / ${twin.plugins.length} installed`);
    } else if (twin.installedPlugins?.length) {
      lines.push(`- **Plugins:** ${twin.installedPlugins.length} installed _(no status — filesystem scan)_`);
    }

    if (twin.activeTheme) lines.push(`- **Active theme:** ${twin.activeTheme}`);

    if (twin.postCount != null) {
      lines.push(`- **Posts:** ${twin.postCount} published`);
    }

    if (twin.wpConfigMtime) {
      const ageDays = Math.floor((Date.now() - twin.wpConfigMtime * 1000) / (24 * 60 * 60 * 1000));
      const ageLabel = ageDays > 365
        ? `⚠️ ${Math.floor(ageDays / 365)}y ${ageDays % 365}d ago (consider rotating salts)`
        : `${ageDays}d ago`;
      lines.push(`- **wp-config.php last modified:** ${ageLabel}`);
    }

    if (twin.indexState) {
      const stateIcon = twin.indexState === 'indexed' ? '✅'
        : twin.indexState === 'stale'   ? '⚠️'
        : twin.indexState === 'error'   ? '❌'
        : twin.indexState === 'never'   ? '—'
        : '🔄';
      const docs = twin.documentCount ? ` (${twin.documentCount} docs)` : '';
      lines.push(`- **Index:** ${stateIcon} ${twin.indexState}${docs}`);
    }

    if (twin.usage) {
      const mb = twin.usage.bandwidthBytes
        ? `${(twin.usage.bandwidthBytes / 1e6).toFixed(0)} MB`
        : '—';
      lines.push(`- **WPE usage (${twin.usage.period}):** ${twin.usage.visits ?? '—'} visits, ${mb} bandwidth`);
    }

    if (opts.showSources && Object.keys(twin.sources).length > 0) {
      lines.push('');
      lines.push('**Sources:**');
      for (const [field, src] of Object.entries(twin.sources)) {
        if (!src) continue;
        const age = formatAge(Date.now() - src.timestamp);
        lines.push(`- \`${field}\`: ${src.method} (${age})`);
      }
    }

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeCompleteness(twin: SiteDigitalTwin): TwinCompleteness {
  if (twin.indexState === 'indexed' && twin.plugins?.length) return 'indexed';
  if (twin.plugins?.length || twin.postCount != null)        return 'metadata';
  if (twin.wpVersion || twin.installedPlugins?.length)       return 'filesystem';
  return 'none';
}

function computeAsOf(sources: Partial<Record<string, FieldSource>>): number | null {
  const timestamps = Object.values(sources)
    .filter((s): s is FieldSource => !!s)
    .map((s) => s.timestamp);
  if (!timestamps.length) return null;
  return Math.min(...timestamps);
}

function formatAge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60)                      return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)                      return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)                      return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
