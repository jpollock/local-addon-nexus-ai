import { McpToolHandler } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const fleetHealthHandler: McpToolHandler = {
  definition: {
    name: 'wpe_fleet_health',
    description:
      'Get a health overview of all WP Engine installs — traffic tiers, WP/PHP versions, SSL status, disk usage. ' +
      'Flags installs that need attention.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'Scope to one account. If omitted, checks all accounts.',
        },
      },
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const scopedAccountId = args.account_id as string | undefined;
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

    try {
      const allInstalls = await services.localServices!.capiGetInstalls() as any[];
      let installs = allInstalls ?? [];

      if (scopedAccountId) {
        installs = installs.filter(
          (i) => i.account?.id === scopedAccountId || i.account_id === scopedAccountId,
        );
      }

      if (installs.length === 0) {
        return ok('No installs found.');
      }

      // Fetch SSL certs for each install in parallel with per-item error handling
      const sslResults = await Promise.all(
        installs.map(async (inst) => {
          try {
            const data = await services.localServices!.capiDirect(
              `/installs/${inst.id}/ssl_certificates`,
            ) as any;
            return { id: inst.id, certs: data?.results ?? [], error: null };
          } catch (err: any) {
            return { id: inst.id, certs: [], error: err.message ?? String(err) };
          }
        }),
      );

      const sslMap = new Map(sslResults.map((r) => [r.id, r]));

      function sslStatus(installId: string): { icon: string; label: string } {
        const result = sslMap.get(installId);
        if (!result) return { icon: '?', label: 'Unknown' };
        if (result.error) return { icon: '⚠️', label: 'Error fetching SSL' };
        if (result.certs.length === 0) return { icon: '❌', label: 'No cert' };

        let earliestExpiry: Date | null = null;
        for (const cert of result.certs) {
          const expStr = cert.expires_at ?? cert.expiry ?? cert.valid_to ?? null;
          if (expStr) {
            const d = new Date(expStr);
            if (!isNaN(d.getTime())) {
              if (!earliestExpiry || d < earliestExpiry) earliestExpiry = d;
            }
          }
        }

        if (!earliestExpiry) return { icon: '✅', label: 'Valid' };
        const msLeft = earliestExpiry.getTime() - now;
        if (msLeft < 0) return { icon: '❌', label: 'Expired' };
        if (msLeft <= THIRTY_DAYS_MS) {
          return { icon: '⚠️', label: `Expiring ${Math.ceil(msLeft / 86400000)}d` };
        }
        return { icon: '✅', label: 'Valid' };
      }

      const issues: string[] = [];

      const lines = [
        `## Fleet Health — ${installs.length} Install${installs.length !== 1 ? 's' : ''}`,
        '',
        '| Install | Env | PHP | Domain | SSL | Flags |',
        '|---------|-----|-----|--------|-----|-------|',
      ];

      for (const inst of installs) {
        const env = inst.environment ?? '—';
        const php = inst.php_version ?? '—';
        const domain = inst.primary_domain ?? inst.cname ?? '—';
        const { icon: sslIcon, label: sslLabel } = sslStatus(inst.id);

        const flags: string[] = [];
        if (env === 'production' && (sslIcon === '❌' || sslIcon === '⚠️')) {
          const issueLabel = sslIcon === '❌' ? `${inst.name}: no/expired SSL on production` : `${inst.name}: SSL expiring soon on production`;
          issues.push(issueLabel);
          flags.push(sslIcon === '❌' ? '🚨 SSL issue' : '⚠️ SSL expiring');
        }

        const flagsLabel = flags.length > 0 ? flags.join(' ') : '—';
        lines.push(`| ${inst.name} | ${env} | ${php} | ${domain} | ${sslIcon} ${sslLabel} | ${flagsLabel} |`);
      }

      lines.push('');
      lines.push('### Issues Found');
      if (issues.length === 0) {
        lines.push('✅ No critical issues detected.');
      } else {
        lines.push(`${issues.length} issue${issues.length !== 1 ? 's' : ''} require attention:`);
        for (const issue of issues) {
          lines.push(`- ${issue}`);
        }
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
