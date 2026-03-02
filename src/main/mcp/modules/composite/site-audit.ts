import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { requireRunning, ok, error } from '../wp-cli/preflight';

/**
 * Composite tool: runs wp_core_version + wp_plugin_list + wp_theme_list +
 * wp_site_health + plugin update check in parallel against a single local site.
 * Returns a unified audit report.
 */
export const siteAuditHandler: McpToolHandler = {
  definition: {
    name: 'nexus_site_audit',
    description:
      'Comprehensive audit of a local WordPress site. Checks WP version, plugins (with update availability), themes, and site health in a single call.',
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

    const check = requireRunning(site, services);
    if (check) return check;

    const ls = services.localServices!;

    // Run all checks in parallel
    const [version, plugins, themes, healthResult, updateResult] = await Promise.allSettled([
      ls.getWpVersion(site.id),
      ls.getPlugins(site.id),
      ls.getThemes(site.id),
      ls.wpCliRun(site.id, ['site', 'health', 'status', '--format=json']),
      ls.wpCliRun(site.id, ['plugin', 'update', '--all', '--dry-run', '--format=json']),
    ]);

    const lines: string[] = [`## Site Audit: ${site.name}`, ''];

    // WordPress version
    const wpVersion = version.status === 'fulfilled' ? version.value : null;
    lines.push(`**WordPress:** ${wpVersion ?? 'unknown'}`);
    lines.push('');

    // Plugins
    if (plugins.status === 'fulfilled' && plugins.value.length > 0) {
      lines.push(`### Plugins (${plugins.value.length})`);
      lines.push('| Plugin | Version | Status |');
      lines.push('|--------|---------|--------|');
      for (const p of plugins.value) {
        const status = p.status === 'active' ? '**active**' : p.status;
        lines.push(`| ${p.name} | v${p.version} | ${status} |`);
      }
    } else {
      lines.push('### Plugins');
      lines.push('No plugins installed.');
    }
    lines.push('');

    // Updates available
    if (updateResult.status === 'fulfilled' && updateResult.value.success) {
      try {
        const updates = JSON.parse(updateResult.value.stdout || '[]');
        if (updates.length > 0) {
          lines.push(`### Updates Available (${updates.length})`);
          lines.push('| Plugin | Current | Available |');
          lines.push('|--------|---------|-----------|');
          for (const u of updates) {
            lines.push(`| ${u.name} | v${u.version} | v${u.update_version} |`);
          }
        } else {
          lines.push('### Updates');
          lines.push('All plugins are up to date.');
        }
      } catch {
        lines.push('### Updates');
        lines.push(updateResult.value.stdout || 'Could not parse update check.');
      }
    } else {
      lines.push('### Updates');
      lines.push('Update check not available.');
    }
    lines.push('');

    // Themes
    if (themes.status === 'fulfilled' && themes.value.length > 0) {
      lines.push(`### Themes (${themes.value.length})`);
      for (const t of themes.value) {
        const status = t.status === 'active' ? '**active**' : t.status;
        lines.push(`- ${t.name} v${t.version} [${status}]`);
      }
    } else {
      lines.push('### Themes');
      lines.push('No themes installed.');
    }
    lines.push('');

    // Site health
    lines.push('### Site Health');
    if (healthResult.status === 'fulfilled' && healthResult.value.success) {
      lines.push(healthResult.value.stdout || 'Health check completed.');
    } else {
      lines.push('Site health check not available.');
    }

    return ok(lines.join('\n'));
  },
};
