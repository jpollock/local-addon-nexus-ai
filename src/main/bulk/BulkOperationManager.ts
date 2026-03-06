/**
 * BulkOperationManager - Queues and executes bulk operations across multiple WordPress sites.
 * Supports concurrency limiting, per-site progress tracking, cancellation, and progress callbacks.
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
  };
  healthCalculator: { calculateScore(siteId: string, siteInfo: any): Promise<any> };
  onProgress: (opId: string, status: BulkOperationStatus) => void;
  /** Optional: called for 'setup-ai' bulk operations */
  setupSiteForAI?: (siteId: string, options?: any) => Promise<any>;
}

const MAX_CONCURRENCY = 3;
const MAX_HISTORY = 20;

export class BulkOperationManager {
  private ops: Map<string, BulkOperation> = new Map();
  private deps: BulkOpDeps;
  private completionPromises: Map<string, Promise<void>> = new Map();

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

    try {
      if (op.abortController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      await this.executeByType(op, siteId);
      result.status = 'completed';
      result.completedAt = Date.now();
    } catch (err: any) {
      result.status = 'failed';
      result.completedAt = Date.now();
      result.error = err?.message ?? String(err);
      op.progress.errors.push(siteId);
    }

    op.progress.completed++;
    this.deps.onProgress(op.id, this.getStatus(op.id)!);
  }

  private async executeByType(op: BulkOperation, siteId: string): Promise<void> {
    switch (op.type) {
      case 'reindex':
        return this.executeReindex(siteId);
      case 'plugin-update':
        return this.executePluginUpdate(siteId, op.options.pluginSlug);
      case 'start':
        return this.deps.siteDataBridge.startSite(siteId);
      case 'stop':
        return this.deps.siteDataBridge.stopSite(siteId);
      case 'health-refresh':
        return this.executeHealthRefresh(siteId);
      case 'setup-ai':
        return this.executeSetupAI(siteId, op.options);
      default:
        throw new Error(`Unknown operation type: ${op.type}`);
    }
  }

  private async executeReindex(siteId: string): Promise<void> {
    const site = this.deps.siteDataBridge.resolveSiteObject(siteId);
    if (!site) {
      throw new Error(`Site not found: ${siteId}`);
    }

    const status = this.deps.siteDataBridge.getSiteStatus(siteId);
    if (status !== 'running') {
      throw new Error(`Site is not running: ${siteId}`);
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

  private async executePluginUpdate(siteId: string, pluginSlug?: string): Promise<void> {
    if (!pluginSlug) {
      throw new Error('pluginSlug is required for plugin-update');
    }

    const status = this.deps.siteDataBridge.getSiteStatus(siteId);
    if (status !== 'running') {
      throw new Error(`Site is not running: ${siteId}`);
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

    const status = this.deps.siteDataBridge.getSiteStatus(siteId);
    if (status !== 'running') {
      throw new Error(`Site is not running: ${siteId}`);
    }

    const result = await this.deps.setupSiteForAI(siteId, {
      enableOllama: options.enableOllama ?? false,
    });

    if (!result.success) {
      throw new Error(result.message || 'Setup AI failed');
    }
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
