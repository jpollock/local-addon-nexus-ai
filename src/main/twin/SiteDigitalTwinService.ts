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
  TwinPlugin,
  TwinTheme,
} from './SiteDigitalTwin';
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

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

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

      if (meta.wpVersion)  sources['wpVersion']  = src('wpVersion');
      if (meta.phpVersion) sources['phpVersion']  = src('phpVersion');
      if (meta.mysqlVersion) sources['mysqlVersion'] = src('mysqlVersion');
      if (meta.siteUrl)    sources['siteUrl']     = src('siteUrl');
      if (meta.adminEmail) sources['adminEmail']  = src('adminEmail');
      if (meta.activeTheme) sources['activeTheme'] = src('activeTheme');
      if (meta.postCount != null) sources['postCount'] = src('postCount');
      if (meta.lastPostAt != null) sources['lastPostAt'] = src('lastPostAt');

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
    const stale  = entries.filter((e) => e.ageMs > STALE_THRESHOLD_MS);
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
