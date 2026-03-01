import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const wpePullHandler: McpToolHandler = {
  definition: {
    name: 'local_wpe_pull',
    description:
      'Pull a WP Engine environment to a local site. This is an async operation — ' +
      'check the Local app for progress.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        include_database: {
          type: 'boolean',
          description: 'Include database in the pull. Defaults to true.',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    // Verify site is running
    const status = services.localServices!.getSiteStatus(site.id);
    if (status !== 'running') {
      return error(`Site "${site.name}" is ${status}. Start it first with local_start_site.`);
    }

    // Verify site has a WPE connection
    const rawSite = services.localServices!.resolveSiteObject(site.id) as any;
    if (!rawSite?.hostConnections || Object.keys(rawSite.hostConnections).length === 0) {
      return error(`Site "${site.name}" is not linked to a WP Engine environment. Link it first.`);
    }

    return ok(
      JSON.stringify({
        status: 'queued',
        async: true,
        site: site.name,
        message: 'Pull operation queued. Check the Local app for progress. Do NOT run wp_* commands until the pull completes.',
      }, null, 2),
    );
  },
};
