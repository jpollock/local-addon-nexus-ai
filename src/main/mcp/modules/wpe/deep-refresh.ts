/**
 * wpe_site_deep_refresh — SSH WP-CLI deep refresh for a WPE install.
 *
 * Fetches plugins (with active/inactive status), themes, WordPress version,
 * site URL, admin email, active theme, and post count via 7 parallel SSH calls.
 * Persists results to the graph DB so future queries return fresh data.
 *
 * Replicates the logic of the `nexusWpeSiteDeepRefresh` GraphQL resolver,
 * exposing the same capability to Claude Desktop agents via MCP.
 */
import { McpToolHandler } from '../../types';
import { requireLocalServices } from './helpers';
import { isOperationAllowed } from '../../utils/operation-permissions';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { NexusSettings } from '../../../../common/types';

export const deepRefreshHandler: McpToolHandler = {
  definition: {
    name: 'wpe_site_deep_refresh',
    description:
      'Deep-refresh a WP Engine site\'s digital twin via SSH WP-CLI. ' +
      'Fetches plugins (with active/inactive status), themes, WordPress version, ' +
      'site URL, admin email, active theme, and post count. ' +
      'Persists results to the graph so future queries return fresh data. ' +
      'Requires SSH key to be configured in Local. ' +
      'Use when the WPE site\'s cached data is stale or missing.',
    inputSchema: {
      type: 'object',
      properties: {
        install_name: {
          type: 'string',
          description: "WPE install name (e.g. 'mysite' — the install name, not the full domain)",
        },
      },
      required: ['install_name'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services) {
    const installName = args.install_name as string;

    if (!services.localServices) {
      return {
        content: [{ type: 'text' as const, text: 'Local services not available.' }],
        isError: true,
      };
    }

    if (!services.localServices.isSSHKeyAvailable()) {
      return {
        content: [{
          type: 'text' as const,
          text: 'WP Engine SSH key not found. Connect to WP Engine via Local first.',
        }],
        isError: true,
      };
    }

    // Check operation permissions before running SSH commands
    const settings = ((services as any).registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
    const cache = (services as any).registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as { installs?: Array<{ installName?: string; install_name?: string; environment?: string }> } | null;
    const cachedInstall = cache?.installs?.find((i: any) => (i.installName ?? i.install_name) === installName);
    const environment = cachedInstall?.environment ?? 'production';
    if (!isOperationAllowed('wpcli', environment, settings, installName)) {
      return {
        content: [{
          type: 'text' as const,
          text: `Operation blocked: this operation is not permitted on "${environment}" environments. ` +
            `Adjust in Nexus Preferences → WP Engine → WP Engine Access.`,
        }],
        isError: true,
      };
    }

    const graphService = (services as any).graphService;
    const now = Date.now();

    // Find the graph site ID for this install
    let siteId: string | null = null;
    if (graphService?.getDb?.()) {
      const row = graphService.getDb().prepare(
        "SELECT id FROM sites WHERE source='wpe' AND (name=? OR remote_install_id=?)"
      ).get(installName, installName) as any;
      siteId = row?.id ?? null;
    }

    // Run all 7 SSH WP-CLI calls in parallel
    let pluginResult: any;
    let themeResult: any;
    let versionResult: any;
    let siteUrlResult: any;
    let adminEmailResult: any;
    let postCountResult: any;
    let activeThemeResult: any;

    try {
      [
        pluginResult, themeResult, versionResult,
        siteUrlResult, adminEmailResult, postCountResult, activeThemeResult,
      ] = await Promise.all([
        services.localServices.remoteWpCliRun(installName, ['plugin', 'list', '--format=json', '--fields=name,title,version,status']),
        services.localServices.remoteWpCliRun(installName, ['theme', 'list', '--format=json', '--fields=name,title,version,status']),
        services.localServices.remoteWpCliRun(installName, ['core', 'version']),
        services.localServices.remoteWpCliRun(installName, ['option', 'get', 'siteurl']),
        services.localServices.remoteWpCliRun(installName, ['option', 'get', 'admin_email']),
        services.localServices.remoteWpCliRun(installName, ['post', 'list', '--post_status=publish', '--format=count']),
        services.localServices.remoteWpCliRun(installName, ['option', 'get', 'stylesheet']),
      ]);
    } catch (err: any) {
      return {
        content: [{
          type: 'text' as const,
          text: `SSH connection failed for "${installName}": ${err.message}`,
        }],
        isError: true,
      };
    }

    const errors: string[] = [];
    let pluginCount = 0;
    let themeCount = 0;
    let wpVersion: string | null = null;

    // Persist plugins
    if (pluginResult.success && pluginResult.stdout && siteId && graphService) {
      try {
        const plugins = JSON.parse(pluginResult.stdout);
        await graphService.deletePlugins(siteId);
        for (const p of plugins) {
          await graphService.upsertPlugin({
            site_id: siteId, slug: p.name, name: p.title || p.name,
            version: p.version || null, is_active: p.status === 'active',
            author: null, created_at: now, updated_at: now,
          });
          pluginCount++;
        }
      } catch (e) { errors.push(`plugins: ${(e as Error).message}`); }
    } else if (!pluginResult.success) {
      errors.push(`plugin list failed: ${pluginResult.stdout || pluginResult.stderr || 'unknown'}`);
    }

    // Persist themes
    if (themeResult.success && themeResult.stdout && siteId && graphService) {
      try {
        const themes = JSON.parse(themeResult.stdout);
        await graphService.deleteThemes(siteId);
        for (const t of themes) {
          await graphService.upsertTheme({
            site_id: siteId, slug: t.name, name: t.title || t.name,
            version: t.version || null, is_active: t.status === 'active',
            author: null, created_at: now, updated_at: now,
          });
          themeCount++;
        }
      } catch (e) { errors.push(`themes: ${(e as Error).message}`); }
    } else if (!themeResult.success) {
      errors.push(`theme list failed: ${themeResult.stdout || themeResult.stderr || 'unknown'}`);
    }

    // Collect WP version
    if (versionResult.success && versionResult.stdout) {
      wpVersion = versionResult.stdout.trim();
    } else if (!versionResult.success) {
      errors.push(`core version failed: ${versionResult.stdout || 'unknown'}`);
    }

    // Persist scalar fields in one UPDATE
    if (siteId && graphService?.getDb?.()) {
      const siteUrl    = siteUrlResult.success    ? siteUrlResult.stdout?.trim()    || null : null;
      const adminEmail = adminEmailResult.success ? adminEmailResult.stdout?.trim() || null : null;
      const postCount  = postCountResult.success  ? parseInt(postCountResult.stdout?.trim() || '0', 10) || null : null;
      const activeTheme = activeThemeResult.success ? activeThemeResult.stdout?.trim() || null : null;

      graphService.getDb().prepare(`
        UPDATE sites
           SET wp_version=?, site_url=?, admin_email=?, active_theme=?, post_count=?, last_sync_at=?
         WHERE id=?
      `).run(wpVersion, siteUrl, adminEmail, activeTheme, postCount, now, siteId);
    }

    // Build summary
    const siteUrl    = siteUrlResult?.success    ? siteUrlResult.stdout?.trim()    || 'unknown' : 'unavailable';
    const adminEmail = adminEmailResult?.success ? adminEmailResult.stdout?.trim() || 'unknown' : 'unavailable';
    const postCount  = postCountResult?.success  ? postCountResult.stdout?.trim()  || '0'       : 'unavailable';

    const errorNote = errors.length > 0 ? `\n\n⚠️ Partial errors: ${errors.join('; ')}` : '';

    const summary = [
      `✅ **${installName}** refreshed via SSH`,
      `- WordPress: ${wpVersion ?? 'unknown'}`,
      `- ${pluginCount} plugins, ${themeCount} themes`,
      `- Site URL: ${siteUrl}`,
      `- Admin email: ${adminEmail}`,
      `- ${postCount} published posts`,
    ].join('\n') + errorNote;

    return { content: [{ type: 'text' as const, text: summary }] };
  },
};
