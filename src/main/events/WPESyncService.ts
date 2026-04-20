/**
 * WPESyncService - Syncs WP Engine sites into the GraphService
 *
 * Features:
 * - Lists WPE installs via wp-nexus MCP
 * - Extracts metadata via remote WP-CLI
 * - Stores in GraphService with source='wpe'
 * - Progress tracking for large account syncs
 * - Optional content indexing (Phase 2)
 */

import { GraphService } from './GraphService';
import { Site } from './types';
import { RemoteContentExtractor } from '../content/RemoteContentExtractor';
import { EmbeddingService } from '../embeddings/EmbeddingService';
import { VectorStore } from '../vector-store/VectorStore';
import { VectorDocument } from '../../common/types';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { RegistryStorage } from '../content/IndexRegistry';
import { STORAGE_KEYS } from '../../common/constants';
import pLimit from 'p-limit';

export interface WPESyncProgress {
  total: number;
  current: number;
  skipped: number;
  currentSite: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

export interface WPESyncResult {
  success: boolean;
  synced: number;
  skipped: number;
  failed: number;
  errors: Array<{ installId: string; error: string }>;
}

export interface WPEInstallData {
  install_id: string;
  install_name: string;
  environment: string;
  primary_domain: string;
  php_version?: string;
  account_id?: string;
}

export interface WPESyncServiceOptions {
  graphService: GraphService;
  localServices: LocalServicesBridge;
  remoteContentExtractor?: RemoteContentExtractor;
  embeddingService?: EmbeddingService;
  vectorStore?: VectorStore;
  logger?: any;
  registryStorage?: RegistryStorage;
}

export class WPESyncService {
  private graphService: GraphService;
  private localServices: LocalServicesBridge;
  private remoteContentExtractor?: RemoteContentExtractor;
  private embeddingService?: EmbeddingService;
  private vectorStore?: VectorStore;
  private logger: any;
  private registryStorage?: RegistryStorage;
  private currentProgress: WPESyncProgress | null = null;
  private abortRequested = false;

  stopSync(): void {
    if (this.currentProgress?.status === 'running') {
      this.abortRequested = true;
      this.logger.info('[WPESyncService] Stop requested — will halt after current install completes');
    }
  }

  isRunning(): boolean {
    return this.currentProgress?.status === 'running';
  }

  constructor(options: WPESyncServiceOptions) {
    this.graphService = options.graphService;
    this.localServices = options.localServices;
    this.remoteContentExtractor = options.remoteContentExtractor;
    this.embeddingService = options.embeddingService;
    this.vectorStore = options.vectorStore;
    this.logger = options.logger || console;
    this.registryStorage = options.registryStorage;
  }

  /**
   * Get current sync progress
   */
  getProgress(): WPESyncProgress | null {
    return this.currentProgress;
  }

  /**
   * Sync all WPE sites from CAPI
   * @param limit - Optional limit on number of sites to sync (for testing)
   */
  async syncAllWPESites(limit?: number, staleThresholdHours?: number, accountFilter?: string[] | null): Promise<WPESyncResult> {
    this.abortRequested = false;
    const result: WPESyncResult = {
      success: true,
      synced: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    try {
      // Check CAPI availability
      if (!this.localServices.isCAPIAvailable()) {
        this.logger.error('[WPESyncService] CAPI not available - user needs to authenticate with WP Engine');
        throw new Error('WP Engine API (CAPI) not available. Authenticate with WP Engine first.');
      }

      this.logger.info('[WPESyncService] Fetching WPE installs from CAPI...');

      // Get all WPE installs via CAPI
      let installs: any[];
      try {
        installs = await this.localServices.capiGetInstalls() as any[];
      } catch (capiError: any) {
        const capiMsg = capiError instanceof Error ? capiError.message : String(capiError);
        this.logger.error('[WPESyncService] CAPI getInstallList failed:', capiMsg);
        throw new Error(`Failed to fetch WPE installs: ${capiMsg}. Check WP Engine authentication.`);
      }

      if (!installs || !Array.isArray(installs)) {
        this.logger.error('[WPESyncService] CAPI returned invalid data:', installs);
        throw new Error('Failed to get WPE installs from CAPI');
      }

      this.logger.info(`[WPESyncService] Found ${installs.length} WPE installs`);

      // Apply account filter — null/undefined means all accounts
      if (accountFilter && accountFilter.length > 0) {
        const before = installs.length;
        installs = installs.filter((i: any) => i.account?.id && accountFilter.includes(i.account.id));
        this.logger.info(`[WPESyncService] Account filter applied: ${installs.length} of ${before} installs in scope`);
      }

      // Fetch and store accounts for name/nickname lookup
      let accountMap = new Map<string, { name: string; nickname?: string }>();
      try {
        const accounts = await this.localServices.capiGetAccounts() as any[];
        for (const a of accounts ?? []) {
          if (a.id) {
            accountMap.set(a.id, { name: a.name ?? a.id, nickname: a.nickname ?? undefined });
            await this.graphService.upsertAccount({ id: a.id, name: a.name ?? a.id, nickname: a.nickname });
          }
        }
        this.logger.info(`[WPESyncService] Stored ${accountMap.size} accounts`);
      } catch (err: any) {
        this.logger.warn('[WPESyncService] Could not fetch accounts:', err.message);
      }

      // Map to WPEInstallData
      const wpeInstalls: WPEInstallData[] = installs.map((i: any) => ({
        install_id: i.id,
        install_name: i.name,
        environment: i.environment ?? 'production',
        primary_domain: i.primaryDomain || `${i.name}.wpengine.com`,
        php_version: i.phpVersion ?? undefined,
        account_id: i.account?.id ?? undefined,
      }));

      // Build a per-site last_sync_at map from graph for staleness filtering
      const graphDb = this.graphService.getDb();
      const lastSyncMap = new Map<string, number>();
      if (graphDb) {
        try {
          const rows = graphDb.prepare(
            "SELECT remote_install_id, last_sync_at FROM sites WHERE source='wpe' AND remote_install_id IS NOT NULL"
          ).all() as Array<{ remote_install_id: string; last_sync_at: number | null }>;
          for (const r of rows) {
            if (r.last_sync_at) lastSyncMap.set(r.remote_install_id, r.last_sync_at);
          }
        } catch { /* continue without filter */ }
      }

      // Filter to stale installs only (never synced OR older than threshold)
      const thresholdMs = (staleThresholdHours ?? 8) * 60 * 60 * 1000;
      const now = Date.now();
      const staleInstalls = wpeInstalls.filter((i) => {
        const last = lastSyncMap.get(i.install_id);
        return !last || (now - last) > thresholdMs;
      });
      result.skipped = wpeInstalls.length - staleInstalls.length;

      this.logger.info(
        `[WPESyncService] ${staleInstalls.length} stale, ${result.skipped} fresh (skipping) out of ${wpeInstalls.length} total`
      );

      // Apply limit if specified (after staleness filter)
      const installsToSync = limit ? staleInstalls.slice(0, limit) : staleInstalls;

      this.currentProgress = {
        total: installsToSync.length,
        current: 0,
        skipped: result.skipped,
        currentSite: '',
        status: 'running',
      };

      this.logger.info(`[WPESyncService] Starting sync loop for ${installsToSync.length} installs${limit ? ` (limited)` : ''}...`);

      // WP Engine SSH gateway limits to 5 concurrent connections per user.
      // Use 4 to leave one slot for interactive use.
      const concurrencyLimit = pLimit(4);
      let completed = 0;

      const syncTasks = installsToSync.map((install, i) =>
        concurrencyLimit(async () => {
          if (this.abortRequested) {
            this.logger.info(`[WPESyncService] Abort requested — skipping ${install.install_name}`);
            return;
          }

          if (this.currentProgress) {
            this.currentProgress.current = completed + 1;
            this.currentProgress.currentSite = install.install_name;
          }

          this.logger.info(`[WPESyncService] Syncing ${i + 1}/${installsToSync.length}: ${install.install_name}`);

          try {
            await this.syncInstall(install);
            completed++;
            result.synced++;
            this.logger.info(`[WPESyncService] ✓ Synced ${install.install_name} (${completed}/${installsToSync.length} complete)`);
          } catch (error: any) {
            completed++;
            result.failed++;
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            result.errors.push({
              installId: install.install_id,
              error: errorMsg || 'Unknown error',
            });
            this.logger.error(`[WPESyncService] ✗ Failed to sync ${install.install_name}:`, errorMsg, errorStack);
          }
        }),
      );

      await Promise.all(syncTasks);

      this.currentProgress.status = 'completed';
      return result;
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error('[WPESyncService] Sync failed:', errorMsg, errorStack);

      this.currentProgress = {
        total: 0,
        current: 0,
        skipped: 0,
        currentSite: '',
        status: 'failed',
        error: errorMsg,
      };

      result.success = false;
      result.errors.push({
        installId: 'sync',
        error: errorMsg || 'Failed to sync WPE sites',
      });

      return result;
    }
  }

  /**
   * Sync a single WPE install
   */
  async syncInstall(install: WPEInstallData): Promise<void> {
    const now = Date.now();
    const siteId = `wpe-${install.install_id}`;

    // Helper: run a WP-CLI command with 1 retry.
    // The first call establishes the SSH ControlMaster (~13-30s cold start).
    // If it times out, ControlPersist=30s may have kept the master daemon alive,
    // so a retry completes in 1-3s via the existing socket.
    const runWithRetry = async (args: string[]): Promise<{ stdout: string; success: boolean }> => {
      const norm = (r: any) => ({ stdout: r.stdout ?? '', success: !!r.success });
      const first = norm(await this.localServices.remoteWpCliRun(install.install_name, args).catch(() => ({ stdout: '', success: false })));
      if (first.success) return first;
      // Brief pause — gives ControlPersist daemon time to stabilise if the first
      // call established the connection but timed out before WP-CLI responded.
      await new Promise((r) => setTimeout(r, 2000));
      return norm(await this.localServices.remoteWpCliRun(install.install_name, args).catch(() => ({ stdout: '', success: false })));
    };

    // Run commands sequentially: first establishes ControlMaster, rest reuse it.
    const t0 = Date.now();
    const versionResult = await runWithRetry(['core', 'version']);
    const t1 = Date.now();
    this.logger.debug(`[WPESyncService] ${install.install_name} core version: success=${versionResult.success} stdout="${versionResult.stdout?.slice(0, 80)}" ms=${t1 - t0}`);
    const wpVersion = versionResult.success && versionResult.stdout ? versionResult.stdout.trim() : undefined;

    const pluginResult = await this.localServices.remoteWpCliRun(install.install_name, ['plugin', 'list', '--format=json']).catch(() => ({ stdout: '', success: false }));
    const t2 = Date.now();
    this.logger.debug(`[WPESyncService] ${install.install_name} plugin list: success=${pluginResult.success} ms=${t2 - t1}`);
    let pluginRows: any[] = [];
    if (pluginResult.success && pluginResult.stdout) {
      try { const p = JSON.parse(pluginResult.stdout); pluginRows = Array.isArray(p) ? p : []; } catch { /* skip */ }
    }

    const userResult = await this.localServices.remoteWpCliRun(install.install_name, ['user', 'list', '--format=json']).catch(() => ({ stdout: '', success: false }));
    const t3 = Date.now();
    this.logger.debug(`[WPESyncService] ${install.install_name} user list: success=${userResult.success} ms=${t3 - t2}`);
    let userRows: any[] = [];
    if (userResult.success && userResult.stdout) {
      try { const u = JSON.parse(userResult.stdout); userRows = Array.isArray(u) ? u : []; } catch { /* skip */ }
    }

    this.logger.info(
      `[WPESyncService] synced: ${install.install_name} — wp=${wpVersion ?? '?'} plugins=${(pluginRows as any[]).length} users=${(userRows as any[]).length}`
    );

    // Upsert site record
    const site: Site = {
      id: siteId,
      name: install.install_name,
      domain: install.primary_domain,
      wp_version: wpVersion,
      php_version: install.php_version,
      account_id: install.account_id,
      last_sync_at: now,
      is_active: true,
      created_at: now,
      updated_at: now,
      source: 'wpe',
      remote_install_id: install.install_id,
      remote_domain: install.primary_domain,
    };

    await this.graphService.upsertSite(site);

    // Write plugins (wp plugin list returns: name=slug, title=display name, status, version, author)
    if ((pluginRows as any[]).length > 0) {
      await this.graphService.deletePlugins(siteId);
      for (const plugin of pluginRows as any[]) {
        await this.graphService.upsertPlugin({
          site_id: siteId,
          slug: plugin.name,           // wp plugin list uses 'name' for the slug
          name: plugin.title || plugin.name,
          version: plugin.version || null,
          is_active: plugin.status === 'active',
          author: plugin.author || null,
          created_at: now,
          updated_at: now,
        });
      }
    }

    // Write users
    for (const user of userRows) {
      await this.graphService.upsertUser({
        site_id: siteId,
        user_id: user.ID,
        username: user.user_login,
        email: user.user_email || null,
        roles: JSON.stringify(user.roles ? user.roles.split(',') : []),
        created_at: now,
        updated_at: now,
      });
    }

    // Content indexing (optional — don't fail sync if this errors)
    if (this.remoteContentExtractor && this.embeddingService && this.vectorStore) {
      await this.syncContent(siteId, install.install_name);
    }
  }


  /**
   * Sync content for a WPE install (Phase 2)
   * Extracts posts/pages and indexes them for semantic search
   */
  private async syncContent(siteId: string, installName: string): Promise<void> {
    if (!this.remoteContentExtractor || !this.embeddingService || !this.vectorStore) {
      this.logger.warn(`[WPESyncService] Content sync skipped - missing dependencies`);
      return;
    }

    try {
      this.logger.info(`[WPESyncService] Starting content extraction for ${installName}...`);

      // Extract content via remote WP-CLI
      const extracted = await this.remoteContentExtractor.extract(installName);
      this.logger.info(`[WPESyncService] Extraction complete. Posts found: ${extracted.posts?.length || 0}`);

      if (!extracted.posts || extracted.posts.length === 0) {
        this.logger.info(`[WPESyncService] No content to index for ${installName}`);
        return;
      }

      // Prepare documents for embedding
      this.logger.info(`[WPESyncService] Preparing ${extracted.posts.length} documents for embedding...`);
      const documents: Array<Omit<VectorDocument, 'vector'>> = [];

      for (const post of extracted.posts) {
        // Store post metadata in graph
        await this.graphService.upsertContent({
          site_id: siteId,
          post_id: post.id,
          post_type: post.postType,
          title: post.title,
          status: post.postStatus,
          author_id: parseInt(post.author, 10) || null,
          created_at: new Date(post.date).getTime(),
          updated_at: Date.now(),
        });

        // Create document for vector indexing
        // Simple approach: one document per post (no chunking for now)
        documents.push({
          id: `wp_${siteId}_${post.id}`,
          siteId,
          title: post.title,
          content: post.cleanedContent,
          postType: post.postType,
          postId: post.id,
          chunkIndex: 0,
          metadata: JSON.stringify({
            excerpt: post.excerpt,
            author: post.author,
            date: post.date,
            source: 'wpe',
          }),
          indexedAt: Date.now(),
        });
      }

      this.logger.info(`[WPESyncService] Prepared ${documents.length} documents from ${extracted.posts.length} posts`);

      // Embed documents in batches
      this.logger.info(`[WPESyncService] Generating embeddings for ${documents.length} documents...`);
      const batchSize = 10;
      const embeddedDocs: VectorDocument[] = [];

      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        const texts = batch.map(d => d.content);

        this.logger.info(`[WPESyncService] Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)}...`);

        // Generate embeddings
        const vectors = await this.embeddingService.embedBatch(texts);

        // Combine with documents
        for (let j = 0; j < batch.length; j++) {
          embeddedDocs.push({
            ...batch[j],
            vector: vectors[j],
          });
        }
      }

      this.logger.info(`[WPESyncService] Embeddings generated. Upserting ${embeddedDocs.length} documents to vector store...`);

      // Upsert into vector store (this handles table creation automatically)
      await this.vectorStore.upsert(siteId, embeddedDocs);

      this.logger.info(`[WPESyncService] Vector store upsert complete`);


      this.logger.info(`[WPESyncService] Content sync completed for ${installName}: ${embeddedDocs.length} documents indexed`);
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`[WPESyncService] Failed to sync content for ${installName}:`, errorMsg, errorStack);
      // Don't throw - content sync is optional, metadata sync succeeded
    }
  }

  /**
   * Remove a WPE site from the graph
   */
  async removeWPESite(installId: string): Promise<void> {
    const siteId = `wpe-${installId}`;

    // Delete site record (CASCADE should handle related data)
    // For now, manually delete related data since SQLite doesn't enforce CASCADE
    const db = this.graphService.getDb();
    if (!db) throw new Error('Database not initialized');

    db.prepare('DELETE FROM content WHERE site_id = ?').run(siteId);
    db.prepare('DELETE FROM plugins WHERE site_id = ?').run(siteId);
    db.prepare('DELETE FROM users WHERE site_id = ?').run(siteId);
    db.prepare('DELETE FROM relationships WHERE site_id = ?').run(siteId);
    db.prepare('DELETE FROM sites WHERE id = ?').run(siteId);

    // Delete vector store data (Phase 2)
    if (this.vectorStore) {
      try {
        await this.vectorStore.dropSite(siteId);
      } catch (error) {
        this.logger.warn(`[WPESyncService] Failed to delete vector data for ${siteId}:`, error);
      }
    }
  }

  /**
   * Tier 1: CAPI-only sync — runs on every startup, no SSH required.
   *
   * Fetches accounts and installs from CAPI (fast, ~2-3s) and:
   * - Upserts wpe_accounts (name, nickname)
   * - Updates sites with php_version, account_id, domain from CAPI
   * - Detects new installs not yet in the graph
   * - Detects removed installs (deleted from WPE)
   *
   * Does NOT fetch wp_version, plugins, or users (those need SSH).
   * Returns a summary useful for nudging the user toward a full sync.
   */
  async syncFromCAPI(): Promise<{
    accounts: number;
    total: number;
    newInstalls: string[];
    updatedFields: number;
    ghostInstalls: number;
  }> {
    if (!this.localServices.isCAPIAvailable()) {
      throw new Error('WP Engine API not available. Authenticate first.');
    }

    this.logger.info('[WPESyncService] Starting CAPI-only sync...');

    // Fetch accounts
    const accounts = await this.localServices.capiGetAccounts() as any[];
    const accountMap = new Map<string, { name: string; nickname?: string }>();
    for (const a of accounts ?? []) {
      if (a.id) {
        accountMap.set(a.id, { name: a.name ?? a.id, nickname: a.nickname ?? undefined });
        await this.graphService.upsertAccount({ id: a.id, name: a.name ?? a.id, nickname: a.nickname });
      }
    }
    this.logger.info(`[WPESyncService] CAPI: ${accountMap.size} accounts`);

    // Fetch all installs
    const installs = await this.localServices.capiGetInstalls() as any[];
    if (!installs?.length) return { accounts: accountMap.size, total: 0, newInstalls: [], updatedFields: 0, ghostInstalls: 0 };

    // Build set of existing site IDs in graph
    const db = this.graphService.getDb();
    const existingIds = new Set<string>();
    if (db) {
      const rows = db.prepare("SELECT id FROM sites WHERE source='wpe'").all() as Array<{ id: string }>;
      for (const r of rows) existingIds.add(r.id);
    }

    const now = Date.now();
    const newInstalls: string[] = [];
    let updatedFields = 0;

    for (const i of installs) {
      const siteId = `wpe-${i.id}`;
      const isNew = !existingIds.has(siteId);

      if (isNew) {
        newInstalls.push(i.name);
        await this.graphService.upsertSite({
          id: siteId,
          name: i.name,
          domain: i.primaryDomain || `${i.name}.wpengine.com`,
          wp_version: i.wpVersion ?? undefined,
          php_version: i.phpVersion ?? undefined,
          account_id: i.account?.id ?? undefined,
          last_sync_at: undefined,
          is_active: true,
          created_at: now,
          updated_at: now,
          source: 'wpe',
          remote_install_id: i.id,
          remote_domain: i.primaryDomain || `${i.name}.wpengine.com`,
        });
        updatedFields++;
      } else {
        // Update CAPI fields on existing record.
        // wp_version and php_version use COALESCE so SSH-synced values are not overwritten.
        if (db) {
          const result = db.prepare(`
            UPDATE sites SET
              wp_version  = COALESCE(wp_version, ?),
              php_version = COALESCE(php_version, ?),
              account_id  = COALESCE(account_id, ?),
              domain = CASE WHEN domain = '' OR domain IS NULL THEN ? ELSE domain END,
              updated_at = ?
            WHERE id = ?
          `).run(i.wpVersion ?? null, i.phpVersion ?? null, i.account?.id ?? null, i.primaryDomain ?? null, now, siteId);
          if (result.changes > 0) updatedFields++;
        }
      }
    }

    // Detect ghost installs (in graph but not returned by CAPI)
    let ghosts: string[] = [];
    if (db) {
      const capiIds = new Set(installs.map((i: any) => `wpe-${i.id}`));
      const graphIds = Array.from(existingIds);
      ghosts = graphIds.filter(id => !capiIds.has(id));
      if (ghosts.length > 0) {
        const placeholders = ghosts.map(() => '?').join(',');
        db.prepare(`UPDATE sites SET is_active=0, updated_at=? WHERE id IN (${placeholders})`).run(now, ...ghosts);
        this.logger.info(`[WPESyncService] CAPI sync: ${ghosts.length} ghost installs marked inactive`);
      }
    }

    this.logger.info(
      `[WPESyncService] CAPI sync done: ${installs.length} installs, ${newInstalls.length} new, ${updatedFields} fields updated`
    );

    // Cache WPE install data so nexus://fleet/state can include it without a live CAPI call
    if (this.registryStorage) {
      const cache = installs.map((i: any) => ({
        installName: i.name,
        installId: i.id,
        environment: i.environment ?? 'unknown',
        primaryDomain: i.primaryDomain ?? `${i.name}.wpengine.com`,
        accountName: accountMap.get(i.account?.id ?? '')?.name ?? null,
      }));
      this.registryStorage.set(STORAGE_KEYS.WPE_INSTALL_CACHE, { installs: cache, syncedAt: Date.now() });
      this.logger.info(`[WPESyncService] Cached ${cache.length} WPE installs for fleet resource`);
    }

    return { accounts: accountMap.size, total: installs.length, newInstalls, updatedFields, ghostInstalls: ghosts?.length ?? 0 };
  }

  /**
   * Get list of synced WPE sites
   */
  async getSyncedWPESites(): Promise<Site[]> {
    return this.graphService.listSites({ source: 'wpe' });
  }

  /**
   * Returns the most recent last_sync_at across all WPE sites, or null if none synced.
   */
  async getLastSyncTime(): Promise<number | null> {
    const db = this.graphService.getDb();
    if (!db) return null;
    try {
      const row = db.prepare(
        "SELECT MAX(last_sync_at) as latest FROM sites WHERE source='wpe'"
      ).get() as { latest: number | null } | undefined;
      return row?.latest ?? null;
    } catch { return null; }
  }

  /**
   * Returns count of WPE sites not synced within thresholdHours.
   * Returns true (needs sync) if any sites are stale or unsynced.
   */
  async isStale(thresholdHours: number): Promise<boolean> {
    const db = this.graphService.getDb();
    if (!db) return true;
    try {
      const thresholdMs = thresholdHours * 60 * 60 * 1000;
      const cutoff = Date.now() - thresholdMs;
      const row = db.prepare(
        "SELECT COUNT(*) as stale FROM sites WHERE source='wpe' AND (last_sync_at IS NULL OR last_sync_at < ?)"
      ).get(cutoff) as { stale: number } | undefined;
      // Also stale if there are CAPI installs not yet in graph at all
      return (row?.stale ?? 1) > 0;
    } catch { return true; }
  }

  /**
   * Returns count of stale vs fresh WPE sites for dashboard display.
   */
  async getStalenessStats(thresholdHours: number): Promise<{ total: number; fresh: number; stale: number }> {
    const db = this.graphService.getDb();
    if (!db) return { total: 0, fresh: 0, stale: 0 };
    try {
      const cutoff = Date.now() - thresholdHours * 60 * 60 * 1000;
      const row = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN last_sync_at >= ? THEN 1 ELSE 0 END) as fresh,
          SUM(CASE WHEN last_sync_at IS NULL OR last_sync_at < ? THEN 1 ELSE 0 END) as stale
        FROM sites WHERE source='wpe'
      `).get(cutoff, cutoff) as { total: number; fresh: number; stale: number } | undefined;
      return row ?? { total: 0, fresh: 0, stale: 0 };
    } catch { return { total: 0, fresh: 0, stale: 0 }; }
  }

  /**
   * Re-sync a single WPE site's metadata
   */
  async syncSingleSite(installId: string): Promise<void> {
    this.logger?.info(`[WPESyncService] Re-syncing single site: ${installId}`);

    try {
      const install = await this.localServices.capiGetInstall(installId) as any;

      if (!install) {
        throw new Error(`Install ${installId} not found`);
      }

      // Map to WPEInstallData format
      const wpeInstall: WPEInstallData = {
        install_id: install.id,
        install_name: install.name,
        environment: install.environment ?? 'production',
        primary_domain: install.primaryDomain || `${install.name}.wpengine.com`,
        php_version: install.phpVersion ?? undefined,
        account_id: install.account?.id ?? undefined,
      };

      await this.syncInstall(wpeInstall);
      this.logger?.info(`[WPESyncService] Successfully re-synced: ${install.name}`);
    } catch (error) {
      this.logger?.error(`[WPESyncService] Failed to re-sync ${installId}:`, error);
      throw error;
    }
  }

  /**
   * Sync usage data (visits, bandwidth, storage) for all known WPE installs.
   *
   * Runs as part of the hourly cron. For each WPE install in the graph:
   *   1. Checks if we already have a fresh record for the current period
   *   2. If stale (> 1 hour) or missing: fetches from CAPI and persists to site_usage
   *   3. Also populates the in-memory usage-cache so MCP tools get the cached version
   *
   * Non-fatal: individual install failures are logged and skipped.
   */
  async syncUsageData(): Promise<{ synced: number; skipped: number; failed: number }> {
    if (!this.localServices.isCAPIAvailable()) {
      this.logger?.info('[WPESyncService:usage] CAPI not available — skipping usage sync');
      return { synced: 0, skipped: 0, failed: 0 };
    }

    const db = this.graphService.getDb();
    if (!db) return { synced: 0, skipped: 0, failed: 0 };

    // Get all WPE installs from the graph
    const installs = db.prepare(
      "SELECT id, remote_install_id, name FROM sites WHERE source='wpe' AND is_active=1 AND remote_install_id IS NOT NULL"
    ).all() as Array<{ id: string; remote_install_id: string; name: string }>;

    if (!installs.length) return { synced: 0, skipped: 0, failed: 0 };

    // Current month period string
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const firstDate = `${period}-01`;
    const lastDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Check which installs already have a fresh record (< 1 hour old)
    const latestPeriods = this.graphService.getLatestUsagePeriods();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    this.logger?.info(`[WPESyncService:usage] Syncing usage for ${installs.length} installs (period: ${period})`);

    let synced = 0, skipped = 0, failed = 0;
    const limit = pLimit(3); // max 3 concurrent CAPI calls

    await Promise.all(installs.map((install) => limit(async () => {
      try {
        const latest = latestPeriods.get(install.id);
        if (latest?.period === period && (Date.now() - latest.recordedAt) < ONE_HOUR_MS) {
          skipped++;
          return;
        }

        const data = await this.localServices.capiDirect(
          `/installs/${install.remote_install_id}/usage?first_date=${firstDate}&last_date=${lastDate}`,
        ) as Record<string, unknown>;

        this.graphService.upsertSiteUsage(install.id, period, data);

        // Also update the in-memory cache used by MCP tools so they don't re-fetch
        const { setUsageCached, makeUsageCacheKey } = require('../mcp/modules/wpe/usage-cache');
        const cacheKey = makeUsageCacheKey('install', install.remote_install_id, firstDate, lastDate);
        setUsageCached(cacheKey, data, true /* isCurrentMonth */);

        synced++;
        this.logger?.info(`[WPESyncService:usage] Synced ${install.name} — ${period}`);
      } catch (err: any) {
        failed++;
        this.logger?.warn(`[WPESyncService:usage] Failed for ${install.name}: ${err.message}`);
      }
    })));

    this.logger?.info(`[WPESyncService:usage] Done — ${synced} synced, ${skipped} skipped, ${failed} failed`);
    return { synced, skipped, failed };
  }
}
