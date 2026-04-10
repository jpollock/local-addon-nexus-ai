import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getAccountUserHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_account_user',
    description: 'Get details for a single WP Engine portal user on an account.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'WP Engine account ID (UUID). Get from wpe_get_accounts.',
        },
        user_id: {
          type: 'string',
          description: 'Account user ID. Get from wpe_get_account_users.',
        },
      },
      required: ['account_id', 'user_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    try {
      const accountId = args.account_id as string;
      const userId = args.user_id as string;
      const data = await services.localServices!.capiDirect(
        `/accounts/${accountId}/account_users/${userId}`,
      ) as any;

      const fullName = `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || '—';
      const email = data.user?.email ?? data.email ?? '—';
      const roles = Array.isArray(data.roles) && data.roles.length > 0
        ? data.roles.join(', ')
        : '—';
      const created = data.created_at
        ? new Date(data.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : '—';

      const lines = [
        `## WP Engine Account User`,
        `- **Name:** ${fullName}`,
        `- **Email:** ${email}`,
        `- **Roles:** ${roles}`,
        `- **Created:** ${created}`,
        `- **User ID:** ${data.id ?? userId}`,
      ];

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
