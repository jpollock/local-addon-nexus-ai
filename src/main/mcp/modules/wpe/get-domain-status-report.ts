import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getDomainStatusReportHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_domain_status_report',
    description: 'Get a detailed DNS resolution report for a domain — shows NS records, A records, CNAME resolution, and propagation status across multiple DNS resolvers. Use when wpe_check_domain_status shows issues, to get more detail on what DNS records are resolving. Requires both the domain_id and an existing report_id from a previous check.',
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
      const report = await services.localServices!.capiDirect(
        `/installs/${args.install_id}/domains/${args.domain_id}/status_report`,
      ) as any;

      const lines = [
        `## Domain Status Report: ${report.name ?? args.domain_id}`,
        '',
      ];

      const skip = new Set(['id', 'name']);
      for (const [key, value] of Object.entries(report)) {
        if (skip.has(key) || value === null || value === undefined) continue;
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        if (typeof value === 'object') {
          lines.push(`**${label}:**`);
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            lines.push(`  - ${k}: ${v}`);
          }
        } else {
          lines.push(`- **${label}:** ${value}`);
        }
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
