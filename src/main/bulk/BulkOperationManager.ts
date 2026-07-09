/**
 * BulkOperationManager - Queues and executes bulk operations across multiple WordPress sites.
 * Supports concurrency limiting, per-site progress tracking, cancellation, progress callbacks,
 * and auto-start/stop for operations on halted sites.
 */
import type {
  BulkOperation,
  BulkOperationRequest,
  BulkOperationStatus,
  SiteOpResult,
  BulkOpType,
} from './types';

export interface BulkOpDeps {
  contentPipeline: { indexSite(info: any): Promise<any> };
  siteDataBridge: {
    resolveSiteObject(siteId: string): any;
    getSiteStatus(siteId: string): string;
    startSite(siteId: string): Promise<void>;
    stopSite(siteId: string): Promise<void>;
    wpCliRun(siteId: string, args: string[]): Promise<{ stdout: string | null; success: boolean }>;
    getPlugins(siteId: string): Promise<Array<{ name: string; title: string; version: string; status: string }>>;
    getThemes(siteId: string): Promise<Array<{ name: string; title: string; version: string; status: string }>>;
    getWpVersion(siteId: string): Promise<string | null>;
    getOption(siteId: string, option: string): Promise<string | null>;
  };
  /** Optional: metadata cache to update after reindex (same refresh as lifecycle hook) */
  metadataCache?: {
    set(siteId: string, metadata: any): void;
    get(siteId: string): any;
  };
  healthCalculator: { calculateScore(siteId: string, siteInfo: any): Promise<any> };
  graphService?: {
    upsertSite(site: any): Promise<void>;
    upsertPlugin(plugin: any): Promise<number>;
    deletePlugins(siteId: string): Promise<void>;
    updateSiteSettings(siteId: string, settings: Record<string, string | number>): void;
  };
  onProgress: (opId: string, status: BulkOperationStatus) => void;
  /** Optional: called for 'setup-ai' bulk operations */
  setupSiteForAI?: (siteId: string, options?: any) => Promise<any>;
}

const MAX_CONCURRENCY = 5; // Increased from 3 for better performance (50 sites: ~10 min vs ~17 min)
const MAX_HISTORY = 20;
/** Maximum individual site results retained per operation to cap memory usage. */
const MAX_SITE_RESULTS = 500;

export class BulkOperationManager {
  private ops: Map<string, BulkOperation> = new Map();
  private deps: BulkOpDeps;
  private completionPromises: Map<string, Promise<void>> = new Map();
  /** Track sites that were started by auto-start (to restore state after) */
  private autoStartedSites: Map<string, Set<string>> = new Map(); // opId -> Set<siteId>

  constructor(deps: BulkOpDeps) {
    this.deps = deps;
  }

  execute(request: BulkOperationRequest): string {
    const op: BulkOperation = {
      id: this.generateId(),
      type: request.type,
      siteIds: [...request.siteIds],
      siteNames: request.siteNames ?? {},
      options: request.options ?? {},
      status: 'running',
      progress: { completed: 0, total: request.siteIds.length, errors: [] },
      results: new Map(),
      createdAt: Date.now(),
      completedAt: null,
      abortController: new AbortController(),
    };

    // Initialize all site results as pending
    for (const siteId of op.siteIds) {
      op.results.set(siteId, { status: 'pending', startedAt: 0 });
    }

    this.ops.set(op.id, op);
    this.autoStartedSites.set(op.id, new Set());

    // Handle empty siteIds immediately
    if (op.siteIds.length === 0) {
      op.status = 'completed';
      op.completedAt = Date.now();
      this.deps.onProgress(op.id, this.getStatus(op.id)!);
      this.completionPromises.set(op.id, Promise.resolve());
    } else {
      // Start execution in background (don't await)
      const promise = this.executeWithConcurrency(op);
      this.completionPromises.set(op.id, promise);
    }

    return op.id;
  }

  private async executeWithConcurrency(op: BulkOperation): Promise<void> {
    const queue = [...op.siteIds];
    const active = new Set<Promise<void>>();

    while (queue.length > 0 || active.size > 0) {
      // Fill up to max concurrency using tracked set so each promise removes
      // itself on completion — avoids the Promise.race re-enrollment bug where
      // a completed promise lingers in the active set.
      while (queue.length > 0 && active.size < MAX_CONCURRENCY) {
        if (op.abortController.signal.aborted) {
          break;
        }
        const siteId = queue.shift()!;
        const p: Promise<void> = this.executeSingle(op, siteId).finally(() => {
          active.delete(p);
        });
        active.add(p);
      }

      if (op.abortController.signal.aborted) {
        // Mark remaining queued sites as cancelled
        for (const siteId of queue) {
          const result = op.results.get(siteId);
          if (result && result.status === 'pending') {
            result.status = 'failed';
            result.error = 'Operation cancelled';
            op.progress.completed++;
            op.progress.errors.push(siteId);
          }
        }
        queue.length = 0;
        // Wait for all active operations to finish before exiting
        if (active.size > 0) {
          await Promise.allSettled([...active]);
        }
        break;
      }

      if (active.size > 0) {
        // Wait for any one promise to free a slot before refilling
        await Promise.race([...active]);
      }
    }

    // Drain any remaining active promises (e.g. after abort break above)
    if (active.size > 0) {
      await Promise.allSettled([...active]);
    }

    // Cleanup: stop any auto-started sites that are still running
    const autoStarted = this.autoStartedSites.get(op.id);
    if (autoStarted && autoStarted.size > 0) {
      for (const siteId of autoStarted) {
        try {
          await this.deps.siteDataBridge.stopSite(siteId);
        } catch {
          // Best effort - ignore errors on cleanup
        }
      }
    }
    this.autoStartedSites.delete(op.id);

    // Finalize operation status
    op.completedAt = Date.now();
    if (op.abortController.signal.aborted) {
      op.status = 'cancelled';
    } else if (op.progress.errors.length > 0) {
      op.status = 'completed_with_errors';
    } else {
      op.status = 'completed';
    }

    this.pruneHistory();
    this.deps.onProgress(op.id, this.getStatus(op.id)!);
  }

  /**
   * Evict oldest completed operations so memory doesn't grow without bound.
   * Keeps at most MAX_HISTORY operations; always preserves running operations.
   */
  private pruneHistory(): void {
    if (this.ops.size <= MAX_HISTORY) return;

    // Collect completed/cancelled/failed ops sorted oldest-first
    const evictable = [...this.ops.values()]
      .filter(op => op.status !== 'running')
      .sort((a, b) => a.createdAt - b.createdAt);

    const excess = this.ops.size - MAX_HISTORY;
    for (let i = 0; i < excess && i < evictable.length; i++) {
      this.ops.delete(evictable[i].id);
      this.completionPromises.delete(evictable[i].id);
    }
  }

  private async executeSingle(op: BulkOperation, siteId: string): Promise<void> {
    const result = op.results.get(siteId)!;
    result.status = 'running';
    result.startedAt = Date.now();

    let wasAutoStarted = false;

    try {
      if (op.abortController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      // Auto-start logic: if site is halted and autoStartStop is enabled
      const autoStartStop = op.options.autoStartStop === true;
      if (autoStartStop) {
        const currentStatus = this.deps.siteDataBridge.getSiteStatus(siteId);
        if (currentStatus !== 'running') {
          // Start the site
          await this.deps.siteDataBridge.startSite(siteId);
          wasAutoStarted = true;
          this.autoStartedSites.get(op.id)?.add(siteId);

          // Wait a bit for site to fully start
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      await this.executeByType(op, siteId);
      result.status = 'completed';
      result.completedAt = Date.now();
    } catch (err: any) {
      result.status = 'failed';
      result.completedAt = Date.now();
      result.error = err?.message ?? String(err);
      op.progress.errors.push(siteId);
    } finally {
      // Stop site if we auto-started it
      if (wasAutoStarted) {
        try {
          await this.deps.siteDataBridge.stopSite(siteId);
          this.autoStartedSites.get(op.id)?.delete(siteId);
        } catch {
          // Best effort - don't fail the operation if stop fails
        }
      }
    }

    op.progress.completed++;
    this.deps.onProgress(op.id, this.getStatus(op.id)!);
  }

  private async executeByType(op: BulkOperation, siteId: string): Promise<void> {
    switch (op.type) {
      case 'reindex':
        return this.executeReindex(siteId, op.options);
      case 'plugin-update':
        return this.executePluginUpdate(siteId, op.options.pluginSlug, op.options);
      case 'start':
        return this.deps.siteDataBridge.startSite(siteId);
      case 'stop':
        return this.deps.siteDataBridge.stopSite(siteId);
      case 'health-refresh':
        return this.executeHealthRefresh(siteId);
      case 'setup-ai':
        return this.executeSetupAI(siteId, op.options);
      case 'sync-graph':
        return this.executeGraphSync(siteId, op.options);
      default:
        throw new Error(`Unknown operation type: ${op.type}`);
    }
  }

  private async executeReindex(siteId: string, options?: Record<string, any>): Promise<void> {
    const site = this.deps.siteDataBridge.resolveSiteObject(siteId);
    if (!site) {
      throw new Error(`Site not found: ${siteId}`);
    }

    // If auto-started, wait for database to be ready
    if (options?.autoStartStop) {
      await this.waitForDatabaseReady(siteId, 30000);
    }

    const mysqlPort = site.services?.mysql?.port ?? 3306;

    const indexResult = await this.deps.contentPipeline.indexSite({
      siteId,
      siteName: site.name,
      mysqlHost: '127.0.0.1',
      mysqlPort,
      mysqlUser: 'root',
      mysqlPassword: 'root',
      mysqlDatabase: 'local',
      sitePath: site.path,
    });

    // Refresh metadata cache after indexing — same as lifecycle hook does on siteStarted.
    // postCount is metadata, not a content-index concern — collect it here alongside other fields.
    if (this.deps.metadataCache) {
      try {
        const [wpVersion, plugins, themes, postCountResult] = await Promise.all([
          this.deps.siteDataBridge.getWpVersion(siteId),
          this.deps.siteDataBridge.getPlugins(siteId),
          this.deps.siteDataBridge.getThemes(siteId),
          this.deps.siteDataBridge.wpCliRun(siteId, [
            'eval',
            `global $wpdb;
$r=$wpdb->get_results("SELECT post_type,COUNT(*) c FROM {$wpdb->posts} WHERE post_status='publish' GROUP BY post_type",ARRAY_A);
$total=0; $byType=[];
foreach($r as $row){ $byType[$row['post_type']]=(int)$row['c']; $total+=(int)$row['c']; }
echo json_encode(['total'=>$total,'byType'=>$byType]);`,
          ]),
        ]);

        const siteObj = this.deps.siteDataBridge.resolveSiteObject(siteId) as any;
        const phpVersion = siteObj?.phpVersion ?? siteObj?.php?.version ?? null;

        let postCount: number | undefined;
        let postCountByType: Record<string, number> | undefined;
        if (postCountResult.success && postCountResult.stdout?.trim()) {
          try {
            const parsed = JSON.parse(postCountResult.stdout.trim());
            postCount = parsed.total ?? undefined;
            postCountByType = parsed.byType ?? undefined;
          } catch { /* ignore */ }
        }
        // Fallback: use documentsIndexed from the pipeline (excludes system post types)
        if (postCount == null && indexResult?.documentsIndexed) {
          postCount = indexResult.documentsIndexed;
        }

        this.deps.metadataCache.set(siteId, {
          wpVersion: wpVersion ?? 'unknown',
          phpVersion: phpVersion ?? undefined,
          postCount,
          postCountByType,
          plugins: plugins.map(p => ({ name: p.name, title: p.title, version: p.version, status: p.status as 'active' | 'inactive' })),
          themes: themes.map(t => ({ name: t.name, title: t.title, version: t.version, status: t.status as 'active' | 'inactive' })),
          updateSource: 'lifecycle' as const,
          scanDepth: 'full' as const,
          lastUpdated: Date.now(),
        });

        // Persist postCount to graph.db so fleet_sql queries stay accurate
        if (this.deps.graphService && postCount != null) {
          try {
            (this.deps.graphService as any).updateSiteStats?.(siteId, { postCount, postCountByType });
          } catch { /* non-fatal */ }
        }
      } catch {
        // Non-fatal — index succeeded, metadata refresh best-effort
      }
    }
  }

  private async executePluginUpdate(siteId: string, pluginSlug?: string, options?: Record<string, any>): Promise<void> {
    if (!pluginSlug) {
      throw new Error('pluginSlug is required for plugin-update');
    }

    // If auto-started, wait for database to be ready
    if (options?.autoStartStop) {
      await this.waitForDatabaseReady(siteId, 30000);
    }

    const result = await this.deps.siteDataBridge.wpCliRun(siteId, [
      'plugin',
      'update',
      pluginSlug,
      '--format=json',
    ]);

    if (!result.success) {
      throw new Error(`Plugin update failed for ${pluginSlug}`);
    }
  }

  private async executeSetupAI(siteId: string, options: Record<string, any>): Promise<void> {
    if (!this.deps.setupSiteForAI) {
      throw new Error('setupSiteForAI not configured');
    }

    // Check if site is running (unless auto-start will handle it)
    if (!options.autoStartStop) {
      const currentStatus = this.deps.siteDataBridge.getSiteStatus(siteId);
      if (currentStatus !== 'running') {
        throw new Error(`Site must be running to setup AI. Current status: ${currentStatus}`);
      }
    }

    // If auto-started, wait for database to be ready
    // (auto-start logic already ensured site is running)
    if (options.autoStartStop) {
      await this.waitForDatabaseReady(siteId, 30000); // 30 second timeout
    }

    const result = await this.deps.setupSiteForAI(siteId, {
      provider: options.provider,
    });

    if (!result.success) {
      throw new Error(result.message || 'Setup AI failed');
    }
  }

  /**
   * Wait for database to be ready by polling with a simple WP-CLI command.
   * Required after auto-starting sites - web server starts quickly but DB takes longer.
   */
  private async waitForDatabaseReady(siteId: string, timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 1000; // Check every 1 second

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Simple DB-dependent command to test readiness
        const result = await this.deps.siteDataBridge.wpCliRun(siteId, [
          'eval',
          "echo 'ready';",
        ]);

        if (result.success && result.stdout?.trim() === 'ready') {
          return; // Database is ready!
        }
      } catch {
        // Database not ready yet, continue polling
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Database did not become ready within ${timeoutMs}ms`);
  }

  private async executeHealthRefresh(siteId: string): Promise<void> {
    const site = this.deps.siteDataBridge.resolveSiteObject(siteId);
    if (!site) {
      throw new Error(`Site not found: ${siteId}`);
    }

    await this.deps.healthCalculator.calculateScore(siteId, {
      domain: site.domain,
      phpVersion: site.phpVersion,
    });
  }

  private async executeGraphSync(siteId: string, options?: Record<string, any>): Promise<void> {
    if (!this.deps.graphService) {
      throw new Error('GraphService not available');
    }

    const site = this.deps.siteDataBridge.resolveSiteObject(siteId);
    if (!site) {
      throw new Error(`Site not found: ${siteId}`);
    }

    // If auto-started, wait for database to be ready
    if (options?.autoStartStop) {
      await this.waitForDatabaseReady(siteId, 30000);
    }

    const now = Date.now();

    // 1. Sync site metadata — get WP version, PHP, and settings via WP-CLI
    // WP-CLI is open — grab everything in one parallel batch
    const [wpVersion, phpResult, siteUrlResult, adminEmailResult, wpSettingsResult, postCountResult, userCountResult] = await Promise.allSettled([
      this.deps.siteDataBridge.getWpVersion(siteId),
      this.deps.siteDataBridge.wpCliRun(siteId, ['eval', 'echo phpversion();']),
      this.deps.siteDataBridge.getOption(siteId, 'siteurl'),
      this.deps.siteDataBridge.getOption(siteId, 'admin_email'),
      this.deps.siteDataBridge.wpCliRun(siteId, [
        'eval',
        `$keys = ['blogname','blogdescription','blogpublic','show_on_front','posts_per_page','default_comment_status','permalink_structure','timezone_string','users_can_register','default_role','WPLANG'];
$out = [];
foreach ($keys as $k) { $v = get_option($k); if ($v !== false) $out[$k] = $v; }
echo json_encode($out);`,
      ]),
      this.deps.siteDataBridge.wpCliRun(siteId, [
        'eval',
        `global $wpdb;
$r=$wpdb->get_results("SELECT post_type,COUNT(*) c,MAX(post_date_gmt) ld FROM {$wpdb->posts} WHERE post_status='publish' GROUP BY post_type",ARRAY_A);
$total=0;$byType=[];$last=null;
foreach($r as $row){ $byType[$row['post_type']]=(int)$row['c']; $total+=(int)$row['c']; if(!$last||$row['ld']>$last)$last=$row['ld']; }
echo json_encode(['total'=>$total,'byType'=>$byType,'lastPostAt'=>$last]);`,
      ]),
      this.deps.siteDataBridge.wpCliRun(siteId, ['eval', 'global $wpdb; echo (int)$wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->users}");']),
    ]);

    const phpVersion = phpResult.status === 'fulfilled' && phpResult.value?.success
      ? (phpResult.value.stdout ?? '').trim() || null
      : (site as any).phpVersion ?? (site as any).php?.version ?? null;

    let wpSettings: Record<string, string | number> | undefined;
    if (wpSettingsResult.status === 'fulfilled' && wpSettingsResult.value?.success) {
      try {
        const parsed = JSON.parse((wpSettingsResult.value.stdout ?? '').trim());
        if (parsed && typeof parsed === 'object') wpSettings = parsed;
      } catch { /* ignore */ }
    }

    let postCount: number | null = null;
    let postCountByType: string | null = null;
    let lastPostAt: number | null = null;
    if (postCountResult.status === 'fulfilled' && postCountResult.value?.success) {
      try {
        const p = JSON.parse((postCountResult.value.stdout ?? '').trim());
        postCount = p.total ?? null;
        postCountByType = p.byType ? JSON.stringify(p.byType) : null;
        if (p.lastPostAt) { const t = new Date(p.lastPostAt + ' UTC').getTime(); if (t) lastPostAt = t; }
      } catch { /* ignore */ }
    }

    const userCount: number | null = (userCountResult.status === 'fulfilled' && userCountResult.value?.success)
      ? (parseInt((userCountResult.value.stdout ?? '').trim(), 10) || null)
      : null;

    const siteUrl = siteUrlResult.status === 'fulfilled' ? siteUrlResult.value ?? null : null;
    const adminEmail = adminEmailResult.status === 'fulfilled' ? adminEmailResult.value ?? null : null;

    await this.deps.graphService.upsertSite({
      id: siteId,
      name: site.name,
      domain: site.domain,
      wp_version: wpVersion.status === 'fulfilled' ? (wpVersion.value || null) : null,
      php_version: phpVersion,
      site_url: siteUrl,
      admin_email: adminEmail,
      last_sync_at: now,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    // Persist everything we collected while WP-CLI was open
    try {
      (this.deps.graphService as any).getDb?.()?.prepare(
        `UPDATE sites SET post_count=COALESCE(?,post_count), post_count_by_type=COALESCE(?,post_count_by_type),
         last_post_at=COALESCE(?,last_post_at), user_count=COALESCE(?,user_count),
         settings_json=COALESCE(?,settings_json) WHERE id=?`,
      ).run(postCount, postCountByType, lastPostAt, userCount, wpSettings ? JSON.stringify(wpSettings) : null, siteId);
    } catch { /* non-fatal */ }

    // 2. Sync plugins (delete all, then re-insert)
    await this.deps.graphService.deletePlugins(siteId);
    const plugins = await this.deps.siteDataBridge.getPlugins(siteId);
    for (const plugin of plugins) {
      await this.deps.graphService.upsertPlugin({
        site_id: siteId,
        slug: plugin.name, // WP-CLI returns 'name' as the slug
        name: plugin.title, // WP-CLI returns 'title' as the display name
        version: plugin.version || null,
        is_active: plugin.status === 'active' ? 1 : 0,
        author: null,
        created_at: now,
        updated_at: now,
      });
    }

    // Note: Themes and users not currently tracked in graph
    // Could add in future if needed
  }

  getStatus(opId: string): BulkOperationStatus | null {
    const op = this.ops.get(opId);
    if (!op) return null;

    const siteResults: Record<string, SiteOpResult> = {};
    let resultCount = 0;
    for (const [key, value] of op.results) {
      if (resultCount >= MAX_SITE_RESULTS) break;
      siteResults[key] = { ...value };
      resultCount++;
    }

    return {
      id: op.id,
      type: op.type,
      siteIds: [...op.siteIds],
      siteNames: { ...op.siteNames },
      status: op.status,
      progress: { ...op.progress, errors: [...op.progress.errors] },
      siteResults,
      createdAt: op.createdAt,
      completedAt: op.completedAt,
    };
  }

  cancel(opId: string): boolean {
    const op = this.ops.get(opId);
    if (!op || op.status !== 'running') return false;
    op.abortController.abort();
    return true;
  }

  listAll(): BulkOperationStatus[] {
    const allOps = [...this.ops.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_HISTORY);

    return allOps.map((op) => this.getStatus(op.id)!);
  }

  /** Wait for a specific operation to complete (used in tests). */
  waitForCompletion(opId: string): Promise<void> {
    return this.completionPromises.get(opId) ?? Promise.resolve();
  }

  private generateId(): string {
    return `bulk-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}
