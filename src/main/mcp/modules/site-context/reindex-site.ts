import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { SiteConnectionInfo } from '../../../content/MySQLExtractor';

export const reindexSiteHandler: McpToolHandler = {
  definition: {
    name: 'reindex_site',
    description:
      'Trigger re-indexing for a site. Drops existing index data and rebuilds from scratch. ' +
      'The site must be running for content extraction to work.',
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

    const info: SiteConnectionInfo = {
      siteId: site.id,
      siteName: site.name,
      sitePath: site.path,
    };

    try {
      const result = await services.contentPipeline.reindexSite(info);

      const lines = [
        `## Re-index Complete: ${site.name}`,
        `**Documents indexed:** ${result.documentsIndexed}`,
        `**Chunks indexed:** ${result.chunksIndexed}`,
        `**Duration:** ${result.durationMs}ms`,
      ];

      if (result.errors.length > 0) {
        lines.push(`**Warnings:** ${result.errors.join('; ')}`);
      }

      return ok(lines.join('\n'));
    } catch (err) {
      return error(`Re-indexing failed for "${site.name}": ${(err as Error).message}`);
    }
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
