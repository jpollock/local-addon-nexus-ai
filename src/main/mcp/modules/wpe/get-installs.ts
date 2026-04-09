import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI, staleSyncWarning } from './helpers';

export const getInstallsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_installs',
    description: 'List all WP Engine installs (environments) accessible to the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const installs = await services.localServices!.capiGetInstalls() as any[];
      if (!installs || installs.length === 0) {
        return ok('No WP Engine installs found.');
      }

      const lines = [`## WP Engine Installs (${installs.length})`];
      for (const i of installs) {
        lines.push(`- **${i.name}** (ID: ${i.id}, env: ${i.environment ?? 'unknown'})`);
      }
      const warning = await staleSyncWarning(services);
      return ok(lines.join('\n') + warning);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
