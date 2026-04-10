import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const requestSslCertificateHandler: McpToolHandler = {
  definition: {
    name: 'wpe_request_ssl_certificate',
    description: "Request a new SSL certificate for domains on a WP Engine install. WP Engine will automatically provision a Let's Encrypt certificate. Domains must already be added to the install and DNS must be resolving.",
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        domain_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of domain IDs to include in the certificate. Get IDs from wpe_get_domains.',
        },
      },
      required: ['install_id', 'domain_ids'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      await services.localServices!.capiDirect(
        `/installs/${args.install_id}/ssl_certificates`,
        'POST',
        { domain_ids: args.domain_ids },
      ) as any;

      const count = (args.domain_ids as string[]).length;
      return ok(
        `## SSL Certificate Requested\n\n` +
        `Certificate provisioning has been requested for ${count} domain(s) on install \`${args.install_id}\`.\n\n` +
        `WP Engine will provision a Let's Encrypt certificate automatically. This may take a few minutes. ` +
        `Use \`wpe_get_ssl_certificates\` to check the status.`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
