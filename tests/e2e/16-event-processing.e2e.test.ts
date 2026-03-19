/**
 * E2E tests for WordPress event processing
 *
 * Tests the full flow: WordPress sends event → HTTP interface → Event processor → Graph + Embeddings
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { getClient, getTestSite, expectSuccess, waitFor } from './helpers/environment';
import type { McpClient } from './helpers/client';

describe('Event Processing E2E', () => {
  let client: McpClient;
  let siteName: string;
  let siteId: string;
  let eventEndpoint: string;
  let authToken: string;

  beforeAll(async () => {
    client = getClient();
    const site = getTestSite();
    siteName = site.name;
    siteId = site.id;

    // Get event endpoint connection info
    const result = await client.callTool('get_event_endpoint_info', {});
    expectSuccess(result);

    const info = result.content[0].text;
    const parsed = JSON.parse(info);
    eventEndpoint = parsed.url;
    authToken = parsed.authToken;
  }, 30000);

  describe('WordPress to Local event flow', () => {
    it('should receive and process post_created event', async () => {
      // Step 1: Simulate WordPress sending event
      const event = {
        site_id: siteId,
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 9001,
          post_type: 'post',
          title: 'E2E Test Post',
          content: 'This post was created by an E2E test to verify event processing',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      };

      const response = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(event),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.event_id).toBeGreaterThan(0);

      // Step 2: Wait for event to be processed
      // Note: We can't check failed_events === 0 globally because old test runs may have failures
      // Instead, just wait for pending to clear (events are either completed or failed)
      await waitFor(async () => {
        const statsResult = await client.callTool('get_event_processor_stats', {});
        expectSuccess(statsResult);

        const stats = JSON.parse(statsResult.content[0].text);
        return stats.pending_events === 0;
      }, 10000, 500);

      // Step 3: Verify content was stored in graph
      const graphResult = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: 9001,
      });
      expectSuccess(graphResult);

      const content = JSON.parse(graphResult.content[0].text);
      if (content === null) {
        // Debug: try list_graph_content to see what's actually there
        const listResult = await client.callTool('list_graph_content', {
          site: siteName,
        });
        const allContent = JSON.parse(listResult.content[0].text);
        console.log(`[DEBUG] get_graph_content returned null for site="${siteName}" post_id=9001`);
        console.log(`[DEBUG] list_graph_content found ${allContent.length} items:`, allContent.slice(0, 3).map((c: any) => `post_id=${c.post_id}`));
        console.log(`[DEBUG] siteId="${siteId}", siteName="${siteName}"`);
      }
      expect(content).not.toBeNull();
      expect(content.title).toBe('E2E Test Post');
      expect(content.post_id).toBe(9001);

      // Step 4: Verify embedding was created and searchable
      const searchResult = await client.callTool('search_site_content', {
        site: siteName,
        query: 'verify event processing',
        limit: 20,
      });
      expectSuccess(searchResult);

      const searchText = searchResult.content[0].text;
      expect(searchText).toContain('Found');
      expect(searchText).toMatch(/Post ID:/); // Verify search returns posts
    }, 30000);

    it('should receive and process post_updated event', async () => {
      // Create initial post
      const createEvent = {
        site_id: siteId,
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: 9002,
          post_type: 'post',
          title: 'Original Title',
          content: 'Original content',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      };

      await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(createEvent),
      });

      // Wait for processing
      await waitFor(async () => {
        const stats = await fetch(`${eventEndpoint}/wp-events/stats`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        const data = await stats.json();
        return data.pending_events === 0;
      }, 5000);

      // Update the post
      const updateEvent = {
        site_id: siteId,
        event_type: 'post_updated',
        timestamp: Date.now() + 1000,
        payload: {
          post_id: 9002,
          post_type: 'post',
          title: 'Updated Title',
          content: 'Updated content with new information',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now() + 1000,
        },
      };

      const response = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(updateEvent),
      });

      expect(response.status).toBe(200);

      // Wait for processing
      await waitFor(async () => {
        const stats = await fetch(`${eventEndpoint}/wp-events/stats`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        const data = await stats.json();
        return data.pending_events === 0;
      }, 5000);

      // Verify update
      const graphResult = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: 9002,
      });
      expectSuccess(graphResult);

      const content = JSON.parse(graphResult.content[0].text);
      expect(content.title).toBe('Updated Title');
    }, 30000);

    it('should receive and process plugin_activated event', async () => {
      const event = {
        site_id: siteId,
        event_type: 'plugin_activated',
        timestamp: Date.now(),
        payload: {
          slug: 'e2e-test-plugin',
          name: 'E2E Test Plugin',
          version: '1.0.0',
          is_active: true,
          author: 'E2E Test',
          description: 'Plugin for E2E testing',
        },
      };

      const response = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(event),
      });

      expect(response.status).toBe(200);

      // Wait for processing
      await waitFor(async () => {
        const stats = await fetch(`${eventEndpoint}/wp-events/stats`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        const data = await stats.json();
        return data.pending_events === 0;
      }, 5000);

      // Verify plugin in graph
      const graphResult = await client.callTool('get_graph_plugin', {
        site: siteName,
        slug: 'e2e-test-plugin',
      });
      expectSuccess(graphResult);

      const plugin = JSON.parse(graphResult.content[0].text);
      expect(plugin).not.toBeNull();
      expect(plugin.name).toBe('E2E Test Plugin');
      expect(plugin.is_active).toBe(true);
    }, 30000);
  });

  describe('Event processing statistics', () => {
    it('should track events via stats endpoint', async () => {
      const response = await fetch(`${eventEndpoint}/wp-events/stats`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const stats = await response.json();

      expect(stats).toHaveProperty('total_events');
      expect(stats).toHaveProperty('pending_events');
      expect(stats).toHaveProperty('failed_events');
      expect(stats).toHaveProperty('processed_today');
      expect(stats.total_events).toBeGreaterThan(0);
    });

    it('should track events via MCP tool', async () => {
      const result = await client.callTool('get_event_processor_stats', {});
      expectSuccess(result);

      const stats = JSON.parse(result.content[0].text);
      expect(stats.total_events).toBeGreaterThan(0);
    });
  });

  describe('Graph queries after events', () => {
    it('should list all content for a site', async () => {
      const result = await client.callTool('list_graph_content', {
        site: siteName,
      });
      expectSuccess(result);

      const content = JSON.parse(result.content[0].text);
      expect(Array.isArray(content)).toBe(true);
      expect(content.length).toBeGreaterThan(0);
    });

    it('should list all plugins for a site', async () => {
      const result = await client.callTool('list_graph_plugins', {
        site: siteName,
      });
      expectSuccess(result);

      const plugins = JSON.parse(result.content[0].text);
      expect(Array.isArray(plugins)).toBe(true);
    });

    it('should get graph statistics', async () => {
      const result = await client.callTool('get_graph_stats', {
        site: siteName,
      });
      expectSuccess(result);

      const stats = JSON.parse(result.content[0].text);
      expect(stats).toHaveProperty('total_content');
      expect(stats).toHaveProperty('total_plugins');
      expect(stats).toHaveProperty('storage_size_bytes');
    });
  });

  describe('Error handling', () => {
    it('should reject event without auth token', async () => {
      const response = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          site_id: siteId,
          event_type: 'post_created',
          timestamp: Date.now(),
          payload: {},
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should reject event with invalid payload', async () => {
      const response = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          site_id: siteId,
          event_type: 'post_created',
          timestamp: Date.now(),
          payload: {
            // Missing required fields
          },
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle malformed JSON', async () => {
      const response = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: 'not-valid-json',
      });

      expect(response.status).toBe(400);
    });
  });
});
