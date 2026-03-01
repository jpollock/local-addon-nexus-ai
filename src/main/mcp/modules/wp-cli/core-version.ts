import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error } from './preflight';

export const coreVersionHandler: McpToolHandler = {
  definition: {
    name: 'wp_core_version',
    description: 'Get the WordPress core version for a site.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const check = requireRunning(site, services);
    if (check) return check;

    const version = await services.localServices!.getWpVersion(site.id);
    return ok(`WordPress ${version ?? 'unknown'}`);
  },
};
