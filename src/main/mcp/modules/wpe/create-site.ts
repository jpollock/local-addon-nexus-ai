import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const createSiteHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_site',
    description: 'Create a new WP Engine site. A site is a container for installs (environments). After creating a site, use wpe_create_install to add production/staging/development environments.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Site name' },
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

      const site = await services.localServices!.capiDirect('/sites', 'POST', { name, account: accountId }) as any;

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
