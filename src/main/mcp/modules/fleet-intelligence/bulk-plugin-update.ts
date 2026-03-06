import { McpToolHandler, McpToolResult } from '../../types';
import { getToolSafety } from '../../safety';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const bulkPluginUpdateHandler: McpToolHandler = {
  definition: {
    name: 'bulk_plugin_update',
    description:
      'Update a specific plugin across multiple sites. This is a destructive operation ' +
      'that modifies site files — requires confirmation. Processes sites concurrently (max 3).',
    inputSchema: {
      type: 'object',
      properties: {
        site_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of site IDs to update the plugin on',
        },
        plugin_slug: {
          type: 'string',
          description: 'The plugin slug to update (e.g., "akismet")',
        },
      },
      required: ['site_ids', 'plugin_slug'],
    },
    annotations: { title: 'Bulk Plugin Update', readOnlyHint: false },
  },

  async execute(args, services): Promise<McpToolResult> {
    const bulkOpManager = services.bulkOpManager;
    if (!bulkOpManager) return ok('Bulk operations are not available.');

    const siteIds = args.site_ids as string[];
    const pluginSlug = args.plugin_slug as string;

    if (!siteIds || siteIds.length === 0) {
      return ok('No site IDs provided.');
    }
    if (!pluginSlug) {
      return ok('No plugin slug provided.');
    }

    const opId = await bulkOpManager.execute({
      type: 'plugin-update',
      siteIds,
      options: { pluginSlug },
    });

    return ok(
      `Bulk plugin update started: "${pluginSlug}" on ${siteIds.length} site(s).\n` +
      `Operation ID: ${opId}\n` +
      `Sites are being processed concurrently (max 3 at a time).`
    );
  },
};
