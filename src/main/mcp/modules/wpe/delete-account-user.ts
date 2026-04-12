import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const deleteAccountUserHandler: McpToolHandler = {
  definition: {
    name: 'wpe_delete_account_user',
    description:
      'Tier 3 (destructive) — remove a user from a WP Engine account, revoking all portal access. Requires confirmation token. This does NOT delete the user WP Engine account — only removes their access to this account. Use wpe_get_account_users to find the user_id and confirm before removing.' +
      'Tier 3 — requires confirmation.',
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
        _confirmationToken: {
          type: 'string',
          description: 'Confirmation token. Omit on first call to see what will be deleted.',
        },
      },
      required: ['account_id', 'user_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const accountId = args.account_id as string;
    const userId = args.user_id as string;

    if (!args._confirmationToken) {
      try {
        const data = await services.localServices!.capiDirect(
          `/accounts/${accountId}/account_users/${userId}`,
        ) as any;

        const fullName = `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || '—';
        const email = data.user?.email ?? data.email ?? '—';
        const roles = Array.isArray(data.roles) && data.roles.length > 0
          ? data.roles.join(', ')
          : '—';

        return ok(
          `## ⚠️ Confirm User Removal\n\n` +
          `**Name:** ${fullName}\n` +
          `**Email:** ${email}\n` +
          `**Roles:** ${roles}\n` +
          `**User ID:** ${userId}\n\n` +
          `This will revoke the user's portal access to this WP Engine account. ` +
          `This action cannot be undone.\n\n` +
          `To confirm, call this tool again with the same parameters plus \`_confirmationToken: "confirm"\`.`,
        );
      } catch (err: any) {
        return capiError(err);
      }
    }

    try {
      await services.localServices!.capiDirect(
        `/accounts/${accountId}/account_users/${userId}`,
        'DELETE',
      );

      return ok(`User \`${userId}\` has been removed from the account and their portal access has been revoked.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
