import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getDomainHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_domain',
    description: 'Get details for a single domain on a WP Engine install.',
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
      const d = await services.localServices!.capiDirect(`/installs/${args.install_id}/domains/${args.domain_id}`) as any;

      const lines = [
        `## Domain: ${d.name ?? d.id}`,
        '',
        `- **ID:** ${d.id ?? '-'}`,
        `- **Name:** ${d.name ?? '-'}`,
        `- **Primary:** ${d.primary ? 'Yes' : 'No'}`,
        `- **Status:** ${d.status ?? '-'}`,
        `- **Redirect To:** ${d.redirect_to ?? '-'}`,
        `- **Created:** ${d.created_at ?? '-'}`,
      ];

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
