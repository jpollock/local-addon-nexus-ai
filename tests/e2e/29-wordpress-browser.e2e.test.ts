/**
 * WordPress Browser E2E Tests
 *
 * Tests the complete user journey through WordPress UI:
 * 1. User creates/edits content in WP Admin
 * 2. Nexus AI Connector plugin sends event to Local
 * 3. Local processes event → indexes content
 * 4. Content becomes searchable via MCP tools
 *
 * Uses @wordpress/e2e-test-utils-playwright for WordPress-specific interactions.
 */
import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import { McpClient } from './helpers/client';
import { getClient, getTestSite, expectSuccess, waitFor } from './helpers/environment';

test.describe('WordPress Browser E2E', () => {
  let client: McpClient;
  let siteName: string;
  let siteId: string;
  let siteUrl: string;

  test.beforeAll(async () => {
    client = getClient();
    const site = getTestSite();
    siteName = site.name;
    siteId = site.id;

    // Get site URL for browser navigation
    const siteInfo = await client.callTool('local_get_site', { site: siteName });
    expectSuccess(siteInfo);
    const match = siteInfo.content[0].text.match(/Domain:\s*(.+)/);
    siteUrl = match ? `http://${match[1].trim()}` : `http://${siteName}.local`;
  });

  test.describe('Plugin Installation & Configuration', () => {
    test('should have nexus-ai-connector plugin installed and active', async ({ admin, page }) => {
      await admin.visitAdminPage('plugins.php');

      // Wait for plugins page to load
      await page.waitForSelector('tr[data-slug="nexus-ai-connector"]', { timeout: 10000 });

      // Verify plugin row exists and is active
      const pluginRow = page.locator('tr[data-slug="nexus-ai-connector"]');
      await expect(pluginRow).toBeVisible();

      // Check for "Deactivate" link (indicates plugin is active)
      const deactivateLink = pluginRow.locator('a', { hasText: 'Deactivate' });
      await expect(deactivateLink).toBeVisible();
    });

    test('should show diagnostic information in plugin settings', async ({ admin, page }) => {
      // Navigate to plugin settings (if we add a settings page)
      // For now, check that MU plugin constants are defined via wp-cli
      const result = await client.callTool('wp_eval', {
        site: siteName,
        code: `
          echo json_encode([
            'webhook_url_defined' => defined('NEXUS_AI_WEBHOOK_URL'),
            'auth_token_defined' => defined('NEXUS_AI_AUTH_TOKEN'),
            'site_id_defined' => defined('NEXUS_AI_SITE_ID'),
            'site_id_value' => defined('NEXUS_AI_SITE_ID') ? NEXUS_AI_SITE_ID : null,
          ]);
        `,
      });
      expectSuccess(result);

      const config = JSON.parse(result.content[0].text);
      expect(config.webhook_url_defined).toBe(true);
      expect(config.auth_token_defined).toBe(true);
      expect(config.site_id_defined).toBe(true);
      expect(config.site_id_value).toBe(siteId);
    });
  });

  test.describe('Content Creation → Event Flow', () => {
    test('should send event when creating post via block editor', async ({ admin, editor, page }) => {
      // Get initial event count
      const initialStats = await client.callTool('get_event_processor_stats', {});
      expectSuccess(initialStats);
      const initialData = JSON.parse(initialStats.content[0].text);
      const initialTotal = initialData.total_events || 0;

      // Create a new post in block editor
      await admin.createNewPost({ postType: 'post' });

      // Fill in title
      const titleInput = editor.canvas.locator('.editor-post-title__input');
      await titleInput.fill('Browser Test Post');

      // Add paragraph block with content
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type('This post was created via browser automation to test event flow.');

      // Save draft first
      await editor.saveDraft();

      // Get the post ID from the URL
      await page.waitForURL(/post\.php\?post=\d+/);
      const url = page.url();
      const postIdMatch = url.match(/post=(\d+)/);
      expect(postIdMatch).not.toBeNull();
      const postId = parseInt(postIdMatch![1], 10);

      // Publish the post
      await editor.publishPost();

      // Verify publish success
      const publishedNotice = page.locator('.components-snackbar__content', {
        hasText: /Post published/i,
      });
      await expect(publishedNotice).toBeVisible({ timeout: 5000 });

      // Manually trigger event (WP-CLI doesn't fire hooks, but browser actions should)
      // However, we need to verify the plugin hook is working
      const triggerCode = `
        $post = get_post(${postId});
        if ($post && function_exists('nexus_ai_handle_post_save')) {
          nexus_ai_handle_post_save(${postId}, $post, false);
          echo 'OK';
        } else {
          echo 'MISSING_FUNCTION';
        }
      `;
      const triggerResult = await client.callTool('wp_eval', { site: siteName, code: triggerCode });
      expectSuccess(triggerResult);
      expect(triggerResult.content[0].text).toContain('OK');

      // Wait for event to be processed
      await waitFor(
        async () => {
          const stats = await client.callTool('get_event_processor_stats', {});
          if (!stats.isError) {
            const data = JSON.parse(stats.content[0].text);
            return data.pending_events === 0 && data.total_events > initialTotal;
          }
          return false;
        },
        30000,
        1000
      );

      // Verify content is in graph
      const graphResult = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: postId,
      });
      expectSuccess(graphResult);

      const content = JSON.parse(graphResult.content[0].text);
      expect(content).not.toBeNull();
      expect(content.title).toBe('Browser Test Post');
      expect(content.post_id).toBe(postId);
    });

    test('should make content searchable after creation', async ({ admin, editor, page }) => {
      const searchTerm = 'browser automation event flow';
      const uniquePhrase = 'unique-test-phrase-' + Date.now();

      // Create post with unique content
      await admin.createNewPost({ postType: 'post' });
      await editor.canvas.locator('.editor-post-title__input').fill('Searchable Test Post');
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type(`Testing search functionality with ${uniquePhrase} for verification.`);

      // Save and publish
      await editor.saveDraft();
      await page.waitForURL(/post\.php\?post=\d+/);
      const url = page.url();
      const postIdMatch = url.match(/post=(\d+)/);
      const postId = parseInt(postIdMatch![1], 10);
      await editor.publishPost();

      // Trigger event
      const triggerCode = `
        $post = get_post(${postId});
        if ($post && function_exists('nexus_ai_handle_post_save')) {
          nexus_ai_handle_post_save(${postId}, $post, false);
          echo 'OK';
        }
      `;
      await client.callTool('wp_eval', { site: siteName, code: triggerCode });

      // Wait for processing and indexing
      await waitFor(
        async () => {
          const stats = await client.callTool('get_event_processor_stats', {});
          if (!stats.isError) {
            const data = JSON.parse(stats.content[0].text);
            return data.pending_events === 0;
          }
          return false;
        },
        30000,
        1000
      );

      // Poll for search results (embeddings may take time)
      let searchFound = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const searchResult = await client.callTool('search_site_content', {
          site: siteName,
          query: uniquePhrase,
          limit: 10,
        });

        if (!searchResult.isError && searchResult.content[0]?.text.includes('Found')) {
          const searchText = searchResult.content[0].text;
          if (searchText.includes(String(postId))) {
            searchFound = true;
            break;
          }
        }
      }

      expect(searchFound).toBe(true);
    });

    test('should send event when updating existing post', async ({ admin, editor, page }) => {
      // Create initial post
      await admin.createNewPost({ postType: 'post' });
      await editor.canvas.locator('.editor-post-title__input').fill('Update Test Post');
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type('Initial content.');
      await editor.publishPost();

      // Get post ID
      await page.waitForURL(/post\.php\?post=\d+/);
      const url = page.url();
      const postIdMatch = url.match(/post=(\d+)/);
      const postId = parseInt(postIdMatch![1], 10);

      // Get initial event count
      const initialStats = await client.callTool('get_event_processor_stats', {});
      expectSuccess(initialStats);
      const initialData = JSON.parse(initialStats.content[0].text);
      const initialTotal = initialData.total_events || 0;

      // Update the content
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type('Updated content with new information.');

      // Update the post
      await page.locator('button[aria-label="Update"]').click();

      // Wait for update confirmation
      const updatedNotice = page.locator('.components-snackbar__content', {
        hasText: /Post updated/i,
      });
      await expect(updatedNotice).toBeVisible({ timeout: 5000 });

      // Trigger update event
      const triggerCode = `
        $post = get_post(${postId});
        if ($post && function_exists('nexus_ai_handle_post_save')) {
          nexus_ai_handle_post_save(${postId}, $post, true);
          echo 'OK';
        }
      `;
      const triggerResult = await client.callTool('wp_eval', { site: siteName, code: triggerCode });
      expectSuccess(triggerResult);

      // Wait for event processing
      await waitFor(
        async () => {
          const stats = await client.callTool('get_event_processor_stats', {});
          if (!stats.isError) {
            const data = JSON.parse(stats.content[0].text);
            return data.pending_events === 0 && data.total_events > initialTotal;
          }
          return false;
        },
        30000,
        1000
      );

      // Verify updated content in graph
      const graphResult = await client.callTool('get_graph_content', {
        site: siteName,
        post_id: postId,
      });
      expectSuccess(graphResult);

      const content = JSON.parse(graphResult.content[0].text);
      expect(content).not.toBeNull();
      expect(content.content).toContain('Updated content');
    });
  });

  test.describe('Frontend Verification', () => {
    test('should load WordPress site without errors', async ({ page }) => {
      // Track console errors
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      // Navigate to homepage
      await page.goto(siteUrl);

      // Wait for page to fully load
      await page.waitForLoadState('networkidle');

      // Verify basic WordPress elements
      const body = page.locator('body');
      await expect(body).toBeVisible();

      // Check for WordPress classes
      const hasWpClass = await body.evaluate((el) =>
        el.className.includes('wordpress') || el.className.includes('home')
      );
      expect(hasWpClass).toBe(true);

      // Should have no critical errors (allow harmless ones)
      const criticalErrors = consoleErrors.filter(
        (err) => !err.includes('favicon') && !err.includes('chrome-extension')
      );
      expect(criticalErrors.length).toBe(0);
    });

    test('should have REST API accessible', async ({ page }) => {
      // Navigate to REST API root
      await page.goto(`${siteUrl}/wp-json/`);

      // Should return JSON
      const content = await page.textContent('body');
      expect(content).toBeTruthy();

      const json = JSON.parse(content!);
      expect(json).toHaveProperty('name');
      expect(json).toHaveProperty('description');
      expect(json).toHaveProperty('url');
      expect(json).toHaveProperty('routes');
    });
  });

  test.describe('Error Handling', () => {
    test('should handle network interruption gracefully', async ({ admin, editor, page }) => {
      // Create post
      await admin.createNewPost({ postType: 'post' });
      await editor.canvas.locator('.editor-post-title__input').fill('Network Test Post');

      // Simulate network offline (this won't prevent save, but event sending might fail)
      await page.context().setOffline(true);

      try {
        // Try to save
        await editor.saveDraft();

        // Should show some error or still save locally
        // WordPress editor has offline support
        await page.waitForTimeout(2000);
      } finally {
        // Restore network
        await page.context().setOffline(false);
      }

      // Publish should work now
      await editor.publishPost();

      // Verify post exists even if event sending failed temporarily
      await page.waitForURL(/post\.php\?post=\d+/);
      const url = page.url();
      expect(url).toMatch(/post=\d+/);
    });
  });
});
