import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const updateSiteHandler: McpToolHandler = {
  definition: {
    name: 'wpe_update_site',
    description: 'Update a WP Engine site name.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'WP Engine site ID' },
        name: { type: 'string', description: 'New site name' },
      },
      required: ['site_id', 'name'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const siteId = args.site_id as string;
      const name = args.name as string;

      if (!siteId) return error('Site ID is required.');
      if (!name) return error('New site name is required.');

      await services.localServices!.capiDirect(`/sites/${siteId}`, 'PATCH', { name });

      return ok(`Site \`${siteId}\` has been renamed to **${name}**.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
