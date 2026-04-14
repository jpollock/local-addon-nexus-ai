import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const goLiveChecklistHandler: McpToolHandler = {
  definition: {
    name: 'wpe_go_live_checklist',
    description:
      'Read-only diagnostic: check whether a WP Engine install is ready to go live with a specific domain. Verifies domain configuration, DNS propagation, SSL status, and common go-live blockers. Does NOT make changes — use wpe_prepare_go_live to take action on any issues found.' +
      'Read-only diagnostic — use wpe_prepare_go_live to take action.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: {
          type: 'string',
          description: 'WP Engine install ID',
        },
        domain: {
          type: 'string',
          description: 'The domain you want to use for this install',
        },
      },
      required: ['install_id', 'domain'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const installId = args.install_id as string;
    const targetDomain = args.domain as string;
    if (!installId) return error('install_id is required.');
    if (!targetDomain) return error('domain is required.');

    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

    try {
      // Fetch install + domains + SSL in parallel
      const [installResult, domainsResult, sslResult] = await Promise.allSettled([
        services.localServices!.capiDirect(`/installs/${installId}`) as Promise<any>,
        services.localServices!.capiDirect(`/installs/${installId}/domains`) as Promise<any>,
        services.localServices!.capiDirect(`/installs/${installId}/ssl_certificates`) as Promise<any>,
      ]);

      const install = installResult.status === 'fulfilled' ? installResult.value : null;
      const domainsData = domainsResult.status === 'fulfilled' ? domainsResult.value : null;
      const sslData = sslResult.status === 'fulfilled' ? sslResult.value : null;

      const installName = install?.name ?? installId;
      const domains: any[] = domainsData?.results ?? [];
      const certs: any[] = sslData?.results ?? [];

      const lines = [
        `## Go-Live Checklist: ${installName} → ${targetDomain}`,
        '',
        '### Pre-Launch Checks',
        '',
      ];

      // Check 1: Domain is added to install
      const foundDomain = domains.find(
        (d) => (d.name ?? d.domain ?? '').toLowerCase() === targetDomain.toLowerCase(),
      );

      if (!foundDomain) {
        lines.push(`❌ **Domain added** — \`${targetDomain}\` is not yet added to this install.`);
        lines.push('   _Next action: Run **wpe_prepare_go_live** to add the domain automatically._');
      } else {
        lines.push(`✅ **Domain added** — \`${targetDomain}\` is configured on this install (ID: ${foundDomain.id}).`);
      }

      // Check 2: DNS resolving (only if domain is found)
      if (foundDomain?.id) {
        let dnsStatus = 'unknown';
        try {
          const checkResult = await services.localServices!.capiDirect(
            `/installs/${installId}/domains/${foundDomain.id}/check_status`,
            'POST',
            {},
          ) as any;
          dnsStatus = checkResult?.status ?? checkResult?.dns_status ?? 'unknown';
        } catch {
          dnsStatus = 'check-failed';
        }

        if (dnsStatus === 'check-failed') {
          lines.push('⚠️ **DNS resolving** — Could not check DNS status.');
          lines.push('   _Next action: Verify DNS records point to WP Engine name servers or IP._');
        } else if (dnsStatus.toLowerCase().includes('ok') || dnsStatus.toLowerCase() === 'active') {
          lines.push(`✅ **DNS resolving** — DNS status: ${dnsStatus}`);
        } else {
          lines.push(`⚠️ **DNS resolving** — DNS status: ${dnsStatus}`);
          lines.push('   _Next action: Update your DNS records to point to WP Engine. It may take up to 48 hours to propagate._');
        }
      } else {
        lines.push('⏭ **DNS resolving** — Skipped (domain not yet added).');
      }

      // Check 3: SSL valid for domain
      const domainCert = certs.find((cert) => {
        const certDomains: string[] = cert.domains ?? (cert.domain ? [cert.domain] : []);
        return certDomains.some(
          (d) => d.toLowerCase() === targetDomain.toLowerCase() ||
            (d.startsWith('*.') && targetDomain.endsWith(d.slice(1))),
        );
      });

      if (certs.length === 0 || !domainCert) {
        lines.push(`❌ **SSL certificate** — No certificate found covering \`${targetDomain}\`.`);
        lines.push('   _Next action: Run **wpe_prepare_go_live** to request an SSL certificate._');
      } else {
        const expStr = domainCert.expires_at ?? domainCert.expiry ?? domainCert.valid_to ?? null;
        const expDate = expStr ? new Date(expStr) : null;

        if (!expDate || isNaN(expDate.getTime())) {
          lines.push(`✅ **SSL certificate** — Certificate present for \`${targetDomain}\` (expiry unknown).`);
        } else {
          const msLeft = expDate.getTime() - now;
          const expLabel = expDate.toISOString().split('T')[0];
          if (msLeft < 0) {
            lines.push(`❌ **SSL certificate** — Certificate for \`${targetDomain}\` expired on ${expLabel}.`);
            lines.push('   _Next action: Request a new SSL certificate._');
          } else if (msLeft <= THIRTY_DAYS_MS) {
            const daysLeft = Math.ceil(msLeft / 86400000);
            lines.push(`⚠️ **SSL certificate** — Certificate expires in ${daysLeft} days (${expLabel}).`);
            lines.push('   _Next action: Renew the SSL certificate before go-live._');
          } else {
            lines.push(`✅ **SSL certificate** — Valid until ${expLabel}.`);
          }
        }
      }

      // Check 4: WP version advisory
      if (install?.php_version) {
        const phpMajor = parseFloat(install.php_version);
        if (phpMajor < 8.0) {
          lines.push(`⚠️ **PHP version** — Running PHP ${install.php_version} (below 8.0 — consider upgrading before go-live).`);
        } else {
          lines.push(`✅ **PHP version** — ${install.php_version}`);
        }
      }

      const allPass = !lines.some((l) => l.startsWith('❌') || l.startsWith('⚠️'));

      lines.push('');
      lines.push('---');
      if (allPass) {
        lines.push('✅ **All checks passed.** This install appears ready to go live.');
      } else {
        lines.push('Some checks need attention. Run **wpe_prepare_go_live** to resolve domain/SSL issues automatically.');
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
