import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getAccountHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_account',
    description: 'Get details for a single WP Engine account — name, ID, creation date, and plan information. Use wpe_get_accounts first to list available accounts and their IDs. For a higher-level overview, use wpe_account_overview.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'WP Engine account ID (UUID). Get from wpe_get_accounts.',
        },
      },
      required: ['account_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    try {
      const accountId = args.account_id as string;
      const data = await services.localServices!.capiDirect(`/accounts/${accountId}`) as any;

      const lines = [
        `## WP Engine Account`,
        `- **Name:** ${data.name ?? '—'}`,
        `- **ID:** ${data.id ?? accountId}`,
        `- **Created:** ${data.created_at ? new Date(data.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}`,
      ];

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
