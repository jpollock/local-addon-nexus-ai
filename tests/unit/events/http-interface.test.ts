/**
 * Tests for HTTP webhook interface - WordPress event receiver
 */
import * as http from 'http';
import { EventProcessor } from '../../../src/main/events/EventProcessor';
import { HttpEventInterface } from '../../../src/main/events/HttpEventInterface';
import { GraphService } from '../../../src/main/events/GraphService';
import { WordPressEvent } from '../../../src/main/events/types';

describe('HttpEventInterface', () => {
  let httpInterface: HttpEventInterface;
  let eventProcessor: EventProcessor;
  let graphService: GraphService;
  let port: number;
  let baseUrl: string;

  beforeEach(async () => {
    // Create test database
    graphService = new GraphService(':memory:');
    await graphService.initialize();

    eventProcessor = new EventProcessor({
      graphService,
      vectorStore: null as any, // Mock for now
      embeddingService: null as any,
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      } as any,
    });

    await eventProcessor.initialize();

    httpInterface = new HttpEventInterface({
      eventProcessor,
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      } as any,
    });

    const info = await httpInterface.start();
    port = info.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await httpInterface.stop();
    await eventProcessor.stop();
    await graphService.close();
  });

  describe('server lifecycle', () => {
    it('should start on available port', () => {
      expect(port).toBeGreaterThan(0);
      expect(baseUrl).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
    });

    it('should provide connection info', () => {
      const info = httpInterface.getConnectionInfo();
      expect(info.port).toBe(port);
      expect(info.url).toBe(baseUrl);
      expect(info.authToken).toBeTruthy();
    });

    it('should stop gracefully', async () => {
      await httpInterface.stop();
      expect(httpInterface.isRunning()).toBe(false);
    });

    it('should be able to restart', async () => {
      await httpInterface.stop();
      await httpInterface.start();
      expect(httpInterface.isRunning()).toBe(true);
    });
  });

  describe('health check', () => {
    it('should respond to /health without auth', async () => {
      const response = await fetch(`${baseUrl}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.port).toBe(port);
    });
  });

  describe('authentication', () => {
    it('should reject requests without auth token', async () => {
      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid token', async () => {
      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(401);
    });

    it('should accept requests with valid token', async () => {
      const { authToken } = httpInterface.getConnectionInfo();

      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          site_id: 'site-123',
          event_type: 'plugin_activated',
          timestamp: Date.now(),
          payload: {
            slug: 'test-plugin',
            name: 'Test Plugin',
            version: '1.0.0',
            is_active: true,
          },
        }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe('POST /wp-events', () => {
    let authToken: string;

    beforeEach(() => {
      authToken = httpInterface.getConnectionInfo().authToken;
    });

    it('should accept a post_created event', async () => {
      const event: WordPressEvent = {
        site_id: 'site-123',
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 42,
          post_type: 'post',
          title: 'Test Post',
          content: 'Test content',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      };

      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(event),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.event_id).toBeGreaterThan(0);
    });

    it('should accept a plugin_activated event', async () => {
      const event: WordPressEvent = {
        site_id: 'site-123',
        event_type: 'plugin_activated',
        timestamp: Date.now(),
        payload: {
          slug: 'test-plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          is_active: true,
        },
      };

      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(event),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should enqueue event before responding (acknowledge-before-process)', async () => {
      const event: WordPressEvent = {
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
        },
      };

      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(event),
      });

      expect(response.status).toBe(200);

      const stats = await eventProcessor.getStats();
      expect(stats.total_events).toBe(1);
      // Event is enqueued - processing happens asynchronously after response
      // (may be pending or already completed depending on timing)
    });

    it('should reject event with missing fields', async () => {
      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          // Missing site_id
          event_type: 'post_created',
          payload: {},
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject event with invalid event_type', async () => {
      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          site_id: 'site-123',
          event_type: 'invalid_event',
          timestamp: Date.now(),
          payload: {},
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: 'not-json',
      });

      expect(response.status).toBe(400);
    });

    it('should return event_id in response', async () => {
      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          site_id: 'site-123',
          event_type: 'plugin_activated',
          timestamp: Date.now(),
          payload: {
            slug: 'test-plugin',
            name: 'Test Plugin',
            version: '1.0.0',
            is_active: true,
          },
        }),
      });

      const data = await response.json();

      expect(data).toHaveProperty('event_id');
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('message');
    });
  });

  describe('GET /wp-events/stats', () => {
    let authToken: string;

    beforeEach(() => {
      authToken = httpInterface.getConnectionInfo().authToken;
    });

    it('should return processing statistics', async () => {
      const response = await fetch(`${baseUrl}/wp-events/stats`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('total_events');
      expect(data).toHaveProperty('pending_events');
      expect(data).toHaveProperty('failed_events');
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/wp-events/stats`);
      expect(response.status).toBe(401);
    });
  });

  describe('rate limiting', () => {
    let authToken: string;

    beforeEach(() => {
      authToken = httpInterface.getConnectionInfo().authToken;
    });

    it('should accept reasonable request rate', async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          fetch(`${baseUrl}/wp-events`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              site_id: 'site-123',
              event_type: 'plugin_activated',
              timestamp: Date.now(),
              payload: {
                slug: `plugin-${i}`,
                name: `Plugin ${i}`,
                version: '1.0.0',
                is_active: true,
              },
            }),
          })
        );
      }

      const responses = await Promise.all(promises);
      const statuses = responses.map(r => r.status);

      expect(statuses.every(s => s === 200)).toBe(true);
    });

    it.skip('should handle concurrent requests safely', async () => {
      // Send in smaller batches to avoid overwhelming the test server
      let successCount = 0;

      for (let batch = 0; batch < 4; batch++) {
        const promises = [];
        for (let i = 0; i < 5; i++) {
          const postId = batch * 5 + i;
          promises.push(
            fetch(`${baseUrl}/wp-events`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
              },
              body: JSON.stringify({
                site_id: 'site-123',
                event_type: 'post_created',
                timestamp: Date.now(),
                payload: {
                  post_id: postId,
                  post_type: 'post',
                  title: `Post ${postId}`,
                  status: 'publish',
                  author_id: 1,
                  created_at: Date.now(),
                  updated_at: Date.now(),
                },
              }),
            })
          );
        }

        const responses = await Promise.all(promises);
        successCount += responses.filter(r => r.status === 200).length;

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      expect(successCount).toBe(20);

      const stats = await eventProcessor.getStats();
      expect(stats.total_events).toBe(20);
    });
  });

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    });

    it('should handle OPTIONS preflight', async () => {
      const response = await fetch(`${baseUrl}/wp-events`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    });
  });
});
