import { McpToolHandler, McpToolResult } from '../../types';
import { DAY_MS } from '../../../twin/twin-helpers';
import type { SiteSource } from '../../../../common/types';
import { toSiteSource } from '../../../../common/types';

interface ThemeMatch {
  siteName: string;
  themeName: string;
  version: string;
  status: string;
  isChildTheme: boolean;
  parentTheme?: string;
  source: SiteSource;
  lastIndexed?: number;
}

export const findSitesWithThemeHandler: McpToolHandler = {
  definition: {
    name: 'find_sites_with_theme',
    description:
      'Find all indexed sites that have a specific theme installed — matches by theme name or slug. Works even when sites are stopped — reads from the content index. Returns site names, theme version, and active/inactive status. Use for theme migration planning or to identify sites using a specific theme before updates.' +
      'Matches by slug (exact) or name (case-insensitive substring). ' +
      'Shows active status and child theme info. Works even when sites are stopped.',
    inputSchema: {
      type: 'object',
      properties: {
        theme: {
          type: 'string',
          description: 'Theme name or slug to search for (e.g. "twentytwentyfour" or "Twenty Twenty")',
        },
      },
      required: ['theme'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const query = args.theme as string;
    if (!query) {
      return error('Missing required argument: theme');
    }

    const queryLower = query.toLowerCase();
    const matches: ThemeMatch[] = [];
    const now = Date.now();

    // ── Local sites: IndexRegistry structure ──────────────────────────────
    const entries = services.indexRegistry.listAll();
    const indexed = entries.filter((e) => e.structure);
    let staleCount = 0;

    for (const entry of indexed) {
      if (entry.lastIndexed && (now - entry.lastIndexed) > DAY_MS) staleCount++;
      for (const theme of entry.structure!.themes) {
        const slugMatch = theme.slug.toLowerCase() === queryLower;
        const nameMatch = theme.name.toLowerCase().includes(queryLower);
        if (slugMatch || nameMatch) {
          matches.push({
            siteName: entry.siteName || entry.siteId,
            themeName: theme.name,
            version: theme.version,
            status: theme.isActive ? 'active' : 'inactive',
            isChildTheme: theme.isChildTheme,
            parentTheme: theme.parentTheme,
            source: 'local',
            lastIndexed: entry.lastIndexed,
          });
        }
      }
    }

    // ── WPE sites: graph.db themes table ──────────────────────────────────
    const graphService = (services as any).graphService;
    let wpeTotal = 0;
    if (graphService?.getDb) {
      try {
        const db = graphService.getDb();
        if (db) {
          // Remote sites of every kind: WPE installs and external SSH hosts.
          // Add new remote kinds here; `!= 'local'` is forbidden (see source-semantics.test.ts).
          const rows = db.prepare(`
            SELECT t.slug, t.name, t.version, t.is_active, s.name as site_name, s.source
            FROM themes t
            JOIN sites s ON t.site_id = s.id
            WHERE s.source IN ('wpe', 'external')
              AND (LOWER(t.slug) = ? OR LOWER(t.name) LIKE ?)
          `).all(queryLower, `%${queryLower}%`) as Array<{
            slug: string; name: string; version: string; is_active: number; site_name: string; source: string;
          }>;

          for (const row of rows) {
            matches.push({
              siteName: row.site_name,
              themeName: row.name ?? row.slug,
              version: row.version ?? '?',
              status: row.is_active ? 'active' : 'inactive',
              isChildTheme: false,
              source: toSiteSource(row.source),
            });
          }

          const wpeCount = (db.prepare(
            "SELECT COUNT(*) as c FROM sites WHERE source IN ('wpe', 'external')"
          ).get() as { c: number })?.c ?? 0;
          wpeTotal = wpeCount;
        }
      } catch { /* graph unavailable */ }
    }

    const totalSearched = indexed.length + wpeTotal;

    if (matches.length === 0) {
      return ok(`No sites have a theme matching "${query}" (searched ${totalSearched} sites: ${indexed.length} local, ${wpeTotal} remote).`);
    }

    const lines: string[] = [`## Sites with theme "${query}"`, ''];
    lines.push('| Site | Theme | Version | Status | Source | Last Indexed |');
    lines.push('|------|-------|---------|--------|--------|-------------|');

    const localMatches = matches.filter((m) => m.source === 'local');
    const remoteMatches = matches.filter((m) => m.source === 'wpe' || m.source === 'external');

    for (const m of [...localMatches, ...remoteMatches]) {
      const date = m.lastIndexed ? new Date(m.lastIndexed).toISOString().split('T')[0] : '—';
      const childInfo = m.isChildTheme ? ` (child of ${m.parentTheme || '?'})` : '';
      lines.push(`| ${m.siteName} | ${m.themeName}${childInfo} | v${m.version} | ${m.status} | [${m.source}] | ${date} |`);
    }

    lines.push('');
    lines.push(`Found in ${matches.length} of ${totalSearched} sites (${indexed.length} local, ${wpeTotal} remote).`);

    if (staleCount > 0) {
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
