import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const createDomainHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_domain',
    description: 'Add a custom domain to a WP Engine install. After adding: (1) point DNS to WPE nameservers or A record at the registrar, (2) use wpe_check_domain_status to verify DNS has propagated, (3) use wpe_request_ssl_certificate to provision HTTPS. For a full guided go-live flow, use wpe_prepare_go_live instead.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        name: { type: 'string', description: 'The domain name to add (e.g. "example.com")' },
      },
      required: ['install_id', 'name'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const result = await services.localServices!.capiDirect(
        `/installs/${args.install_id}/domains`,
        'POST',
        { name: args.name },
      ) as any;

      return ok(
        `## Domain Added\n\n` +
        `- **Name:** ${result.name ?? args.name}\n` +
        `- **ID:** ${result.id ?? '-'}\n\n` +
        `Use \`wpe_check_domain_status\` to verify DNS propagation and \`wpe_request_ssl_certificate\` to provision HTTPS.`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
