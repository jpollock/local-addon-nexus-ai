import { McpToolHandler, McpToolResult } from '../../types';
import { HOUR_MS, DAY_MS } from '../../../twin/twin-helpers';

interface Match {
  siteName: string;
  version: string;
  status: string;
  source: 'local' | 'wpe';
  lastIndexed?: number;
}

export const findSitesWithPluginHandler: McpToolHandler = {
  definition: {
    name: 'find_sites_with_plugin',
    description:
      'Find all indexed sites that have a specific plugin installed — matches by slug (exact) or plugin name (case-insensitive substring). Works even when sites are stopped — reads from the content index. Returns site names, plugin version, and active/inactive status. Use before bulk updates to identify which sites have a specific plugin, or for security audits.' +
      'Matches by slug (exact) or name (case-insensitive substring). ' +
      'Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        plugin: {
          type: 'string',
          description: 'Plugin name or slug to search for (e.g. "woocommerce" or "WooCommerce")',
        },
      },
      required: ['plugin'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const query = args.plugin as string;
    if (!query) {
      return error('Missing required argument: plugin');
    }

    const queryLower = query.toLowerCase();
    const matches: Match[] = [];

    // ── Local sites: IndexRegistry structure ──────────────────────────────
    const entries = services.indexRegistry.listAll();
    const indexed = entries.filter((e) => e.structure);
    let staleCount = 0;
    const now = Date.now();

    for (const entry of indexed) {
      if (entry.lastIndexed && (now - entry.lastIndexed) > DAY_MS) staleCount++;
      for (const plugin of entry.structure!.plugins) {
        const slugMatch = plugin.slug.toLowerCase() === queryLower;
        const nameMatch = plugin.name.toLowerCase().includes(queryLower);
        if (slugMatch || nameMatch) {
          matches.push({
            siteName: entry.siteName || entry.siteId,
            version: plugin.version,
            status: plugin.isActive ? 'active' : 'inactive',
            source: 'local',
            lastIndexed: entry.lastIndexed,
          });
          break;
        }
      }
    }

    // ── WPE sites: graph.db plugins table ─────────────────────────────────
    const graphService = (services as any).graphService;
    let wpeTotal = 0;
    if (graphService?.getDb) {
      try {
        const db = graphService.getDb();
        if (db) {
          const rows = db.prepare(`
            SELECT p.slug, p.version, p.is_active, s.name as site_name
            FROM plugins p
            JOIN sites s ON p.site_id = s.id
            WHERE s.source != 'local'
              AND (LOWER(p.slug) = ? OR LOWER(p.slug) LIKE ?)
          `).all(queryLower, `%${queryLower}%`) as Array<{
            slug: string; version: string; is_active: number; site_name: string;
          }>;

          const wpeSitesSeen = new Set<string>();
          for (const row of rows) {
            if (!wpeSitesSeen.has(row.site_name)) {
              wpeSitesSeen.add(row.site_name);
              matches.push({
                siteName: row.site_name,
                version: row.version ?? '?',
                status: row.is_active ? 'active' : 'inactive',
                source: 'wpe',
              });
            }
          }

          const wpeCount = (db.prepare(
            "SELECT COUNT(*) as c FROM sites WHERE source != 'local'"
          ).get() as { c: number })?.c ?? 0;
          wpeTotal = wpeCount;
        }
      } catch { /* graph unavailable */ }
    }

    const totalSearched = indexed.length + wpeTotal;

    if (matches.length === 0) {
      return ok(`No sites have a plugin matching "${query}" (searched ${totalSearched} sites: ${indexed.length} local, ${wpeTotal} WPE).`);
    }

    const lines: string[] = [`## Sites with "${query}"`, ''];
    lines.push('| Site | Version | Status | Source | Last Indexed |');
    lines.push('|------|---------|--------|--------|-------------|');

    const localMatches = matches.filter((m) => m.source === 'local');
    const wpeMatches = matches.filter((m) => m.source === 'wpe');

    for (const m of [...localMatches, ...wpeMatches]) {
      const date = m.lastIndexed ? new Date(m.lastIndexed).toISOString().split('T')[0] : '—';
      lines.push(`| ${m.siteName} | v${m.version} | ${m.status} | ${m.source === 'wpe' ? '[wpe]' : '[local]'} | ${date} |`);
    }

    lines.push('');
    lines.push(`Found in ${matches.length} of ${totalSearched} sites (${indexed.length} local, ${wpeTotal} WPE).`);

    // Staleness: only warn if a meaningful fraction of local sites are stale
    if (staleCount > 0) {
      const pct = Math.round((staleCount / indexed.length) * 100);
      if (staleCount === indexed.length) {
        lines.push(`⚠️ All local site indexes are >24h old — run \`reindex_site\` to refresh.`);
      } else {
        lines.push(`ℹ️ ${staleCount} of ${indexed.length} local sites have indexes older than 24h.`);
      }
    }

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
