import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const updateAccountUserHandler: McpToolHandler = {
  definition: {
    name: 'wpe_update_account_user',
    description: 'Update the role of an existing WP Engine portal user on an account. Role options: full, billing, or partial (partial requires install_ids to specify access). Use wpe_get_account_users to find the user_id and confirm current role before updating.',
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
        roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of roles to assign. Common values: "full", "billing", "partial".',
        },
      },
      required: ['account_id', 'user_id', 'roles'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    try {
      const accountId = args.account_id as string;
      const userId = args.user_id as string;
      const roles = args.roles as string[];

      await services.localServices!.capiDirect(
        `/accounts/${accountId}/account_users/${userId}`,
        'PATCH',
        { roles },
      );

      return ok(
        `## Role Updated Successfully\n` +
        `User \`${userId}\` now has role(s): ${roles.join(', ')}.`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
