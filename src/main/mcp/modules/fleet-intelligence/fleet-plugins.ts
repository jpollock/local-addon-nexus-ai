import type { McpToolHandler, McpToolResult } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const fleetPluginsHandler: McpToolHandler = {
  definition: {
    name: 'nexus_fleet_plugins',
    description:
      'List all plugins across the fleet aggregated from twin cache. ' +
      'Shows how many sites each plugin is active on. ' +
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
    if (!services.twinService) {
      return ok('Twin service is not available. Ensure Local is running with the Nexus AI addon active.');
    }

    const search: string | undefined = typeof args.search === 'string' ? args.search : undefined;
    const minSites: number = typeof args.min_sites === 'number' ? args.min_sites : 1;

    const twins = services.twinService.getAll() ?? [];

    if (twins.length === 0) {
      return ok('No sites found. Are any sites loaded in Local?');
    }

    const pluginMap = new Map<string, {
      slug: string;
      title?: string;
      activeOnCount: number;
      installedOnCount: number;
      sites: string[];
    }>();

    for (const twin of twins) {
      // Process plugins with status (metadata/indexed completeness)
      if (twin.plugins?.length) {
        for (const plugin of twin.plugins) {
          const slug = plugin.name;
          if (!pluginMap.has(slug)) {
            pluginMap.set(slug, { slug, title: plugin.title, activeOnCount: 0, installedOnCount: 0, sites: [] });
          }
          const entry = pluginMap.get(slug)!;
          if (plugin.title && !entry.title) entry.title = plugin.title;
          entry.installedOnCount++;
          if (plugin.status === 'active') {
            entry.activeOnCount++;
            if (!entry.sites.includes(twin.siteName)) entry.sites.push(twin.siteName);
          }
        }
      }

      // Filesystem-only installed plugins (installed but not active)
      if (twin.installedPlugins?.length) {
        for (const slug of twin.installedPlugins) {
          if (!twin.plugins?.some(p => p.name === slug)) {
            if (!pluginMap.has(slug)) {
              pluginMap.set(slug, { slug, activeOnCount: 0, installedOnCount: 0, sites: [] });
            }
            pluginMap.get(slug)!.installedOnCount++;
          }
        }
      }
    }

    let plugins = Array.from(pluginMap.values());

    // Apply search filter
    if (search) {
      const q = search.toLowerCase();
      plugins = plugins.filter(p =>
        p.slug.toLowerCase().includes(q) ||
        (p.title ?? '').toLowerCase().includes(q)
      );
    }

    // Apply min_sites filter
    plugins = plugins.filter(p => p.activeOnCount >= minSites);

    // Sort by activeOnCount desc
    plugins.sort((a, b) => b.activeOnCount - a.activeOnCount);

    const sitesWithFullData = twins.filter(
      t => t.completeness === 'metadata' || t.completeness === 'indexed'
    ).length;

    if (plugins.length === 0) {
      const filterDesc = search ? ` matching "${search}"` : '';
      return ok(
        `No plugins found${filterDesc} across ${twins.length} sites (${sitesWithFullData} with full data).\n\n` +
        'Run `nexus fleet refresh` to populate twin data.'
      );
    }

    const lines: string[] = [
      '## Fleet Plugins',
      '',
      `**${plugins.length} plugin${plugins.length !== 1 ? 's' : ''} found** across ${twins.length} sites (${sitesWithFullData} with full WP-CLI data)`,
      '',
      '| Plugin | Active on | Installed on | Sites |',
      '|--------|-----------|--------------|-------|',
    ];

    for (const plugin of plugins) {
      const name = plugin.title ? `${plugin.title} (\`${plugin.slug}\`)` : `\`${plugin.slug}\``;
      const sitesStr = plugin.sites.length > 0
        ? plugin.sites.slice(0, 3).join(', ') + (plugin.sites.length > 3 ? `, +${plugin.sites.length - 3} more` : '')
        : '—';
      lines.push(`| ${name} | ${plugin.activeOnCount} | ${plugin.installedOnCount} | ${sitesStr} |`);
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
