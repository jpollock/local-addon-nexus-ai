import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

function formatExpiry(expiryDate: string | undefined): string {
  if (!expiryDate) return '-';
  const expiry = new Date(expiryDate);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays < 0) {
    return `❌ expired ${Math.abs(diffDays)} days ago`;
  } else if (diffDays <= 14) {
    return `⚠️ expires in ${diffDays} days`;
  } else {
    return `expires in ${diffDays} days`;
  }
}

export const getSslCertificatesHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_ssl_certificates',
    description: 'List all SSL certificates for a WP Engine install — type (Lets Encrypt or custom), expiry dates, covered domains, and status. Use to audit certificate health, identify expiring certs, or confirm HTTPS is active after wpe_request_ssl_certificate. For a specific domain cert, use wpe_get_domain_ssl_certificate.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const data = await services.localServices!.capiDirect(`/installs/${args.install_id}/ssl_certificates`) as any;
      const results: any[] = data?.results ?? data?.certificates ?? [];

      if (results.length === 0) {
        return ok('No SSL certificates found for this install.');
      }

      const lines = [
        `## SSL Certificates for Install \`${args.install_id}\``,
        '',
        '| Domains Covered | Expiry Date | Status | Type |',
        '|-----------------|-------------|--------|------|',
      ];

      for (const cert of results) {
        const domains = Array.isArray(cert.domains) ? cert.domains.join(', ') : (cert.domains ?? '-');
        const expiry = formatExpiry(cert.expires_time ?? cert.expires_at ?? cert.expiry_date ?? cert.expiration_date);
        const status = cert.status ?? '-';
        const type = cert.type ?? '-';
        lines.push(`| ${domains} | ${expiry} | ${status} | ${type} |`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
