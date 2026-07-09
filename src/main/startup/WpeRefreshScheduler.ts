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
  /**
   * Returns the current account filter. Called at the start of each cycle so
   * changes to settings take effect without restarting the scheduler.
   * Return null/undefined to include all accounts (default).
   */
  getAccountFilter?: () => string[] | null | undefined;
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
  private currentIntervalMs: number;
  private currentStalenessThresholdMs: number;
  private readonly getAccountFilter: () => string[] | null | undefined;
  private readonly logger: WpeRefreshSchedulerOptions['logger'];

  private timer: ReturnType<typeof setInterval> | null = null;
  private columnsEnsured = false;

  constructor(options: WpeRefreshSchedulerOptions) {
    this.graphService = options.graphService;
    this.localServices = options.localServices;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.currentIntervalMs = this.intervalMs;
    this.currentStalenessThresholdMs = options.stalenessThresholdMs ?? this.intervalMs;
    this.getAccountFilter = options.getAccountFilter ?? (() => null);
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
      `[WpeRefreshScheduler] Starting — interval ${Math.round(this.currentIntervalMs / 3600000)}h`
    );

    this.timer = setInterval(() => {
      this.runNow().catch((err) => {
        this.logger.error('[WpeRefreshScheduler] Refresh cycle error:', (err as Error).message);
      });
    }, this.currentIntervalMs);
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
   * Stop the existing timer and restart with a new interval.
   * Used when the user changes `wpeRefreshIntervalHours` in Settings.
   * The staleness threshold is set to the same value as the new interval.
   */
  restart(intervalMs: number): void {
    this.currentIntervalMs = intervalMs;
    this.currentStalenessThresholdMs = intervalMs;
    this.stop();
    this.start();
    this.logger.info(
      `[WpeRefreshScheduler] Restarted with interval ${Math.round(intervalMs / 3600000)}h`
    );
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
      { name: 'site_url',           type: 'TEXT' },
      { name: 'admin_email',        type: 'TEXT' },
      { name: 'active_theme',       type: 'TEXT' },
      { name: 'post_count',         type: 'INTEGER' },
      // ssh_last_sync_at tracks when this scheduler last ran SSH WP-CLI on a site,
      // independent of last_sync_at which WPESyncService bumps on every CAPI sync.
      // Without this, the CAPI sync's timestamp prevents the SSH scan from ever firing.
      { name: 'ssh_last_sync_at',   type: 'INTEGER' },
      { name: 'post_count_by_type', type: 'TEXT' },
      { name: 'last_active_session', type: 'INTEGER' },
      { name: 'user_count_by_role', type: 'TEXT' },
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

    // Read account filter — evaluated fresh each cycle so settings changes apply immediately
    const accountFilter = this.getAccountFilter();

    // Query all active WPE installs that have a remote_install_id
    type SiteRow = {
      id: string;
      name: string;
      remote_install_id: string;
      ssh_last_sync_at: number | null;
      account_id: string | null;
    };

    let sites: SiteRow[];
    try {
      sites = db.prepare(
        "SELECT id, name, remote_install_id, ssh_last_sync_at, account_id FROM sites WHERE source='wpe' AND is_active=1 AND remote_install_id IS NOT NULL"
      ).all() as SiteRow[];
    } catch (err: any) {
      this.logger.error('[WpeRefreshScheduler] Failed to query WPE sites:', err.message);
      return result;
    }

    // Apply account filter if set
    if (accountFilter && accountFilter.length > 0) {
      const before = sites.length;
      sites = sites.filter((s) => s.account_id && accountFilter.includes(s.account_id));
      this.logger.info(`[WpeRefreshScheduler] Account filter: ${sites.length} of ${before} installs in scope`);
    }

    if (sites.length === 0) {
      this.logger.info('[WpeRefreshScheduler] No active WPE installs found — nothing to refresh');
      return result;
    }

    const now = Date.now();

    for (const site of sites) {
      // Skip if SSH sync is recent enough — use ssh_last_sync_at (not last_sync_at which
      // WPESyncService bumps on every CAPI sync, causing this scheduler to always skip)
      if (site.ssh_last_sync_at !== null && (now - site.ssh_last_sync_at) < this.currentStalenessThresholdMs) {
        result.skipped++;
        this.logger.info(
          `[WpeRefreshScheduler] Skipping fresh install: ${site.name} (age ${Math.round((now - site.ssh_last_sync_at) / 3600000)}h)`
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

    // Warm-up call to establish SSH ControlMaster — the first cold connection often
    // hits a stale ControlSocket and fails; subsequent calls reuse the master fine.
    await this.localServices.remoteWpCliRun(installName, ['core', 'version'])
      .catch(() => {/* warm-up only */});

    // Collect WP settings sequentially while ControlMaster is warm.
    // Running these before the parallel batch keeps total concurrency under WPE's 5-connection limit.
    const wpSettingsMap: Record<string, string> = {};
    for (const [optionName, mapKey] of [
      ['blogname', 'blogname'], ['blogdescription', 'blogdescription'],
      ['blog_public', 'blog_public'], ['show_on_front', 'show_on_front'],
      ['posts_per_page', 'posts_per_page'], ['default_comment_status', 'default_comment_status'],
      ['permalink_structure', 'permalink_structure'], ['timezone_string', 'timezone_string'],
      ['users_can_register', 'users_can_register'], ['default_role', 'default_role'],
      ['WPLANG', 'WPLANG'],
    ] as [string, string][]) {
      const r = await this.localServices.remoteWpCliRun(installName, ['option', 'get', optionName])
        .catch(() => ({ success: false, stdout: null }));
      if (r.success && r.stdout?.trim()) wpSettingsMap[mapKey] = r.stdout.trim();
    }
    const settingsJson = Object.keys(wpSettingsMap).length > 0 ? JSON.stringify(wpSettingsMap) : null;

    // Run all WP-CLI commands in parallel
    const [
      pluginResult,
      themeResult,
      coreVersionResult,
      siteurlResult,
      adminEmailResult,
      postCountResult,
      stylesheetResult,
      postCountByTypeResult,   // post list --post_type=post --format=count
      lastPostAtResult,        // post list --orderby=modified --posts-per-page=1 --format=json
      userCountResult,         // user list --format=count
      userCountByRoleResult,   // user list --role=administrator --format=count
      lastActiveSessionResult, // user list --role=editor --format=count (reusing slot; lastActiveSession not available on WPE)
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
      // postCountByType: post count (wp eval blocked on WPE SSH gateway — use native subcommands)
      this.localServices
        .remoteWpCliRun(installName, ['post', 'list', '--post_type=post', '--post_status=publish', '--format=count'])
        .catch(() => ({ success: false, stdout: null })),
      // lastPostAt: most recently modified published post
      this.localServices
        .remoteWpCliRun(installName, ['post', 'list', '--post_status=publish', '--orderby=modified', '--posts-per-page=1', '--fields=post_modified', '--format=json'])
        .catch(() => ({ success: false, stdout: null })),
      // userCount: total user count
      this.localServices
        .remoteWpCliRun(installName, ['user', 'list', '--format=count'])
        .catch(() => ({ success: false, stdout: null })),
      // userCountByRole: administrator count
      this.localServices
        .remoteWpCliRun(installName, ['user', 'list', '--role=administrator', '--format=count'])
        .catch(() => ({ success: false, stdout: null })),
      // lastActiveSession: not available on WPE (requires wp eval, blocked by WPE SSH gateway)
      // Placeholder — always returns empty so lastActiveSession stays null for WPE
      this.localServices
        .remoteWpCliRun(installName, ['user', 'list', '--role=editor', '--format=count'])
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

    // Parse new analytics fields (wp eval blocked on WPE SSH gateway — using native WP-CLI)
    const parseCount = (r: any): number | null => {
      if (!r?.success || !r.stdout?.trim()) return null;
      const n = parseInt(r.stdout.trim(), 10);
      return isNaN(n) ? null : n;
    };

    // postCountByType: post and page counts as separate calls, combined into JSON
    const postTypePostCount = parseCount(postCountByTypeResult);   // post type
    const postCountFromType = postTypePostCount;                    // used as total below
    const postCountByType: Record<string, number> | undefined = postTypePostCount !== null
      ? { post: postTypePostCount }
      : undefined;

    // lastPostAt: from wp post list --orderby=modified --posts-per-page=1 --format=json
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

    // userCount: from wp user list --format=count
    const userCount = parseCount(userCountResult);

    // userCountByRole: administrator and editor counts from separate calls
    const adminCount  = parseCount(userCountByRoleResult);   // --role=administrator
    const editorCount = parseCount(lastActiveSessionResult); // --role=editor (reusing slot)
    const userCountByRole: string | null = (adminCount !== null || editorCount !== null)
      ? JSON.stringify({ administrator: adminCount ?? 0, editor: editorCount ?? 0 })
      : null;

    // lastActiveSession: not available on WPE (wp eval blocked by WPE SSH gateway)
    const lastActiveSession: number | null = null;

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
    // Uses individual COALESCE guards so we never overwrite a good value with null
    const db = this.graphService.getDb();
    if (db) {
      db.prepare(`
        UPDATE sites SET
          wp_version          = COALESCE(?, wp_version),
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
          updated_at          = ?
        WHERE id = ?
      `).run(
        wpVersion,
        siteUrl,
        adminEmail,
        activeTheme,
        postCountFromType ?? postCount,         // prefer type-derived total
        postCountByType ? JSON.stringify(postCountByType) : null,
        lastPostAt,
        userCount,
        userCountByRole,
        lastActiveSession,
        settingsJson,
        now,
        now,
        siteId
      );
    }

    this.logger.info(
      `[WpeRefreshScheduler] Refreshed ${installName} — wp=${wpVersion ?? '?'} plugins=${pluginRows.length} themes=${themeRows.length} posts=${postCountFromType ?? postCount ?? '?'} users=${userCount ?? '?'}`
    );
  }
}
