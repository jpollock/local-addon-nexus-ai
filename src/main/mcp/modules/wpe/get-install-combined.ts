/**
 * wpe_install — consolidated install read tool
 *
 * Replaces: wpe_get_install, wpe_get_install_usage,
 *           wpe_get_domains, wpe_get_ssl_certificates, wpe_get_offload_settings
 *
 * Reduces 5 tool definitions + 5 round trips → 1 tool, 1–2 round trips.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

function buildDateRange(monthOffset = 0) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
  const first = target.toISOString().split('T')[0];
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).toISOString().split('T')[0];
  return { first, last, label: target.toLocaleString('en-US', { month: 'long', year: 'numeric' }) };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

export const getInstallCombinedHandler: McpToolHandler = {
  definition: {
    name: 'wpe_install',
    description:
      'Get WP Engine install details with optional extras in one call. ' +
      'include=[] fetches just the install. ' +
      'include=["usage"] adds bandwidth/visit/storage metrics. ' +
      'include=["domains"] adds all mapped domains and DNS status. ' +
      'include=["ssl"] adds SSL certificate details. ' +
      'include=["offload"] adds LargeFS/offload media settings. ' +
      'Combine freely: include=["domains","ssl"]. ' +
      'Replaces wpe_get_install, wpe_get_install_usage, wpe_get_domains, wpe_get_ssl_certificates, wpe_get_offload_settings.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: {
          type: 'string',
          description: 'WP Engine install ID (UUID). Get from wpe_get_installs.',
        },
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['usage', 'domains', 'ssl', 'offload'],
          },
          description: 'Additional data to fetch. Default: [].',
        },
        month_offset: {
          type: 'number',
          description: 'Month for usage data (0 = current, 1 = last month). Default: 0.',
        },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const installId = args.install_id as string;
    const include = (args.include as string[] | undefined) ?? [];
    const monthOffset = (args.month_offset as number) ?? 0;

    if (!installId) return error('install_id is required.');

    try {
      const { first, last, label } = buildDateRange(monthOffset);

      const install = await services.localServices!.capiGetInstall(installId) as any;
      if (!install) return error(`Install "${installId}" not found.`);

      // Parallel-fetch all requested extras
      const [usage, domains, ssl, offload] = await Promise.all([
        include.includes('usage')
          ? services.localServices!.capiDirect(`/installs/${installId}/usage?first_date=${first}&last_date=${last}`).catch(() => null)
          : Promise.resolve(null),
        include.includes('domains')
          ? services.localServices!.capiDirect(`/installs/${installId}/domains`).catch(() => null)
          : Promise.resolve(null),
        include.includes('ssl')
          ? services.localServices!.capiDirect(`/installs/${installId}/ssl_certificates`).catch(() => null)
          : Promise.resolve(null),
        include.includes('offload')
          ? services.localServices!.capiDirect(`/installs/${installId}/offload`).catch(() => null)
          : Promise.resolve(null),
      ]);

      const status = install.status ?? 'unknown';
      const isActive = status === 'active';

      const lines: string[] = [
        `## Install: ${install.name}`,
        '',
        `**Status:** ${status}${isActive ? ' ✅' : ' ⏳'}`,
        `**ID:** \`${install.id}\``,
        `**Environment:** ${install.environment ?? 'unknown'}`,
        `**Domain:** ${install.primaryDomain ?? install.cname ?? 'pending'}`,
        `**PHP:** ${install.phpVersion ?? 'unknown'}`,
      ];

      if (usage) {
        const u = usage as any;
        let totalVisits = 0, totalBandwidthBytes = 0, totalStorageBytes = 0;
        for (const env of (u.environment_metrics ?? [])) {
          totalVisits += Number(env.metrics_rollup?.visit_count?.sum ?? 0);
          totalBandwidthBytes += Number(env.metrics_rollup?.network_total_bytes?.sum ?? 0);
          totalStorageBytes += Number(env.metrics_rollup?.storage_bytes?.sum ?? 0);
        }
        lines.push('', `### Usage — ${label}`, '');
        lines.push(`- Visits: ${totalVisits.toLocaleString()}`);
        lines.push(`- Bandwidth: ${formatBytes(totalBandwidthBytes)}`);
        lines.push(`- Storage: ${formatBytes(totalStorageBytes)}`);
      }

      if (domains) {
        const domainList: any[] = (domains as any).results ?? (Array.isArray(domains) ? domains : []);
        lines.push('', `### Domains (${domainList.length})`, '');
        lines.push('| Domain | Primary | DNS Status | SSL |');
        lines.push('|--------|---------|------------|-----|');
        for (const d of domainList) {
          const primary = d.primary ? '✅' : '';
          lines.push(`| ${d.name} | ${primary} | ${d.dns_status ?? '—'} | ${d.ssl_active ? '✅' : '—'} |`);
        }
      }

      if (ssl) {
        const certList: any[] = (ssl as any).results ?? (Array.isArray(ssl) ? ssl : []);
        lines.push('', `### SSL Certificates (${certList.length})`, '');
        for (const cert of certList) {
          const expiry = cert.expires_at ? new Date(cert.expires_at).toLocaleDateString() : 'unknown';
          lines.push(`- **${cert.type ?? 'unknown'}** — expires ${expiry} | domains: ${(cert.domains ?? []).join(', ') || '—'}`);
        }
      }

      if (offload) {
        const o = offload as any;
        lines.push('', '### Offload (LargeFS)', '');
        lines.push(`- Enabled: ${o.enabled ? '✅' : '❌'}`);
        if (o.bucket) lines.push(`- Bucket: ${o.bucket}`);
        if (o.region) lines.push(`- Region: ${o.region}`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
