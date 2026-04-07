/**
 * wpe_portfolio_usage — cross-account install usage in O(accounts) calls.
 *
 * The CAPI /accounts/{id}/usage endpoint returns environment_metrics, a
 * per-install breakdown for every install in the account. This lets us get
 * visit/bandwidth/storage data for ALL installs by making one call per
 * account instead of one call per install.
 *
 * Sorted by visits descending. Supports optional min_visits_per_day filter
 * so the agent can answer "which installs have > 100 visits/day" without
 * fetching WP/PHP versions for sites that don't qualify.
 */
import { McpToolHandler } from '../../types';
import { requireCAPI, capiError, staleSyncWarning } from './helpers';

export const portfolioUsageHandler: McpToolHandler = {
  definition: {
    name: 'wpe_portfolio_usage',
    description:
      'Get visit, bandwidth, and storage metrics for ALL WP Engine installs across all accounts ' +
      'in a single efficient operation (one API call per account, not per install). ' +
      'Use this for questions like "which sites get the most traffic?", ' +
      '"filter installs with more than N visits per day", or ' +
      '"what are my highest-bandwidth environments?". ' +
      'Results are sorted by total visits descending. ' +
      'Use month_offset to query previous months (0 = current, 1 = last month).',
    inputSchema: {
      type: 'object',
      properties: {
        month_offset: {
          type: 'number',
          description: 'Month to query (0 = current month, 1 = last month). Default: 0',
        },
        min_visits_per_day: {
          type: 'number',
          description: 'Filter to installs averaging at least this many visits per day. Optional.',
        },
      },
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    try {
      const monthOffset = (args.month_offset as number) ?? 0;
      const minVisitsPerDay = args.min_visits_per_day as number | undefined;

      // Build date range
      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
      const firstDate = target.toISOString().split('T')[0];
      const lastDate = new Date(target.getFullYear(), target.getMonth() + 1, 0)
        .toISOString().split('T')[0];
      const daysInMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();

      // Get all accounts
      const accounts = await services.localServices!.capiGetAccounts() as Array<{ id: string; name: string }>;
      if (!accounts || accounts.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No WP Engine accounts found.' }] };
      }

      // Fetch account-level usage in parallel (concurrency 5)
      interface InstallUsage {
        install_name: string;
        account_name: string;
        total_visits: number | null;
        avg_visits_per_day: number | null;
        total_bandwidth_gb: number | null;
        storage_files_gb: number | null;
        storage_db_gb: number | null;
      }

      const allInstalls: InstallUsage[] = [];
      const errors: string[] = [];

      const CONCURRENCY = 5;
      let i = 0;

      while (i < accounts.length) {
        const batch = accounts.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (account) => {
          try {
            const data = await services.localServices!.capiDirect(
              `/accounts/${account.id}/usage?first_date=${firstDate}&last_date=${lastDate}`,
            ) as any;

            const envMetrics: any[] = data?.environment_metrics ?? [];
            for (const env of envMetrics) {
              const totalVisits = env.metrics_rollup?.visit_count?.sum ?? null;
              const totalVisitsNum = totalVisits !== null ? Number(totalVisits) : null;
              const avgPerDay = totalVisitsNum !== null ? Math.round(totalVisitsNum / daysInMonth) : null;

              allInstalls.push({
                install_name: env.environment_name ?? 'unknown',
                account_name: account.name,
                total_visits: totalVisitsNum,
                avg_visits_per_day: avgPerDay,
                total_bandwidth_gb: env.metrics_rollup?.network_total_bytes?.sum != null
                  ? Math.round(Number(env.metrics_rollup.network_total_bytes.sum) / 1e9 * 100) / 100
                  : null,
                storage_files_gb: env.metrics_rollup?.storage_file_bytes?.latest?.value != null
                  ? Math.round(Number(env.metrics_rollup.storage_file_bytes.latest.value) / 1e9 * 100) / 100
                  : null,
                storage_db_gb: env.metrics_rollup?.storage_database_bytes?.latest?.value != null
                  ? Math.round(Number(env.metrics_rollup.storage_database_bytes.latest.value) / 1e9 * 100) / 100
                  : null,
              });
            }
          } catch (err: any) {
            errors.push(`${account.name}: ${err.message}`);
          }
        }));
        i += CONCURRENCY;
      }

      // Sort by visits descending
      allInstalls.sort((a, b) => (b.total_visits ?? -1) - (a.total_visits ?? -1));

      // Apply min_visits_per_day filter if requested
      const filtered = minVisitsPerDay != null
        ? allInstalls.filter(inst => (inst.avg_visits_per_day ?? 0) >= minVisitsPerDay)
        : allInstalls;

      const monthLabel = target.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const filterNote = minVisitsPerDay != null
        ? ` (filtered: ≥${minVisitsPerDay} visits/day)`
        : '';

      const lines = [
        `## WP Engine Portfolio Usage — ${monthLabel}${filterNote}`,
        `${filtered.length} install${filtered.length === 1 ? '' : 's'} across ${accounts.length} account${accounts.length === 1 ? '' : 's'}`,
        '',
        '| Install | Account | Visits (total) | Avg/day | Bandwidth | File storage | DB storage |',
        '|---------|---------|---------------|---------|-----------|-------------|------------|',
      ];

      for (const inst of filtered) {
        lines.push(
          `| ${inst.install_name} | ${inst.account_name} | ${inst.total_visits?.toLocaleString() ?? '—'} | ${inst.avg_visits_per_day?.toLocaleString() ?? '—'} | ${inst.total_bandwidth_gb != null ? inst.total_bandwidth_gb + ' GB' : '—'} | ${inst.storage_files_gb != null ? inst.storage_files_gb + ' GB' : '—'} | ${inst.storage_db_gb != null ? inst.storage_db_gb + ' GB' : '—'} |`,
        );
      }

      if (errors.length > 0) {
        lines.push('', `⚠️ Errors for ${errors.length} account(s): ${errors.join('; ')}`);
      }

      const warning = await staleSyncWarning(services);
      return { content: [{ type: 'text' as const, text: lines.join('\n') + warning }] };
    } catch (err: any) {
      return capiError(err);
    }
  },
};
