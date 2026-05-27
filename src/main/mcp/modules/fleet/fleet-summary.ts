import { McpToolHandler, McpToolResult } from '../../types';
import { PluginInfo } from '../../../../common/types';
import { groupByVersion } from './version-utils';

export const fleetSummaryHandler: McpToolHandler = {
  definition: {
    name: 'fleet_summary',
    description:
      'Aggregate overview across ALL WordPress sites — local + WP Engine. WordPress/PHP version distribution, most common plugins, content totals, and integration presence. Reads from content index (local) and graph.db (WPE). Use for a quick fleet health snapshot or to find version distribution before a bulk update.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const entries = services.indexRegistry.listAll();
    const localSiteCount = Object.keys(services.siteData.getSites()).length;
    const indexed = entries.filter((e) => e.structure);

    // ── WPE data from graph.db ─────────────────────────────────────────────
    const graphService = (services as any).graphService;
    interface WpeSite { name: string; wp_version: string | null; php_version: string | null; }
    interface WpePlugin { slug: string; name: string | null; is_active: number; }
    let wpeSites: WpeSite[] = [];
    let wpePluginRows: (WpePlugin & { site_name: string })[] = [];

    if (graphService?.getDb) {
      try {
        const db = graphService.getDb();
        if (db) {
          wpeSites = db.prepare(
            "SELECT name, wp_version, php_version FROM sites WHERE source != 'local' AND is_active = 1"
          ).all() as WpeSite[];
          wpePluginRows = db.prepare(`
            SELECT p.slug, p.name, p.is_active, s.name as site_name
            FROM plugins p JOIN sites s ON p.site_id = s.id
            WHERE s.source != 'local' AND s.is_active = 1
          `).all() as (WpePlugin & { site_name: string })[];
        }
      } catch { /* graph unavailable */ }
    }

    const lines: string[] = ['## Fleet Summary', ''];
    const totalSites = localSiteCount + wpeSites.length;
    lines.push(`**Total sites: ${totalSites}** — ${localSiteCount} local, ${wpeSites.length} WP Engine`);

    // ── WordPress version distribution ────────────────────────────────────
    lines.push('', '### WordPress Versions');
    const wpMap = new Map<string, { local: number; wpe: number }>();
    for (const entry of indexed.filter((e) => e.structure!.wpVersion)) {
      const v = entry.structure!.wpVersion!;
      const cur = wpMap.get(v) ?? { local: 0, wpe: 0 };
      wpMap.set(v, { ...cur, local: cur.local + 1 });
    }
    for (const site of wpeSites.filter((s) => s.wp_version)) {
      const v = site.wp_version!;
      const cur = wpMap.get(v) ?? { local: 0, wpe: 0 };
      wpMap.set(v, { ...cur, wpe: cur.wpe + 1 });
    }
    if (wpMap.size > 0) {
      const sorted = Array.from(wpMap.entries()).sort((a, b) => (b[1].local + b[1].wpe) - (a[1].local + a[1].wpe));
      for (const [version, counts] of sorted) {
        const total = counts.local + counts.wpe;
        const parts = [];
        if (counts.local) parts.push(`${counts.local} local`);
        if (counts.wpe) parts.push(`${counts.wpe} WPE`);
        lines.push(`- **${version}**: ${total} sites (${parts.join(', ')})`);
      }
    } else {
      lines.push('- No version data available');
    }

    // ── PHP version distribution ──────────────────────────────────────────
    lines.push('', '### PHP Versions');
    const phpMap = new Map<string, { local: number; wpe: number }>();
    for (const entry of indexed.filter((e) => e.structure!.phpVersion)) {
      const v = entry.structure!.phpVersion!;
      const cur = phpMap.get(v) ?? { local: 0, wpe: 0 };
      phpMap.set(v, { ...cur, local: cur.local + 1 });
    }
    for (const site of wpeSites.filter((s) => s.php_version)) {
      const v = site.php_version!;
      const cur = phpMap.get(v) ?? { local: 0, wpe: 0 };
      phpMap.set(v, { ...cur, wpe: cur.wpe + 1 });
    }
    if (phpMap.size > 0) {
      const sorted = Array.from(phpMap.entries()).sort((a, b) => (b[1].local + b[1].wpe) - (a[1].local + a[1].wpe));
      for (const [version, counts] of sorted.slice(0, 6)) {
        const total = counts.local + counts.wpe;
        const parts = [];
        if (counts.local) parts.push(`${counts.local} local`);
        if (counts.wpe) parts.push(`${counts.wpe} WPE`);
        lines.push(`- **${version}**: ${total} sites (${parts.join(', ')})`);
      }
    } else {
      lines.push('- No version data available');
    }

    // ── Most common plugins (fleet-wide top 10) ───────────────────────────
    const pluginMap = new Map<string, { name: string; local: number; wpe: number; active: number }>();
    for (const entry of indexed) {
      for (const plugin of entry.structure!.plugins) {
        const cur = pluginMap.get(plugin.slug) ?? { name: plugin.name, local: 0, wpe: 0, active: 0 };
        cur.local++;
        if (plugin.isActive) cur.active++;
        pluginMap.set(plugin.slug, cur);
      }
    }
    for (const row of wpePluginRows) {
      const cur = pluginMap.get(row.slug) ?? { name: row.name ?? row.slug, local: 0, wpe: 0, active: 0 };
      cur.wpe++;
      if (row.is_active) cur.active++;
      pluginMap.set(row.slug, cur);
    }

    if (pluginMap.size > 0) {
      const sorted = Array.from(pluginMap.entries())
        .map(([slug, v]) => ({ slug, ...v, total: v.local + v.wpe }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      lines.push('', '### Most Common Plugins (fleet-wide)');
      sorted.forEach((p, i) => {
        const src = [p.local ? `${p.local} local` : '', p.wpe ? `${p.wpe} WPE` : ''].filter(Boolean).join(', ');
        lines.push(`${i + 1}. **${p.name}** — ${p.total} sites (${src}, ${p.active} active)`);
      });
    }

    // ── Content totals (local index only) ────────────────────────────────
    const totalDocs = entries.reduce((sum, e) => sum + e.documentCount, 0);
    const totalChunks = entries.reduce((sum, e) => sum + e.chunkCount, 0);
    lines.push('', `### Content (${indexed.length} indexed local sites)`);
    lines.push(`- ${totalDocs.toLocaleString()} documents · ${totalChunks.toLocaleString()} chunks`);

    // ── Key integrations ──────────────────────────────────────────────────
    const wooLocal = indexed.filter((e) => e.structure!.hasWooCommerce).length;
    const acfLocal = indexed.filter((e) => e.structure!.hasACF).length;
    const wooWpe = wpePluginRows.filter((r) => r.slug === 'woocommerce' && r.is_active).length;
    const acfWpe = wpePluginRows.filter((r) => (r.slug === 'advanced-custom-fields' || r.slug === 'acf-pro') && r.is_active).length;
    if (wooLocal + wooWpe + acfLocal + acfWpe > 0) {
      lines.push('', '### Key Integrations');
      if (wooLocal + wooWpe > 0) lines.push(`- WooCommerce: ${wooLocal + wooWpe} sites (${wooLocal} local, ${wooWpe} WPE)`);
      if (acfLocal + acfWpe > 0) lines.push(`- ACF: ${acfLocal + acfWpe} sites (${acfLocal} local, ${acfWpe} WPE)`);
    }

    // ── Warnings ──────────────────────────────────────────────────────────
    const staleCount = entries.filter((e) => e.state === 'stale').length;
    const errorCount = entries.filter((e) => e.state === 'error').length;
    if (staleCount > 0 || errorCount > 0) {
      lines.push('', '### Warnings');
      if (staleCount > 0) lines.push(`- ${staleCount} local site${staleCount !== 1 ? 's' : ''} with stale content indexes`);
      if (errorCount > 0) lines.push(`- ${errorCount} local site${errorCount !== 1 ? 's' : ''} with index errors`);
    }

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
