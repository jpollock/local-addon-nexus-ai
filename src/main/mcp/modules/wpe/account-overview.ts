import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const accountOverviewHandler: McpToolHandler = {
  definition: {
    name: 'wpe_account_overview',
    description:
      'Get a comprehensive overview of a WP Engine account — install count by environment, ' +
      'WP/PHP versions, and recent activity. ' +
      'Use this for "what does this account look like?" questions.',
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
      const [accountResult, allInstallsResult] = await Promise.allSettled([
        services.localServices!.capiDirect(`/accounts/${accountId}`) as Promise<any>,
        services.localServices!.capiGetInstalls() as Promise<any[]>,
      ]);

      if (accountResult.status === 'rejected') return capiError(accountResult.reason);
      if (allInstallsResult.status === 'rejected') return capiError(allInstallsResult.reason);

      const account = accountResult.value as any;
      const allInstalls = (allInstallsResult.value ?? []) as any[];

      // Filter installs to this account
      const installs = allInstalls.filter(
        (i) => i.account?.id === accountId || i.account_id === accountId,
      );

      // Group by environment
      const byEnv: Record<string, any[]> = {};
      for (const inst of installs) {
        const env = inst.environment ?? 'unknown';
        if (!byEnv[env]) byEnv[env] = [];
        byEnv[env].push(inst);
      }

      const envOrder = ['production', 'staging', 'development'];
      const sortedEnvs = [
        ...envOrder.filter((e) => byEnv[e]),
        ...Object.keys(byEnv).filter((e) => !envOrder.includes(e)),
      ];

      const lines = [
        `## Account Overview: ${account?.name ?? accountId}`,
        '',
        '### Account Info',
        `- **ID:** ${account?.id ?? accountId}`,
        `- **Name:** ${account?.name ?? '—'}`,
        account?.status ? `- **Status:** ${account.status}` : '',
        account?.plan_name ? `- **Plan:** ${account.plan_name}` : '',
        '',
        `### Installs (${installs.length} total)`,
      ].filter((l) => l !== '');

      // Summary counts by environment
      for (const env of sortedEnvs) {
        lines.push(`- **${env}:** ${byEnv[env].length}`);
      }

      // Per-environment install listings
      for (const env of sortedEnvs) {
        lines.push('');
        lines.push(`#### ${env.charAt(0).toUpperCase() + env.slice(1)} Installs`);
        lines.push('');
        lines.push('| Name | ID | Primary Domain | PHP |');
        lines.push('|------|----|---------------|-----|');
        for (const inst of byEnv[env]) {
          const domain = inst.primary_domain ?? inst.cname ?? inst.domains?.[0]?.name ?? '—';
          const php = inst.php_version ?? '—';
          lines.push(`| ${inst.name} | ${inst.id} | ${domain} | ${php} |`);
        }
      }

      if (installs.length === 0) {
        lines.push('', '_No installs found for this account._');
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
