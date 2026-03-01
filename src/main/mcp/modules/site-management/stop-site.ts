import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const stopSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_stop_site',
    description: 'Stop a running local WordPress site.',
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
    if (status === 'halted') {
      return ok(`Site "${site.name}" is already stopped.`);
    }

    await services.localServices!.stopSite(site.id);
    return ok(`Site "${site.name}" stopped.`);
  },
};
