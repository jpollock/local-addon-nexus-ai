import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const createInstallHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_install',
    description: 'Create a new WP Engine install (environment) within an existing site. Environment types: production, staging, or development. Each site can have one of each. Requires an existing site_id from wpe_create_site. After creation the install takes a few minutes to provision.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'WP Engine site ID from wpe_create_site or wpe_get_sites.' },
        name: {
          type: 'string',
          description: 'Install slug — used as the SSH hostname and WP Engine subdomain (e.g. "fakerinc" → fakerinc.wpengine.com). Rules: lowercase letters, numbers, hyphens only. No spaces. No special characters. Max ~20 chars. Must be globally unique across all WP Engine. Bad: "Faker Incorporated", "faker_inc". Good: "fakerinc", "faker-demo".',
        },
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

      // Validate install name before calling CAPI — invalid names return unhelpful 400 errors
      if (!/^[a-z0-9-]+$/.test(name)) {
        return error(
          `Invalid install name "${name}". WPE install names must be lowercase letters, numbers, and hyphens only — no spaces or special characters. ` +
          `Try: "${name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}"`
        );
      }
      if (name.length > 20) {
        return error(`Install name "${name}" is too long (${name.length} chars). WPE limits install names to ~20 characters.`);
      }

      // Swagger: field names are site_id and account_id (not site/account)
      const install = await services.localServices!.capiDirect('/installs', 'POST', { name, account_id: accountId, site_id: siteId, environment }) as any;

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
