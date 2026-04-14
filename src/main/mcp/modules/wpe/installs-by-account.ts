import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const installsByAccountHandler: McpToolHandler = {
  definition: {
    name: 'wpe_installs_by_account',
    description:
      'List all WP Engine installs grouped by account — shows install name, environment type, and primary domain for each install across all accounts. More structured than wpe_get_installs when working across multiple accounts. Use for fleet-wide inventory or when the user asks to show all their WPE sites.' +
      'Useful for fleet overview when you have multiple accounts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    try {
      const [accounts, installs] = await Promise.all([
        services.localServices!.capiGetAccounts() as Promise<any[]>,
        services.localServices!.capiGetInstalls() as Promise<any[]>,
      ]);

      if (!accounts || accounts.length === 0) {
        return ok('No WP Engine accounts found.');
      }

      // Build a map of account_id → installs
      const installsByAccountId: Record<string, any[]> = {};
      for (const account of accounts) {
        installsByAccountId[account.id] = [];
      }

      for (const install of (installs ?? [])) {
        const acctId = install.account?.id ?? install.account_id;
        if (acctId && installsByAccountId[acctId]) {
          installsByAccountId[acctId].push(install);
        } else if (acctId) {
          installsByAccountId[acctId] = [install];
        }
      }

      const totalInstalls = (installs ?? []).length;
      const lines = [
        `## WP Engine Installs by Account`,
        `${accounts.length} account${accounts.length !== 1 ? 's' : ''} · ${totalInstalls} total install${totalInstalls !== 1 ? 's' : ''}`,
        '',
      ];

      for (const account of accounts) {
        const acctInstalls = installsByAccountId[account.id] ?? [];

        // Count by environment
        const envCounts: Record<string, number> = {};
        for (const inst of acctInstalls) {
          const env = inst.environment ?? 'unknown';
          envCounts[env] = (envCounts[env] ?? 0) + 1;
        }

        const envSummary = Object.entries(envCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([env, count]) => `${count} ${env}`)
          .join(', ');

        lines.push(`### ${account.name} (${acctInstalls.length} install${acctInstalls.length !== 1 ? 's' : ''})`);
        lines.push(`**ID:** ${account.id}`);
        if (envSummary) lines.push(`**By environment:** ${envSummary}`);

        if (acctInstalls.length > 0) {
          lines.push('');
          lines.push('| Name | Environment | Primary Domain |');
          lines.push('|------|------------|---------------|');
          for (const inst of acctInstalls) {
            const domain = inst.primary_domain ?? inst.cname ?? inst.domains?.[0]?.name ?? '—';
            lines.push(`| ${inst.name} | ${inst.environment ?? '—'} | ${domain} |`);
          }
        } else {
          lines.push('_No installs._');
        }

        lines.push('');
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
