import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const restartSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_restart_site',
    description: 'Restart a local WordPress site by stopping and starting its services. Required after changing PHP version (local_change_php_version) or toggling Xdebug (local_toggle_xdebug). Also useful if the site becomes unresponsive — a restart clears stale connections.',
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

    await services.localServices!.restartSite(site.id);
    return ok(`Site "${site.name}" restarted.`);
  },
};
