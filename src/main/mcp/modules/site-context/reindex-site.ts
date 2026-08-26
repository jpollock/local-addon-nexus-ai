import { McpToolHandler, McpToolResult } from '../../types';
import { resolveLocalSite } from '../../site-resolver';

export const reindexSiteHandler: McpToolHandler = {
  definition: {
    name: 'reindex_site',
    namespace: 'content',
    description:
      'Trigger a complete re-index for a site — drops existing index data and rebuilds from the current content. Use after major content migrations, large plugin changes, or when search results are outdated. A halted site is started, indexed, and stopped again automatically. ASYNC: indexing runs in the background and this returns an operation id immediately — check progress with get_index_status.',
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
    const site = resolveLocalSite(args.site as string, services.siteData, services.graphService);
    if (!site) {
      return error(`Site "${args.site}" not found`);
    }

    // Route through BulkOperationManager — the single centralized indexing
    // path, and the same one `INDEX_SITE` uses. It auto-starts a halted site,
    // waits for MySQL, stops it again, and records succeeded / failed /
    // did-not-run honestly.
    //
    // The direct `contentPipeline.reindexSite` call this replaces did neither:
    // it never started the site, and it printed "## Re-index Complete" with
    // "Documents indexed: 0" and the real failure demoted to "**Warnings:**"
    // — the same overstatement WP-67 removed from the bulk seam, still live on
    // this surface.
    const bulkOpManager = services.bulkOpManager;
    if (!bulkOpManager) {
      return error(
        `Cannot re-index "${site.name}": bulk operations are not available in this process.`,
      );
    }

    try {
      const opId = await bulkOpManager.execute({
        type: 'reindex',
        siteIds: [site.id],
        siteNames: { [site.id]: site.name },
        options: { autoStartStop: true },
      });

      return ok(
        `Re-index started for **${site.name}**.\n` +
        `Operation ID: ${opId}\n` +
        (site.status && site.status !== 'running'
          ? 'The site is not running — it will be started, indexed, and stopped again.\n'
          : '') +
        'Runs in the background; check get_index_status for the result.',
      );
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
