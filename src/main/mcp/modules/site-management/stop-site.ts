import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const stopSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_stop_site',
    description: 'Stop a local WordPress site and shut down its services. Frees system resources (RAM, ports) when the site is not needed. The site data and database are preserved — use local_start_site to bring it back. Do NOT stop a site mid-pull or mid-push — wait for operations to complete first.',
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
