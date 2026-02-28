import { McpToolHandler, McpToolResult, NexusServices } from '../../types';
import { resolveSite } from '../../site-resolver';

export const searchContentHandler: McpToolHandler = {
  definition: {
    name: 'search_site_content',
    description:
      'Search indexed WordPress content using semantic similarity. ' +
      'Searches posts, pages, WooCommerce products, and media attachments. ' +
      'Returns ranked results with titles, excerpts, and relevance scores. ' +
      'The site must be indexed first (indexing happens automatically when a site starts).',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain to search',
        },
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 5, max: 20)',
        },
        postType: {
          type: 'string',
          description: 'Filter by post type (e.g., "post", "page", "product", "attachment")',
        },
      },
      required: ['site', 'query'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) {
      return error(`Site "${args.site}" not found`);
    }

    const indexEntry = services.indexRegistry.get(site.id);
    if (!indexEntry || indexEntry.state === 'error') {
      return error(`Site "${site.name}" is not indexed. Start the site to trigger indexing.`);
    }

    const queryVector = await services.embeddingService.embed(args.query as string);
    const limit = Math.min(Math.max((args.limit as number) || 5, 1), 20);

    const results = await services.vectorStore.search(site.id, queryVector, {
      limit,
      postType: args.postType as string | undefined,
    });

    if (results.length === 0) {
      return ok(`No results found for "${args.query}" in ${site.name}.`);
    }

    const formatted = results
      .map((r, i) => {
        const meta = JSON.parse(r.metadata);
        const excerpt = r.content.length > 200 ? r.content.substring(0, 200) + '...' : r.content;
        const tags = [
          r.postType,
          ...(meta.categories ?? []),
        ].join(', ');

        return `${i + 1}. **${r.title}** (${tags}, score: ${r.score.toFixed(3)})\n   ${excerpt}\n   Post ID: ${r.postId}`;
      })
      .join('\n\n');

    return ok(`Found ${results.length} results in "${site.name}":\n\n${formatted}`);
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
