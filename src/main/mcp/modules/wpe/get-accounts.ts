import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, requireCAPI } from './helpers';

export const getAccountsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_accounts',
    description: 'List WP Engine accounts accessible to the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const accounts = await services.localServices!.capiGetAccounts() as any[];
    if (!accounts || accounts.length === 0) {
      return ok('No WP Engine accounts found.');
    }

    const lines = [`## WP Engine Accounts (${accounts.length})`];
    for (const a of accounts) {
      lines.push(`- **${a.name}** (ID: ${a.id})`);
    }
    return ok(lines.join('\n'));
  },
};
