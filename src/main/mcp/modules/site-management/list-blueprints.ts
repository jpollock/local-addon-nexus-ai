import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error as err, requireLocalServices } from './helpers';

export const listBlueprintsHandler: McpToolHandler = {
  definition: {
    name: 'local_list_blueprints',
    description: 'List all available site blueprints (templates)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(_args, services): Promise<McpToolResult> {
    try {
      const blueprints = await services.localServices!.getBlueprints?.();

      if (!blueprints) {
        return err('Blueprints service not available in this version of Local');
      }

      if (blueprints.length === 0) {
        return ok('No blueprints found. Create one using local_save_blueprint.');
      }

      const blueprintList = blueprints.map((bp: any) => ({
        id: bp.id,
        name: bp.name,
        description: bp.description || '',
        createdAt: bp.createdAt,
      }));

      return ok(JSON.stringify(blueprintList, null, 2));
    } catch (error: any) {
      return err(`Failed to list blueprints: ${error.message}`);
    }
  },
};
