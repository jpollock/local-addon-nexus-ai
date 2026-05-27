import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error } from './preflight';
import { withSiteRunning } from '../with-site-running';

export const siteHealthHandler: McpToolHandler = {
  definition: {
    name: 'wp_site_health',
    description:
      'Run WordPress site health check — returns core version, database status, active theme, ' +
      'plugin/theme counts, and basic diagnostics. ' +
      'LOCAL SITES ONLY — use nexus_site_audit or wp_plugin_list for remote WPE installs. ' +
      'Run this after plugin updates or before local_wpe_push to confirm no regressions.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name, ID, or domain' },
      },
      required: ['site'],
    },
    isAvailable: (services) => !!services.localServices,
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    return withSiteRunning(site.id, services, async () => {
      const wpCli = services.localServices!;

      // Run multiple lightweight WP-CLI commands in parallel to build a health report
      const [versionResult, pluginResult, themeResult, optionResult, dbResult] = await Promise.allSettled([
        wpCli.wpCliRun(site.id, ['core', 'version']),
        wpCli.wpCliRun(site.id, ['plugin', 'list', '--format=json']),
        wpCli.wpCliRun(site.id, ['theme', 'list', '--format=json']),
        wpCli.wpCliRun(site.id, ['option', 'get', 'blogname']),
        wpCli.wpCliRun(site.id, ['db', 'size', '--format=json']),
      ]);

      const lines: string[] = [];
      lines.push(`## Site Health: ${site.name}`);
      lines.push('');

      // WordPress version
      if (versionResult.status === 'fulfilled' && versionResult.value.success) {
        lines.push(`**WordPress Version:** ${(versionResult.value.stdout ?? '').trim()}`);
      }

      // Site name from options
      if (optionResult.status === 'fulfilled' && optionResult.value.success) {
        lines.push(`**Site Title:** ${(optionResult.value.stdout ?? '').trim()}`);
      }

      if (site.domain) {
        lines.push(`**Domain:** ${site.domain}`);
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
    });
  },
};
