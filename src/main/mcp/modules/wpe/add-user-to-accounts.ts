import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const addUserToAccountsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_add_user_to_accounts',
    description:
      'Add a user to multiple WP Engine accounts in one call — useful for agency workflows where a user needs access across many accounts. The user receives an invitation email. Role options: full, billing, or partial (partial requires install_ids). Requires confirmation token for Tier 3 accounts. Use wpe_create_account_user for adding to a single account.' +
      'Creates the user on each account with the specified role.',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the user to add',
        },
        account_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Account IDs to add the user to',
        },
        first_name: {
          type: 'string',
          description: 'User first name',
        },
        last_name: {
          type: 'string',
          description: 'User last name',
        },
        role: {
          type: 'string',
          description: 'Role to grant: "full", "billing", or "partial"',
        },
      },
      required: ['email', 'account_ids', 'first_name', 'last_name', 'role'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const email = args.email as string;
    const accountIds = args.account_ids as string[];
    const firstName = args.first_name as string;
    const lastName = args.last_name as string;
    const role = args.role as string;

    if (!email) return error('email is required.');
    if (!accountIds || accountIds.length === 0) return error('account_ids must be a non-empty array.');
    if (!firstName) return error('first_name is required.');
    if (!lastName) return error('last_name is required.');
    if (!role) return error('role is required.');

    const validRoles = ['full', 'billing', 'partial'];
    if (!validRoles.includes(role.toLowerCase())) {
      return error(`Invalid role "${role}". Must be one of: ${validRoles.join(', ')}.`);
    }

    // Add user to each account in parallel
    const results = await Promise.all(
      accountIds.map(async (accountId) => {
        try {
          await services.localServices!.capiDirect(
            `/accounts/${accountId}/account_users`,
            'POST',
            {
              user: { email, first_name: firstName, last_name: lastName },
              roles: [role],
            },
          );
          return { accountId, success: true, message: null };
        } catch (err: any) {
          return { accountId, success: false, message: err.message ?? String(err) };
        }
      }),
    );

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.length - successCount;

    const lines = [
      `## Add User to Accounts: ${email}`,
      `**Name:** ${firstName} ${lastName}  |  **Role:** ${role}`,
      `**Result:** ${successCount} succeeded, ${failCount} failed`,
      '',
      '| Account ID | Result |',
      '|-----------|--------|',
    ];

    for (const result of results) {
      if (result.success) {
        lines.push(`| ${result.accountId} | ✅ Added |`);
      } else {
        lines.push(`| ${result.accountId} | ❌ ${result.message ?? 'Unknown error'} |`);
      }
    }

    if (failCount > 0) {
      lines.push('');
      lines.push('⚠️ Some accounts failed. Common causes: user already exists, account not found, or insufficient permissions.');
    }

    return ok(lines.join('\n'));
  },
};
