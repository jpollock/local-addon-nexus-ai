import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const createSiteHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_site',
    description: 'Create a new WP Engine site container. Always follow immediately with wpe_create_install to add an environment — a site with no installs has no hosting capacity. Requires account_id from wpe_get_accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Site display name. WPE accepts spaces and mixed case here (e.g. "Faker Incorporated"). This is NOT the install/SSH name — that is set separately in wpe_create_install.',
        },
        account_id: { type: 'string', description: 'Account ID. Get from wpe_get_accounts.' },
      },
      required: ['name', 'account_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const name = args.name as string;
      const accountId = args.account_id as string;

      if (!name) return error('Site name is required.');
      if (!accountId) return error('Account ID is required.');

      // CAPI expects account_id as a query param, name in the POST body
      const site = await services.localServices!.capiDirect(`/sites?account_id=${encodeURIComponent(accountId)}`, 'POST', { name }) as any;


      return ok(
        `## Site Created\n\n` +
        `**Name:** ${site.name ?? name}\n` +
        `**ID:** \`${site.id}\`\n\n` +
        `Use \`wpe_create_install\` with this site ID to add production/staging/development environments.`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
