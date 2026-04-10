import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const checkDomainStatusHandler: McpToolHandler = {
  definition: {
    name: 'wpe_check_domain_status',
    description: 'Check DNS propagation and resolution status for a domain on a WP Engine install. Use after adding a domain to verify it is resolving correctly.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        domain_id: { type: 'string', description: 'Domain ID to check' },
      },
      required: ['install_id', 'domain_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const result = await services.localServices!.capiDirect(
        `/installs/${args.install_id}/domains/${args.domain_id}/check_status`,
        'POST',
        {},
      ) as any;

      const lines = [
        `## DNS Status: ${result.name ?? args.domain_id}`,
        '',
        `- **DNS Status:** ${result.status ?? result.dns_status ?? '-'}`,
        `- **Resolution:** ${result.resolves_to ?? result.resolution ?? '-'}`,
      ];

      if (result.message) {
        lines.push(`- **Message:** ${result.message}`);
      }

      if (result.errors && result.errors.length > 0) {
        lines.push('', '### Errors');
        for (const e of result.errors) {
          lines.push(`- ${typeof e === 'string' ? e : JSON.stringify(e)}`);
        }
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
