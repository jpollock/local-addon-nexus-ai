/**
 * StartupSiteScanner
 *
 * Runs shortly after the Nexus AI addon loads and populates the SiteMetadataCache
 * for every Local site — regardless of whether it is running or halted.
 *
 * Two scan depths:
 *
 *   'filesystem' (always available)
 *   ─────────────────────────────────
 *   Reads directly from the site's directory on disk. No WP-CLI, no site process
 *   required. Gives us:
 *     - WP version (wp-includes/version.php)
 *     - Installed plugin directory names (wp-content/plugins/)
 *     - Installed theme directory names  (wp-content/themes/)
 *     - PHP version (already in Local's site object)
 *
 *   'full' (running sites only)
 *   ─────────────────────────────────
 *   Enriches the filesystem snapshot via WP-CLI. Adds:
 *     - Plugin active/inactive status + exact versions
 *     - Theme active/inactive status + exact versions
 *     - Active theme name
 *     - Published post count (total + by post type)
 *     - Timestamp of most recent published post
 *     - Admin email, site URL
 *
 * Staleness guard
 * ─────────────────────────────────
 * If the cache already has a 'full' scan that is less than FULL_SCAN_MAX_AGE_MS old,
 * we skip the WP-CLI enrichment for that site — a site-start lifecycle hook will have
 * produced fresher data than we can offer. We always attempt the filesystem scan so
 * that halted sites get at least Tier 1 data.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SiteMetadataCache } from '../metadata/SiteMetadataCache';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';

interface SiteRef {
  id: string;
  name: string;
  path: string;       // root of the Local site on disk
  phpVersion?: string; // may be on the site object in Local
}

interface ScannerDeps {
  getAllSites: () => SiteRef[];
  getRunningSiteIds: () => string[];
  localServices: LocalServicesBridge;
  metadataCache: SiteMetadataCache;
  logger: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
}

/** Skip WP-CLI enrichment if a full scan is younger than this. */
const FULL_SCAN_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Maximum WP-CLI enrichment calls to run in parallel (avoid overwhelming the site). */
const WP_CLI_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class StartupSiteScanner {
  constructor(private deps: ScannerDeps) {}

  /**
   * Scan all sites. Safe to call multiple times — idempotent per site.
   * Errors on individual sites are caught and logged; they never abort others.
   */
  async scan(): Promise<void> {
    const { getAllSites, getRunningSiteIds, logger } = this.deps;
    const sites = getAllSites();
    if (sites.length === 0) return;

    const runningSiteIds = new Set(getRunningSiteIds());
    logger.info(`[StartupSiteScanner] Scanning ${sites.length} sites (${runningSiteIds.size} running)`);

    // Phase 1: filesystem scan for all sites (fast, parallel)
    await Promise.all(sites.map((site) => this.filesystemScan(site)));

    // Phase 2: WP-CLI enrichment for running sites (batched)
    const running = sites.filter((s) => runningSiteIds.has(s.id));
    await this.enrichInBatches(running);

    logger.info(`[StartupSiteScanner] Done — ${sites.length} filesystem scans, ${running.length} full scans`);
  }

  // ---------------------------------------------------------------------------
  // Phase 1: filesystem scan
  // ---------------------------------------------------------------------------

  private async filesystemScan(site: SiteRef): Promise<void> {
    const { metadataCache, logger } = this.deps;
    const tag = `[StartupSiteScanner:${site.name}]`;

    try {
      const wpRoot = path.join(site.path, 'app', 'public');

      const wpVersion = readWpVersion(wpRoot);
      if (!wpVersion) {
        logger.warn(`${tag} Could not read WP version from filesystem — skipping`);
        return;
      }

      const installedPlugins = listDirs(path.join(wpRoot, 'wp-content', 'plugins'));
      const installedThemes  = listDirs(path.join(wpRoot, 'wp-content', 'themes'));

      // Only write if we don't already have a fresher full scan
      const existing = metadataCache.get(site.id);
      if (existing?.scanDepth === 'full' && !metadataCache.isStale(site.id)) {
        logger.info(`${tag} Fresh full scan exists — skipping filesystem write`);
        return;
      }

      metadataCache.set(site.id, {
        // Preserve any richer fields that a previous full scan may have written
        ...(existing ?? {}),
        wpVersion,
        phpVersion: existing?.phpVersion ?? site.phpVersion,
        plugins: existing?.plugins ?? [],
        themes:  existing?.themes  ?? [],
        installedPlugins,
        installedThemes,
        scanDepth: existing?.scanDepth === 'full' ? 'full' : 'filesystem',
        updateSource: 'startup-scan',
      });

      logger.info(`${tag} Filesystem scan complete — WP ${wpVersion}, ${installedPlugins.length} plugins, ${installedThemes.length} themes`);
    } catch (err) {
      logger.warn(`${tag} Filesystem scan failed:`, (err as Error).message);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 2: WP-CLI enrichment (batched)
  // ---------------------------------------------------------------------------

  private async enrichInBatches(sites: SiteRef[]): Promise<void> {
    for (let i = 0; i < sites.length; i += WP_CLI_CONCURRENCY) {
      const batch = sites.slice(i, i + WP_CLI_CONCURRENCY);
      await Promise.all(batch.map((site) => this.wpCliEnrich(site)));
    }
  }

  private async wpCliEnrich(site: SiteRef): Promise<void> {
    const { metadataCache, localServices, logger } = this.deps;
    const tag = `[StartupSiteScanner:${site.name}]`;

    // Skip if we already have a recent full scan
    const existing = metadataCache.get(site.id);
    if (existing?.scanDepth === 'full') {
      const ageMs = Date.now() - existing.lastUpdated;
      if (ageMs < FULL_SCAN_MAX_AGE_MS) {
        logger.info(`${tag} Full scan is ${Math.round(ageMs / 60000)}m old — skipping WP-CLI enrichment`);
        return;
      }
    }

    try {
      logger.info(`${tag} Running WP-CLI enrichment...`);

      // Fetch in parallel — each is a separate WP-CLI invocation
      const [plugins, themes, postData, siteUrl, adminEmail, mysqlResult] = await Promise.allSettled([
        localServices.getPlugins(site.id),
        localServices.getThemes(site.id),
        fetchPostCounts(localServices, site.id),
        localServices.getOption(site.id, 'siteurl'),
        localServices.getOption(site.id, 'admin_email'),
        localServices.wpCliRun(site.id, ['eval', 'global $wpdb; echo $wpdb->db_version();']),
      ]);

      // Cast to WpPluginMetadata[] — the bridge returns a compatible shape
      const resolvedPlugins = (plugins.status === 'fulfilled' ? plugins.value : existing?.plugins ?? []) as import('../metadata/SiteMetadataCache').WpPluginMetadata[];
      const resolvedThemes  = (themes.status  === 'fulfilled' ? themes.value  : existing?.themes  ?? []) as import('../metadata/SiteMetadataCache').WpThemeMetadata[];
      const resolvedPosts   = postData.status === 'fulfilled' ? postData.value : null;
      const resolvedSiteUrl = siteUrl.status === 'fulfilled' ? (siteUrl.value ?? undefined) : undefined;
      const resolvedEmail   = adminEmail.status === 'fulfilled' ? (adminEmail.value ?? undefined) : undefined;
      const resolvedMysql   = mysqlResult.status === 'fulfilled' && mysqlResult.value.success
        ? ((mysqlResult.value.stdout ?? '').trim() || undefined)
        : undefined;

      const activeTheme = resolvedThemes.find((t: any) => t.status === 'active')?.name;

      metadataCache.set(site.id, {
        ...(existing ?? {}),
        wpVersion:       existing?.wpVersion ?? '',
        plugins:         resolvedPlugins,
        themes:          resolvedThemes,
        activeTheme,
        siteUrl:         resolvedSiteUrl  ?? existing?.siteUrl,
        adminEmail:      resolvedEmail    ?? existing?.adminEmail,
        mysqlVersion:    resolvedMysql    ?? existing?.mysqlVersion,
        postCount:       resolvedPosts?.total    ?? existing?.postCount,
        postCountByType: resolvedPosts?.byType   ?? existing?.postCountByType,
        lastPostAt:      resolvedPosts?.lastPostAt ?? existing?.lastPostAt,
        installedPlugins: existing?.installedPlugins,
        installedThemes:  existing?.installedThemes,
        scanDepth: 'full',
        updateSource: 'startup-scan',
      });

      logger.info(`${tag} Full scan complete — ${resolvedPlugins.length} plugins, ${resolvedThemes.length} themes, ${resolvedPosts?.total ?? '?'} posts`);
    } catch (err) {
      logger.warn(`${tag} WP-CLI enrichment failed:`, (err as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse $wp_version from wp-includes/version.php without executing PHP. */
function readWpVersion(wpRoot: string): string | null {
  const versionFile = path.join(wpRoot, 'wp-includes', 'version.php');
  try {
    const content = fs.readFileSync(versionFile, 'utf8');
    const match = content.match(/\$wp_version\s*=\s*'([^']+)'/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** List immediate subdirectory names within a directory. Returns [] if missing. */
function listDirs(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Fetch post counts (total + by type + last post date) via wp eval. */
async function fetchPostCounts(
  localServices: LocalServicesBridge,
  siteId: string,
): Promise<{ total: number; byType: Record<string, number>; lastPostAt: number | null }> {
  // Single WP-CLI eval that returns JSON — avoids multiple round trips
  const php = `
    global $wpdb;
    $rows = $wpdb->get_results(
      "SELECT post_type, COUNT(*) as cnt, MAX(post_date_gmt) as last_date
       FROM {$wpdb->posts}
       WHERE post_status = 'publish'
       GROUP BY post_type",
      ARRAY_A
    );
    $byType = [];
    $total = 0;
    $lastDate = null;
    foreach ($rows as $r) {
      $byType[$r['post_type']] = (int)$r['cnt'];
      $total += (int)$r['cnt'];
      if (!$lastDate || $r['last_date'] > $lastDate) $lastDate = $r['last_date'];
    }
    echo json_encode(['total' => $total, 'byType' => $byType, 'lastDate' => $lastDate]);
  `.trim().replace(/\n\s+/g, ' ');

  const result = await localServices.wpCliRun(siteId, ['eval', php, '--skip-wordpress=false']);
  if (!result.success) throw new Error(result.stdout ?? 'WP-CLI eval failed');

  const parsed = JSON.parse((result.stdout ?? '').trim());
  return {
    total: parsed.total ?? 0,
    byType: parsed.byType ?? {},
    lastPostAt: parsed.lastDate ? new Date(parsed.lastDate + ' UTC').getTime() : null,
  };
}
