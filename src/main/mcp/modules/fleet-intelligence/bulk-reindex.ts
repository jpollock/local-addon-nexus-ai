import { McpToolHandler, McpToolResult } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const bulkReindexHandler: McpToolHandler = {
  definition: {
    name: 'bulk_reindex',
    description:
      'Reindex multiple sites at once. Queues a bulk reindex operation that processes ' +
      'sites concurrently (max 3 at a time). Returns an operation ID to track progress.',
    inputSchema: {
      type: 'object',
      properties: {
        site_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of site IDs to reindex',
        },
      },
      required: ['site_ids'],
    },
    annotations: { title: 'Bulk Reindex', readOnlyHint: false },
  },

  async execute(args, services): Promise<McpToolResult> {
    const bulkOpManager = services.bulkOpManager;
    if (!bulkOpManager) return ok('Bulk operations are not available.');

    const siteIds = args.site_ids as string[];
    if (!siteIds || siteIds.length === 0) {
      return ok('No site IDs provided.');
    }

    const opId = await bulkOpManager.execute({
      type: 'reindex',
      siteIds,
    });

    return ok(
      `Bulk reindex started for ${siteIds.length} site(s).\n` +
      `Operation ID: ${opId}\n` +
      `Sites are being processed concurrently (max 3 at a time).`
    );
  },
};
