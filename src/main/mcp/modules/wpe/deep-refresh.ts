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
import { isOperationAllowed, getEffectiveSettings } from '../../utils/operation-permissions';
import { STORAGE_KEYS } from '../../../../common/constants';

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
    const settings = getEffectiveSettings((services as any).registryStorage);
    const cache = (services as any).registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as { installs?: Array<{ installName?: string; install_name?: string; environment?: string }> } | null;
    const cachedInstall = cache?.installs?.find((i: any) => (i.installName ?? i.install_name) === installName);
    const environment = cachedInstall?.environment ?? 'production';
    if (!isOperationAllowed('wpcli_read', environment, settings, installName)) {
      return {
        content: [{
          type: 'text' as const,
          text: `Operation blocked: this operation is not permitted on "${environment}" environments. ` +
            `Adjust in Nexus AI → Settings → WP Engine Access.`,
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

    // Run all SSH WP-CLI calls in parallel
    let pluginResult: any;
    let themeResult: any;
    let versionResult: any;
    let siteUrlResult: any;
    let adminEmailResult: any;
    let postCountResult: any;
    let activeThemeResult: any;
    let postTypePostResult: any;
    let postTypePageResult: any;
    let lastPostAtResult: any;
    let userCountResult: any;
    let adminCountResult: any;
    let editorCountResult: any;
    // Collect WP settings FIRST, sequentially — this establishes the SSH ControlMaster
    // connection so the large parallel batch below can reuse it without hitting WPE's
    // 5-concurrent-connection limit.
    //
    // Warm-up: the first SSH call always hits ControlSocket stale-socket warnings and
    // may fail. Run a throwaway call first to establish ControlMaster cleanly.
    await services.localServices.remoteWpCliRun(installName, ['core', 'version'])
      .catch(() => {/* warm-up only — result ignored */});

    const settingsKeys: Array<[string, string]> = [
      // [option_name_in_wp_options, key_for_our_map]
      ['blogname',               'blogname'],
      ['blogdescription',        'blogdescription'],
      ['blog_public',            'blog_public'],        // search-engine visibility
      ['show_on_front',          'show_on_front'],
      ['posts_per_page',         'posts_per_page'],
      ['default_comment_status', 'default_comment_status'],
      ['permalink_structure',    'permalink_structure'],
      ['timezone_string',        'timezone_string'],
      ['users_can_register',     'users_can_register'],
      ['default_role',           'default_role'],
      ['WPLANG',                 'WPLANG'],
    ];
    const wpSettingsMap: Record<string, string> = {};
    for (const [optionName, mapKey] of settingsKeys) {
      const r = await services.localServices.remoteWpCliRun(installName, ['option', 'get', optionName])
        .catch(() => ({ success: false, stdout: null }));
      if (r.success && r.stdout?.trim()) wpSettingsMap[mapKey] = r.stdout.trim();
    }
    const wpSettingsJsonStr = Object.keys(wpSettingsMap).length > 0
      ? JSON.stringify(wpSettingsMap) : null;

    try {
      [
        pluginResult, themeResult, versionResult,
        siteUrlResult, adminEmailResult, postCountResult, activeThemeResult,
        postTypePostResult, postTypePageResult, lastPostAtResult,
        userCountResult, adminCountResult, editorCountResult,
      ] = await Promise.all([
        services.localServices.remoteWpCliRun(installName, ['plugin', 'list', '--format=json', '--fields=name,title,version,status']),
        services.localServices.remoteWpCliRun(installName, ['theme', 'list', '--format=json', '--fields=name,title,version,status']),
        services.localServices.remoteWpCliRun(installName, ['core', 'version']),
        services.localServices.remoteWpCliRun(installName, ['option', 'get', 'siteurl']),
        services.localServices.remoteWpCliRun(installName, ['option', 'get', 'admin_email']),
        services.localServices.remoteWpCliRun(installName, ['post', 'list', '--post_status=publish', '--format=count']),
        services.localServices.remoteWpCliRun(installName, ['option', 'get', 'stylesheet']),
        // New: post count for 'post' type (wp eval is blocked on WPE SSH gateway)
        services.localServices.remoteWpCliRun(installName,
          ['post', 'list', '--post_type=post', '--post_status=publish', '--format=count'],
        ).catch(() => ({ success: false, stdout: null })),
        // New: page count
        services.localServices.remoteWpCliRun(installName,
          ['post', 'list', '--post_type=page', '--post_status=publish', '--format=count'],
        ).catch(() => ({ success: false, stdout: null })),
        // New: most recently modified published post date
        services.localServices.remoteWpCliRun(installName,
          ['post', 'list', '--post_status=publish', '--orderby=modified', '--posts-per-page=1', '--fields=post_modified', '--format=json'],
        ).catch(() => ({ success: false, stdout: null })),
        // New: total user count
        services.localServices.remoteWpCliRun(installName,
          ['user', 'list', '--format=count'],
        ).catch(() => ({ success: false, stdout: null })),
        // New: administrator count (most security-relevant role)
        services.localServices.remoteWpCliRun(installName,
          ['user', 'list', '--role=administrator', '--format=count'],
        ).catch(() => ({ success: false, stdout: null })),
        // New: editor count
        services.localServices.remoteWpCliRun(installName,
          ['user', 'list', '--role=editor', '--format=count'],
        ).catch(() => ({ success: false, stdout: null })),
        // WordPress settings — wp eval and wp db query are blocked on WPE SSH gateway.
        // Use wp option get per key, collected AFTER the main batch to stay under
        // WPE's 5-concurrent-connection limit. Returns a synthetic result object.
        Promise.resolve({ success: true, stdout: '__deferred__' }),
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

    // Persist scalar fields in one UPDATE (including new analytics fields)
    if (siteId && graphService?.getDb?.()) {
      const siteUrl     = siteUrlResult.success    ? siteUrlResult.stdout?.trim()    || null : null;
      const adminEmail  = adminEmailResult.success ? adminEmailResult.stdout?.trim() || null : null;
      const postCount   = postCountResult.success  ? parseInt(postCountResult.stdout?.trim() || '0', 10) || null : null;
      const activeTheme = activeThemeResult.success ? activeThemeResult.stdout?.trim() || null : null;

      // Parse new analytics fields (using native WP-CLI — wp eval blocked on WPE SSH gateway)
      const parseCount = (r: any): number | null => {
        if (!r?.success || !r.stdout?.trim()) return null;
        const n = parseInt(r.stdout.trim(), 10);
        return isNaN(n) ? null : n;
      };

      const postTypePosts = parseCount(postTypePostResult);
      const postTypePages = parseCount(postTypePageResult);
      const postCountByType: string | null = (postTypePosts !== null || postTypePages !== null)
        ? JSON.stringify({ post: postTypePosts ?? 0, page: postTypePages ?? 0 })
        : null;

      let lastPostAt: number | null = null;
      if (lastPostAtResult?.success && lastPostAtResult.stdout?.trim()) {
        try {
          const rows = JSON.parse(lastPostAtResult.stdout.trim()) as Array<{ post_modified: string }>;
          if (Array.isArray(rows) && rows[0]?.post_modified) {
            const ts = new Date(rows[0].post_modified + ' UTC').getTime();
            if (!isNaN(ts) && ts > 0) lastPostAt = ts;
          }
        } catch { /* ignore */ }
      }

      const userCount = parseCount(userCountResult);
      const adminCount = parseCount(adminCountResult);
      const editorCount = parseCount(editorCountResult);
      const userCountByRole: string | null = (adminCount !== null || editorCount !== null)
        ? JSON.stringify({ administrator: adminCount ?? 0, editor: editorCount ?? 0 })
        : null;

      // lastActiveSession not available on WPE (requires wp eval, blocked by WPE SSH gateway)
      const lastActiveSession: number | null = null;

      // Parse settings (option list returns [{option_name, option_value}] array)
      const settingsJson: string | null = wpSettingsJsonStr;

      graphService.getDb().prepare(`
        UPDATE sites
           SET wp_version          = COALESCE(?, wp_version),
               site_url            = COALESCE(?, site_url),
               admin_email         = COALESCE(?, admin_email),
               active_theme        = COALESCE(?, active_theme),
               post_count          = COALESCE(?, post_count),
               post_count_by_type  = COALESCE(?, post_count_by_type),
               last_post_at        = COALESCE(?, last_post_at),
               user_count          = COALESCE(?, user_count),
               user_count_by_role  = COALESCE(?, user_count_by_role),
               last_active_session = COALESCE(?, last_active_session),
               settings_json       = COALESCE(?, settings_json),
               ssh_last_sync_at    = ?,
               last_sync_at        = ?
         WHERE id=?
      `).run(
        wpVersion, siteUrl, adminEmail, activeTheme, postCount,
        postCountByType, lastPostAt, userCount, userCountByRole, lastActiveSession,
        settingsJson, now, now, siteId,
      );
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
      `- Settings: ${wpSettingsJsonStr ? Object.keys(JSON.parse(wpSettingsJsonStr)).length + ' keys collected' : 'unavailable'}`,
    ].join('\n') + errorNote;

    return { content: [{ type: 'text' as const, text: summary }] };
  },
};
