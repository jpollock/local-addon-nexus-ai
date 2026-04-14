import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const getAccountsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_accounts',
    description: 'List all WP Engine accounts the authenticated user has access to. Returns account ID, name, and creation date. Account IDs are required as input for most other wpe_* tools. Run this first if you do not know the account_id, or use nexus_list_sites for a unified local+WPE view.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const accounts = await services.localServices!.capiGetAccounts() as any[];
      if (!accounts || accounts.length === 0) {
        return ok('No WP Engine accounts found.');
      }

      const lines = [`## WP Engine Accounts (${accounts.length})`];
      for (const a of accounts) {
        lines.push(`- **${a.name}** (ID: ${a.id})`);
      }
      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
