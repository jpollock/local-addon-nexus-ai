/**
 * find_outdated_sites
 *
 * Reads from the graph DB (primary) and falls back to the index registry
 * for local sites not yet in the graph. The graph is populated by:
 *   - WPE sync (remote WP-CLI + CAPI) for WPE installs
 *   - WordPress event processor for local sites with the connector plugin
 *
 * The index registry is no longer the primary source — it only captured
 * a snapshot at crawl time and doesn't cover WPE installs after sync.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { groupByVersion, compareVersions } from './version-utils';

interface SiteRecord {
  id: string;
  name: string;
  source: 'local' | 'wpe';
  wp_version: string | null;
  php_version: string | null;
}

interface PluginRecord {
  site_id: string;
  slug: string;
  version: string | null;
}

export const findOutdatedSitesHandler: McpToolHandler = {
  definition: {
    name: 'find_outdated_sites',
    description:
      'Identify sites running older versions of WordPress, PHP, or plugins compared to the latest available versions. Labels each result as [local] or [wpe] and accepts a source filter (wpe or local). Use for prioritizing update work, or to identify sites that need maintenance before go-live. For remote WPE plugin updates, use wp_plugin_update with install_name=.' +
      'the rest of your fleet. Reads from the local graph DB — works for both local sites ' +
      '(after WordPress connector events) and WP Engine installs (after WPE sync). ' +
      'Each site labeled [local] or [wpe]. Filter by source to focus on live WPE environments.',
    inputSchema: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          enum: ['wordpress', 'php', 'plugins'],
          description: 'Which component to check (default: all)',
        },
        source: {
          type: 'string',
          enum: ['local', 'wpe', 'all'],
          description: 'Filter to local sites, WP Engine installs, or all (default: all)',
        },
      },
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const component = args.component as string | undefined;
    const sourceFilter = (args.source as string | undefined) ?? 'all';
    const checkAll = !component;

    // --- Build site list from graph ---
    const graphService = (services as any).graphService;
    const graphSites = new Map<string, SiteRecord>();

    if (graphService?.getDb) {
      try {
        const db = graphService.getDb();
        if (db) {
          const q = sourceFilter === 'all'
            ? 'SELECT id, name, source, wp_version, php_version FROM sites'
            : 'SELECT id, name, source, wp_version, php_version FROM sites WHERE source = ?';
          const params = sourceFilter === 'all' ? [] : [sourceFilter];
          const rows = db.prepare(q).all(...params) as SiteRecord[];
          for (const r of rows) {
            graphSites.set(r.id, { ...r, source: (r.source ?? 'local') as 'local' | 'wpe' });
          }
        }
      } catch { /* graph unavailable */ }
    }

    // --- Supplement with index registry for local sites not in graph ---
    if (sourceFilter !== 'wpe') {
      const entries = services.indexRegistry.listAll().filter((e) => e.structure);
      for (const e of entries) {
        if (!graphSites.has(e.siteId)) {
          graphSites.set(e.siteId, {
            id: e.siteId,
            name: e.siteName || e.siteId,
            source: 'local',
            wp_version: e.structure?.wpVersion ?? null,
            php_version: e.structure?.phpVersion ?? null,
          });
        }
      }
    }

    const sites = Array.from(graphSites.values());

    if (sites.length === 0) {
      const hint = sourceFilter === 'wpe'
        ? 'Run "Sync WP Engine Sites" first.'
        : 'Index your sites or install the WordPress connector.';
      return ok(`No site version data available. ${hint}`);
    }

    const sourceLabel = sourceFilter === 'wpe' ? ' (WP Engine installs only)'
      : sourceFilter === 'local' ? ' (local sites only)' : '';
    const lines: string[] = [`## Outdated Sites Report${sourceLabel}`, `${sites.length} sites in scope`, ''];

    if (checkAll || component === 'wordpress') {
      lines.push(...formatVersionSection('WordPress', sites, (s) => s.wp_version ?? ''));
    }

    if (checkAll || component === 'php') {
      lines.push(...formatVersionSection('PHP', sites, (s) => s.php_version ?? ''));
    }

    if (checkAll || component === 'plugins') {
      const pluginData = await loadPlugins(graphService, sourceFilter, sites.map((s) => s.id));
      lines.push(...formatPluginMismatches(pluginData, graphSites));
    }

    // Plugin version freshness comes from graph.db last_sync_at, NOT from the
    // content index (IndexRegistry). Using the content index timestamp was wrong:
    // reindex_site updates LanceDB embeddings but does NOT refresh plugin versions.
    // Plugin versions are updated by WPE metadata sync (WpeRefreshScheduler) and
    // CAPI sync (WPESyncService) — both write to graph.db sites.last_sync_at.
    const syncWarning = pluginSyncFreshnessWarning(graphService, sourceFilter);
    if (syncWarning) lines.push(syncWarning);

    return ok(lines.join('\n'));
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function siteLabel(s: SiteRecord): string {
  return `${s.name} [${s.source}]`;
}

function formatVersionSection(
  label: string,
  sites: SiteRecord[],
  getVersion: (s: SiteRecord) => string,
): string[] {
  const withVersion = sites.filter((s) => getVersion(s));
  if (withVersion.length === 0) {
    return [`### ${label}`, `- No ${label} version data available`, ''];
  }

  const lines: string[] = [`### ${label}`];
  const groups = groupByVersion(withVersion, getVersion);

  if (groups.size <= 1) {
    const [version] = groups.keys();
    lines.push(`- All ${withVersion.length} site${withVersion.length !== 1 ? 's' : ''} on ${version} ✓`);
    const missing = sites.length - withVersion.length;
    if (missing > 0) lines.push(`- ${missing} site${missing !== 1 ? 's' : ''} with no version data`);
    lines.push('');
    return lines;
  }

  const versions = Array.from(groups.keys()); // newest-first
  const latest = versions[0];

  for (const [version, group] of groups) {
    const names = group.map((s) => siteLabel(s)).join(', ');
    if (version === latest) {
      lines.push(`- Latest: ${version} (${group.length} site${group.length !== 1 ? 's' : ''})`);
    } else {
      lines.push(`- Outdated: ${version} (${group.length} site${group.length !== 1 ? 's' : ''}) — ${names}`);
    }
  }

  const missing = sites.length - withVersion.length;
  if (missing > 0) {
    const caveat = label === 'WordPress'
      ? ' (WP version requires SSH — installs without SSH access show unknown)'
      : label === 'PHP'
      ? ' (PHP version from CAPI — unexpected if you just synced)'
      : '';
    lines.push(`- ${missing} site${missing !== 1 ? 's' : ''} with no ${label} version data${caveat}`);
  }
  lines.push('');
  return lines;
}

async function loadPlugins(
  graphService: any,
  sourceFilter: string,
  siteIds: string[],
): Promise<PluginRecord[]> {
  if (!graphService?.getDb || siteIds.length === 0) return [];
  try {
    const db = graphService.getDb();
    if (!db) return [];
    const placeholders = siteIds.map(() => '?').join(',');
    return db.prepare(
      `SELECT site_id, slug, version FROM plugins WHERE site_id IN (${placeholders})`,
    ).all(...siteIds) as PluginRecord[];
  } catch {
    return [];
  }
}

function formatPluginMismatches(
  plugins: PluginRecord[],
  siteMap: Map<string, SiteRecord>,
): string[] {
  const lines: string[] = ['### Plugin Version Mismatches'];

  if (plugins.length === 0) {
    lines.push('- No plugin data available (sync sites or index locally)');
    lines.push('');
    return lines;
  }

  // slug → version → site labels
  const bySlug = new Map<string, Map<string, string[]>>();
  for (const p of plugins) {
    if (!p.version) continue;
    const site = siteMap.get(p.site_id);
    if (!site) continue;
    let byVersion = bySlug.get(p.slug);
    if (!byVersion) { byVersion = new Map(); bySlug.set(p.slug, byVersion); }
    const list = byVersion.get(p.version);
    if (list) { list.push(siteLabel(site)); } else { byVersion.set(p.version, [siteLabel(site)]); }
  }

  let mismatches = 0;
  for (const [slug, byVersion] of bySlug) {
    if (byVersion.size <= 1) continue;
    const sorted = Array.from(byVersion.entries()).sort(([a], [b]) => compareVersions(b, a));
    const parts = sorted.map(([v, names]) =>
      names.length <= 3
        ? `${v} (${names.join(', ')})`
        : `${v} (${names.length} sites)`,
    );
    lines.push(`- ${slug}: ${parts.join(' vs ')}`);
    mismatches++;
  }

  if (mismatches === 0) lines.push('- No plugin version mismatches detected ✓');
  lines.push('');
  return lines;
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * Check plugin data freshness using graph.db last_sync_at — the correct
 * source for plugin version data. IndexRegistry/LanceDB timestamps are for
 * content embeddings, not plugin versions, and suggest the wrong remediation.
 */
function pluginSyncFreshnessWarning(graphService: any, sourceFilter: string): string | null {
  if (!graphService?.getDb) return null;
  try {
    const db = graphService.getDb();
    if (!db) return null;

    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Check the oldest last_sync_at across relevant sites
    const q = sourceFilter === 'wpe'
      ? "SELECT MIN(last_sync_at) as oldest, COUNT(*) as total, COUNT(CASE WHEN last_sync_at IS NULL THEN 1 END) as never_synced FROM sites WHERE source='wpe' AND is_active=1"
      : sourceFilter === 'local'
      ? "SELECT MIN(last_sync_at) as oldest, COUNT(*) as total, COUNT(CASE WHEN last_sync_at IS NULL THEN 1 END) as never_synced FROM sites WHERE source='local' AND is_active=1"
      : "SELECT MIN(last_sync_at) as oldest, COUNT(*) as total, COUNT(CASE WHEN last_sync_at IS NULL THEN 1 END) as never_synced FROM sites WHERE is_active=1";

    const row = db.prepare(q).get() as { oldest: number | null; total: number; never_synced: number } | undefined;
    if (!row || row.total === 0) return null;

    if (row.never_synced > 0) {
      return `> ℹ️ ${row.never_synced} of ${row.total} sites have never been synced — plugin data may be missing. ` +
        `Enable "Site info updates" in Nexus AI → Settings to schedule automatic syncs.`;
    }

    if (!row.oldest) return null;
    const ageMs = now - row.oldest;
    const ageDays = Math.floor(ageMs / DAY_MS);

    // Only warn if stalest site is > 2 days old (WPE syncs every 4h when enabled)
    if (ageDays >= 2) {
      return `> ℹ️ Plugin data for some sites is ${ageDays}d old. ` +
        `Enable "Site info updates" in Nexus AI → Settings to schedule automatic SSH syncs, ` +
        `or call \`wpe_site_deep_refresh\` for specific installs.`;
    }
    return null;
  } catch {
    return null;
  }
}
