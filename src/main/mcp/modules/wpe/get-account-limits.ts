import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getAccountLimitsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_account_limits',
    description:
      'Get the plan limits for a WP Engine account — visitor quotas, storage caps, bandwidth limits, and site/install counts. Use to understand capacity constraints before creating new installs or sites. Compare with wpe_get_account_usage_summary to see current consumption vs limits.' +
      'Use this to answer "am I near my plan limits?"',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'WP Engine account ID (UUID). Get from wpe_get_accounts.',
        },
      },
      required: ['account_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    try {
      const accountId = args.account_id as string;
      const data = await services.localServices!.capiDirect(`/accounts/${accountId}/limits`) as any;

      const limits: any[] = data?.results ?? (Array.isArray(data) ? data : []);
      if (limits.length === 0) {
        return ok(`No limit data found for account ${accountId}.`);
      }

      const lines = [
        `## WP Engine Account Plan Limits`,
        '',
        '| Limit | Allowed | Current | % Used |',
        '|-------|---------|---------|--------|',
      ];

      for (const limit of limits) {
        const name = limit.name ?? limit.limit_type ?? '—';
        const allowed = limit.limit ?? limit.allowed ?? '—';
        const current = limit.current ?? limit.used ?? '—';
        const pct =
          allowed && current && Number(allowed) > 0
            ? `${Math.round((Number(current) / Number(allowed)) * 100)}%`
            : '—';
        lines.push(`| ${name} | ${allowed} | ${current} | ${pct} |`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
