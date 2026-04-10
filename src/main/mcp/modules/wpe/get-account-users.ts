import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getAccountUsersHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_account_users',
    description:
      'List WP Engine portal users for an account — who has platform access and their roles. ' +
      'These are WP Engine account-level users (portal login), NOT WordPress site users. ' +
      'For WordPress users within a site use wp_user_list instead.',
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
      const data = await services.localServices!.capiDirect(
        `/accounts/${accountId}/account_users?limit=100`,
      ) as any;

      const users: any[] = data?.results ?? [];
      if (users.length === 0) {
        return ok(`No users found for account ${accountId}.`);
      }

      const lines = [`## WP Engine Account Users (${users.length})`];
      const byRole: Record<string, string[]> = {};
      for (const u of users) {
        const role = u.roles?.[0] ?? 'unknown';
        if (!byRole[role]) byRole[role] = [];
        byRole[role].push(`${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.user?.email || u.id);
      }

      for (const [role, names] of Object.entries(byRole).sort()) {
        lines.push(`\n**${role}** (${names.length})`);
        for (const name of names) lines.push(`- ${name}`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
