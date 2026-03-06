import { McpToolHandler, McpToolResult } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const fleetFilterHandler: McpToolHandler = {
  definition: {
    name: 'fleet_filter',
    description:
      'Apply a smart filter to find sites matching specific criteria. ' +
      'Available filters: security-updates, outdated-php, no-ssl, not-indexed, ' +
      'large-db, low-disk, no-events, low-health.',
    inputSchema: {
      type: 'object',
      properties: {
        filter_id: {
          type: 'string',
          description: 'The filter to apply',
          enum: ['security-updates', 'outdated-php', 'no-ssl', 'not-indexed', 'large-db', 'low-disk', 'no-events', 'low-health'],
        },
      },
      required: ['filter_id'],
    },
    annotations: { title: 'Fleet Filter', readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    const filterEngine = services.filterEngine;
    if (!filterEngine) return ok('Filter engine is not available.');

    const filterId = args.filter_id as string;

    try {
      const siteIds = await filterEngine.applyFilter(filterId);
      if (siteIds.length === 0) {
        return ok(`No sites match the "${filterId}" filter. All clear!`);
      }

      const allSites = services.siteData.getSites();
      const lines = [`## Filter: ${filterId}`, '', `**${siteIds.length} site(s) matched:**`, ''];

      for (const siteId of siteIds) {
        const site = allSites[siteId];
        const name = site?.name || siteId;
        lines.push(`- ${name} (${siteId})`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return ok(`Filter "${filterId}" failed: ${err.message}`);
    }
  },
};
