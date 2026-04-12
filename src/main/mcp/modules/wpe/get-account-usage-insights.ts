import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getAccountUsageInsightsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_account_usage_insights',
    description:
      'Get usage metrics broken down by environment type (production, staging, development) for a WP Engine account. Useful for understanding which environment tier is consuming the most resources. Month defaults to current (0). For total account usage, use wpe_get_account_usage_summary. For individual install usage, use wpe_get_install_usage.',
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
        `/accounts/${accountId}/usage/insights?first_date=${firstDate}&last_date=${lastDate}`,
      ) as any;

      const insights: any[] = data?.results ?? (Array.isArray(data) ? data : []);
      if (insights.length === 0) {
        return ok(`No usage insight data found for account ${accountId} in ${monthLabel}.`);
      }

      const fmtGb = (bytes: any): string => {
        if (bytes == null) return '—';
        return `${Math.round(Number(bytes) / 1e9 * 100) / 100} GB`;
      };

      const lines = [
        `## WP Engine Account Usage Insights — ${monthLabel}`,
        `Period: ${firstDate} to ${lastDate}`,
        '',
        '| Environment Type | Visits | Bandwidth | Storage |',
        '|-----------------|--------|-----------|---------|',
      ];

      for (const row of insights) {
        const envType = row.environment_type ?? row.type ?? '—';
        const visits = row.visit_count ?? row.visits ?? null;
        const bandwidth = row.network_total_bytes ?? row.bandwidth_bytes ?? null;
        const storage = row.storage_bytes ?? row.storage_file_bytes ?? null;
        lines.push(
          `| ${envType} | ${visits != null ? Number(visits).toLocaleString() : '—'} | ${fmtGb(bandwidth)} | ${fmtGb(storage)} |`,
        );
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
