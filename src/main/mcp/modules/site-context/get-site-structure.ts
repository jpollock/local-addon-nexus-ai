import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';

export const getSiteStructureHandler: McpToolHandler = {
  definition: {
    name: 'get_site_structure',
    description:
      'Get deep structural context for a WordPress site. Returns themes (active/installed), ' +
      'plugins, PHP/WP versions, custom post types, multisite status, and key plugin detection ' +
      '(WooCommerce, ACF). Works whether or not the site is running.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
      },
      required: ['site'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      return error(`Site "${args.site}" not found`);
    }

    // Get structure from index registry (populated during indexing)
    const indexEntry = services.indexRegistry.get(site.id);
    let structure = indexEntry?.structure;

    // If no cached structure, scan now
    if (!structure) {
      try {
        structure = await services.fileScanner.scan(site.path);
      } catch (err) {
        return error(`Failed to scan site structure: ${(err as Error).message}`);
      }
    }

    // Build response
    const lines: string[] = [];

    lines.push(`## ${site.name}`);
    lines.push(`**Domain:** ${site.domain ?? 'unknown'}`);
    lines.push(`**Path:** ${site.path}`);
    lines.push(`**WordPress:** ${structure.wpVersion || 'unknown'}`);
    lines.push(`**PHP:** ${structure.phpVersion || 'unknown'}`);
    lines.push(`**Multisite:** ${structure.isMultisite ? 'Yes' : 'No'}`);

    // Themes
    lines.push('');
    lines.push('### Themes');
    if (structure.themes.length === 0) {
      lines.push('No themes found.');
    } else {
      for (const theme of structure.themes) {
        const active = theme.isActive ? ' **(active)**' : '';
        const child = theme.isChildTheme ? ` (child of ${theme.parentTheme})` : '';
        lines.push(`- ${theme.name} v${theme.version}${active}${child}`);
      }
    }

    // Plugins
    lines.push('');
    lines.push('### Plugins');
    if (structure.plugins.length === 0) {
      lines.push('No plugins found.');
    } else {
      for (const plugin of structure.plugins) {
        const active = plugin.isActive ? ' **(active)**' : '';
        lines.push(`- ${plugin.name} v${plugin.version}${active}`);
      }
    }

    // Key detections
    lines.push('');
    lines.push('### Key Integrations');
    lines.push(`- WooCommerce: ${structure.hasWooCommerce ? 'Installed' : 'Not found'}`);
    lines.push(`- ACF: ${structure.hasACF ? 'Installed' : 'Not found'}`);

    // Custom tables (grouped by plugin)
    if (structure.customTables && structure.customTables.length > 0) {
      lines.push('');
      lines.push('### Custom Tables');

      const byPlugin = new Map<string, Array<{ name: string; rowCount: number }>>();
      for (const table of structure.customTables) {
        const plugin = table.pluginGuess;
        if (!byPlugin.has(plugin)) byPlugin.set(plugin, []);
        byPlugin.get(plugin)!.push({ name: table.name, rowCount: table.rowCount });
      }

      for (const [plugin, tables] of byPlugin) {
        const tableList = tables
          .map((t) => `${t.name} (~${t.rowCount} rows)`)
          .join(', ');
        lines.push(`- **${plugin}:** ${tableList}`);
      }
    }

    // Index status if available
    if (indexEntry) {
      lines.push('');
      lines.push('### Index Status');
      lines.push(`- State: ${indexEntry.state}`);
      lines.push(`- Documents: ${indexEntry.documentCount}`);
      lines.push(`- Chunks: ${indexEntry.chunkCount}`);
      if (indexEntry.lastIndexed) {
        lines.push(`- Last indexed: ${new Date(indexEntry.lastIndexed).toISOString()}`);
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
