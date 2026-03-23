/**
 * Integration tests for Event Tracking IPC handlers (Sprint 1)
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GraphService } from '../../src/main/events/GraphService';
import { EventProcessor } from '../../src/main/events/EventProcessor';
import { VectorStore } from '../../src/main/vector-store/VectorStore';
import { EmbeddingService } from '../../src/main/embeddings/EmbeddingService';
import { IPC_CHANNELS } from '../../src/common/constants';
import type { EventTimelineEntry, EventStats } from '../../src/common/types';

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'models', 'all-MiniLM-L6-v2-quantized');

/**
 * Mock ipcMain that stores handlers we can call manually
 */
class MockIpcMain {
  private handlers: Map<string, Function> = new Map();
  private syncHandlers: Map<string, Function> = new Map();

  handle(channel: string, handler: Function) {
    this.handlers.set(channel, handler);
  }

  on(channel: string, handler: Function) {
    this.syncHandlers.set(channel, handler);
  }

  async invokeHandler(channel: string, ...args: any[]): Promise<any> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }

  hasHandler(channel: string): boolean {
    return this.handlers.has(channel) || this.syncHandlers.has(channel);
  }
}

// Mock electron before importing ipc-handlers
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({
  ipcMain: mockIpc,
}));

// NOW import the module that depends on electron
import { registerIpcHandlers, IpcHandlerDeps } from '../../src/main/ipc-handlers';

describe('Event Tracking IPC Handlers (Sprint 1)', () => {
  let tmpDir: string;
  let graphDbPath: string;
  let vectorDbPath: string;
  let graphService: GraphService;
  let eventProcessor: EventProcessor;
  let vectorStore: VectorStore;
  let embeddingService: EmbeddingService;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ipc-events-'));
    graphDbPath = path.join(tmpDir, 'graph.db');
    vectorDbPath = path.join(tmpDir, 'vectors');

    // Initialize services
    graphService = new GraphService(graphDbPath);
    await graphService.initialize();

    vectorStore = new VectorStore(vectorDbPath);
    await vectorStore.initialize();

    embeddingService = new EmbeddingService(MODELS_DIR);
    await embeddingService.initialize();

    eventProcessor = new EventProcessor({
      graphService,
      vectorStore,
      embeddingService,
      logger: console,
    });
    await eventProcessor.initialize();

    // Create mock dependencies
    const mockSiteData = {
      getSite: (id: string) => ({ id, name: `Site ${id}`, domain: `${id}.local` }),
      getSites: () => ({}),
    };

    const mockBridge = {
      getAllSiteStatuses: () => ({}),
      isCAPIAvailable: () => false,
      startSite: async () => {},
      stopSite: async () => {},
    };

    const mockRegistry = {
      listAll: () => [],
      get: () => null,
      update: () => {},
    };

    const mockContentPipeline = {
      indexSite: async () => ({ documentsIndexed: 0, chunksIndexed: 0, durationMs: 0, errors: [] }),
    };

    const mockStorage = {
      get: () => null,
      set: () => {},
    };

    const deps: IpcHandlerDeps = {
      siteData: mockSiteData,
      localServicesBridge: mockBridge as any,
      indexRegistry: mockRegistry as any,
      embeddingService,
      contentPipeline: mockContentPipeline as any,
      vectorStore,
      registryStorage: mockStorage,
      localLogger: console,
      getMcpServer: () => null,
      graphService,
      eventProcessor,
      vectorDbPath,
    };

    // Register handlers
    registerIpcHandlers(deps);
  }, 120000);

  afterAll(async () => {
    await graphService?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Clean up database after each test
  afterEach(async () => {
    const db = (graphService as any).db;
    db.prepare('DELETE FROM event_queue').run();
    db.prepare('DELETE FROM sites').run();
  });

  describe('EVENTS_GET_TIMELINE', () => {
    beforeEach(async () => {
      // Insert test site
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should return empty timeline when no events', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE);

      expect(result.success).toBe(true);
      expect(result.events).toEqual([]);
    });

    test('should return timeline with events', async () => {
      // Insert events directly into graph service
      const db = (graphService as any).db;
      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({ slug: 'akismet' }), 'processed', Date.now());

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE);

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventType).toBe('plugin_activated');
      expect(result.events[0].siteName).toBe('Site test-site');
      expect(result.events[0].summary).toContain('Plugin Activated');
    });

    test('should filter by event type', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({ slug: 'test' }), 'processed', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({ post_id: 1 }), 'processed', now + 1000);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE, {
        filter: 'plugin_activated',
      });

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventType).toBe('plugin_activated');
    });

    test('should filter by status', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({}), 'pending', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_updated', JSON.stringify({}), 'processed', now + 1000);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE, {
        status: 'pending',
      });

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].status).toBe('pending');
    });

    test('should respect limit parameter', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run('test-site', 'post_created', JSON.stringify({ post_id: i }), 'processed', now + i);
      }

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE, {
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.events).toHaveLength(5);
    });
  });

  describe('EVENTS_GET_STATS', () => {
    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should return stats with zero counts when no events', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.total).toBe(0);
      expect(result.stats.today).toBe(0);
      expect(result.stats.yesterday).toBe(0);
      expect(result.stats.pending).toBe(0);
      expect(result.stats.failed).toBe(0);
      expect(result.stats.healthStatus).toBe('good');
    });

    test('should count events correctly', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      // Add events
      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({}), 'processed', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({}), 'pending', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count, error)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('test-site', 'user_created', JSON.stringify({}), 'failed', now, 'Test error');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.total).toBe(3);
      expect(result.stats.pending).toBe(1);
      expect(result.stats.failed).toBe(1);
    });

    test('should set health status to error when failed events exist', async () => {
      const db = (graphService as any).db;

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count, error)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('test-site', 'post_created', JSON.stringify({}), 'failed', Date.now(), 'Error');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.healthStatus).toBe('error');
    });

    test('should set health status to warning when many pending events', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      for (let i = 0; i < 15; i++) {
        db.prepare(`
          INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run('test-site', 'post_created', JSON.stringify({}), 'pending', now + i);
      }

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.pending).toBe(15);
      expect(result.stats.healthStatus).toBe('warning');
    });

    test('should group events by type', async () => {
      const db = (graphService as any).db;
      const now = Date.now();

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({}), 'processed', now);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'plugin_activated', JSON.stringify({}), 'processed', now + 1000);

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({}), 'processed', now + 2000);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_GET_STATS);

      expect(result.success).toBe(true);
      expect(result.stats.byType.plugin_activated).toBe(2);
      expect(result.stats.byType.post_created).toBe(1);
    });
  });

  describe('STORAGE_GET_HEALTH', () => {
    test('should return storage health metrics', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.STORAGE_GET_HEALTH);

      expect(result.success).toBe(true);
      expect(result.health).toBeDefined();
      expect(result.health.graph_db).toBeDefined();
      expect(result.health.vector_db).toBeDefined();
      expect(typeof result.health.graph_db.size_bytes).toBe('number');
      expect(typeof result.health.pending_events).toBe('number');
      expect(typeof result.health.failed_events).toBe('number');
    });
  });

  describe('ISSUES_DETECT', () => {
    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should return empty issues when everything is healthy', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.ISSUES_DETECT);

      expect(result.success).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test('should detect failed events', async () => {
      const db = (graphService as any).db;

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count, error)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('test-site', 'post_created', JSON.stringify({}), 'failed', Date.now(), 'Test error');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.ISSUES_DETECT);

      expect(result.success).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      const failedIssue = result.issues.find((i: any) => i.type === 'failed_events');
      expect(failedIssue).toBeDefined();
      expect(failedIssue.severity).toBe('error');
    });

    test('should detect stale sites', async () => {
      const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);

      await graphService.upsertSite({
        id: 'stale-site',
        name: 'Stale Site',
        domain: 'stale.local',
        is_active: true,
        last_sync_at: eightDaysAgo,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.ISSUES_DETECT);

      expect(result.success).toBe(true);
      const staleIssue = result.issues.find((i: any) => i.type === 'stale_sites');
      expect(staleIssue).toBeDefined();
      expect(staleIssue.severity).toBe('warning');
    });
  });

  describe('STORAGE_CLEANUP', () => {
    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should cleanup old events', async () => {
      const db = (graphService as any).db;
      const now = Date.now();
      const fortyDaysAgo = now - (40 * 24 * 60 * 60 * 1000);

      // Insert old event
      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_created', JSON.stringify({}), 'processed', fortyDaysAgo);

      // Insert recent event
      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run('test-site', 'post_updated', JSON.stringify({}), 'processed', now);

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.STORAGE_CLEANUP, {
        retentionDays: 30,
      });

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(1);

      // Verify recent event still exists
      const remaining = db.prepare('SELECT COUNT(*) as count FROM event_queue').get() as any;
      expect(remaining.count).toBe(1);
    });

    test('should use default retention of 30 days', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.STORAGE_CLEANUP);

      expect(result.success).toBe(true);
      expect(typeof result.deletedCount).toBe('number');
    });
  });

  describe('EVENTS_RETRY_FAILED', () => {
    beforeEach(async () => {
      await graphService.upsertSite({
        id: 'test-site',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    test('should return zero when no failed events', async () => {
      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_RETRY_FAILED);

      expect(result.success).toBe(true);
      expect(result.retriedCount).toBe(0);
    });

    test('should retry failed events', async () => {
      const db = (graphService as any).db;

      db.prepare(`
        INSERT INTO event_queue (site_id, event_type, payload, status, created_at, retry_count, error)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('test-site', 'post_created', JSON.stringify({}), 'failed', Date.now(), 'Test error');

      const result = await mockIpc.invokeHandler(IPC_CHANNELS.EVENTS_RETRY_FAILED);

      expect(result.success).toBe(true);
      expect(result.retriedCount).toBe(1);
    });
  });

  test('All 6 Sprint 1 IPC channels are registered', () => {
    expect(mockIpc.hasHandler(IPC_CHANNELS.EVENTS_GET_TIMELINE)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.EVENTS_GET_STATS)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.STORAGE_GET_HEALTH)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.ISSUES_DETECT)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.STORAGE_CLEANUP)).toBe(true);
    expect(mockIpc.hasHandler(IPC_CHANNELS.EVENTS_RETRY_FAILED)).toBe(true);
  });
});
