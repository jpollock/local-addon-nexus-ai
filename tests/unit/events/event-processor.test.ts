/**
 * Tests for EventProcessor - processes WordPress events and updates graph
 */
import * as path from 'path';
import * as fs from 'fs';
import { EventProcessor } from '../../../src/main/events/EventProcessor';
import { GraphService } from '../../../src/main/events/GraphService';
import { VectorStore } from '../../../src/main/vector-store/VectorStore';
import { EmbeddingService } from '../../../src/main/embeddings/EmbeddingService';
import {
  WordPressEvent,
  PostEventPayload,
  PluginEventPayload,
  EventProcessorStats,
} from '../../../src/main/events/types';

describe('EventProcessor', () => {
  let processor: EventProcessor;
  let graphService: GraphService;
  let vectorStore: VectorStore;
  let embeddingService: EmbeddingService;
  let testDbPath: string;
  let testVectorPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-events-${Date.now()}.db`);
    testVectorPath = path.join(__dirname, `test-vectors-${Date.now()}`);

    graphService = new GraphService(testDbPath);
    await graphService.initialize();

    // Mock VectorStore and EmbeddingService for faster tests
    vectorStore = {
      initialize: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue([
        {
          id: 'wp_site-123_42',
          siteId: 'site-123',
          postId: 42,
          title: 'Test Post',
          content: 'This is test content about WordPress',
          postType: 'post',
          chunkIndex: 0,
          vector: new Float32Array(384),
          metadata: '{}',
          indexedAt: Date.now(),
          distance: 0.1,
        },
      ]),
    } as any;

    embeddingService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      embed: jest.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
    } as any;

    processor = new EventProcessor({
      graphService,
      vectorStore,
      embeddingService,
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      } as any,
    });

    await processor.initialize();
  });

  afterEach(async () => {
    await processor.stop();
    await graphService.close();

    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('initialization', () => {
    it('should initialize event queue', async () => {
      const stats = await processor.getStats();
      expect(stats.total_events).toBe(0);
      expect(stats.pending_events).toBe(0);
    });

    it('should create event queue table', async () => {
      const tables = await graphService.listTables();
      expect(tables).toContain('event_queue');
    });
  });

  describe('event enqueueing', () => {
    it('should enqueue a post_created event', async () => {
      const event: WordPressEvent = {
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 42,
          post_type: 'post',
          title: 'Test Post',
          content: 'This is test content',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      };

      const id = await processor.enqueue(event);
      expect(id).toBeGreaterThan(0);

      const stats = await processor.getStats();
      expect(stats.total_events).toBe(1);
      expect(stats.pending_events).toBe(1);
    });

    it('should enqueue a plugin_activated event', async () => {
      const event: WordPressEvent = {
        site_id: 'site-123',
        event_type: 'plugin_activated',
        timestamp: Date.now(),
        payload: {
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          is_active: true,
          author: 'Test Author',
        } as PluginEventPayload,
      };

      const id = await processor.enqueue(event);
      expect(id).toBeGreaterThan(0);
    });

    it('should preserve event order', async () => {
      const event1: WordPressEvent = {
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 1,
          post_type: 'post',
          title: 'Post 1',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      };

      const event2: WordPressEvent = {
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now() + 1000,
        payload: {
          post_id: 2,
          post_type: 'post',
          title: 'Post 2',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      };

      const id1 = await processor.enqueue(event1);
      const id2 = await processor.enqueue(event2);

      expect(id2).toBeGreaterThan(id1);
    });
  });

  describe('event processing', () => {
    it('should process post_created event', async () => {
      const event: WordPressEvent = {
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 42,
          post_type: 'post',
          title: 'Test Post',
          content: 'This is test content about WordPress',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      };

      await processor.enqueue(event);
      await processor.processNext();

      // Verify content was stored in graph
      const content = await graphService.getContent('site-123', 42);
      expect(content).not.toBeNull();
      expect(content?.title).toBe('Test Post');

      // Verify embedding was created
      expect(vectorStore.upsert).toHaveBeenCalled();
      const upsertCall = (vectorStore.upsert as jest.Mock).mock.calls[0];
      expect(upsertCall[0]).toBe('site-123'); // siteId
      expect(upsertCall[1][0].postId).toBe(42); // document
    });

    it('should process post_updated event', async () => {
      // First create the post
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 42,
          post_type: 'post',
          title: 'Original Title',
          content: 'Original content',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      });

      await processor.processNext();

      // Then update it
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'post_updated',
        timestamp: Date.now() + 1000,
        payload: {
          post_id: 42,
          post_type: 'post',
          title: 'Updated Title',
          content: 'Updated content',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now() + 1000,
        } as PostEventPayload,
      });

      await processor.processNext();

      const content = await graphService.getContent('site-123', 42);
      expect(content?.title).toBe('Updated Title');
    });

    it('should process post_deleted event', async () => {
      // Create post
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 42,
          post_type: 'post',
          title: 'Test Post',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      });
      await processor.processNext();

      // Delete it
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'post_deleted',
        timestamp: Date.now() + 1000,
        payload: {
          post_id: 42,
          post_type: 'post',
          title: 'Test Post',
          status: 'trash',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      });
      await processor.processNext();

      const content = await graphService.getContent('site-123', 42);
      expect(content).toBeNull();
    });

    it('should process plugin_activated event', async () => {
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'plugin_activated',
        timestamp: Date.now(),
        payload: {
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          is_active: true,
          author: 'Test Author',
        } as PluginEventPayload,
      });

      await processor.processNext();

      const plugin = await graphService.getPlugin('site-123', 'test-plugin');
      expect(plugin).not.toBeNull();
      expect(plugin?.is_active).toBe(true);
    });

    it('should process plugin_deactivated event', async () => {
      // Activate plugin
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'plugin_activated',
        timestamp: Date.now(),
        payload: {
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          is_active: true,
        } as PluginEventPayload,
      });
      await processor.processNext();

      // Deactivate it
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'plugin_deactivated',
        timestamp: Date.now() + 1000,
        payload: {
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          is_active: false,
        } as PluginEventPayload,
      });
      await processor.processNext();

      const plugin = await graphService.getPlugin('site-123', 'test-plugin');
      expect(plugin?.is_active).toBe(false);
    });

    it('should mark event as completed after processing', async () => {
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'plugin_activated',
        timestamp: Date.now(),
        payload: {
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          is_active: true,
        } as PluginEventPayload,
      });

      await processor.processNext();

      const stats = await processor.getStats();
      expect(stats.pending_events).toBe(0);
      expect(stats.total_events).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should mark event as failed on processing error', async () => {
      // Enqueue event with invalid payload
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          // Missing required fields
          post_id: 42,
        } as any,
      });

      await processor.processNext();

      const stats = await processor.getStats();
      expect(stats.failed_events).toBe(1);
    });

    it('should retry failed events', async () => {
      // Mock temporary failure
      let callCount = 0;
      jest.spyOn(graphService, 'upsertContent').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Temporary failure');
        return 1;
      });

      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 42,
          post_type: 'post',
          title: 'Test Post',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      });

      await processor.processNext(); // First attempt fails
      await processor.retryFailed();  // Retry

      expect(callCount).toBe(2);
      const stats = await processor.getStats();
      expect(stats.failed_events).toBe(0);
    });

    it('should limit retry attempts', async () => {
      jest.spyOn(graphService, 'upsertContent').mockRejectedValue(new Error('Permanent failure'));

      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 42,
          post_type: 'post',
          title: 'Test Post',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      });

      for (let i = 0; i < 5; i++) {
        await processor.processNext();
        await processor.retryFailed();
      }

      const stats = await processor.getStats();
      expect(stats.failed_events).toBe(1);
    });
  });

  describe('batch processing', () => {
    it('should process multiple events', async () => {
      for (let i = 1; i <= 5; i++) {
        await processor.enqueue({
          site_id: 'site-123',
          event_type: 'post_created',
          timestamp: Date.now() + i,
          payload: {
            post_id: i,
            post_type: 'post',
            title: `Post ${i}`,
            status: 'publish',
            author_id: 1,
            created_at: Date.now(),
            updated_at: Date.now(),
          } as PostEventPayload,
        });
      }

      await processor.processAll();

      const content = await graphService.listContent('site-123');
      expect(content.length).toBe(5);
    });

    it('should process events in FIFO order', async () => {
      const titles: string[] = [];

      jest.spyOn(graphService, 'upsertContent').mockImplementation(async (content) => {
        titles.push(content.title);
        return 1;
      });

      for (let i = 1; i <= 3; i++) {
        await processor.enqueue({
          site_id: 'site-123',
          event_type: 'post_created',
          timestamp: Date.now() + i,
          payload: {
            post_id: i,
            post_type: 'post',
            title: `Post ${i}`,
            status: 'publish',
            author_id: 1,
            created_at: Date.now(),
            updated_at: Date.now(),
          } as PostEventPayload,
        });
      }

      await processor.processAll();

      expect(titles).toEqual(['Post 1', 'Post 2', 'Post 3']);
    });
  });

  describe('statistics', () => {
    it('should track processing stats', async () => {
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 1,
          post_type: 'post',
          title: 'Post 1',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      });

      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 2,
          post_type: 'post',
          title: 'Post 2',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        } as PostEventPayload,
      });

      await processor.processNext();

      const stats = await processor.getStats();
      expect(stats.total_events).toBe(2);
      expect(stats.pending_events).toBe(1);
      expect(stats.processed_today).toBe(1);
    });

    it('should track average processing time', async () => {
      await processor.enqueue({
        site_id: 'site-123',
        event_type: 'plugin_activated',
        timestamp: Date.now(),
        payload: {
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          is_active: true,
        } as PluginEventPayload,
      });

      await processor.processNext();

      const stats = await processor.getStats();
      // Processing time might be 0 in fast test environments
      expect(stats.average_processing_time_ms).toBeGreaterThanOrEqual(0);
      expect(stats.total_events).toBe(1);
      expect(stats.pending_events).toBe(0);
    });
  });
});
