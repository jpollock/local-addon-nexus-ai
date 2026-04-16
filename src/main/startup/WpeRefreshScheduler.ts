/**
 * WpeRefreshScheduler
 *
 * Background cron that periodically runs SSH WP-CLI scans on WPE installs
 * whose digital twin SSH data is stale (plugins, themes, site URL, admin email,
 * post count, active theme).
 *
 * Why: WPESyncService handles CAPI data (php_version, domain) on an hourly
 * schedule. The SSH WP-CLI layer (plugins, themes, scalar site fields) is
 * expensive and runs only when explicitly triggered or when this scheduler
 * detects stale data (older than 24h by default).
 *
 * Staleness check: a WPE install is considered stale when its last_sync_at
 * (the SSH sync timestamp) is older than `stalenessThresholdMs` (default 24h),
 * or has never been SSH-synced (last_sync_at IS NULL).
 *
 * Column guard: site_url, admin_email, active_theme, post_count may not exist
 * on all deployments (they were added in feat/fleet-refresh-deep). This class
 * adds them defensively via ALTER TABLE IF NOT EXISTS-style checks on first run.
 */

import type { GraphService } from '../events/GraphService';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';

export interface WpeRefreshSchedulerOptions {
  graphService: GraphService;
  localServices: LocalServicesBridge;
  /**
   * How often to run the refresh cycle (milliseconds).
   * Default: 24 hours.
   */
  intervalMs?: number;
  /**
   * Skip a site if its last SSH sync is more recent than this age (milliseconds).
   * Default: same as intervalMs.
   */
  stalenessThresholdMs?: number;
  logger: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
}

export interface WpeRefreshResult {
  scanned: number;
  skipped: number;
  failed: number;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class WpeRefreshScheduler {
  private readonly graphService: GraphService;
  private readonly localServices: LocalServicesBridge;
  private readonly intervalMs: number;
  private readonly stalenessThresholdMs: number;
  private readonly logger: WpeRefreshSchedulerOptions['logger'];

  private timer: ReturnType<typeof setInterval> | null = null;
  private columnsEnsured = false;

  constructor(options: WpeRefreshSchedulerOptions) {
    this.graphService = options.graphService;
    this.localServices = options.localServices;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.stalenessThresholdMs = options.stalenessThresholdMs ?? this.intervalMs;
    this.logger = options.logger;
  }

  /**
   * Start the scheduler. Idempotent — calling start() while already running
   * is a no-op; the existing interval is preserved.
   */
  start(): void {
    if (this.timer !== null) {
      this.logger.info('[WpeRefreshScheduler] Already running — start() ignored');
      return;
    }

    this.logger.info(
      `[WpeRefreshScheduler] Starting — interval ${Math.round(this.intervalMs / 3600000)}h`
    );

    this.timer = setInterval(() => {
      this.runNow().catch((err) => {
        this.logger.error('[WpeRefreshScheduler] Refresh cycle error:', (err as Error).message);
      });
    }, this.intervalMs);
  }

  /**
   * Stop the scheduler. Safe to call multiple times.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('[WpeRefreshScheduler] Stopped');
    }
  }

  /**
   * Ensure that site_url, admin_email, active_theme, post_count columns exist
   * on the sites table. These were added in feat/fleet-refresh-deep but may not
   * be present on older deployments. Safe to call multiple times.
   */
  private ensureColumns(): void {
    if (this.columnsEnsured) return;

    const db = this.graphService.getDb();
    if (!db) return;

    const columnsToAdd: Array<{ name: string; type: string }> = [
      { name: 'site_url',     type: 'TEXT' },
      { name: 'admin_email',  type: 'TEXT' },
      { name: 'active_theme', type: 'TEXT' },
      { name: 'post_count',   type: 'INTEGER' },
    ];

    for (const col of columnsToAdd) {
      try {
        const exists = db
          .prepare(`SELECT COUNT(*) as c FROM pragma_table_info('sites') WHERE name=?`)
          .get(col.name) as { c: number };
        if (!exists.c) {
          db.exec(`ALTER TABLE sites ADD COLUMN ${col.name} ${col.type}`);
          this.logger.info(`[WpeRefreshScheduler] Added column sites.${col.name}`);
        }
      } catch (err: any) {
        this.logger.warn(`[WpeRefreshScheduler] Could not add column ${col.name}: ${err.message}`);
      }
    }

    this.columnsEnsured = true;
  }

  /**
   * Immediately run one SSH refresh cycle across all stale WPE installs.
   *
   * Returns counts of scanned / skipped / failed installs.
   */
  async runNow(): Promise<WpeRefreshResult> {
    const result: WpeRefreshResult = { scanned: 0, skipped: 0, failed: 0 };

    // Ensure SSH-specific columns exist before attempting writes
    this.ensureColumns();

    // SSH key is required — bail early if not available
    if (!this.localServices.isSSHKeyAvailable()) {
      this.logger.info('[WpeRefreshScheduler] SSH key not available — skipping all WPE SSH scans');
      return result;
    }

    const db = this.graphService.getDb();
    if (!db) {
      this.logger.warn('[WpeRefreshScheduler] Database not available — skipping cycle');
      return result;
    }

    // Query all active WPE installs that have a remote_install_id
    type SiteRow = {
      id: string;
      name: string;
      remote_install_id: string;
      last_sync_at: number | null;
    };

    let sites: SiteRow[];
    try {
      sites = db.prepare(
        "SELECT id, name, remote_install_id, last_sync_at FROM sites WHERE source='wpe' AND is_active=1 AND remote_install_id IS NOT NULL"
      ).all() as SiteRow[];
    } catch (err: any) {
      this.logger.error('[WpeRefreshScheduler] Failed to query WPE sites:', err.message);
      return result;
    }

    if (sites.length === 0) {
      this.logger.info('[WpeRefreshScheduler] No active WPE installs found — nothing to refresh');
      return result;
    }

    const now = Date.now();

    for (const site of sites) {
      // Skip if SSH sync is recent enough
      if (site.last_sync_at !== null && (now - site.last_sync_at) < this.stalenessThresholdMs) {
        result.skipped++;
        this.logger.info(
          `[WpeRefreshScheduler] Skipping fresh install: ${site.name} (age ${Math.round((now - site.last_sync_at) / 3600000)}h)`
        );
        continue;
      }

      this.logger.info(`[WpeRefreshScheduler] Refreshing stale WPE install: ${site.name}`);
      try {
        await this.refreshInstall(site.name, site.id);
        result.scanned++;
      } catch (err: any) {
        result.failed++;
        this.logger.error(
          `[WpeRefreshScheduler] Failed to refresh install ${site.name}:`,
          err.message
        );
      }
    }

    this.logger.info(
      `[WpeRefreshScheduler] Cycle done — ${result.scanned} scanned, ${result.skipped} fresh (skipped), ${result.failed} failed`
    );

    return result;
  }

  /**
   * Run the SSH WP-CLI scan for a single WPE install and persist results.
   *
   * Runs all WP-CLI calls in parallel (same as nexusWpeSiteDeepRefresh resolver),
   * then writes plugins, themes, and scalar site fields to the graph DB.
   */
  private async refreshInstall(installName: string, siteId: string): Promise<void> {
    const now = Date.now();

    // Run all WP-CLI commands in parallel
    const [
      pluginResult,
      themeResult,
      coreVersionResult,
      siteurlResult,
      adminEmailResult,
      postCountResult,
      stylesheetResult,
    ] = await Promise.all([
      this.localServices
        .remoteWpCliRun(installName, ['plugin', 'list', '--format=json', '--fields=name,title,version,status'])
        .catch(() => ({ success: false, stdout: null })),
      this.localServices
        .remoteWpCliRun(installName, ['theme', 'list', '--format=json', '--fields=name,title,version,status'])
        .catch(() => ({ success: false, stdout: null })),
      this.localServices
        .remoteWpCliRun(installName, ['core', 'version'])
        .catch(() => ({ success: false, stdout: null })),
      this.localServices
        .remoteWpCliRun(installName, ['option', 'get', 'siteurl'])
        .catch(() => ({ success: false, stdout: null })),
      this.localServices
        .remoteWpCliRun(installName, ['option', 'get', 'admin_email'])
        .catch(() => ({ success: false, stdout: null })),
      this.localServices
        .remoteWpCliRun(installName, ['post', 'list', '--post_status=publish', '--format=count'])
        .catch(() => ({ success: false, stdout: null })),
      this.localServices
        .remoteWpCliRun(installName, ['option', 'get', 'stylesheet'])
        .catch(() => ({ success: false, stdout: null })),
    ]);

    // Parse plugin list
    let pluginRows: Array<{ name: string; title: string; version: string; status: string }> = [];
    if (pluginResult.success && pluginResult.stdout) {
      try {
        const parsed = JSON.parse(pluginResult.stdout);
        pluginRows = Array.isArray(parsed) ? parsed : [];
      } catch { /* skip — leave pluginRows empty */ }
    }

    // Parse theme list
    let themeRows: Array<{ name: string; title: string; version: string; status: string }> = [];
    if (themeResult.success && themeResult.stdout) {
      try {
        const parsed = JSON.parse(themeResult.stdout);
        themeRows = Array.isArray(parsed) ? parsed : [];
      } catch { /* skip */ }
    }

    // Parse scalar fields
    const wpVersion = coreVersionResult.success && coreVersionResult.stdout
      ? coreVersionResult.stdout.trim() || null
      : null;
    const siteUrl = siteurlResult.success && siteurlResult.stdout
      ? siteurlResult.stdout.trim() || null
      : null;
    const adminEmail = adminEmailResult.success && adminEmailResult.stdout
      ? adminEmailResult.stdout.trim() || null
      : null;
    const postCountRaw = postCountResult.success && postCountResult.stdout
      ? parseInt(postCountResult.stdout.trim(), 10)
      : null;
    const postCount = postCountRaw !== null && !isNaN(postCountRaw) ? postCountRaw : null;
    const activeTheme = stylesheetResult.success && stylesheetResult.stdout
      ? stylesheetResult.stdout.trim() || null
      : null;

    // Persist plugins
    if (pluginRows.length > 0) {
      await this.graphService.deletePlugins(siteId);
      for (const plugin of pluginRows) {
        await this.graphService.upsertPlugin({
          site_id: siteId,
          slug: plugin.name,
          name: plugin.title || plugin.name,
          version: plugin.version || null,
          is_active: plugin.status === 'active',
          author: null,
          created_at: now,
          updated_at: now,
        });
      }
    }

    // Persist themes
    if (themeRows.length > 0) {
      await this.graphService.deleteThemes(siteId);
      for (const theme of themeRows) {
        await this.graphService.upsertTheme({
          site_id: siteId,
          slug: theme.name,
          name: theme.title || theme.name,
          version: theme.version || null,
          is_active: theme.status === 'active',
          author: null,
          created_at: now,
          updated_at: now,
        });
      }
    }

    // Persist scalar site fields via direct SQL UPDATE
    // Uses individual CASE guards so we never overwrite a good value with null
    const db = this.graphService.getDb();
    if (db) {
      db.prepare(`
        UPDATE sites SET
          wp_version   = COALESCE(?, wp_version),
          site_url     = COALESCE(?, site_url),
          admin_email  = COALESCE(?, admin_email),
          active_theme = COALESCE(?, active_theme),
          post_count   = COALESCE(?, post_count),
          last_sync_at = ?,
          updated_at   = ?
        WHERE id = ?
      `).run(
        wpVersion,
        siteUrl,
        adminEmail,
        activeTheme,
        postCount,
        now,
        now,
        siteId
      );
    }

    this.logger.info(
      `[WpeRefreshScheduler] Refreshed ${installName} — wp=${wpVersion ?? '?'} plugins=${pluginRows.length} themes=${themeRows.length} posts=${postCount ?? '?'}`
    );
  }
}
