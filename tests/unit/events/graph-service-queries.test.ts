/**
 * Unit tests for GraphService query methods (Sprint 1)
 */
import { GraphService } from '../../../src/main/events/GraphService';
import { EventQueueEntry, EventStatsData, StorageHealthData, IssueData } from '../../../src/main/events/types';
import * as fs from 'fs';
import * as path from 'path';

describe('GraphService - Query Methods (Sprint 1)', () => {
  let service: GraphService;
  let testDbPath: string;

  beforeEach(async () => {
    // Use unique in-memory DB for each test
    testDbPath = `:memory:`;
    service = new GraphService(testDbPath);
    await service.initialize();
  });

  afterEach(async () => {
    await service.close();
  });

  describe('getRecentEvents', () => {
    beforeEach(async () => {
      // Insert test sites
      await service.upsertSite({
        id: 'site1',
        name: 'Test Site 1',
        domain: 'test1.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      await service.upsertSite({
        id: 'site2',
        name: 'Test Site 2',
        domain: 'test2.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    it('should return recent events in descending order', async () => {
      // Insert events with different timestamps
      const now = Date.now();

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: { slug: 'test-plugin' },
        created_at: now - 3000,
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: { post_id: 1, title: 'Test Post' },
        created_at: now - 1000,
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site2',
        event_type: 'user_created',
        payload: { user_id: 1, username: 'testuser' },
        created_at: now,
        status: 'pending',
      });

      const events = await service.getRecentEvents();

      expect(events).toHaveLength(3);
      expect(events[0].event_type).toBe('user_created'); // Most recent
      expect(events[1].event_type).toBe('post_created');
      expect(events[2].event_type).toBe('plugin_activated'); // Oldest
    });

    it('should respect limit parameter', async () => {
      // Insert 10 events
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        await insertEvent(service, {
          site_id: 'site1',
          event_type: 'post_created',
          payload: { post_id: i },
          created_at: now + i,
          status: 'processed',
        });
      }

      const events = await service.getRecentEvents({ limit: 5 });

      expect(events).toHaveLength(5);
    });

    it('should filter by event type', async () => {
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'plugin_deactivated',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      const events = await service.getRecentEvents({ filter: 'plugin_activated' });

      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('plugin_activated');
    });

    it('should filter by status', async () => {
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: {},
        created_at: Date.now(),
        status: 'pending',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_updated',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_deleted',
        payload: {},
        created_at: Date.now(),
        status: 'failed',
      });

      const pending = await service.getRecentEvents({ status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('pending');

      const processed = await service.getRecentEvents({ status: 'processed' });
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('processed');

      const failed = await service.getRecentEvents({ status: 'failed' });
      expect(failed).toHaveLength(1);
      expect(failed[0].status).toBe('failed');
    });

    it('should filter by site_id', async () => {
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site2',
        event_type: 'post_created',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      const events = await service.getRecentEvents({ siteId: 'site1' });

      expect(events).toHaveLength(1);
      expect(events[0].site_id).toBe('site1');
    });

    it('should parse JSON payload', async () => {
      const payload = { post_id: 123, title: 'Test Post', author_id: 1 };

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload,
        created_at: Date.now(),
        status: 'processed',
      });

      const events = await service.getRecentEvents();

      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual(payload);
      expect(typeof events[0].payload).toBe('object');
    });

    it('should handle empty result', async () => {
      const events = await service.getRecentEvents();
      expect(events).toEqual([]);
    });

    it('should combine multiple filters', async () => {
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: {},
        created_at: Date.now(),
        status: 'pending',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site2',
        event_type: 'plugin_activated',
        payload: {},
        created_at: Date.now(),
        status: 'pending',
      });

      const events = await service.getRecentEvents({
        siteId: 'site1',
        filter: 'plugin_activated',
        status: 'pending',
      });

      expect(events).toHaveLength(1);
      expect(events[0].site_id).toBe('site1');
      expect(events[0].event_type).toBe('plugin_activated');
      expect(events[0].status).toBe('pending');
    });
  });

  describe('getEventStats', () => {
    beforeEach(async () => {
      await service.upsertSite({
        id: 'site1',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    it('should return event statistics', async () => {
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);

      // Today's events
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: {},
        created_at: now - 1000,
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: {},
        created_at: now - 2000,
        status: 'processed',
      });

      // Yesterday's events
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'user_created',
        payload: {},
        created_at: oneDayAgo,
        status: 'processed',
      });

      // Pending and failed
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_updated',
        payload: {},
        created_at: now,
        status: 'pending',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_deleted',
        payload: {},
        created_at: now,
        status: 'failed',
      });

      const stats = await service.getEventStats();

      expect(stats.total).toBe(5);
      expect(stats.pending).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.today).toBeGreaterThanOrEqual(3); // At least the 3 from today
      expect(stats.yesterday).toBeGreaterThanOrEqual(1);
    });

    it('should group events by type', async () => {
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: {},
        created_at: Date.now(),
        status: 'processed',
      });

      const stats = await service.getEventStats();

      expect(stats.by_type.plugin_activated).toBe(2);
      expect(stats.by_type.post_created).toBe(1);
    });

    it('should handle empty database', async () => {
      const stats = await service.getEventStats();

      expect(stats.total).toBe(0);
      expect(stats.today).toBe(0);
      expect(stats.yesterday).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.failed).toBe(0);
      expect(Object.keys(stats.by_type).length).toBe(0);
    });
  });

  describe('getStorageHealth', () => {
    beforeEach(async () => {
      await service.upsertSite({
        id: 'site1',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    it('should return storage health metrics', async () => {
      const now = Date.now();

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: { post_id: 1 },
        created_at: now - 10000,
        status: 'processed',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'plugin_activated',
        payload: { slug: 'test' },
        created_at: now,
        status: 'pending',
      });

      const health = await service.getStorageHealth('/fake/vector/path');

      expect(health.graph_db.event_count).toBe(2);
      expect(health.graph_db.size_bytes).toBeGreaterThanOrEqual(0); // In-memory DB has size 0
      expect(health.graph_db.oldest_event).toBe(now - 10000);
      expect(health.graph_db.newest_event).toBe(now);
      expect(health.pending_events).toBe(1);
      expect(health.failed_events).toBe(0);
      expect(health.vector_db.path).toBe('/fake/vector/path');
    });

    it('should handle empty event queue', async () => {
      const health = await service.getStorageHealth('/fake/vector/path');

      expect(health.graph_db.event_count).toBe(0);
      expect(health.graph_db.oldest_event).toBeNull();
      expect(health.graph_db.newest_event).toBeNull();
      expect(health.pending_events).toBe(0);
      expect(health.failed_events).toBe(0);
    });

    it('should count failed events', async () => {
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: {},
        created_at: Date.now(),
        status: 'failed',
        error: 'Test error',
      });

      const health = await service.getStorageHealth('/fake/vector/path');

      expect(health.failed_events).toBe(1);
      expect(health.pending_events).toBe(0);
    });
  });

  describe('detectIssues', () => {
    beforeEach(async () => {
      await service.upsertSite({
        id: 'site1',
        name: 'Test Site',
        domain: 'test.local',
        is_active: true,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    });

    it('should detect failed events', async () => {
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: {},
        created_at: Date.now(),
        status: 'failed',
        error: 'Database connection failed',
      });

      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_updated',
        payload: {},
        created_at: Date.now(),
        status: 'failed',
        error: 'Another error',
      });

      const issues = await service.detectIssues();

      const failedIssue = issues.find((i: IssueData) => i.type === 'failed_events');
      expect(failedIssue).toBeDefined();
      expect(failedIssue?.severity).toBe('error');
      expect(failedIssue?.count).toBe(2);
    });

    it('should detect stale sites', async () => {
      const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);

      await service.upsertSite({
        id: 'stale-site',
        name: 'Stale Site',
        domain: 'stale.local',
        is_active: true,
        last_sync_at: eightDaysAgo,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      const issues = await service.detectIssues();

      const staleIssue = issues.find((i: IssueData) => i.type === 'stale_sites');
      expect(staleIssue).toBeDefined();
      expect(staleIssue?.severity).toBe('warning');
      expect(staleIssue?.count).toBeGreaterThan(0);
    });

    it('should return empty array when no issues', async () => {
      const issues = await service.detectIssues();
      expect(issues).toEqual([]);
    });

    it('should not report pending events as issues', async () => {
      await insertEvent(service, {
        site_id: 'site1',
        event_type: 'post_created',
        payload: {},
        created_at: Date.now(),
        status: 'pending',
      });

      const issues = await service.detectIssues();

      const pendingIssue = issues.find((i: IssueData) => i.type === 'pending_events');
      expect(pendingIssue).toBeUndefined();
    });
  });
});

// Helper function to insert events into event_queue
async function insertEvent(
  service: GraphService,
  event: {
    site_id: string;
    event_type: string;
    payload: any;
    created_at: number;
    status: string;
    processed_at?: number;
    error?: string;
  }
): Promise<void> {
  // Access private db through any cast (for testing)
  const db = (service as any).db;

  db.prepare(`
    INSERT INTO event_queue (site_id, event_type, payload, status, created_at, processed_at, error, retry_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    event.site_id,
    event.event_type,
    JSON.stringify(event.payload),
    event.status,
    event.created_at,
    event.processed_at ?? null,
    event.error ?? null
  );
}
