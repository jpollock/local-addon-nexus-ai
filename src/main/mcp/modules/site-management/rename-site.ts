import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error as err, requireLocalServices } from './helpers';

export const renameSiteHandler: McpToolHandler = {
  definition: {
    name: 'local_rename_site',
    description: 'Rename a WordPress site',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Current site name, ID, or domain',
        },
        newName: {
          type: 'string',
          description: 'New name for the site',
        },
      },
      required: ['site', 'newName'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return err(`Site "${args.site}" not found.`);

    const newName = args.newName as string;
    if (!newName?.trim()) {
      return err('newName cannot be empty');
    }

    const oldName = site.name;

    try {
      services.localServices!.updateSite(site.id, { name: newName.trim() });

      return ok(`Successfully renamed site from "${oldName}" to "${newName.trim()}"`);
    } catch (error: any) {
      return err(`Failed to rename site: ${error.message}`);
    }
  },
};
