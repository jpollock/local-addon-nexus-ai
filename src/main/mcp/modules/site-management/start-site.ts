import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const startSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_start_site',
    description: 'Start a local WordPress site.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const status = services.localServices!.getSiteStatus(site.id);
    if (status === 'running') {
      return ok(`Site "${site.name}" is already running.`);
    }

    await services.localServices!.startSite(site.id);
    return ok(`Site "${site.name}" started.`);
  },
};
