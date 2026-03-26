/**
 * EventProcessor - Processes WordPress events and updates knowledge graph + embeddings
 */
import {
  WordPressEvent,
  QueuedEvent,
  EventProcessorStats,
  PostEventPayload,
  PluginEventPayload,
  ThemeEventPayload,
  UserEventPayload,
  SiteEventPayload,
} from './types';
import { GraphService } from './GraphService';
import { VectorStore } from '../vector-store/VectorStore';
import { EmbeddingService } from '../embeddings/EmbeddingService';

export interface EventProcessorOptions {
  graphService: GraphService;
  vectorStore: VectorStore | null;  // Can be null for testing
  embeddingService: EmbeddingService | null;  // Can be null for testing
  logger: {
    info: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
    warn: (msg: string) => void;
    debug: (msg: string) => void;
  };
  maxRetries?: number;
}

export class EventProcessor {
  private graphService: GraphService;
  private vectorStore: VectorStore | null;
  private embeddingService: EmbeddingService | null;
  private logger: any;
  private maxRetries: number;
  private processing = false;
  private eventsSinceOptimize = 0;
  private optimizeThreshold = 20; // Optimize every 20 events
  private sitesToOptimize = new Set<string>();

  constructor(options: EventProcessorOptions) {
    this.graphService = options.graphService;
    this.vectorStore = options.vectorStore;
    this.embeddingService = options.embeddingService;
    this.logger = options.logger;
    this.maxRetries = options.maxRetries ?? 3;
  }

  async initialize(): Promise<void> {
    // Schema is already created by GraphService
    this.logger.info('[EventProcessor] Initialized');
  }

  async stop(): Promise<void> {
    this.processing = false;
  }

  // ===== Event Queue Management =====

  async enqueue(event: WordPressEvent): Promise<number> {
    const db = (this.graphService as any).db;
    if (!db) throw new Error('GraphService not initialized');

    const result = db
      .prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
        RETURNING id
      `)
      .get(
        event.site_id,
        event.event_type,
        JSON.stringify(event.payload),
        event.timestamp
      ) as { id: number };

    return result.id;
  }

  // ===== Event Processing =====

  async processNext(): Promise<boolean> {
    const db = (this.graphService as any).db;
    if (!db) throw new Error('GraphService not initialized');

    // Get next pending event
    const event = db
      .prepare(`
        SELECT * FROM event_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
      `)
      .get() as QueuedEvent | undefined;

    if (!event) return false;

    // Mark as processing
    db.prepare('UPDATE event_queue SET status = ?, processed_at = ? WHERE id = ?')
      .run('processing', Date.now(), event.id);

    try {
      await this.processEvent(event);

      // Mark as completed
      db.prepare('UPDATE event_queue SET status = ?, processed_at = ? WHERE id = ?')
        .run('completed', Date.now(), event.id);

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[EventProcessor] Failed to process event ${event.id}:`, errorMsg);

      // Mark as failed
      db.prepare('UPDATE event_queue SET status = ?, error = ?, retry_count = retry_count + 1, processed_at = ? WHERE id = ?')
        .run('failed', errorMsg, Date.now(), event.id);

      return false;
    }
  }

  async processAll(): Promise<number> {
    let processed = 0;
    while (await this.processNext()) {
      processed++;
    }

    // Optimize tables if we've processed enough events
    if (this.eventsSinceOptimize >= this.optimizeThreshold && this.vectorStore) {
      this.logger.info(`[EventProcessor] Optimizing ${this.sitesToOptimize.size} tables after ${this.eventsSinceOptimize} events`);
      await this.optimizeTables();
    }

    return processed;
  }

  async retryFailed(): Promise<number> {
    const db = (this.graphService as any).db;
    if (!db) throw new Error('GraphService not initialized');

    // Reset failed events that haven't exceeded max retries
    const result = db
      .prepare('UPDATE event_queue SET status = ? WHERE status = ? AND retry_count < ?')
      .run('pending', 'failed', this.maxRetries);

    if (result.changes > 0) {
      await this.processAll();
    }

    return result.changes;
  }

  private async processEvent(event: QueuedEvent): Promise<void> {
    const payload = JSON.parse(event.payload);

    switch (event.event_type) {
      case 'post_created':
      case 'post_updated':
      case 'post_trashed':
      case 'post_untrashed':
        await this.processPostEvent(event.site_id, payload as PostEventPayload, event.event_type);
        this.sitesToOptimize.add(event.site_id);
        break;

      case 'post_deleted':
        await this.processPostDeletion(event.site_id, payload as PostEventPayload);
        this.sitesToOptimize.add(event.site_id);
        break;

      case 'plugin_installed':
      case 'plugin_activated':
      case 'plugin_deactivated':
      case 'plugin_updated':
        await this.processPluginEvent(event.site_id, payload as PluginEventPayload);
        break;

      case 'plugin_deleted':
        await this.processPluginDeletion(event.site_id, payload as PluginEventPayload);
        break;

      case 'theme_installed':
      case 'theme_activated':
        await this.processThemeEvent(event.site_id, payload as ThemeEventPayload);
        break;

      case 'theme_deleted':
        await this.processThemeDeletion(event.site_id, payload as ThemeEventPayload);
        break;

      case 'user_created':
      case 'user_updated':
        await this.processUserEvent(event.site_id, payload as UserEventPayload);
        break;

      case 'user_deleted':
        await this.processUserDeletion(event.site_id, payload as UserEventPayload);
        break;

      case 'site_initialized':
        await this.processSiteEvent(event.site_id, payload as SiteEventPayload);
        break;

      default:
        throw new Error(`Unknown event type: ${event.event_type}`);
    }
  }

  private async processPostEvent(siteId: string, payload: PostEventPayload, eventType: string): Promise<void> {
    // Validate required fields
    if (!payload.post_id || !payload.title) {
      throw new Error('Missing required fields: post_id, title');
    }

    // Update graph
    await this.graphService.upsertContent({
      site_id: siteId,
      post_id: payload.post_id,
      post_type: payload.post_type,
      title: payload.title,
      status: payload.status,
      author_id: payload.author_id ?? null,
      created_at: payload.created_at,
      updated_at: payload.updated_at,
    });

    // Update embeddings if content is provided
    if (payload.content && this.vectorStore && this.embeddingService) {
      this.logger.debug(`[EventProcessor] Creating embedding for post ${payload.post_id} (${payload.title}) in site "${siteId}"`);
      const text = `${payload.title}\n\n${payload.content}`;
      const embedding = await this.embeddingService.embed(text);

      const doc = {
        id: `wp_${siteId}_${payload.post_id}`,
        siteId: siteId,
        title: payload.title,
        content: payload.content,
        postType: payload.post_type,
        postId: payload.post_id,
        chunkIndex: 0,
        vector: embedding,
        metadata: JSON.stringify({
          excerpt: payload.excerpt ?? '',
          status: payload.status,
          updated_at: payload.updated_at,
        }),
        indexedAt: Date.now(),
      };

      this.logger.debug(`[EventProcessor] Upserting to VectorStore: siteId="${siteId}", docId="${doc.id}"`);
      await this.vectorStore.upsert(siteId, [doc]);
      this.logger.debug(`[EventProcessor] Embedding created and indexed for post ${payload.post_id}`);

      // Track events for periodic optimization
      this.eventsSinceOptimize++;
    } else {
      this.logger.warn(`[EventProcessor] Skipping embedding for post ${payload.post_id}: content=${!!payload.content}, vectorStore=${!!this.vectorStore}, embeddingService=${!!this.embeddingService}`);
    }
  }

  private async processPostDeletion(siteId: string, payload: PostEventPayload): Promise<void> {
    await this.graphService.deleteContent(siteId, payload.post_id);

    if (this.vectorStore) {
      await this.vectorStore.delete(siteId, [`wp_${siteId}_${payload.post_id}`]);
      this.eventsSinceOptimize++; // Count deletions too
    }
  }

  private async processPluginEvent(siteId: string, payload: PluginEventPayload): Promise<void> {
    await this.graphService.upsertPlugin({
      site_id: siteId,
      slug: payload.slug,
      name: payload.name,
      version: payload.version ?? null,
      is_active: payload.is_active,
      author: payload.author ?? null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  }

  private async processPluginDeletion(siteId: string, payload: PluginEventPayload): Promise<void> {
    await this.graphService.deletePlugin(siteId, payload.slug);
  }

  private async processThemeEvent(siteId: string, payload: ThemeEventPayload): Promise<void> {
    await this.graphService.upsertTheme({
      site_id: siteId,
      slug: payload.slug,
      name: payload.name,
      version: payload.version ?? null,
      is_active: payload.is_active,
      author: payload.author ?? null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  }

  private async processThemeDeletion(siteId: string, payload: ThemeEventPayload): Promise<void> {
    await this.graphService.deleteTheme(siteId, payload.slug);
  }

  private async processUserEvent(siteId: string, payload: UserEventPayload): Promise<void> {
    await this.graphService.upsertUser({
      site_id: siteId,
      user_id: payload.user_id,
      username: payload.username,
      email: payload.email ?? null,
      roles: JSON.stringify(payload.roles),
      created_at: payload.created_at,
      updated_at: Date.now(),
    });
  }

  private async processUserDeletion(siteId: string, payload: UserEventPayload): Promise<void> {
    await this.graphService.deleteUser(siteId, payload.user_id);
  }

  private async processSiteEvent(siteId: string, payload: SiteEventPayload): Promise<void> {
    await this.graphService.upsertSite({
      id: siteId,
      name: payload.name,
      domain: payload.domain,
      wp_version: payload.wp_version,
      is_active: true,
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // Optionally process plugins from site initialization
    if (payload.plugins) {
      for (const plugin of payload.plugins) {
        await this.processPluginEvent(siteId, plugin);
      }
    }
  }

  // ===== Statistics =====

  async getStats(): Promise<EventProcessorStats> {
    const db = (this.graphService as any).db;
    if (!db) throw new Error('GraphService not initialized');

    const total = db.prepare('SELECT COUNT(*) as count FROM event_queue').get() as { count: number };
    const pending = db.prepare('SELECT COUNT(*) as count FROM event_queue WHERE status = ?').get('pending') as { count: number };
    const failed = db.prepare('SELECT COUNT(*) as count FROM event_queue WHERE status = ?').get('failed') as { count: number };

    const todayStart = new Date().setHours(0, 0, 0, 0);
    const processedToday = db
      .prepare('SELECT COUNT(*) as count FROM event_queue WHERE status = ? AND processed_at >= ?')
      .get('completed', todayStart) as { count: number };

    // Calculate average processing time
    const avgTime = db
      .prepare(`
        SELECT AVG(processed_at - created_at) as avg
        FROM event_queue
        WHERE status = 'completed' AND processed_at IS NOT NULL
      `)
      .get() as { avg: number | null };

    return {
      total_events: total.count,
      pending_events: pending.count,
      failed_events: failed.count,
      processed_today: processedToday.count,
      average_processing_time_ms: avgTime.avg ?? 0,
    };
  }

  /**
   * Optimize tables for sites that have had events
   * Performs compaction, cleanup, and incremental index updates
   */
  private async optimizeTables(): Promise<void> {
    if (!this.vectorStore || this.sitesToOptimize.size === 0) {
      return;
    }

    const sites = Array.from(this.sitesToOptimize);
    this.logger.debug(`[EventProcessor] Optimizing tables for sites: ${sites.join(', ')}`);

    for (const siteId of sites) {
      try {
        await this.vectorStore.optimize(siteId);
        this.logger.debug(`[EventProcessor] Optimized table for ${siteId}`);
      } catch (error) {
        this.logger.error(`[EventProcessor] Failed to optimize ${siteId}:`, error);
      }
    }

    // Reset counters
    this.eventsSinceOptimize = 0;
    this.sitesToOptimize.clear();
  }
}
