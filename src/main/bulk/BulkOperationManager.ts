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
  };
  healthCalculator: { calculateScore(siteId: string, siteInfo: any): Promise<any> };
  graphService?: {
    upsertSite(site: any): Promise<void>;
    upsertPlugin(plugin: any): Promise<number>;
    deletePlugins(siteId: string): Promise<void>;
  };
  onProgress: (opId: string, status: BulkOperationStatus) => void;
  /** Optional: called for 'setup-ai' bulk operations */
  setupSiteForAI?: (siteId: string, options?: any) => Promise<any>;
}

const MAX_CONCURRENCY = 5; // Increased from 3 for better performance (50 sites: ~10 min vs ~17 min)
const MAX_HISTORY = 20;

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
      // Fill up to max concurrency
      while (queue.length > 0 && active.size < MAX_CONCURRENCY) {
        if (op.abortController.signal.aborted) {
          break;
        }
        const siteId = queue.shift()!;
        const promise = this.executeSingle(op, siteId).then(() => {
          active.delete(promise);
        });
        active.add(promise);
      }

      if (op.abortController.signal.aborted) {
        // Mark remaining queued sites as failed
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
        // Wait for active operations to finish
        if (active.size > 0) {
          await Promise.race([...active]);
        }
        continue;
      }

      if (active.size > 0) {
        await Promise.race([...active]);
      }
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

    this.deps.onProgress(op.id, this.getStatus(op.id)!);
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

    await this.deps.contentPipeline.indexSite({
      siteId,
      siteName: site.name,
      mysqlHost: '127.0.0.1',
      mysqlPort,
      mysqlUser: 'root',
      mysqlPassword: 'root',
      mysqlDatabase: 'local',
      sitePath: site.path,
    });
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

    // If auto-started, wait for database to be ready
    // (auto-start logic already ensured site is running)
    if (options.autoStartStop) {
      await this.waitForDatabaseReady(siteId, 30000); // 30 second timeout
    }

    const result = await this.deps.setupSiteForAI(siteId, {
      enableOllama: options.enableOllama ?? false,
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

    // 1. Sync site metadata
    const wpVersion = await this.deps.siteDataBridge.getWpVersion(siteId);
    await this.deps.graphService.upsertSite({
      id: siteId,
      name: site.name,
      domain: site.domain,
      wp_version: wpVersion || null,
      last_sync_at: now,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

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
    for (const [key, value] of op.results) {
      siteResults[key] = { ...value };
    }

    return {
      id: op.id,
      type: op.type,
      siteIds: [...op.siteIds],
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
