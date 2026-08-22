import { McpToolHandler, McpToolResult } from '../../types';
import { resolveAnySite } from '../../site-resolver';

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
    // WP-58: this was local-then-graph, with its own copy of the collision
    // policy. Under the decline that is no longer safe as written — a name in
    // BOTH stores makes the local half return nothing, and the graph half
    // would then answer about the install as if the caller had asked for it.
    // `resolveAnySite` consults both before answering and owns the one policy.
    const resolved = resolveAnySite(args.site as string, services.siteData, (services as any).graphService);
    if (resolved.kind === 'none') {
      return error(`Site "${args.site}" not found`);
    }
    if (resolved.kind === 'ambiguous') {
      return error(
        `"${args.site}" matches ${resolved.matches.length} sites across sources — specify which one: ${resolved.matches.join(', ')}`
      );
    }
    const siteId = resolved.id;
    const siteName = resolved.name;

    const entry = services.indexRegistry.get(siteId);
    if (!entry) {
      return ok(`Site "${siteName}" has not been indexed yet. Start the site to trigger indexing.`);
    }

    const lines = [
      `## Index Status: ${siteName}`,
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
