import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getDomainsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_domains',
    description: 'List all domains associated with a WP Engine install — including primary domain, additional domains, DNS propagation status, and SSL coverage. Use after wpe_create_domain to verify DNS status, or before go-live to audit domain configuration. For SSL-specific details, use wpe_get_ssl_certificates.',
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
      const data = await services.localServices!.capiDirect(`/installs/${args.install_id}/domains`) as any;
      const results: any[] = data?.results ?? [];

      if (results.length === 0) {
        return ok('No domains found for this install.');
      }

      const lines = [
        `## Domains for Install \`${args.install_id}\``,
        '',
        '| Domain | Primary | Status | Redirect To |',
        '|--------|---------|--------|-------------|',
      ];

      for (const d of results) {
        const primary = d.primary ? '✓' : '';
        const status = d.status ?? '-';
        const redirectTo = d.redirect_to ?? '-';
        lines.push(`| ${d.name ?? d.id} | ${primary} | ${status} | ${redirectTo} |`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
