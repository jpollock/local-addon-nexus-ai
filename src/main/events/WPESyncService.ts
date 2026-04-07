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
  currentSite: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

export interface WPESyncResult {
  success: boolean;
  synced: number;
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
  async syncAllWPESites(limit?: number): Promise<WPESyncResult> {
    const result: WPESyncResult = {
      success: true,
      synced: 0,
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

      // Apply limit if specified
      const installsToSync = limit ? wpeInstalls.slice(0, limit) : wpeInstalls;

      this.currentProgress = {
        total: installsToSync.length,
        current: 0,
        currentSite: '',
        status: 'running',
      };

      this.logger.info(`[WPESyncService] Starting sync loop for ${installsToSync.length} installs${limit ? ` (limited from ${wpeInstalls.length})` : ''}...`);

      // WP Engine SSH gateway limits to 5 concurrent connections per user.
      // Use 4 to leave one slot for interactive use.
      const concurrencyLimit = pLimit(4);
      let completed = 0;

      const syncTasks = installsToSync.map((install, i) =>
        concurrencyLimit(async () => {
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

    // Run WP version, plugins, and users in parallel — all independent SSH calls
    const [wpVersion, pluginRows, userRows] = await Promise.all([
      this.localServices.remoteWpCliRun(install.install_name, ['core', 'version'])
        .then((r) => (r.success && r.stdout ? r.stdout.trim() : undefined))
        .catch(() => undefined),

      this.localServices.remoteWpCliRun(install.install_name, ['plugin', 'list', '--format=json'])
        .then((r) => {
          if (!r.success || !r.stdout) return [];
          const parsed = JSON.parse(r.stdout);
          return Array.isArray(parsed) ? parsed : [];
        })
        .catch(() => []),

      this.localServices.remoteWpCliRun(install.install_name, ['user', 'list', '--format=json'])
        .then((r) => {
          if (!r.success || !r.stdout) return [];
          const parsed = JSON.parse(r.stdout);
          return Array.isArray(parsed) ? parsed : [];
        })
        .catch(() => []),
    ]);

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

    // Write plugins
    if (pluginRows.length > 0) {
      await this.graphService.deletePlugins(siteId);
      for (const plugin of pluginRows) {
        await this.graphService.upsertPlugin({
          site_id: siteId,
          slug: plugin.name,
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
   * Returns the oldest last_sync_at across all WPE sites, or null if none synced.
   */
  async getLastSyncTime(): Promise<number | null> {
    const sites = await this.graphService.listSites({ source: 'wpe' });
    if (sites.length === 0) return null;
    const times = sites.map((s) => s.last_sync_at ?? 0).filter((t) => t > 0);
    return times.length > 0 ? Math.min(...times) : null;
  }

  /**
   * Returns true if the oldest WPE sync is older than thresholdHours.
   */
  async isStale(thresholdHours: number): Promise<boolean> {
    const lastSync = await this.getLastSyncTime();
    if (lastSync === null) return true;
    return Date.now() - lastSync > thresholdHours * 60 * 60 * 1000;
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
