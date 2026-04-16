import { McpToolHandler, McpToolResult, NexusServices } from '../../types';
import { resolveSite } from '../../site-resolver';
import { indexFreshnessWarning } from '../../../twin/twin-helpers';

export const searchContentHandler: McpToolHandler = {
  definition: {
    name: 'search_site_content',
    description:
      'Search a single site\'s indexed content using semantic similarity — understands meaning, not just keywords. ' +
      '"Optimize images" also matches posts about compression, WebP, lazy loading, and CDN. ' +
      'The site must be indexed — run reindex_site if results are missing or stale. ' +
      'For searching across all sites simultaneously, use search_across_sites.' +
      'Works for both local sites (by name/domain) and WPE installs (by install name, e.g. "localwpe"). ' +
      'WPE install content is indexed by wpe_sync_sites — run that first if results are missing. ' +
      'Returns ranked results with titles, excerpts, and relevance scores.',
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
        min_score: {
          type: 'number',
          description: 'Minimum relevance score (0-1). Results below this are filtered out. Default: 0.3',
        },
      },
      required: ['site', 'query'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    // Try local site first, then resolve WPE install name → wpe-{uuid}
    let siteId: string;
    let siteName: string;

    const localSite = resolveSite(args.site as string, services.siteData);
    if (localSite) {
      siteId = localSite.id;
      siteName = localSite.name;
    } else {
      // Try to find as WPE install in graph DB
      const graphService = (services as any).graphService;
      const db = graphService?.getDb?.();
      const row = db?.prepare(
        "SELECT id, name FROM sites WHERE source='wpe' AND name=? LIMIT 1"
      ).get(args.site) as { id: string; name: string } | undefined;

      if (!row) {
        return error(`Site "${args.site}" not found. For WPE installs, use the install name (e.g. "testjpp1"). Run wpe_sync_sites first if the install is missing.`);
      }
      siteId = row.id;
      siteName = row.name;
    }

    const indexEntry = services.indexRegistry.get(siteId);
    if (!indexEntry || indexEntry.state === 'error') {
      return error(`Site "${siteName}" is not indexed. Start the site to trigger indexing.`);
    }

    const queryVector = await services.embeddingService.embed(args.query as string);
    const limit = Math.min(Math.max((args.limit as number) || 5, 1), 20);

    const results = await services.vectorStore.search(siteId, queryVector, {
      limit,
      postType: args.postType as string | undefined,
      relevanceFloor: args.min_score as number | undefined,
    });

    if (results.length === 0) {
      return ok(`No results found for "${args.query}" in ${siteName}.`);
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

    const warning = indexFreshnessWarning(indexEntry);
    const suffix = warning ? `\n${warning}` : '';
    return ok(`Found ${results.length} results in "${siteName}":\n\n${formatted}${suffix}`);
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
