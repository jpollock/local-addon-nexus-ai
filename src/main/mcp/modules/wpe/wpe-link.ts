import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const wpeLinkHandler: McpToolHandler = {
  definition: {
    name: 'local_wpe_link',
    description: 'Check if a local site is linked to a WP Engine environment.',
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
      lines.push(`- **${key}:** ${conn?.installName ?? conn?.name ?? JSON.stringify(conn)}`);
    }

    return ok(lines.join('\n'));
  },
};
