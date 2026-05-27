import type { McpToolHandler, McpToolResult } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const fleetPluginsHandler: McpToolHandler = {
  definition: {
    name: 'nexus_fleet_plugins',
    description:
      'List all plugins across the FULL fleet (local + WP Engine) aggregated from twin cache and graph.db. ' +
      'Shows how many sites each plugin is active on across both local and WPE environments. ' +
      'Filter with search= (partial name match) or min_sites= (minimum active site count).',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Partial name match for plugin slug or title',
        },
        min_sites: {
          type: 'number',
          description: 'Only show plugins active on at least this many sites (default: 1)',
        },
      },
    },
    annotations: { title: 'Fleet Plugins', readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    const search: string | undefined = typeof args.search === 'string' ? args.search : undefined;
    const minSites: number = typeof args.min_sites === 'number' ? args.min_sites : 1;

    interface PluginEntry {
      slug: string;
      title?: string;
      localActive: number;
      localInstalled: number;
      wpeActive: number;
      wpeInstalled: number;
      exampleSites: string[];
    }

    const pluginMap = new Map<string, PluginEntry>();

    // ── Local sites: twin cache ────────────────────────────────────────────
    const twins = services.twinService?.getAll() ?? [];
    let localSiteCount = 0;

    for (const twin of twins) {
      localSiteCount++;
      if (twin.plugins?.length) {
        for (const plugin of twin.plugins) {
          const slug = plugin.name;
          if (!pluginMap.has(slug)) {
            pluginMap.set(slug, { slug, title: plugin.title, localActive: 0, localInstalled: 0, wpeActive: 0, wpeInstalled: 0, exampleSites: [] });
          }
          const entry = pluginMap.get(slug)!;
          if (plugin.title && !entry.title) entry.title = plugin.title;
          entry.localInstalled++;
          if (plugin.status === 'active') {
            entry.localActive++;
            if (entry.exampleSites.length < 3) entry.exampleSites.push(`${twin.siteName} [local]`);
          }
        }
      }
      if (twin.installedPlugins?.length) {
        for (const slug of twin.installedPlugins) {
          if (!twin.plugins?.some(p => p.name === slug)) {
            if (!pluginMap.has(slug)) {
              pluginMap.set(slug, { slug, localActive: 0, localInstalled: 0, wpeActive: 0, wpeInstalled: 0, exampleSites: [] });
            }
            pluginMap.get(slug)!.localInstalled++;
          }
        }
      }
    }

    // ── WPE sites: graph.db ───────────────────────────────────────────────
    const graphService = (services as any).graphService;
    let wpeSiteCount = 0;

    if (graphService?.getDb) {
      try {
        const db = graphService.getDb();
        if (db) {
          wpeSiteCount = ((db.prepare(
            "SELECT COUNT(*) as c FROM sites WHERE source != 'local' AND is_active = 1"
          ).get() as { c: number })?.c) ?? 0;

          const rows = db.prepare(`
            SELECT p.slug, p.name, p.is_active, s.name as site_name
            FROM plugins p JOIN sites s ON p.site_id = s.id
            WHERE s.source != 'local' AND s.is_active = 1
          `).all() as Array<{ slug: string; name: string | null; is_active: number; site_name: string }>;

          for (const row of rows) {
            if (!pluginMap.has(row.slug)) {
              pluginMap.set(row.slug, { slug: row.slug, title: row.name ?? undefined, localActive: 0, localInstalled: 0, wpeActive: 0, wpeInstalled: 0, exampleSites: [] });
            }
            const entry = pluginMap.get(row.slug)!;
            if (row.name && !entry.title) entry.title = row.name;
            entry.wpeInstalled++;
            if (row.is_active) {
              entry.wpeActive++;
              if (entry.exampleSites.length < 3) entry.exampleSites.push(`${row.site_name} [wpe]`);
            }
          }
        }
      } catch { /* graph unavailable */ }
    }

    let plugins = Array.from(pluginMap.values());

    if (search) {
      const q = search.toLowerCase();
      plugins = plugins.filter(p =>
        p.slug.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q)
      );
    }

    const totalActive = (p: PluginEntry) => p.localActive + p.wpeActive;
    plugins = plugins.filter(p => totalActive(p) >= minSites);
    plugins.sort((a, b) => totalActive(b) - totalActive(a));

    const totalSites = localSiteCount + wpeSiteCount;

    if (plugins.length === 0) {
      const filterDesc = search ? ` matching "${search}"` : '';
      return ok(
        `No plugins found${filterDesc} across ${totalSites} sites (${localSiteCount} local, ${wpeSiteCount} WPE).\n\n` +
        'Run `nexus fleet refresh` to populate local twin data, or sync WPE sites to populate graph.db.'
      );
    }

    const lines: string[] = [
      '## Fleet Plugins',
      '',
      `**${plugins.length} plugin${plugins.length !== 1 ? 's' : ''} found** across ${totalSites} sites (${localSiteCount} local, ${wpeSiteCount} WPE)`,
      '',
      '| Plugin | Active (local) | Active (WPE) | Total active | Example sites |',
      '|--------|---------------|-------------|--------------|---------------|',
    ];

    for (const plugin of plugins) {
      const name = plugin.title ? `${plugin.title} (\`${plugin.slug}\`)` : `\`${plugin.slug}\``;
      const sitesStr = plugin.exampleSites.length > 0
        ? plugin.exampleSites.slice(0, 3).join(', ')
        : '—';
      lines.push(`| ${name} | ${plugin.localActive} | ${plugin.wpeActive} | ${totalActive(plugin)} | ${sitesStr} |`);
    }

    if (minSites > 1 || search) {
      lines.push('');
      const filters: string[] = [];
      if (search) filters.push(`search="${search}"`);
      if (minSites > 1) filters.push(`min_sites=${minSites}`);
      lines.push(`_Filtered by: ${filters.join(', ')}_`);
    }

    return ok(lines.join('\n'));
  },
};
