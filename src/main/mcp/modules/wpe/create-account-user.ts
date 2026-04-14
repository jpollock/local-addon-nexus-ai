import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const createAccountUserHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_account_user',
    description: 'Add a new user to a WP Engine account, granting portal access. Role options: full (complete access), billing (billing only), partial (specific installs only — requires install_ids). An invitation email is sent to the user. Use wpe_get_account_users to confirm the user was added successfully.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'WP Engine account ID (UUID). Get from wpe_get_accounts.',
        },
        email: {
          type: 'string',
          description: 'Email address of the user to add.',
        },
        first_name: {
          type: 'string',
          description: 'First name of the user.',
        },
        last_name: {
          type: 'string',
          description: 'Last name of the user.',
        },
        roles: {
          type: 'string',
          description: 'Role to grant. Swagger accepts: "owner", "full", "full,billing", "partial", "partial,billing".',
        },
      },
      required: ['account_id', 'email', 'first_name', 'last_name', 'roles'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    try {
      const accountId = args.account_id as string;
      const email = args.email as string;
      const firstName = args.first_name as string;
      const lastName = args.last_name as string;
      const roles = args.roles as string;

      // Swagger: roles is a string inside the user object; account_id required in user
      await services.localServices!.capiDirect(
        `/accounts/${accountId}/account_users`,
        'POST',
        { user: { account_id: accountId, email, first_name: firstName, last_name: lastName, roles } },
      );

      return ok(
        `## User Added Successfully\n` +
        `**${firstName} ${lastName}** (${email}) has been added to the account with role: ${roles}.`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
