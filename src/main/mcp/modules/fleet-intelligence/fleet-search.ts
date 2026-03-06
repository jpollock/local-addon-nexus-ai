import { McpToolHandler, McpToolResult } from '../../types';

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export const fleetSearchHandler: McpToolHandler = {
  definition: {
    name: 'fleet_search',
    description:
      'Search across all indexed sites for content, plugins, themes, and users. ' +
      'Uses semantic search (vector similarity) combined with metadata matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query text' },
        content_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by content type: post, plugin, theme, user. Omit for all types.',
        },
        site_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Limit search to specific site IDs. Omit to search all sites.',
        },
        limit: { type: 'number', description: 'Maximum results to return (default 20)' },
      },
      required: ['query'],
    },
    annotations: { title: 'Fleet Search', readOnlyHint: true },
  },

  async execute(args, services): Promise<McpToolResult> {
    const searchService = services.searchService;
    if (!searchService) return ok('Search service is not available.');

    const query = args.query as string;
    const contentTypes = args.content_types as string[] | undefined;
    const siteIds = args.site_ids as string[] | undefined;
    const limit = (args.limit as number) || 20;

    const results = await searchService.searchFleet(
      query,
      { contentTypes, siteIds },
      { limit }
    );

    if (results.total === 0) {
      return ok(`No results found for "${query}".`);
    }

    const lines = [`## Search Results for "${query}"`, '', `**${results.total} results found**`, ''];

    for (const r of results.results) {
      lines.push(`### ${r.title}`);
      lines.push(`- Type: ${r.type} | Site: ${r.siteName} | Score: ${Math.round(r.score * 100)}%`);
      if (r.excerpt) lines.push(`- ${r.excerpt.slice(0, 200)}`);
      lines.push('');
    }

    return ok(lines.join('\n'));
  },
};
