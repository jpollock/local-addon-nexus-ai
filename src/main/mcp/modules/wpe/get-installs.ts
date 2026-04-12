import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI, staleSyncWarning } from './helpers';

export const getInstallsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_installs',
    description: 'List all WP Engine installs (environments) accessible to the authenticated user. An install is a single environment: production, staging, or development. Optionally filter by account_id. Returns install name, ID, environment type, and primary domain. The install name (e.g. mysite) is used as install_name in wp_* tools for remote WP-CLI execution.',
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
