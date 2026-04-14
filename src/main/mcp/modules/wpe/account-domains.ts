import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const accountDomainsHandler: McpToolHandler = {
  definition: {
    name: 'wpe_account_domains',
    description:
      'List all custom domains across every install in a WP Engine account, grouped by install. Use for a complete domain inventory, identifying unused domains, or auditing primary domain configuration across the fleet.' +
      'Useful for domain inventory and finding where domains are configured.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'WP Engine account ID',
        },
      },
      required: ['account_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const accountId = args.account_id as string;
    if (!accountId) return error('account_id is required.');

    try {
      // Get all installs and filter to this account
      const allInstalls = await services.localServices!.capiGetInstalls() as any[];
      const installs = (allInstalls ?? []).filter(
        (i) => i.account?.id === accountId || i.account_id === accountId,
      );

      if (installs.length === 0) {
        return ok(`No installs found for account \`${accountId}\`.`);
      }

      // Fetch domains for each install in parallel with per-item error handling
      const domainResults = await Promise.all(
        installs.map(async (inst) => {
          try {
            const data = await services.localServices!.capiDirect(
              `/installs/${inst.id}/domains`,
            ) as any;
            return { install: inst, domains: data?.results ?? [], error: null };
          } catch (err: any) {
            return { install: inst, domains: [], error: err.message ?? String(err) };
          }
        }),
      );

      const totalDomains = domainResults.reduce((sum, r) => sum + r.domains.length, 0);

      const lines = [
        `## Domain Inventory — Account ${accountId}`,
        `${installs.length} install${installs.length !== 1 ? 's' : ''} · ${totalDomains} domain${totalDomains !== 1 ? 's' : ''}`,
        '',
      ];

      for (const { install, domains, error: fetchError } of domainResults) {
        lines.push(`### ${install.name} (${install.environment ?? 'unknown'})`);

        if (fetchError) {
          lines.push(`_⚠️ Could not fetch domains: ${fetchError}_`);
          lines.push('');
          continue;
        }

        if (domains.length === 0) {
          lines.push('_No domains configured._');
          lines.push('');
          continue;
        }

        lines.push('');
        lines.push('| Domain | Primary | Status |');
        lines.push('|--------|---------|--------|');
        for (const d of domains) {
          const isPrimary = d.primary ? '✅ Yes' : 'No';
          const status = d.status ?? d.redirect_to ?? '—';
          lines.push(`| ${d.name ?? d.domain ?? '—'} | ${isPrimary} | ${status} |`);
        }
        lines.push('');
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
