import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const wpeLinkHandler: McpToolHandler = {
  definition: {
    name: 'local_wpe_link',
    description:
      'Check whether a local site is linked to a WP Engine install. ' +
      'A link enables local_wpe_pull and local_wpe_push between the two environments. ' +
      'Read-only — does not create or modify links. ' +
      'To link a site: use Local\'s Connect UI or provide remote_install_id when calling local_wpe_pull. ' +
      'Use nexus_list_sites to see all linked pairs at a glance.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    // Check the raw site object for host connections
    const rawSite = services.localServices!.resolveSiteObject(site.id) as any;
    const connections = rawSite?.hostConnections;

    if (!connections || Object.keys(connections).length === 0) {
      return ok(`Site "${site.name}" is not linked to any WP Engine environment.`);
    }

    const lines = [`## WPE Link for "${site.name}"`];
    for (const [key, conn] of Object.entries(connections) as [string, any][]) {
      const label = conn?.installName ?? conn?.remoteSiteId ?? conn?.name ?? JSON.stringify(conn);
      lines.push(`- **${key}:** ${label}`);
    }

    return ok(lines.join('\n'));
  },
};
