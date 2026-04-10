import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const portfolioOverviewHandler: McpToolHandler = {
  definition: {
    name: 'wpe_portfolio_overview',
    description:
      'Get an executive summary of the entire WP Engine fleet — all accounts, install counts, ' +
      'traffic totals, version distribution. The highest-level fleet summary available.',
    inputSchema: {
      type: 'object',
      properties: {
        month_offset: {
          type: 'number',
          description: 'Month to query for usage (0 = current month, 1 = last month). Default: 0',
        },
      },
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const monthOffset = (args.month_offset as number) ?? 0;

    try {
      // Build date range for usage queries
      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
      const firstDate = target.toISOString().split('T')[0];
      const lastDate = new Date(target.getFullYear(), target.getMonth() + 1, 0)
        .toISOString().split('T')[0];
      const monthLabel = target.toLocaleString('en-US', { month: 'long', year: 'numeric' });

      const [accounts, allInstalls] = await Promise.all([
        services.localServices!.capiGetAccounts() as Promise<any[]>,
        services.localServices!.capiGetInstalls() as Promise<any[]>,
      ]);

      if (!accounts || accounts.length === 0) {
        return ok('No WP Engine accounts found.');
      }

      const installs = allInstalls ?? [];

      // Get account-level usage for each account in parallel
      interface AccountUsage {
        accountId: string;
        accountName: string;
        totalVisits: number;
        totalBandwidthGb: number;
        installCount: number;
        envCounts: Record<string, number>;
      }

      const usageResults = await Promise.all(
        accounts.map(async (account) => {
          const acctInstalls = installs.filter(
            (i) => i.account?.id === account.id || i.account_id === account.id,
          );
          const envCounts: Record<string, number> = {};
          for (const inst of acctInstalls) {
            const env = inst.environment ?? 'unknown';
            envCounts[env] = (envCounts[env] ?? 0) + 1;
          }

          let totalVisits = 0;
          let totalBandwidthGb = 0;

          try {
            const data = await services.localServices!.capiDirect(
              `/accounts/${account.id}/usage?first_date=${firstDate}&last_date=${lastDate}`,
            ) as any;
            const envMetrics: any[] = data?.environment_metrics ?? [];
            for (const env of envMetrics) {
              const visits = Number(env.metrics_rollup?.visit_count?.sum ?? 0);
              const bandwidthBytes = Number(env.metrics_rollup?.network_total_bytes?.sum ?? 0);
              totalVisits += visits;
              totalBandwidthGb += bandwidthBytes / 1e9;
            }
          } catch {
            // Usage fetch failed — counts remain 0
          }

          return {
            accountId: account.id,
            accountName: account.name,
            totalVisits,
            totalBandwidthGb: Math.round(totalBandwidthGb * 100) / 100,
            installCount: acctInstalls.length,
            envCounts,
          } as AccountUsage;
        }),
      );

      // Fleet-wide totals
      const totalInstalls = installs.length;
      const totalVisits = usageResults.reduce((s, r) => s + r.totalVisits, 0);
      const totalBandwidth = Math.round(usageResults.reduce((s, r) => s + r.totalBandwidthGb, 0) * 100) / 100;

      // Installs by environment across all accounts
      const fleetEnvCounts: Record<string, number> = {};
      for (const inst of installs) {
        const env = inst.environment ?? 'unknown';
        fleetEnvCounts[env] = (fleetEnvCounts[env] ?? 0) + 1;
      }

      const lines = [
        `## WP Engine Portfolio Overview — ${monthLabel}`,
        '',
        '### Fleet Summary',
        `- **Accounts:** ${accounts.length}`,
        `- **Total installs:** ${totalInstalls}`,
        ...Object.entries(fleetEnvCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([env, count]) => `  - ${env}: ${count}`),
        `- **Total visits (${monthLabel}):** ${totalVisits.toLocaleString()}`,
        `- **Total bandwidth (${monthLabel}):** ${totalBandwidth} GB`,
        '',
        '### By Account',
        '',
        '| Account | Installs | Visits | Bandwidth | Environments |',
        '|---------|---------|--------|-----------|-------------|',
      ];

      // Sort by total visits descending
      usageResults.sort((a, b) => b.totalVisits - a.totalVisits);

      for (const r of usageResults) {
        const envSummary = Object.entries(r.envCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([env, count]) => `${count} ${env}`)
          .join(', ') || '—';

        lines.push(
          `| ${r.accountName} | ${r.installCount} | ${r.totalVisits.toLocaleString()} | ${r.totalBandwidthGb} GB | ${envSummary} |`,
        );
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
