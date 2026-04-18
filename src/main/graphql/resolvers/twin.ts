/**
 * Digital twin + fleet summary resolvers.
 *
 * Covers: nexusSiteStatus, nexusSiteRefresh, nexusFleetRefresh,
 * nexusWpeSiteDeepRefresh, nexusFleetSummary, nexusFleetPlugins,
 * nexusFleetVersionSites.
 */

import type { NexusServices } from '../../types/nexus-services';
import type { ToolRegistry } from '../../mcp/tool-registry';
import type { ResolverParent } from '../resolver-utils';

export function createTwinResolvers(services: NexusServices, registry: ToolRegistry) {
  return {
    /**
     * Digital twin: status report for one site
     */
    nexusSiteStatus: async (_parent: ResolverParent, { target }: { target: string }) => {
      try {
        const result = await registry.call('nexus_site_status', { site: target }, services, 'cli');
        const text = result?.content?.[0]?.text ?? '';
        return { success: !result?.isError, error: result?.isError ? text : null, report: text };
      } catch (err: any) {
        return { success: false, error: err.message, report: null };
      }
    },

    /**
     * Digital twin: refresh one site
     */
    nexusSiteRefresh: async (_parent: ResolverParent, { target, force }: { target: string; force?: boolean }) => {
      try {
        const result = await registry.call('nexus_site_refresh', { site: target, force: !!force }, services, 'cli');
        const text = result?.content?.[0]?.text ?? '';
        return { success: !result?.isError, error: result?.isError ? text : null, report: text };
      } catch (err: any) {
        return { success: false, error: err.message, report: null };
      }
    },

    /**
     * Digital twin: refresh all sites
     */
    nexusFleetRefresh: async () => {
      try {
        const result = await registry.call('nexus_fleet_refresh', {}, services, 'cli');
        const text = result?.content?.[0]?.text ?? '';
        return { success: !result?.isError, error: result?.isError ? text : null, report: text };
      } catch (err: any) {
        return { success: false, error: err.message, report: null };
      }
    },

    /**
     * Deep-refresh a WPE site via SSH WP-CLI.
     * Fetches plugins, themes, and WP version and persists them to the graph.
     */
    nexusWpeSiteDeepRefresh: async (_parent: ResolverParent, { installName }: { installName: string }) => {
      const empty = { installName, pluginCount: 0, themeCount: 0, wpVersion: null };
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available', ...empty };
        }
        if (!services.localServices.isSSHKeyAvailable()) {
          return { success: false, error: 'WP Engine SSH key not found. Connect to WP Engine via Local first.', ...empty };
        }

        const graphService = services.graphService;
        const now = Date.now();

        // Find the graph site ID for this install
        let siteId: string | null = null;
        if (graphService?.getDb?.()) {
          const row = graphService.getDb()!.prepare(
            "SELECT id FROM sites WHERE source='wpe' AND (name=? OR remote_install_id=?)"
          ).get(installName, installName) as any;
          siteId = row?.id ?? null;
        }

        // Run all SSH WP-CLI calls in parallel
        const [
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

        if (versionResult.success && versionResult.stdout) {
          wpVersion = versionResult.stdout.trim();
        } else if (!versionResult.success) {
          errors.push(`core version failed: ${versionResult.stdout || 'unknown'}`);
        }

        if (siteId && graphService?.getDb?.()) {
          const siteUrl    = siteUrlResult.success    ? siteUrlResult.stdout?.trim()    || null : null;
          const adminEmail = adminEmailResult.success ? adminEmailResult.stdout?.trim() || null : null;
          const postCount  = postCountResult.success  ? parseInt(postCountResult.stdout?.trim() || '0', 10) || null : null;
          const activeTheme = activeThemeResult.success ? activeThemeResult.stdout?.trim() || null : null;

          graphService.getDb()!.prepare(`
            UPDATE sites
               SET wp_version=?, site_url=?, admin_email=?, active_theme=?, post_count=?, last_sync_at=?
             WHERE id=?
          `).run(wpVersion, siteUrl, adminEmail, activeTheme, postCount, now, siteId);
        }

        return {
          success: errors.length === 0 || pluginCount > 0 || themeCount > 0,
          error: errors.length > 0 ? errors.join('; ') : null,
          installName, pluginCount, themeCount, wpVersion,
        };
      } catch (error: any) {
        return { success: false, error: error.message, ...empty };
      }
    },

    /**
     * Fleet-wide summary from twin cache — WP/PHP version distribution,
     * completeness breakdown, recent post activity, stale count.
     */
    nexusFleetSummary: () => {
      try {
        if (!services.twinService) {
          return {
            success: false,
            error: 'Twin service not available',
            totalSites: 0,
            sitesWithFullData: 0,
            wpVersions: [],
            phpVersions: [],
            completeness: { none: 0, filesystem: 0, metadata: 0, indexed: 0 },
            staleCount: 0,
            neverScannedCount: 0,
            recentActivityCount: 0,
          };
        }

        const DAY_MS = 24 * 60 * 60 * 1000;
        const MONTH_MS = 30 * DAY_MS;
        const now = Date.now();
        const graphService = services.graphService;

        const localTwins = services.twinService.getAll() ?? [];

        const wpeTwins: any[] = [];
        try {
          if (graphService?.getDb?.()) {
            const db = graphService.getDb()!;
            const wpeRows = db.prepare("SELECT * FROM sites WHERE source='wpe'").all() as any[];
            for (const row of wpeRows) {
              const hasPlugins = db.prepare('SELECT COUNT(*) as c FROM plugins WHERE site_id=?').get(row.id) as { c: number };
              const comp = hasPlugins.c > 0 ? 'metadata' : (row.wp_version ? 'filesystem' : 'none');
              wpeTwins.push({
                siteName: row.name,
                wpVersion: row.wp_version ?? undefined,
                phpVersion: row.php_version ?? undefined,
                completeness: comp,
                asOf: row.last_sync_at ?? null,
                lastPostAt: row.post_count != null ? now - 1 : null,
                plugins: hasPlugins.c > 0
                  ? db.prepare('SELECT slug as name, name as title, is_active FROM plugins WHERE site_id=?').all(row.id)
                      .map((p: any) => ({ name: p.name, title: p.title, status: p.is_active ? 'active' : 'inactive' }))
                  : undefined,
              });
            }
          }
        } catch { /* WPE graph optional */ }

        const twins = [...localTwins, ...wpeTwins];

        const completeness = { none: 0, filesystem: 0, metadata: 0, indexed: 0 };
        let staleCount = 0;
        let neverScannedCount = 0;
        let recentActivityCount = 0;

        const wpVersionMap = new Map<string, number>();
        const phpVersionMap = new Map<string, number>();

        for (const twin of twins) {
          const comp = twin.completeness as 'none' | 'filesystem' | 'metadata' | 'indexed';
          completeness[comp]++;

          if (twin.asOf && now - twin.asOf > DAY_MS) staleCount++;
          if (comp === 'none') neverScannedCount++;
          if (twin.lastPostAt && now - twin.lastPostAt < MONTH_MS) recentActivityCount++;

          const wpV: string = twin.wpVersion ?? 'unknown';
          wpVersionMap.set(wpV, (wpVersionMap.get(wpV) ?? 0) + 1);

          const rawPhp: string = twin.phpVersion ?? 'unknown';
          const phpV = rawPhp === 'unknown' ? 'unknown'
            : (rawPhp.match(/^(\d+\.\d+)/)?.[1] ?? rawPhp);
          phpVersionMap.set(phpV, (phpVersionMap.get(phpV) ?? 0) + 1);
        }

        const sitesWithFullData = twins.filter(
          (t) => t.completeness === 'metadata' || t.completeness === 'indexed'
        ).length;

        const sortVersions = (map: Map<string, number>) => {
          const entries = Array.from(map.entries())
            .map(([version, count]) => ({ version, count }));
          entries.sort((a, b) => {
            if (a.version === 'unknown') return 1;
            if (b.version === 'unknown') return -1;
            return b.count - a.count;
          });
          return entries;
        };

        return {
          success: true,
          error: null,
          totalSites: twins.length,
          sitesWithFullData,
          wpVersions: sortVersions(wpVersionMap),
          phpVersions: sortVersions(phpVersionMap),
          completeness,
          staleCount,
          neverScannedCount,
          recentActivityCount,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message,
          totalSites: 0,
          sitesWithFullData: 0,
          wpVersions: [],
          phpVersions: [],
          completeness: { none: 0, filesystem: 0, metadata: 0, indexed: 0 },
          staleCount: 0,
          neverScannedCount: 0,
          recentActivityCount: 0,
        };
      }
    },

    /**
     * Aggregate plugin presence across the fleet from twin cache.
     */
    nexusFleetPlugins: (_parent: ResolverParent, { search, minSites }: { search?: string; minSites?: number }) => {
      try {
        if (!services.twinService) {
          return {
            success: false,
            error: 'Twin service not available',
            totalSites: 0,
            sitesWithFullData: 0,
            plugins: [],
          };
        }

        const localTwins = services.twinService.getAll() ?? [];

        const wpePluginTwins: any[] = [];
        try {
          const graphService = services.graphService;
          if (graphService?.getDb?.()) {
            const db = graphService.getDb()!;
            const wpeRows = db.prepare("SELECT id, name FROM sites WHERE source='wpe'").all() as any[];
            for (const row of wpeRows) {
              const pluginRows = db.prepare(
                'SELECT slug as name, name as title, is_active FROM plugins WHERE site_id=?'
              ).all(row.id) as any[];
              if (pluginRows.length) {
                wpePluginTwins.push({
                  siteName: row.name,
                  completeness: 'metadata',
                  plugins: pluginRows.map((p: any) => ({
                    name: p.name, title: p.title,
                    status: p.is_active ? 'active' : 'inactive',
                  })),
                  installedPlugins: undefined,
                });
              }
            }
          }
        } catch { /* optional */ }

        const twins = [...localTwins, ...wpePluginTwins];

        const pluginMap = new Map<string, {
          slug: string;
          title?: string;
          activeOnCount: number;
          installedOnCount: number;
          sites: string[];
        }>();

        for (const twin of twins) {
          if (twin.plugins?.length) {
            for (const plugin of twin.plugins) {
              const slug = plugin.name;
              if (!pluginMap.has(slug)) {
                pluginMap.set(slug, { slug, title: plugin.title, activeOnCount: 0, installedOnCount: 0, sites: [] });
              }
              const entry = pluginMap.get(slug)!;
              if (plugin.title && !entry.title) entry.title = plugin.title;
              entry.installedOnCount++;
              if (plugin.status === 'active') {
                entry.activeOnCount++;
                if (!entry.sites.includes(twin.siteName)) entry.sites.push(twin.siteName);
              }
            }
          }

          if (twin.installedPlugins?.length) {
            for (const slug of twin.installedPlugins) {
              if (!twin.plugins?.some((p: any) => p.name === slug)) {
                if (!pluginMap.has(slug)) {
                  pluginMap.set(slug, { slug, activeOnCount: 0, installedOnCount: 0, sites: [] });
                }
                pluginMap.get(slug)!.installedOnCount++;
              }
            }
          }
        }

        const effectiveMinSites = minSites ?? 1;
        let plugins = Array.from(pluginMap.values());

        if (search) {
          const q = search.toLowerCase();
          plugins = plugins.filter(p =>
            p.slug.toLowerCase().includes(q) ||
            (p.title ?? '').toLowerCase().includes(q)
          );
        }

        plugins = plugins.filter(p => p.activeOnCount >= effectiveMinSites);
        plugins.sort((a, b) => b.activeOnCount - a.activeOnCount);

        const sitesWithFullData = twins.filter(
          (t) => t.completeness === 'metadata' || t.completeness === 'indexed'
        ).length;

        return {
          success: true,
          error: null,
          totalSites: twins.length,
          sitesWithFullData,
          plugins,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message,
          totalSites: 0,
          sitesWithFullData: 0,
          plugins: [],
        };
      }
    },

    /**
     * List sites on a specific PHP or WP version — for security triage.
     */
    nexusFleetVersionSites: (_parent: ResolverParent, { phpVersion, wpVersion }: { phpVersion?: string; wpVersion?: string }) => {
      try {
        if (!services.twinService) {
          return { success: false, error: 'Twin service not available', sites: [] };
        }

        const localTwins = services.twinService.getAll() ?? [];
        const graphService = services.graphService;
        const wpeTwins: any[] = [];

        try {
          if (graphService?.getDb?.()) {
            const rows = graphService.getDb()!
              .prepare("SELECT name, wp_version, php_version FROM sites WHERE source='wpe' AND is_active=1")
              .all() as any[];
            for (const row of rows) {
              wpeTwins.push({ siteName: row.name, wpVersion: row.wp_version, phpVersion: row.php_version, source: 'wpe' });
            }
          }
        } catch { /* optional */ }

        const normalizePhp = (v?: string) => v ? (v.match(/^(\d+\.\d+)/)?.[1] ?? v) : 'unknown';
        const all = [
          ...localTwins.map((t: any) => ({ siteName: t.siteName, wpVersion: t.wpVersion, phpVersion: t.phpVersion, source: 'local' })),
          ...wpeTwins,
        ];

        const matched = all.filter((s) => {
          if (phpVersion) {
            const normalized = normalizePhp(s.phpVersion);
            const target = normalizePhp(phpVersion);
            if (normalized !== target) return false;
          }
          if (wpVersion && s.wpVersion !== wpVersion) return false;
          return true;
        });

        return {
          success: true,
          error: null,
          sites: matched.map((s) => ({
            name: s.siteName,
            wpVersion: s.wpVersion ?? null,
            phpVersion: normalizePhp(s.phpVersion),
            source: s.source ?? 'local',
          })),
        };
      } catch (err: any) {
        return { success: false, error: err.message, sites: [] };
      }
    },
  };
}
