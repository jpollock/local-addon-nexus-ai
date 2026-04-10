import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const createInstallHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_install',
    description: 'Create a new WP Engine install (environment) within an existing site. Use wpe_create_site first if you need a new site container.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'WP Engine site ID. Get from wpe_get_sites.' },
        name: { type: 'string', description: 'Install name (lowercase, hyphens allowed)' },
        environment: { type: 'string', description: 'Environment type: production, staging, or development' },
        account_id: { type: 'string', description: 'Account ID' },
      },
      required: ['site_id', 'name', 'environment', 'account_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const siteId = args.site_id as string;
      const name = args.name as string;
      const environment = args.environment as string;
      const accountId = args.account_id as string;

      if (!siteId) return error('Site ID is required.');
      if (!name) return error('Install name is required.');
      if (!environment) return error('Environment type is required (production, staging, or development).');
      if (!accountId) return error('Account ID is required.');

      const validEnvs = ['production', 'staging', 'development'];
      if (!validEnvs.includes(environment)) {
        return error(`Invalid environment "${environment}". Must be one of: production, staging, development.`);
      }

      const install = await services.localServices!.capiDirect('/installs', 'POST', { site: siteId, name, environment, account: accountId }) as any;

      const domain = install?.primaryDomain ?? install?.cname ?? `${install?.name ?? name}.wpengine.com`;

      return ok(
        `## Install Created\n\n` +
        `**Name:** ${install?.name ?? name}\n` +
        `**ID:** \`${install?.id}\`\n` +
        `**Environment:** ${install?.environment ?? environment}\n` +
        `**Domain:** ${domain}`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
