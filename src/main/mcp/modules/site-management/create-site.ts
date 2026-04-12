import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, requireLocalServices } from './helpers';

export const createSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_create_site',
    description:
      'Create a new local WordPress site with WordPress pre-installed. ' +
      'Default admin credentials are admin/admin — change immediately for any site that will be pushed to WPE. ' +
      'Optionally specify PHP version; defaults to Local current default. ' +
      'Site is created and started automatically. ' +
      'After creation, run wp_plugin_update --all to ensure plugins are current before doing any WPE pull.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the new site' },
        php_version: { type: 'string', description: 'PHP version (e.g. "8.2"). Optional.' },
      },
      required: ['name'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const name = args.name as string;
    if (!name || !name.trim()) {
      return error('Site name is required.');
    }

    const result = await services.localServices!.createSite({
      name: name.trim(),
      phpVersion: args.php_version as string | undefined,
    });

    return ok(
      `Site created:\n` +
      `- **Name:** ${result.name}\n` +
      `- **Domain:** ${result.domain}\n` +
      `- **ID:** ${result.id}\n` +
      `- **Credentials:** admin / admin`,
    );
  },
};
