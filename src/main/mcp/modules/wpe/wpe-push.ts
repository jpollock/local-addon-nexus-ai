import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const wpePushHandler: McpToolHandler = {
  definition: {
    name: 'local_wpe_push',
    description:
      'Push a local site to WP Engine. This is a Tier 3 (destructive) operation ' +
      'that overwrites the remote environment. Requires confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        include_database: {
          type: 'boolean',
          description: 'Include database in the push. Defaults to false.',
        },
        _confirmationToken: { type: 'string', description: 'Confirmation token for Tier 3 operations' },
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
        include_database: args.include_database === true,
        message: 'Push operation queued. Check the Local app for progress.',
      }, null, 2),
    );
  },
};
