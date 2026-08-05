import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite, resolveRemoteGraphSite } from '../../site-resolver';

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
    // Local first, then the graph for WPE installs and external SSH hosts —
    // the same fallback (and the same collision policy) search_site_content uses.
    let siteId: string;
    let siteName: string;

    const localSite = resolveSite(args.site as string, services.siteData);
    if (localSite) {
      siteId = localSite.id;
      siteName = localSite.name;
    } else {
      const resolved = resolveRemoteGraphSite((services as any).graphService?.getDb?.(), args.site);
      if (resolved.kind === 'none') {
        return error(`Site "${args.site}" not found`);
      }
      if (resolved.kind === 'ambiguous') {
        return error(
          `"${args.site}" matches ${resolved.matches.length} sites across sources — specify which one: ${resolved.matches.join(', ')}`
        );
      }
      siteId = resolved.siteId;
      siteName = resolved.siteName;
    }

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
