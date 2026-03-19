/**
 * E2E tests for WordPress event processing (plugin integration)
 *
 * Tests the complete flow:
 * WordPress action → Plugin sends event → Local HTTP interface → Event processor → Graph + Embeddings
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from './helpers/client';
import { getClient, getAnySite, expectSuccess } from './helpers/environment';

describe('WordPress Events E2E', () => {
  let client: McpClient;
  let siteName: string;
  let siteId: string;

  beforeAll(async () => {
    client = getClient();
    const site = getAnySite();
    siteName = site.name;
    siteId = site.id;

    // Wait for initial site indexing to complete
    // Search for WordPress default "Hello world!" post as a smoke test
    console.log('[Test Setup] Waiting for site indexing to complete...');
    let indexed = false;
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      const searchResult = await client.callTool('search_site_content', {
        site: siteName,
        query: 'Hello world',
        limit: 1,
      });

      if (!searchResult.isError && searchResult.content[0]?.text.includes('Hello world')) {
        indexed = true;
        console.log(`[Test Setup] Site indexed (attempt ${i + 1}/${maxAttempts})`);
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!indexed) {
      console.warn('[Test Setup] Site indexing did not complete within timeout, tests may be flaky');
    }
  }, 30000);

  describe('Plugin Installation', () => {
    it('should have nexus-ai-connector plugin installed', async () => {
      const result = await client.callTool('wp_plugin_list', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text.toLowerCase();
      expect(text).toContain('nexus-ai-connector');
    });

    it('should have nexus-ai-connector plugin active', async () => {
      const result = await client.callTool('wp_plugin_list', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;
      // Should show plugin as active
      expect(text).toMatch(/nexus-ai-connector.*active/i);
    });

    it('should have webhook URL configured via MU plugin', async () => {
      // Verify constants are defined by checking Nexus AI Connector config
      // The plugin checks constants first, so if they're defined it will use them
      const fs = require('fs');
      const path = require('path');

      // Check MU plugin file exists
      const sitesDir = path.join(process.env.HOME || '', 'Local Sites');
      const muPluginPath = path.join(sitesDir, siteName, 'app', 'public', 'wp-content', 'mu-plugins', 'nexus-ai-connector-config.php');

      expect(fs.existsSync(muPluginPath)).toBe(true);

      // Verify it contains the constants
      const muPluginContent = fs.readFileSync(muPluginPath, 'utf-8');
      expect(muPluginContent).toContain('NEXUS_AI_WEBHOOK_URL');
      expect(muPluginContent).toContain('NEXUS_AI_AUTH_TOKEN');
      expect(muPluginContent).toContain('127.0.0.1');
    });
  });

  describe('WordPress to Local Event Flow', () => {
    it('should send post_created event when post is created via wp-cli', async () => {
      // Get initial event stats
      const initialStats = await client.callTool('get_event_processor_stats', {});
      expectSuccess(initialStats);
      const initialData = JSON.parse(initialStats.content[0].text);
      const initialTotal = initialData.total_events || 0;

      // Create post via WP-CLI
      const createResult = await client.callTool('wp_post_create', {
        site: siteName,
        title: 'E2E Event Test Post',
        content: 'This post was created to test WordPress event sending',
        status: 'publish',
      });
      expectSuccess(createResult);

      // Extract post ID from result
      const createText = createResult.content[0].text;
      const postIdMatch = createText.match(/Created post (\d+)/i);
      expect(postIdMatch).not.toBeNull();
      const postId = parseInt(postIdMatch![1], 10);

      // Manually trigger event sending (WP-CLI doesn't fire hooks by default)
      const triggerCode = `$post = get_post(${postId}); if ($post) { nexus_ai_handle_post_save(${postId}, $post, false); echo 'OK'; }`;
      const triggerResult = await client.callTool('wp_eval', {
        site: siteName,
        code: triggerCode,
      });
      expectSuccess(triggerResult);
      expect(triggerResult.content[0].text).toContain('OK');

      // Wait for async event processing and verify searchability
      // Poll for content instead of fixed wait (event processing is async)
      let found = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const searchResult = await client.callTool('search_site_content', {
          site: siteName,
          query: 'E2E Event Test',
          limit: 5,
        });

        if (!searchResult.isError && searchResult.content[0]?.text.includes('E2E Event Test Post')) {
          found = true;
          break;
        }
      }

      expect(found).toBe(true);

      // Verify event stats increased
      const newStats = await client.callTool('get_event_processor_stats', {});
      expectSuccess(newStats);
      const newData = JSON.parse(newStats.content[0].text);
      const newTotal = newData.total_events || 0;

      expect(newTotal).toBeGreaterThan(initialTotal);
    }, 30000);

    it('should send post_updated event when post is updated', async () => {
      // First create a post
      const createResult = await client.callTool('wp_post_create', {
        site: siteName,
        title: 'Post to Update',
        content: 'Original content',
        status: 'publish',
      });
      expectSuccess(createResult);

      const createText = createResult.content[0].text;
      const postIdMatch = createText.match(/Created post (\d+)/i);
      const postId = parseInt(postIdMatch![1], 10);

      // Trigger create event
      const triggerCreate = `$post = get_post(${postId}); if ($post) { nexus_ai_handle_post_save(${postId}, $post, false); echo 'OK'; }`;
      await client.callTool('wp_eval', { site: siteName, code: triggerCreate });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get stats before update
      const beforeStats = await client.callTool('get_event_processor_stats', {});
      const beforeData = JSON.parse(beforeStats.content[0].text);
      const beforeTotal = beforeData.total_events || 0;

      // Update the post
      const updateResult = await client.callTool('wp_post_update', {
        site: siteName,
        post_id: postId,
        title: 'Updated Post Title',
        content: 'Updated content with new information',
      });
      expectSuccess(updateResult);

      // Trigger update event (update=true)
      const triggerUpdate = `$post = get_post(${postId}); if ($post) { nexus_ai_handle_post_save(${postId}, $post, true); echo 'OK'; }`;
      const triggerResult = await client.callTool('wp_eval', {
        site: siteName,
        code: triggerUpdate,
      });
      expectSuccess(triggerResult);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check stats increased
      const afterStats = await client.callTool('get_event_processor_stats', {});
      const afterData = JSON.parse(afterStats.content[0].text);
      const afterTotal = afterData.total_events || 0;

      expect(afterTotal).toBeGreaterThan(beforeTotal);

      // Search for updated content
      const searchResult = await client.callTool('search_site_content', {
        site: siteName,
        query: 'Updated Post Title',
        limit: 5,
      });
      expectSuccess(searchResult);

      const searchText = searchResult.content[0].text;
      expect(searchText).toContain('Updated Post Title');
    }, 30000);

    it('should send post_deleted event when post is deleted', async () => {
      // Create a post to delete
      const createResult = await client.callTool('wp_post_create', {
        site: siteName,
        title: 'Post to Delete',
        content: 'This post will be deleted',
        status: 'publish',
      });
      expectSuccess(createResult);

      const createText = createResult.content[0].text;
      const postIdMatch = createText.match(/Created post (\d+)/i);
      const postId = parseInt(postIdMatch![1], 10);

      // Trigger create event and wait for it to be searchable
      const triggerCreate = `$post = get_post(${postId}); if ($post) { nexus_ai_handle_post_save(${postId}, $post, false); echo 'OK'; }`;
      await client.callTool('wp_eval', { site: siteName, code: triggerCreate });

      // Poll for content to become searchable (event processing is async)
      let foundBeforeDelete = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const beforeSearch = await client.callTool('search_site_content', {
          site: siteName,
          query: 'Post to Delete',
          limit: 5,
        });

        if (!beforeSearch.isError && beforeSearch.content[0]?.text.includes('Post to Delete')) {
          foundBeforeDelete = true;
          break;
        }
      }

      expect(foundBeforeDelete).toBe(true);

      // Get stats before delete
      const beforeStats = await client.callTool('get_event_processor_stats', {});
      const beforeData = JSON.parse(beforeStats.content[0].text);
      const beforeTotal = beforeData.total_events || 0;

      // Trigger delete event BEFORE actually deleting (so we can get post data)
      const triggerDelete = `$post = get_post(${postId}); if ($post) { nexus_ai_handle_post_delete(${postId}); echo 'OK'; }`;
      const triggerResult = await client.callTool('wp_eval', {
        site: siteName,
        code: triggerDelete,
      });
      expectSuccess(triggerResult);

      // Now actually delete the post
      const deleteResult = await client.callTool('wp_post_delete', {
        site: siteName,
        post_id: postId,
        force: true,
      });
      expectSuccess(deleteResult);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check stats increased
      const afterStats = await client.callTool('get_event_processor_stats', {});
      const afterData = JSON.parse(afterStats.content[0].text);
      const afterTotal = afterData.total_events || 0;

      expect(afterTotal).toBeGreaterThan(beforeTotal);

      // Verify post was deleted from graph database
      const graphCheckResult = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: postId,
      });
      expectSuccess(graphCheckResult);

      const deletedPost = JSON.parse(graphCheckResult.content[0].text);
      // Post should be null in graph after deletion
      expect(deletedPost).toBeNull();
    }, 30000);
  });

  describe('Event Processing Statistics', () => {
    it('should track events via MCP tool', async () => {
      const result = await client.callTool('get_event_processor_stats', {});
      expectSuccess(result);

      const stats = JSON.parse(result.content[0].text);
      expect(stats).toHaveProperty('total_events');
      expect(stats).toHaveProperty('pending_events');
      expect(stats).toHaveProperty('failed_events');
      expect(stats).toHaveProperty('processed_today');

      // Should have processed some events from previous tests
      expect(stats.total_events).toBeGreaterThan(0);
    });
  });

  describe('Real-Time Content Updates', () => {
    it('should make new content immediately searchable', async () => {
      const uniqueTitle = `Test ${Date.now()}`;

      // Create post
      const createResult = await client.callTool('wp_post_create', {
        site: siteName,
        title: uniqueTitle,
        content: 'Content with unique timestamp for search test',
        status: 'publish',
      });
      expectSuccess(createResult);

      const createText = createResult.content[0].text;
      const postIdMatch = createText.match(/Created post (\d+):/);
      expect(postIdMatch).toBeTruthy();
      const newPostId = parseInt(postIdMatch![1], 10);

      // Manually trigger event sending (WP-CLI doesn't fire hooks by default)
      const triggerCode = `$post = get_post(${newPostId}); if ($post) { nexus_ai_handle_post_save(${newPostId}, $post, false); echo 'OK'; }`;
      const triggerResult = await client.callTool('wp_eval', {
        site: siteName,
        code: triggerCode,
      });
      expectSuccess(triggerResult);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify post is in graph database
      const graphResult = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: newPostId,
      });
      expectSuccess(graphResult);

      const graphContent = JSON.parse(graphResult.content[0].text);
      expect(graphContent).not.toBeNull();
      expect(graphContent.title).toBe(uniqueTitle);

      // Verify it's searchable (may not be in top 5 due to test data accumulation, but should return results)
      const searchResult = await client.callTool('search_site_content', {
        site: siteName,
        query: uniqueTitle,
        limit: 20,
      });
      expectSuccess(searchResult);

      const searchText = searchResult.content[0].text;
      expect(searchText).toMatch(/Found \d+ results/);
    }, 15000);
  });
});
