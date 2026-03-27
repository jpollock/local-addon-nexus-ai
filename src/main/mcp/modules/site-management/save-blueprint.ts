import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error as err, requireLocalServices } from './helpers';

export const saveBlueprintHandler: McpToolHandler = {
  definition: {
    name: 'local_save_blueprint',
    description: 'Save a site as a blueprint (template) for creating new sites',
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
      const blueprint = await services.localServices!.saveBlueprint?.(site.id, { name, description });

      if (!blueprint) {
        return err('Blueprints service not available in this version of Local');
      }

      return ok(`Successfully saved blueprint "${name}" from site "${site.name}" (ID: ${blueprint.id})`);
    } catch (error: any) {
      return err(`Failed to save blueprint: ${error.message}`);
    }
  },
};
