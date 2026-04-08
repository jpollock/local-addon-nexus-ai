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
}

export interface WPESyncServiceOptions {
  graphService: GraphService;
  localServices: LocalServicesBridge;
  remoteContentExtractor?: RemoteContentExtractor;
  embeddingService?: EmbeddingService;
  vectorStore?: VectorStore;
  logger?: any;
}

export class WPESyncService {
  private graphService: GraphService;
  private localServices: LocalServicesBridge;
  private remoteContentExtractor?: RemoteContentExtractor;
  private embeddingService?: EmbeddingService;
  private vectorStore?: VectorStore;
  private logger: any;
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
  async syncAllWPESites(limit?: number, staleThresholdHours?: number): Promise<WPESyncResult> {
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

      // Map to WPEInstallData
      const wpeInstalls: WPEInstallData[] = installs.map((i: any) => ({
        install_id: i.id,
        install_name: i.name,
        environment: i.environment ?? 'production',
        primary_domain: i.primaryDomain || `${i.name}.wpengine.com`,
        php_version: i.phpVersion ?? undefined,
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

    // Run commands sequentially so the first call establishes the ControlMaster socket
    // and subsequent calls reuse it. Running in parallel causes all 3 to race for the
    // socket, potentially opening 3 real TCP connections and hitting WPE's 5-conn limit.
    const t0 = Date.now();
    const versionResult = await this.localServices.remoteWpCliRun(install.install_name, ['core', 'version']).catch(() => ({ stdout: '', success: false }));
    const t1 = Date.now();
    this.logger.info(`[WPESyncService] ${install.install_name} core version: success=${versionResult.success} stdout="${versionResult.stdout?.slice(0, 80)}" ms=${t1 - t0}`);
    const wpVersion = versionResult.success && versionResult.stdout ? versionResult.stdout.trim() : undefined;

    const pluginResult = await this.localServices.remoteWpCliRun(install.install_name, ['plugin', 'list', '--format=json']).catch(() => ({ stdout: '', success: false }));
    const t2 = Date.now();
    this.logger.info(`[WPESyncService] ${install.install_name} plugin list: success=${pluginResult.success} ms=${t2 - t1}`);
    let pluginRows: any[] = [];
    if (pluginResult.success && pluginResult.stdout) {
      try { const p = JSON.parse(pluginResult.stdout); pluginRows = Array.isArray(p) ? p : []; } catch { /* skip */ }
    }

    const userResult = await this.localServices.remoteWpCliRun(install.install_name, ['user', 'list', '--format=json']).catch(() => ({ stdout: '', success: false }));
    const t3 = Date.now();
    this.logger.info(`[WPESyncService] ${install.install_name} user list: success=${userResult.success} ms=${t3 - t2}`);
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
      };

      await this.syncInstall(wpeInstall);
      this.logger?.info(`[WPESyncService] Successfully re-synced: ${install.name}`);
    } catch (error) {
      this.logger?.error(`[WPESyncService] Failed to re-sync ${installId}:`, error);
      throw error;
    }
  }
}
