import { McpToolHandler, McpToolResult } from '../../types';

export const listIndexedSitesHandler: McpToolHandler = {
  definition: {
    name: 'list_indexed_sites',
    description:
      'List all sites with their content index status — document count, chunk count, last indexed timestamp, and whether the index is fresh or stale. Use to identify sites that need reindexing before a search or audit. For a single site detailed index status, use get_index_status.' +
      'Shows which sites have been indexed and are searchable.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  async execute(_args, services): Promise<McpToolResult> {
    const entries = services.indexRegistry.listAll();

    if (entries.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No sites have been indexed yet. Start a site in Local to trigger indexing.',
        }],
      };
    }

    const lines = ['## Indexed Sites\n'];

    for (const entry of entries) {
      const stateIcon =
        entry.state === 'indexed' ? '[OK]' :
        entry.state === 'stale' ? '[STALE]' :
        entry.state === 'indexing' ? '[INDEXING]' :
        '[ERROR]';

      const lastIndexed = entry.lastIndexed
        ? new Date(entry.lastIndexed).toISOString()
        : 'never';

      lines.push(
        `- ${stateIcon} **${entry.siteName || entry.siteId}** — ` +
        `${entry.documentCount} docs, ${entry.chunkCount} chunks, ` +
        `last indexed: ${lastIndexed}`,
      );
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
