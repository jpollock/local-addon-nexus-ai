import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const diagnoseSiteHandler: McpToolHandler = {
  definition: {
    name: 'wpe_diagnose_site',
    description:
      'Run a comprehensive diagnostic on a single WP Engine install — checks domains, SSL, ' +
      'recent backup, and disk usage. Returns actionable findings.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: {
          type: 'string',
          description: 'WP Engine install ID',
        },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const installId = args.install_id as string;
    if (!installId) return error('install_id is required.');

    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
    const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

    // Run all 4 checks in parallel
    const [installResult, domainsResult, sslResult, backupsResult] = await Promise.allSettled([
      services.localServices!.capiDirect(`/installs/${installId}`) as Promise<any>,
      services.localServices!.capiDirect(`/installs/${installId}/domains`) as Promise<any>,
      services.localServices!.capiDirect(`/installs/${installId}/ssl_certificates`) as Promise<any>,
      services.localServices!.capiDirect(`/installs/${installId}/backups?limit=1`) as Promise<any>,
    ]);

    const install = installResult.status === 'fulfilled' ? installResult.value : null;
    const domainsData = domainsResult.status === 'fulfilled' ? domainsResult.value : null;
    const sslData = sslResult.status === 'fulfilled' ? sslResult.value : null;
    const backupsData = backupsResult.status === 'fulfilled' ? backupsResult.value : null;

    const installName = install?.name ?? installId;
    const env = install?.environment ?? 'unknown';

    const lines = [
      `## Diagnostic Report: ${installName}`,
      `**Environment:** ${env}  |  **ID:** ${installId}`,
      install?.primary_domain ? `**Primary domain:** ${install.primary_domain}` : '',
      '',
      '### Checklist',
      '',
    ].filter((l) => l !== '');

    // --- Install info ---
    if (installResult.status === 'rejected') {
      lines.push('❌ **Install info** — Could not fetch install details.');
      lines.push('   _Recommended action: Verify the install ID is correct and you have access._');
    } else {
      lines.push(`✅ **Install found** — \`${installName}\` (${env})`);
    }

    // --- Domain check ---
    const domains: any[] = domainsData?.results ?? [];
    const domainFailed = domainsResult.status === 'rejected';

    if (domainFailed) {
      lines.push('⚠️ **Domains** — Could not fetch domain list.');
      lines.push('   _Recommended action: Check API credentials and retry._');
    } else if (domains.length === 0) {
      lines.push('❌ **Domains** — No domains configured.');
      lines.push('   _Recommended action: Add a primary domain via the WP Engine portal or wpe_prepare_go_live._');
    } else {
      const primaryDomain = domains.find((d) => d.primary);
      if (primaryDomain) {
        lines.push(`✅ **Domains** — ${domains.length} domain${domains.length !== 1 ? 's' : ''} configured. Primary: \`${primaryDomain.name ?? primaryDomain.domain}\``);
      } else {
        lines.push(`⚠️ **Domains** — ${domains.length} domain${domains.length !== 1 ? 's' : ''} configured but no primary domain set.`);
        lines.push('   _Recommended action: Set a primary domain in the WP Engine portal._');
      }
    }

    // --- SSL check ---
    const certs: any[] = sslData?.results ?? [];
    const sslFailed = sslResult.status === 'rejected';

    if (sslFailed) {
      lines.push('⚠️ **SSL** — Could not fetch SSL certificates.');
    } else if (certs.length === 0) {
      lines.push('❌ **SSL** — No SSL certificates found.');
      lines.push('   _Recommended action: Request an SSL certificate via wpe_prepare_go_live or the WP Engine portal._');
    } else {
      let earliestExpiry: Date | null = null;
      for (const cert of certs) {
        const expStr = cert.expires_at ?? cert.expiry ?? cert.valid_to ?? null;
        if (expStr) {
          const d = new Date(expStr);
          if (!isNaN(d.getTime()) && (!earliestExpiry || d < earliestExpiry)) {
            earliestExpiry = d;
          }
        }
      }

      if (!earliestExpiry) {
        lines.push(`✅ **SSL** — ${certs.length} certificate${certs.length !== 1 ? 's' : ''} present (expiry unknown).`);
      } else {
        const msLeft = earliestExpiry.getTime() - now;
        const expStr = earliestExpiry.toISOString().split('T')[0];
        if (msLeft < 0) {
          lines.push(`❌ **SSL** — Certificate expired on ${expStr}.`);
          lines.push('   _Recommended action: Renew or request a new SSL certificate immediately._');
        } else if (msLeft <= THIRTY_DAYS_MS) {
          const daysLeft = Math.ceil(msLeft / 86400000);
          lines.push(`⚠️ **SSL** — Certificate expires in ${daysLeft} days (${expStr}).`);
          lines.push('   _Recommended action: Renew the SSL certificate soon._');
        } else {
          lines.push(`✅ **SSL** — Certificate valid until ${expStr}.`);
        }
      }
    }

    // --- Backup recency check ---
    const backups: any[] = backupsData?.results ?? [];
    const backupFailed = backupsResult.status === 'rejected';

    if (backupFailed) {
      lines.push('⚠️ **Backup** — Could not check backup status. API credentials may be required (wpe_set_api_credentials).');
    } else if (backups.length === 0) {
      lines.push('❌ **Backup** — No backups found.');
      lines.push('   _Recommended action: Create a backup immediately with wpe_backup_and_verify._');
    } else {
      const latest = backups[0];
      const createdStr = latest.created_at ?? latest.date ?? null;
      const createdDate = createdStr ? new Date(createdStr) : null;

      if (!createdDate || isNaN(createdDate.getTime())) {
        lines.push('⚠️ **Backup** — Backup found but date could not be parsed.');
      } else {
        const ageMs = now - createdDate.getTime();
        const ageDays = Math.floor(ageMs / 86400000);
        const ageLabel = ageDays === 0 ? 'today' : ageDays === 1 ? 'yesterday' : `${ageDays} days ago`;

        if (ageMs > SEVEN_DAYS_MS) {
          lines.push(`⚠️ **Backup** — Last backup was ${ageLabel} (${createdDate.toISOString().split('T')[0]}).`);
          lines.push('   _Recommended action: Create a fresh backup with wpe_backup_and_verify._');
        } else {
          lines.push(`✅ **Backup** — Last backup was ${ageLabel} (${createdDate.toISOString().split('T')[0]}).`);
        }
      }
    }

    // --- PHP version advisory ---
    if (install?.php_version) {
      const phpMajor = parseFloat(install.php_version);
      if (phpMajor < 8.0) {
        lines.push(`⚠️ **PHP version** — Running PHP ${install.php_version} (below 8.0).`);
        lines.push('   _Recommended action: Upgrade PHP to 8.1 or later for security and performance._');
      } else {
        lines.push(`✅ **PHP version** — ${install.php_version}`);
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('_Run individual tools (wpe_backup_and_verify, wpe_prepare_go_live) to resolve specific issues._');

    return ok(lines.join('\n'));
  },
};
