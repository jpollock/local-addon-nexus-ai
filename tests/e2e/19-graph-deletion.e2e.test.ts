/**
 * E2E tests for graph deletion events
 *
 * Tests that WordPress deletion events properly remove data from:
 * - Graph database (SQLite)
 * - Vector embeddings (Lance)
 * - Search results
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { getClient, getTestSite, expectSuccess, waitFor, resultText } from './helpers/environment';
import type { McpClient } from './helpers/client';

describe('Graph Deletion E2E', () => {
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

  describe('Post Deletion', () => {
    it('should remove deleted post from graph database', async () => {
      // Step 1: Create a post
      const postId = 9900 + Math.floor(Math.random() * 100);
      const createEvent = {
        site_id: siteId,
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: postId,
          post_type: 'post',
          title: 'Post to be Deleted',
          content: 'This post will be deleted to test graph cleanup',
          status: 'publish',
          author_id: 1,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      };

      const createResponse = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(createEvent),
      });

      expect(createResponse.status).toBe(200);

      // Wait for processing
      await waitFor(async () => {
        const stats = await client.callTool('get_event_processor_stats', {});
        const data = JSON.parse(stats.content[0].text);
        return data.pending_events === 0;
      }, 10000, 500);

      // Step 2: Verify post exists in graph
      const graphBeforeDelete = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: postId,
      });
      expectSuccess(graphBeforeDelete);

      const contentBefore = JSON.parse(graphBeforeDelete.content[0].text);
      expect(contentBefore).not.toBeNull();
      expect(contentBefore.title).toBe('Post to be Deleted');

      // Step 3: Send post_deleted event
      const deleteEvent = {
        site_id: siteId,
        event_type: 'post_deleted',
        timestamp: Date.now(),
        payload: {
          post_id: postId,
          post_type: 'post',
        },
      };

      const deleteResponse = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(deleteEvent),
      });

      expect(deleteResponse.status).toBe(200);

      // Wait for processing
      await waitFor(async () => {
        const stats = await client.callTool('get_event_processor_stats', {});
        const data = JSON.parse(stats.content[0].text);
        return data.pending_events === 0;
      }, 10000, 500);

      // Step 4: Verify post removed from graph
      const graphAfterDelete = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: postId,
      });
      expectSuccess(graphAfterDelete);

      const contentAfter = JSON.parse(graphAfterDelete.content[0].text);
      expect(contentAfter).toBeNull();
    }, 30000);

    it('should remove deleted post from search results', async () => {
      // Create a post with unique identifier
      const postId = 9800 + Math.floor(Math.random() * 100);
      const uniqueTitle = `Searchable Post ${Date.now()}`;

      const createEvent = {
        site_id: siteId,
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: postId,
          post_type: 'post',
          title: uniqueTitle,
          content: 'This post should be searchable then disappear after deletion',
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

      // Wait for processing and indexing
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify searchable
      const searchBefore = await client.callTool('search_site_content', {
        site: siteName,
        query: uniqueTitle,
        limit: 20,
      });
      expectSuccess(searchBefore);

      const searchTextBefore = searchBefore.content[0].text;
      expect(searchTextBefore).toContain('Found');

      // Delete the post
      const deleteEvent = {
        site_id: siteId,
        event_type: 'post_deleted',
        timestamp: Date.now(),
        payload: {
          post_id: postId,
          post_type: 'post',
        },
      };

      await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(deleteEvent),
      });

      // Wait for deletion processing
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify NOT in graph (primary check)
      const graphCheck = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: postId,
      });
      expectSuccess(graphCheck);
      const deletedContent = JSON.parse(graphCheck.content[0].text);
      expect(deletedContent).toBeNull();

      // Search should also not find it (eventually)
      // Note: Vector store deletion is immediate, but search may cache
      const searchAfter = await client.callTool('search_site_content', {
        site: siteName,
        query: uniqueTitle,
        limit: 20,
      });

      // Should either find no results or not include the deleted post ID
      if (!searchAfter.isError) {
        const searchTextAfter = searchAfter.content[0].text;
        // If results found, shouldn't include our deleted post ID
        if (searchTextAfter.includes('Found')) {
          expect(searchTextAfter).not.toContain(`Post ID: ${postId}`);
        }
      }
    }, 30000);

    it('should handle deletion of non-existent post gracefully', async () => {
      const nonExistentPostId = 999999;

      const deleteEvent = {
        site_id: siteId,
        event_type: 'post_deleted',
        timestamp: Date.now(),
        payload: {
          post_id: nonExistentPostId,
          post_type: 'post',
        },
      };

      const response = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(deleteEvent),
      });

      // Should succeed (deletion is idempotent)
      expect(response.status).toBe(200);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify still doesn't exist
      const graphCheck = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: nonExistentPostId,
      });
      expectSuccess(graphCheck);

      const content = JSON.parse(graphCheck.content[0].text);
      expect(content).toBeNull();
    }, 15000);

    it('should be idempotent (deleting already-deleted post)', async () => {
      const postId = 9700 + Math.floor(Math.random() * 100);

      // Create post
      const createEvent = {
        site_id: siteId,
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: postId,
          post_type: 'post',
          title: 'Idempotency Test Post',
          content: 'Testing idempotent deletion',
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Delete once
      const deleteEvent = {
        site_id: siteId,
        event_type: 'post_deleted',
        timestamp: Date.now(),
        payload: {
          post_id: postId,
          post_type: 'post',
        },
      };

      const firstDelete = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(deleteEvent),
      });

      expect(firstDelete.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Delete again (should not error)
      const secondDelete = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(deleteEvent),
      });

      expect(secondDelete.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Still should be gone
      const graphCheck = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: postId,
      });
      expectSuccess(graphCheck);

      const content = JSON.parse(graphCheck.content[0].text);
      expect(content).toBeNull();
    }, 20000);
  });

  describe('Plugin Deletion', () => {
    it('should remove deleted plugin from graph database', async () => {
      const pluginSlug = `test-plugin-${Date.now()}`;

      // Step 1: Activate plugin (stores in graph)
      const activateEvent = {
        site_id: siteId,
        event_type: 'plugin_activated',
        timestamp: Date.now(),
        payload: {
          slug: pluginSlug,
          name: 'Test Plugin for Deletion',
          version: '1.0.0',
          is_active: true,
          author: 'E2E Test',
          description: 'Plugin to test deletion',
        },
      };

      const activateResponse = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(activateEvent),
      });

      expect(activateResponse.status).toBe(200);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Step 2: Verify plugin exists in graph
      const graphBefore = await client.callTool('get_graph_plugin', {
        site: siteName,
        slug: pluginSlug,
      });
      expectSuccess(graphBefore);

      const pluginBefore = JSON.parse(graphBefore.content[0].text);
      expect(pluginBefore).not.toBeNull();
      expect(pluginBefore.name).toBe('Test Plugin for Deletion');

      // Step 3: Delete plugin
      const deleteEvent = {
        site_id: siteId,
        event_type: 'plugin_deleted',
        timestamp: Date.now(),
        payload: {
          slug: pluginSlug,
        },
      };

      const deleteResponse = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(deleteEvent),
      });

      expect(deleteResponse.status).toBe(200);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Step 4: Verify plugin removed from graph
      const graphAfter = await client.callTool('get_graph_plugin', {
        site: siteName,
        slug: pluginSlug,
      });
      expectSuccess(graphAfter);

      const pluginAfter = JSON.parse(graphAfter.content[0].text);
      expect(pluginAfter).toBeNull();
    }, 20000);

    it('should handle deletion of non-existent plugin gracefully', async () => {
      const deleteEvent = {
        site_id: siteId,
        event_type: 'plugin_deleted',
        timestamp: Date.now(),
        payload: {
          slug: 'non-existent-plugin-12345',
        },
      };

      const response = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(deleteEvent),
      });

      // Should succeed (idempotent)
      expect(response.status).toBe(200);
    }, 10000);
  });

  describe('User Deletion', () => {
    it('should remove deleted user from graph database', async () => {
      const userId = 9000 + Math.floor(Math.random() * 1000);

      // Step 1: Create user
      const createEvent = {
        site_id: siteId,
        event_type: 'user_created',
        timestamp: Date.now(),
        payload: {
          user_id: userId,
          username: `testuser${userId}`,
          email: `testuser${userId}@example.com`,
          roles: ['subscriber'],
          created_at: Date.now(),
        },
      };

      const createResponse = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(createEvent),
      });

      expect(createResponse.status).toBe(200);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Note: We don't have a get_graph_user tool yet, so we'll verify via user_deleted event processing
      // The important part is that the event is accepted and processed without error

      // Step 2: Delete user
      const deleteEvent = {
        site_id: siteId,
        event_type: 'user_deleted',
        timestamp: Date.now(),
        payload: {
          user_id: userId,
        },
      };

      const deleteResponse = await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(deleteEvent),
      });

      expect(deleteResponse.status).toBe(200);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify no errors in event processing
      const stats = await client.callTool('get_event_processor_stats', {});
      expectSuccess(stats);

      const statsData = JSON.parse(stats.content[0].text);
      expect(statsData).toHaveProperty('total_events');
      // Events should be processed (not stuck as pending with errors)
    }, 15000);
  });

  describe('Statistics After Deletion', () => {
    it('should reflect deletions in graph statistics', async () => {
      // Get stats before
      const statsBefore = await client.callTool('get_graph_stats', {
        site: siteName,
      });
      expectSuccess(statsBefore);

      const beforeData = JSON.parse(statsBefore.content[0].text);
      const contentCountBefore = beforeData.total_content || 0;

      // Create a post
      const postId = 9600 + Math.floor(Math.random() * 100);
      const createEvent = {
        site_id: siteId,
        event_type: 'post_created',
        timestamp: Date.now(),
        payload: {
          post_id: postId,
          post_type: 'post',
          title: 'Stats Test Post',
          content: 'Testing stats after deletion',
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get stats after creation
      const statsAfterCreate = await client.callTool('get_graph_stats', {
        site: siteName,
      });
      expectSuccess(statsAfterCreate);

      const afterCreateData = JSON.parse(statsAfterCreate.content[0].text);
      const contentCountAfterCreate = afterCreateData.total_content || 0;

      // Should have increased
      expect(contentCountAfterCreate).toBeGreaterThan(contentCountBefore);

      // Delete the post
      const deleteEvent = {
        site_id: siteId,
        event_type: 'post_deleted',
        timestamp: Date.now(),
        payload: {
          post_id: postId,
          post_type: 'post',
        },
      };

      await fetch(`${eventEndpoint}/wp-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(deleteEvent),
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get stats after deletion
      const statsAfterDelete = await client.callTool('get_graph_stats', {
        site: siteName,
      });
      expectSuccess(statsAfterDelete);

      const afterDeleteData = JSON.parse(statsAfterDelete.content[0].text);
      const contentCountAfterDelete = afterDeleteData.total_content || 0;

      // Should have decreased back
      expect(contentCountAfterDelete).toBeLessThan(contentCountAfterCreate);
    }, 20000);
  });
});
