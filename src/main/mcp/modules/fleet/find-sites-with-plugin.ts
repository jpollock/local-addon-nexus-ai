import { McpToolHandler, McpToolResult } from '../../types';
import { fleetFreshnessWarning } from '../../../twin/twin-helpers';

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

    const entries = services.indexRegistry.listAll();
    const indexed = entries.filter((e) => e.structure);

    if (indexed.length === 0) {
      return ok('No indexed sites with structure data available.');
    }

    const queryLower = query.toLowerCase();
    const matches: Array<{ siteName: string; version: string; status: string; lastIndexed: number }> = [];

    for (const entry of indexed) {
      for (const plugin of entry.structure!.plugins) {
        const slugMatch = plugin.slug.toLowerCase() === queryLower;
        const nameMatch = plugin.name.toLowerCase().includes(queryLower);

        if (slugMatch || nameMatch) {
          matches.push({
            siteName: entry.siteName || entry.siteId,
            version: plugin.version,
            status: plugin.isActive ? 'active' : 'inactive',
            lastIndexed: entry.lastIndexed,
          });
          break; // Only count each site once
        }
      }
    }

    if (matches.length === 0) {
      return ok(`No indexed sites have a plugin matching "${query}".`);
    }

    const lines: string[] = [`## Sites with "${query}"`, ''];
    lines.push('| Site | Version | Status | Last Indexed |');
    lines.push('|------|---------|--------|-------------|');

    for (const m of matches) {
      const date = m.lastIndexed ? new Date(m.lastIndexed).toISOString().split('T')[0] : 'unknown';
      lines.push(`| ${m.siteName} | v${m.version} | ${m.status} | ${date} |`);
    }

    lines.push('');
    lines.push(`Found in ${matches.length} of ${indexed.length} indexed sites.`);

    const warning = fleetFreshnessWarning(indexed);
    if (warning) lines.push(warning);

    return ok(lines.join('\n'));
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
