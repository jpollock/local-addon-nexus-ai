import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const cloneSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_clone_site',
    description: 'Clone an existing local WordPress site with a new name.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Source site name, ID, or domain' },
        new_name: { type: 'string', description: 'Name for the cloned site' },
      },
      required: ['site', 'new_name'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const newName = args.new_name as string;
    if (!newName || !newName.trim()) {
      return error('New site name is required.');
    }

    const result = await services.localServices!.cloneSite(site.id, newName.trim());
    return ok(`Cloned "${site.name}" → "${result.name}" (ID: ${result.id}).`);
  },
};
