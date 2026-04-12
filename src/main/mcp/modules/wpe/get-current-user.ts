import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getCurrentUserHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_current_user',
    description: 'Get the profile of the currently authenticated WP Engine user — name, email, and associated accounts. Use to confirm which account is active after wpe_login, or to get the user email for creating SSH keys. Use wpe_status to check whether authentication is still valid.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const user = await services.localServices!.capiDirect('/user') as any;

      const lines = [
        '## Current WP Engine User',
        '',
        `- **Name:** ${[user.first_name, user.last_name].filter(Boolean).join(' ') || '-'}`,
        `- **Email:** ${user.email ?? '-'}`,
      ];

      if (user.phone) {
        lines.push(`- **Phone:** ${user.phone}`);
      }

      if (user.account_id) {
        lines.push(`- **Account ID:** ${user.account_id}`);
      }

      if (Array.isArray(user.accounts) && user.accounts.length > 0) {
        lines.push('', '### Account Associations');
        for (const account of user.accounts) {
          lines.push(`- **${account.name ?? account.id}** (ID: ${account.id}, Role: ${account.roles?.join(', ') ?? account.role ?? '-'})`);
        }
      }

      if (user.roles && !user.accounts) {
        lines.push(`- **Roles:** ${Array.isArray(user.roles) ? user.roles.join(', ') : user.roles}`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
