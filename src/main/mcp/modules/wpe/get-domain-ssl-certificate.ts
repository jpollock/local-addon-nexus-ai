import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getDomainSslCertificateHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_domain_ssl_certificate',
    description: 'Get the SSL certificate for a specific domain on a WP Engine install.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        domain_id: { type: 'string', description: 'Domain ID' },
      },
      required: ['install_id', 'domain_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const cert = await services.localServices!.capiDirect(
        `/installs/${args.install_id}/domains/${args.domain_id}/ssl_certificate`,
      ) as any;

      const domains = Array.isArray(cert.domains) ? cert.domains.join(', ') : (cert.domains ?? '-');

      const lines = [
        `## SSL Certificate`,
        '',
        `- **ID:** ${cert.id ?? '-'}`,
        `- **Status:** ${cert.status ?? '-'}`,
        `- **Type:** ${cert.type ?? '-'}`,
        `- **Issuer:** ${cert.issuer ?? '-'}`,
        `- **Domains Covered:** ${domains}`,
        `- **Expires:** ${cert.expires_at ?? cert.expiry_date ?? cert.expiration_date ?? '-'}`,
        `- **Created:** ${cert.created_at ?? '-'}`,
      ];

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
