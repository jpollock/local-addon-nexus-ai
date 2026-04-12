import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getAccountUsageSummaryHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_account_usage_summary',
    description:
      'Get aggregate usage metrics for a WP Engine account — total visits, bandwidth consumed, and storage used, summed across all installs. Month defaults to current (0). Use month=1 for last month. Compare with wpe_get_account_limits to see consumption vs plan capacity. For per-install breakdown, use wpe_get_install_usage.' +
      'More detailed than wpe_get_account_usage.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'WP Engine account ID (UUID). Get from wpe_get_accounts.',
        },
        month_offset: {
          type: 'number',
          description: 'Month offset (0 = current, 1 = last month). Default: 0.',
        },
      },
      required: ['account_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    try {
      const accountId = args.account_id as string;
      const monthOffset = (args.month_offset as number) ?? 0;

      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
      const firstDate = target.toISOString().split('T')[0];
      const lastDate = new Date(target.getFullYear(), target.getMonth() + 1, 0)
        .toISOString().split('T')[0];
      const monthLabel = target.toLocaleString('en-US', { month: 'long', year: 'numeric' });

      const data = await services.localServices!.capiDirect(
        `/accounts/${accountId}/usage/summary?first_date=${firstDate}&last_date=${lastDate}`,
      ) as any;

      const visits = data?.visit_count ?? data?.visits ?? null;
      const bandwidthBytes = data?.network_total_bytes ?? data?.bandwidth_bytes ?? null;
      const storageBytes = data?.storage_bytes ?? null;
      const storageFileBytes = data?.storage_file_bytes ?? null;
      const storageDbBytes = data?.storage_database_bytes ?? null;

      const fmtGb = (bytes: any): string => {
        if (bytes == null) return '—';
        return `${Math.round(Number(bytes) / 1e9 * 100) / 100} GB`;
      };

      const lines = [
        `## WP Engine Account Usage Summary — ${monthLabel}`,
        `- **Period:** ${firstDate} to ${lastDate}`,
        `- **Visits:** ${visits != null ? Number(visits).toLocaleString() : '—'}`,
        `- **Bandwidth:** ${fmtGb(bandwidthBytes)}`,
      ];

      if (storageBytes != null) {
        lines.push(`- **Storage:** ${fmtGb(storageBytes)}`);
      } else {
        if (storageFileBytes != null) lines.push(`- **File Storage:** ${fmtGb(storageFileBytes)}`);
        if (storageDbBytes != null) lines.push(`- **Database Storage:** ${fmtGb(storageDbBytes)}`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
