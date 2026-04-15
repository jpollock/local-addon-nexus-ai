/**
 * wpe_account — consolidated account read tool
 *
 * Replaces: wpe_get_account, wpe_get_account_limits,
 *           wpe_get_account_usage_summary, wpe_get_account_usage_insights,
 *           wpe_get_account_users
 *
 * Reduces 5 tool definitions + 5 round trips → 1 tool, 1–2 round trips.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

function buildDateRange(monthOffset = 0) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
  const first = target.toISOString().split('T')[0];
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).toISOString().split('T')[0];
  return { first, last, label: target.toLocaleString('en-US', { month: 'long', year: 'numeric' }) };
}

export const getAccountCombinedHandler: McpToolHandler = {
  definition: {
    name: 'wpe_account',
    description:
      'Get WP Engine account details with optional extras in one call. ' +
      'include=[] fetches just the account. ' +
      'include=["limits"] adds plan limits. ' +
      'include=["usage"] adds bandwidth/visit/storage metrics. ' +
      'include=["usage_insights"] adds install-level usage breakdown. ' +
      'include=["users"] adds portal users. ' +
      'Combine freely: include=["limits","usage","users"]. ' +
      'Replaces wpe_get_account, wpe_get_account_limits, wpe_get_account_usage_summary, wpe_get_account_usage_insights, wpe_get_account_users.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'WP Engine account ID (UUID). Get from wpe_get_accounts.',
        },
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['limits', 'usage', 'usage_insights', 'users'],
          },
          description: 'Additional data to fetch alongside account details. Default: [].',
        },
        month_offset: {
          type: 'number',
          description: 'Month for usage data (0 = current, 1 = last month). Default: 0.',
        },
      },
      required: ['account_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const accountId = args.account_id as string;
    const include = (args.include as string[] | undefined) ?? [];
    const monthOffset = (args.month_offset as number) ?? 0;

    if (!accountId) return error('account_id is required.');

    try {
      const { first, last, label } = buildDateRange(monthOffset);

      // Always fetch base account
      const account = await services.localServices!.capiDirect(`/accounts/${accountId}`) as any;

      // Parallel-fetch all requested extras
      const [limits, usage, insights, users] = await Promise.all([
        include.includes('limits')
          ? services.localServices!.capiDirect(`/accounts/${accountId}/limits`).catch(() => null)
          : Promise.resolve(null),
        include.includes('usage')
          ? services.localServices!.capiDirect(`/accounts/${accountId}/usage?first_date=${first}&last_date=${last}`).catch(() => null)
          : Promise.resolve(null),
        include.includes('usage_insights')
          ? services.localServices!.capiDirect(`/accounts/${accountId}/usage/insights?first_date=${first}&last_date=${last}`).catch(() => null)
          : Promise.resolve(null),
        include.includes('users')
          ? services.localServices!.capiDirect(`/accounts/${accountId}/account_users`).catch(() => null)
          : Promise.resolve(null),
      ]);

      const lines: string[] = [
        `## Account: ${account.name ?? accountId}`,
        '',
        `**ID:** ${account.id}`,
        `**Status:** ${account.status ?? 'unknown'}`,
      ];

      if (limits) {
        const l = (limits as any);
        lines.push('', '### Plan Limits', '');
        if (l.installs !== undefined) lines.push(`- Installs: ${l.installs}`);
        if (l.bandwidth_gb !== undefined) lines.push(`- Bandwidth: ${l.bandwidth_gb} GB/mo`);
        if (l.storage_gb !== undefined) lines.push(`- Storage: ${l.storage_gb} GB`);
        if (l.visits !== undefined) lines.push(`- Visits: ${l.visits.toLocaleString()}/mo`);
      }

      if (usage) {
        const u = usage as any;
        const envMetrics: any[] = u.environment_metrics ?? [];
        let totalVisits = 0, totalBandwidthBytes = 0;
        for (const env of envMetrics) {
          totalVisits += Number(env.metrics_rollup?.visit_count?.sum ?? 0);
          totalBandwidthBytes += Number(env.metrics_rollup?.network_total_bytes?.sum ?? 0);
        }
        const bwGb = (totalBandwidthBytes / 1e9).toFixed(2);
        lines.push('', `### Usage — ${label}`, '');
        lines.push(`- Visits: ${totalVisits.toLocaleString()}`);
        lines.push(`- Bandwidth: ${bwGb} GB`);
      }

      if (insights) {
        lines.push('', '### Usage Insights', '');
        lines.push(`\`\`\`json\n${JSON.stringify(insights, null, 2).slice(0, 1000)}\n\`\`\``);
      }

      if (users) {
        const userList: any[] = (users as any).results ?? (Array.isArray(users) ? users : []);
        lines.push('', `### Users (${userList.length})`, '');
        lines.push('| Name | Email | Role |');
        lines.push('|------|-------|------|');
        for (const u of userList.slice(0, 20)) {
          lines.push(`| ${u.first_name ?? ''} ${u.last_name ?? ''} | ${u.email ?? '—'} | ${u.roles ?? '—'} |`);
        }
        if (userList.length > 20) lines.push(`_...and ${userList.length - 20} more_`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
