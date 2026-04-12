import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';

export const getIndexStatusHandler: McpToolHandler = {
  definition: {
    name: 'get_index_status',
    description:
      'Get the content index status for a specific site — document count, chunk count, last indexed timestamp, and index freshness indicator. Use to confirm a site has been indexed before running search_site_content or fleet searches. If the index is stale, trigger a fresh index with reindex_site.' +
      'last indexed time, indexing duration, and current state.',
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

    const entry = services.indexRegistry.get(site.id);
    if (!entry) {
      return ok(`Site "${site.name}" has not been indexed yet. Start the site to trigger indexing.`);
    }

    const lines = [
      `## Index Status: ${site.name}`,
      `**State:** ${entry.state}`,
      `**Documents:** ${entry.documentCount}`,
      `**Chunks:** ${entry.chunkCount}`,
      `**Last indexed:** ${entry.lastIndexed ? new Date(entry.lastIndexed).toISOString() : 'never'}`,
      `**Duration:** ${entry.durationMs}ms`,
    ];

    if (entry.error) {
      lines.push(`**Error:** ${entry.error}`);
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
