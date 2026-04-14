import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error as err, requireLocalServices } from './helpers';

export const saveBlueprintHandler: McpToolHandler = {
  definition: {
    name: 'local_save_blueprint',
    description: 'Save a local WordPress site as a reusable blueprint (template). Blueprints capture the current state — plugins, themes, configuration, and database — as a zip file. This is a long-running operation (minutes for large sites) that runs in the background. Use local_list_blueprints after a minute to confirm it was saved.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain to save as blueprint',
        },
        name: {
          type: 'string',
          description: 'Name for the blueprint',
        },
        description: {
          type: 'string',
          description: 'Optional description for the blueprint',
        },
      },
      required: ['site', 'name'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return err(`Site "${args.site}" not found.`);

    const name = args.name as string;
    if (!name) {
      return err('name parameter is required');
    }

    const description = (args.description as string) || '';

    try {
      const saveFn = services.localServices!.saveBlueprint;
      if (!saveFn) {
        return err('Blueprints service not available in this version of Local');
      }

      // Fire-and-forget — blueprint creation zips the entire site and can take minutes.
      // Awaiting it would block the MCP server and time out for any reasonably sized site.
      saveFn.call(services.localServices, site.id, { name, description })
        .catch(() => { /* errors surface in Local UI */ });

      return ok(
        `Blueprint "${name}" is being created from site "${site.name}" in the background.\n\n` +
        `This can take 1–5 minutes depending on site size. ` +
        `Call \`local_list_blueprints\` after a minute to confirm it appears.`
      );
    } catch (error: any) {
      return err(`Failed to start blueprint creation: ${error.message}`);
    }
  },
};
