import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error } from './preflight';
import { resolveTransport } from '../../../transport';
import { withSiteRunning } from '../with-site-running';

export const siteHealthHandler: McpToolHandler = {
  definition: {
    name: 'wp_site_health',
    description:
      'Run WordPress site health check — returns core version, database status, active theme, ' +
      'plugin/theme counts, and basic diagnostics. ' +
      'Works on local sites (site=), remote WPE installs via SSH (install_name=), and external SSH hosts (ssh_target=). ' +
      'Run this after plugin updates or before local_wpe_push to confirm no regressions.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        install_name: { type: 'string', description: 'WPE install name for remote execution via SSH' },
        ssh_target: {
          type: 'string',
          description: 'External SSH host, as ssh:<alias>@<production|staging|development>. The alias is a Host entry in the user\'s ~/.ssh/config. Register one with `nexus host add`.',
        },
        wp_path: {
          type: 'string',
          description: 'Absolute WordPress root on an external host. Usually unnecessary — a registered host supplies its own discovered path.',
        },
      },
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const transport = await resolveTransport(args, services, 'wpcli_read');
    if ('content' in transport) return transport;

    // For local sites, retrieve the site record to get the domain (local-only field)
    const localSite = transport.kind === 'local' && transport.siteRef.kind === 'local'
      ? services.siteData?.getSite(transport.siteRef.siteId)
      : undefined;

    // Helper to run the health check commands via the transport
    const runHealthCheck = async (siteName: string) => {
      // Run multiple lightweight WP-CLI commands in parallel to build a health report
      const [versionResult, pluginResult, themeResult, optionResult, dbResult] = await Promise.allSettled([
        transport.runWpCli(['core', 'version']),
        transport.runWpCli(['plugin', 'list', '--format=json']),
        transport.runWpCli(['theme', 'list', '--format=json']),
        transport.runWpCli(['option', 'get', 'blogname']),
        transport.runWpCli(['db', 'size', '--format=json']),
      ]);

      const lines: string[] = [];
      lines.push(`## Site Health: ${siteName}`);
      lines.push('');

      // WordPress version
      if (versionResult.status === 'fulfilled' && versionResult.value.success) {
        lines.push(`**WordPress Version:** ${(versionResult.value.stdout ?? '').trim()}`);
      }

      // Site name from options
      if (optionResult.status === 'fulfilled' && optionResult.value.success) {
        lines.push(`**Site Title:** ${(optionResult.value.stdout ?? '').trim()}`);
      }

      // Domain (local sites only — remote targets do not expose this field)
      if (localSite?.domain) {
        lines.push(`**Domain:** ${localSite.domain}`);
      }

      lines.push('');

      // Plugins
      if (pluginResult.status === 'fulfilled' && pluginResult.value.success) {
        try {
          const plugins = JSON.parse(pluginResult.value.stdout ?? '[]');
          const active = plugins.filter((p: any) => p.status === 'active');
          const inactive = plugins.filter((p: any) => p.status === 'inactive');
          const updateAvailable = plugins.filter((p: any) => p.update === 'available');

          lines.push('### Plugins');
          lines.push(`- **Total:** ${plugins.length} (${active.length} active, ${inactive.length} inactive)`);
          if (updateAvailable.length > 0) {
            lines.push(`- **Updates available:** ${updateAvailable.length}`);
            for (const p of updateAvailable) {
              lines.push(`  - ${p.name} (${p.version})`);
            }
          } else {
            lines.push('- **Updates available:** none');
          }
          lines.push('');
        } catch {
          lines.push('### Plugins');
          lines.push('Could not parse plugin data.');
          lines.push('');
        }
      }

      // Themes
      if (themeResult.status === 'fulfilled' && themeResult.value.success) {
        try {
          const themes = JSON.parse(themeResult.value.stdout ?? '[]');
          const activeTheme = themes.find((t: any) => t.status === 'active');
          const updateAvailable = themes.filter((t: any) => t.update === 'available');

          lines.push('### Themes');
          lines.push(`- **Active theme:** ${activeTheme?.name ?? 'unknown'} (${activeTheme?.version ?? '?'})`);
          lines.push(`- **Total installed:** ${themes.length}`);
          if (updateAvailable.length > 0) {
            lines.push(`- **Updates available:** ${updateAvailable.length}`);
          }
          lines.push('');
        } catch {
          lines.push('### Themes');
          lines.push('Could not parse theme data.');
          lines.push('');
        }
      }

      // Database size
      if (dbResult.status === 'fulfilled' && dbResult.value.success) {
        try {
          const dbData = JSON.parse(dbResult.value.stdout ?? '[]');
          if (Array.isArray(dbData) && dbData.length > 0) {
            // db size returns array of table sizes; last entry is total
            const total = dbData[dbData.length - 1];
            lines.push('### Database');
            lines.push(`- **Size:** ${total?.Size ?? 'unknown'}`);
            lines.push(`- **Tables:** ${dbData.length - 1}`);
            lines.push('');
          }
        } catch {
          // db size output might not be JSON in all versions
        }
      }

      return ok(lines.join('\n'));
    };

    // Get the site name from the transport's siteRef
    const getSiteName = (): string => {
      if (transport.siteRef.kind === 'local') return transport.siteRef.siteName;
      if (transport.siteRef.kind === 'wpe') return transport.siteRef.installName;
      if (transport.siteRef.kind === 'external') return transport.siteRef.alias;
      return 'site';
    };

    const siteName = getSiteName();

    // For local sites only: use withSiteRunning to auto-start halted sites.
    // This is specific to local sites — remote targets have no site to start and no id to pass.
    if (transport.kind === 'local' && transport.siteRef.kind === 'local') {
      return withSiteRunning(transport.siteRef.siteId, services, async () => runHealthCheck(siteName));
    }

    // For remote and external SSH: run directly without withSiteRunning
    return runHealthCheck(siteName);
  },
};
