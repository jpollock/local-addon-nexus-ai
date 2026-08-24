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
  SiteOpOutcome,
  BulkOpType,
} from './types';
import { auditDirectOperation, type AuditCapableServices } from '../audit/auditDirectOperation';
import { siteSourceOf, wpeInstallIdOf, type SiteSource } from './siteSource';
import { recordPipelineRun } from '../intelligence-host/pipelineRunProducer';
import type { PipelineTrigger } from '../../intelligence';
import { writeRowsHonestly } from '../events/writeRowsHonestly';

export interface BulkOpDeps {
  contentPipeline: { indexSite(info: any, trigger?: PipelineTrigger): Promise<any> };
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
  /**
   * Optional: durable audit sink. Bulk operations mutate many production-
   * adjacent sites in one action, so each per-site mutation gets its own
   * entry — an operator investigating "what changed on this site" searches by
   * site, not by bulk op id.
   */
  auditServices?: AuditCapableServices;
  /**
   * WP Engine adapters. Optional so existing construction sites and tests keep
   * working, but absent means a WPE id in a selection FAILS rather than being
   * skipped — see `unavailable()`. A bulk op that silently does nothing is
   * worse than one that reports it could not run.
   */
  wpeOps?: {
    /** Metadata refresh. Takes the CAPI install id, not the `wpe-` graph id. */
    syncSingleSite(installId: string): Promise<void>;
    /**
     * Content index for one install. Takes the graph id and NOTHING ELSE.
     *
     * The name is deliberately not a parameter. Threading one through the UI
     * is what let a graph id reach `WpeSshTransport` as an install name; the
     * adapter resolves it from the graph, which is the only place it is
     * authoritative, and refuses rather than guessing.
     *
     * Returns an outcome rather than void, and that is deliberate too: an
     * indexer can complete having done nothing, and a `Promise<void>` gives it
     * no way to say so. Declaring it required makes a new index adapter that
     * has not decided a compile error rather than a silent "succeeded".
     */
    indexOne(siteId: string): Promise<SiteOpOutcome>;
  };
  /** External SSH adapters. Both take the `ssh:<alias>/<site>` graph id, and only that. */
  externalOps?: {
    refreshSite(siteId: string): Promise<void>;
    indexSite(siteId: string): Promise<SiteOpOutcome>;
  };
}

/**
 * Which operations mean anything for a given source.
 *
 * `start`/`stop` are Local process controls — Nexus does not start or stop a
 * remote host. `plugin-update`, `setup-ai` and `health-refresh` all run through
 * Local's WP-CLI bridge. Only the two data-currency operations, which are what
 * the Sites table's bulk bar offers, are defined for all three.
 */
const REMOTE_SUPPORTED: BulkOpType[] = ['sync-graph', 'reindex', 'index'];

/**
 * Five was exactly WP Engine's cap and therefore had no headroom.
 *
 * WPE allows five concurrent SSH connections PER USER, account-wide — shared
 * by this manager, the schedulers, agent runs and the CLI. At 5 a fleet sweep
 * consumed the entire account quota on its own, so any scheduled refresh or
 * agent firing alongside it was refused, and so was the sweep the moment
 * anything else got in first. Three leaves two connections for everything
 * else on the machine.
 *
 * The 5 was chosen for local-site throughput ("50 sites: ~10 min vs ~17 min")
 * before remote sources routed through here at all, and that reasoning never
 * accounted for a per-account server-side limit. Local sites are slower for
 * it; correctness on the remote path is worth more than the difference, and a
 * per-source limit is the better answer if the local cost ever bites.
 */
const MAX_CONCURRENCY = 3;
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
      // Display names are a chokepoint concern, not a caller contract. A
      // caller-supplied name wins; the gaps are filled here from Local's store
      // and the graph — measured 2026-08-23, an MCP bulk_reindex (ids only)
      // rendered five raw wpe-<uuid>s in the Operations panel because only the
      // renderer dispatcher happened to send names.
      siteNames: this.resolveSiteNames(request.siteIds, request.siteNames),
      options: request.options ?? {},
      status: 'running',
      progress: { completed: 0, total: request.siteIds.length, errors: [], skipped: [] },
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

  /**
   * Names for the panel: caller-supplied first, then Local's store for local
   * ids, then the graph for wpe/external rows. Best-effort and non-fatal — a
   * missing name renders as the id, which is exactly the failure this exists
   * to make rare, but it must never fail a dispatch.
   */
  private resolveSiteNames(
    siteIds: string[],
    supplied?: Record<string, string>,
  ): Record<string, string> {
    const names: Record<string, string> = { ...(supplied ?? {}) };
    for (const siteId of siteIds) {
      if (names[siteId]) continue;
      try {
        if (siteSourceOf(siteId) === 'local') {
          const site = this.deps.siteDataBridge.resolveSiteObject(siteId);
          if (site?.name) names[siteId] = site.name;
          continue;
        }
        const db = (this.deps.graphService as { getDb?(): unknown } | undefined)?.getDb?.() as
          | { prepare(sql: string): { get(id: string): { name?: string } | undefined } }
          | undefined;
        const row = db?.prepare('SELECT name FROM sites WHERE id = ? AND is_active = 1').get(siteId);
        if (row?.name) names[siteId] = row.name;
      } catch {
        /* a name lookup must never fail the dispatch */
      }
    }
    return names;
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

      // Auto-start logic: if site is halted and autoStartStop is enabled.
      // Local only — `getSiteStatus`/`startSite` are Local process controls and
      // Nexus does not start or stop a remote host. Calling them with a `wpe-`
      // or `ssh:` id reaches Local's store and throws.
      const autoStartStop = op.options.autoStartStop === true && siteSourceOf(siteId) === 'local';
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

      // Throwing is the failure channel; the returned outcome says whether the
      // work actually ran. Treating "did not throw" as "succeeded" is what
      // reported 413 successes for three sites' worth of work.
      const outcome = await this.executeByType(op, siteId);
      // An adapter that returns nothing has not said whether the work ran.
      // TypeScript requires an outcome, so this is only reachable from an
      // untyped or out-of-tree adapter — and the one thing we must not do is
      // assume success, which is the whole defect. Fail loudly instead.
      if (!outcome || typeof outcome.ran !== 'boolean') {
        throw new Error(
          `'${op.type}' returned no outcome for ${siteId}, so it cannot be confirmed to have run.`,
        );
      }
      if (outcome.ran) {
        result.status = 'completed';
      } else {
        result.status = 'skipped';
        result.skipReason = outcome.reason;
        op.progress.skipped.push(siteId);
      }
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

  /**
   * The one seam that decides the word "Success".
   *
   * Contract: THROW means the work ran and failed. Returning `{ran: false}`
   * means it did not run, and must carry a reason a user can act on. Every
   * implementation obeys this one rule — the disagreement between three
   * implementations, each returning normally on failure, is the defect this
   * replaces.
   */
  private async executeByType(op: BulkOperation, siteId: string): Promise<SiteOpOutcome> {
    const source = siteSourceOf(siteId);
    if (source !== 'local') {
      return this.executeRemote(op, siteId, source);
    }

    switch (op.type) {
      case 'reindex':
        return this.executeReindex(siteId, op.options);
      case 'index':
        // Sheet 18: ONE run covers both depths — metadata first (a metadata
        // failure is the run failing to read the place at all), then content.
        // The outcome is the CONTENT step's, verbatim: a gatewayless place
        // lands as did-not-run with the gateway reason, which is exactly the
        // "stops at the API facts" group — where it stopped, stated.
        await this.executeGraphSync(siteId, op.options);
        return this.executeReindex(siteId, op.options);
      case 'plugin-update':
        await this.executePluginUpdate(siteId, op.options.pluginSlug, op.options);
        return { ran: true };
      case 'start':
        await this.deps.siteDataBridge.startSite(siteId);
        return { ran: true };
      case 'stop':
        await this.deps.siteDataBridge.stopSite(siteId);
        return { ran: true };
      case 'health-refresh':
        await this.executeHealthRefresh(siteId);
        return { ran: true };
      case 'setup-ai':
        await this.executeSetupAI(siteId, op.options);
        return { ran: true };
      case 'sync-graph':
        await this.executeGraphSync(siteId, op.options);
        return { ran: true };
      default:
        throw new Error(`Unknown operation type: ${op.type}`);
    }
  }

  /**
   * WP Engine and external SSH sites.
   *
   * Kept as one branch rather than folded into the switch above because the
   * Local arms all resolve the id through `siteDataBridge`, which only knows
   * Local's store — reaching them with a remote id produced "Site not found",
   * a message that reads like the site is missing rather than like the
   * operation was pointed at the wrong backend.
   */
  private async executeRemote(op: BulkOperation, siteId: string, source: SiteSource): Promise<SiteOpOutcome> {
    if (REMOTE_SUPPORTED.indexOf(op.type) === -1) {
      throw new Error(
        `'${op.type}' is not supported for ${source} sites — it is a Local-only operation. ` +
        `Supported for ${source}: ${REMOTE_SUPPORTED.join(', ')}.`,
      );
    }

    // Display only. `op.siteNames` is a renderer-supplied map for labelling a
    // row or an error, and it must never reach a transport again: when it had
    // no entry the old `?? siteId` fallback handed a graph id to
    // `WpeSshTransport` as an install name. Every adapter below now takes the
    // graph id alone and resolves the name itself, at the point of use.
    const label = op.siteNames?.[siteId] ?? siteId;

    if (source === 'wpe') {
      const ops = this.deps.wpeOps;
      if (!ops) throw new Error(`WP Engine sync is not available in this process — cannot ${op.type} ${label}.`);
      if (op.type === 'sync-graph' || op.type === 'index') {
        // syncSingleSite calls capiGetInstall, which does not know the `wpe-` form.
        await ops.syncSingleSite(wpeInstallIdOf(siteId));
        if (op.type === 'sync-graph') return { ran: true };
      }
      return ops.indexOne(siteId);
    }

    const ops = this.deps.externalOps;
    if (!ops) throw new Error(`External host access is not available in this process — cannot ${op.type} ${label}.`);
    if (op.type === 'sync-graph' || op.type === 'index') {
      await ops.refreshSite(siteId);
      if (op.type === 'sync-graph') return { ran: true };
    }
    return ops.indexSite(siteId);
  }

  private async executeReindex(siteId: string, options?: Record<string, any>): Promise<SiteOpOutcome> {
    const site = this.deps.siteDataBridge.resolveSiteObject(siteId);
    if (!site) {
      throw new Error(`Site not found: ${siteId}`);
    }

    const trigger: PipelineTrigger = (options?.trigger as PipelineTrigger) ?? 'adhoc';

    // D9. A halted Local site has no MySQL, so `ContentPipeline` records
    // `state: 'error'` with "MySQL not available — site may not be running"
    // and indexes nothing. That is a site that DID NOT RUN, not one that
    // failed — measured 2026-08-22: all 45 Local sites, one identical error.
    //
    // Gated on the site's status rather than on that error string: matching
    // prose from another module is brittle, and the status is the actual fact.
    //
    // `autoStartStop` is the one line to flip. It is wired end to end —
    // `executeSingle` already starts a halted site, waits for the database and
    // stops it afterwards — and it is deliberately left OFF by default.
    // Starting 45 sites because someone pressed a button is the owner's
    // decision, not this function's.
    if (!options?.autoStartStop && this.deps.siteDataBridge.getSiteStatus(siteId) !== 'running') {
      // The one exit that never reaches ContentPipeline — recorded here or
      // recorded nowhere. A skip is a run whose outcome is "did not run".
      const now = Date.now();
      recordPipelineRun({
        layer: 'l3', trigger, outcome: 'skip',
        reason: `${site.name ?? siteId} is not running`,
        startedAt: now, finishedAt: now,
        site: { kind: 'local', localSiteId: siteId },
      });
      return { ran: false, reason: `${site.name ?? siteId} is not running` };
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
    }, trigger);

    // `indexSite` reports failure by RETURNING it: it writes `state: 'error'`
    // into the IndexRegistry and resolves normally. Reading only the throw
    // meant the registry and the panel wrote both words about the same site in
    // the same second — 45 of them, measured. Mirror what the registry
    // recorded; a site the pipeline calls errored is not a success here.
    if (indexResult?.errors?.length) {
      throw new Error(indexResult.errors.join('; '));
    }

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

    return { ran: true };
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

    auditDirectOperation(this.deps.auditServices, {
      operation: 'bulk.plugin.update',
      target: siteId,
      parameters: { siteId, plugin: pluginSlug },
      outcome: result.success ? 'success' : 'failure',
      error: result.success ? undefined : `Plugin update failed for ${pluginSlug}`,
    });

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
    const l2StartedAt = Date.now();
    const l2Trigger: PipelineTrigger = (options?.trigger as PipelineTrigger) ?? 'adhoc';
    try {
      await this.executeGraphSyncInner(siteId, options);
      recordPipelineRun({
        layer: 'l2', trigger: l2Trigger, outcome: 'ok',
        startedAt: l2StartedAt, finishedAt: Date.now(),
        site: { kind: 'local', localSiteId: siteId },
      });
    } catch (err: any) {
      recordPipelineRun({
        layer: 'l2', trigger: l2Trigger, outcome: 'fail',
        reason: err?.message ?? String(err),
        startedAt: l2StartedAt, finishedAt: Date.now(),
        site: { kind: 'local', localSiteId: siteId },
      });
      throw err;
    }
  }

  private async executeGraphSyncInner(siteId: string, options?: Record<string, any>): Promise<void> {
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
    await writeRowsHonestly(plugins, (plugin: any) =>
      this.deps.graphService!.upsertPlugin({
        site_id: siteId,
        slug: plugin.name, // WP-CLI returns 'name' as the slug
        name: plugin.title, // WP-CLI returns 'title' as the display name
        version: plugin.version || null,
        is_active: plugin.status === 'active' ? 1 : 0,
        author: null,
        created_at: now,
        updated_at: now,
      }),
    { subject: siteId, label: 'plugin', logger: { warn: (m: string) => console.warn(m) } });

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
