import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const accountSslStatusHandler: McpToolHandler = {
  definition: {
    name: 'wpe_account_ssl_status',
    description:
      'Check SSL certificate status across all installs in a WP Engine account. ' +
      'Highlights expiring, expired, or missing certificates.',
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
      const allInstalls = await services.localServices!.capiGetInstalls() as any[];
      const installs = (allInstalls ?? []).filter(
        (i) => i.account?.id === accountId || i.account_id === accountId,
      );

      if (installs.length === 0) {
        return ok(`No installs found for account \`${accountId}\`.`);
      }

      // Fetch SSL certs for each install in parallel with per-item error handling
      const sslResults = await Promise.all(
        installs.map(async (inst) => {
          try {
            const data = await services.localServices!.capiDirect(
              `/installs/${inst.id}/ssl_certificates`,
            ) as any;
            return { install: inst, certs: data?.results ?? [], error: null };
          } catch (err: any) {
            return { install: inst, certs: [], error: err.message ?? String(err) };
          }
        }),
      );

      const now = Date.now();
      const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

      function certStatusIcon(certs: any[]): { icon: string; label: string; domains: string; expiry: string } {
        if (certs.length === 0) {
          return { icon: '❌', label: 'No certificate', domains: '—', expiry: '—' };
        }

        // Find the cert with the latest expiry
        let earliestExpiry: Date | null = null;
        const allDomains: string[] = [];

        for (const cert of certs) {
          const expStr = cert.expires_at ?? cert.expiry ?? cert.valid_to ?? null;
          if (expStr) {
            const d = new Date(expStr);
            if (!isNaN(d.getTime())) {
              if (!earliestExpiry || d < earliestExpiry) earliestExpiry = d;
            }
          }
          const certDomains: string[] = cert.domains ?? (cert.domain ? [cert.domain] : []);
          allDomains.push(...certDomains);
        }

        const domainsLabel = allDomains.length > 0 ? allDomains.slice(0, 3).join(', ') + (allDomains.length > 3 ? ` +${allDomains.length - 3}` : '') : '—';
        const expiryLabel = earliestExpiry ? earliestExpiry.toISOString().split('T')[0] : '—';

        if (!earliestExpiry) {
          return { icon: '✅', label: 'Valid (expiry unknown)', domains: domainsLabel, expiry: expiryLabel };
        }

        const msUntilExpiry = earliestExpiry.getTime() - now;
        if (msUntilExpiry < 0) {
          return { icon: '❌', label: 'Expired', domains: domainsLabel, expiry: expiryLabel };
        }
        if (msUntilExpiry <= THIRTY_DAYS_MS) {
          const daysLeft = Math.ceil(msUntilExpiry / 86400000);
          return { icon: '⚠️', label: `Expiring in ${daysLeft} days`, domains: domainsLabel, expiry: expiryLabel };
        }
        return { icon: '✅', label: 'Valid', domains: domainsLabel, expiry: expiryLabel };
      }

      let expiredCount = 0;
      let expiringCount = 0;
      let noCertCount = 0;
      let validCount = 0;

      const lines = [
        `## SSL Certificate Status — Account ${accountId}`,
        `${installs.length} install${installs.length !== 1 ? 's' : ''}`,
        '',
        '| Install | Environment | Domain(s) | Expiry | Status |',
        '|---------|------------|-----------|--------|--------|',
      ];

      for (const { install, certs, error: fetchError } of sslResults) {
        if (fetchError) {
          lines.push(`| ${install.name} | ${install.environment ?? '—'} | — | — | ⚠️ Error fetching certs |`);
          continue;
        }

        const { icon, label, domains, expiry } = certStatusIcon(certs);

        if (icon === '❌' && label === 'No certificate') noCertCount++;
        else if (icon === '❌') expiredCount++;
        else if (icon === '⚠️') expiringCount++;
        else validCount++;

        lines.push(`| ${install.name} | ${install.environment ?? '—'} | ${domains} | ${expiry} | ${icon} ${label} |`);
      }

      lines.push('');
      lines.push('### Summary');
      lines.push(`- ✅ Valid: ${validCount}`);
      lines.push(`- ⚠️ Expiring soon (≤30 days): ${expiringCount}`);
      lines.push(`- ❌ Expired: ${expiredCount}`);
      lines.push(`- ❌ No certificate: ${noCertCount}`);

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
