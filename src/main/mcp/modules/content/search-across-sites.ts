import { McpToolHandler, McpToolResult } from '../../types';

export const searchAcrossSitesHandler: McpToolHandler = {
  definition: {
    name: 'search_across_sites',
    description:
      'Search across ALL indexed sites simultaneously using semantic similarity — finds relevant content regardless of which site has it. ' +
      'Returns results ranked by relevance with site name, post title, and excerpt. ' +
      'Use when you do not know which site has the content you are looking for. ' +
      'For a single site, use search_site_content. ' +
      'Sites must be indexed — run bulk_reindex if results are missing.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        limit: {
          type: 'number',
          description: 'Max results per site (default: 3, max: 10)',
        },
        min_score: {
          type: 'number',
          description: 'Minimum relevance score (0-1). Results below this are filtered out. Default: 0.3',
        },
      },
      required: ['query'],
    },
  },

  async execute(args, services): Promise<McpToolResult> {
    const entries = services.indexRegistry.listAll();
    const indexedSites = entries.filter((e) => e.state === 'indexed' || e.state === 'stale');

    if (indexedSites.length === 0) {
      return {
        content: [{ type: 'text', text: 'No sites are currently indexed. Start a site to trigger indexing.' }],
        isError: true,
      };
    }

    const queryVector = await services.embeddingService.embed(args.query as string);
    const limitPerSite = Math.min(Math.max((args.limit as number) || 3, 1), 10);

    const sections: string[] = [];
    let totalResults = 0;

    for (const entry of indexedSites) {
      const results = await services.vectorStore.search(entry.siteId, queryVector, {
        limit: limitPerSite,
        relevanceFloor: args.min_score as number | undefined,
      });

      if (results.length === 0) continue;

      totalResults += results.length;

      const siteLabel = entry.siteName || entry.siteId;
      const staleNote = entry.state === 'stale' ? ' (index may be stale)' : '';
      const lines = results.map((r, i) => {
        const excerpt = r.content.length > 150 ? r.content.substring(0, 150) + '...' : r.content;
        return `  ${i + 1}. **${r.title}** (${r.postType}, score: ${r.score.toFixed(3)})\n     ${excerpt}`;
      });

      sections.push(`### ${siteLabel}${staleNote}\n${lines.join('\n\n')}`);
    }

    if (totalResults === 0) {
      return {
        content: [{ type: 'text', text: `No results found for "${args.query}" across ${indexedSites.length} indexed sites.` }],
      };
    }

    const header = `Found ${totalResults} results across ${sections.length} sites for "${args.query}":\n`;
    return {
      content: [{ type: 'text', text: header + '\n' + sections.join('\n\n') }],
    };
  },
};
