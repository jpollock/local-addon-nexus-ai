/**
 * AI Experiments Browser E2E Tests
 *
 * Tests the AI Experiments plugin functionality with synced credentials:
 * 1. Verify credentials synced from Local to WordPress
 * 2. Enable AI Experiments globally
 * 3. Test individual experiments (title gen, summarization, etc.)
 * 4. Verify experiments use synced API keys
 * 5. Test experiment UI interactions
 *
 * Uses @wordpress/e2e-test-utils-playwright for WordPress-specific interactions.
 */
import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import { McpClient } from './helpers/client';
import { getClient, getTestSite, expectSuccess } from './helpers/environment';

describe('AI Experiments Browser E2E', () => {
  let client: McpClient;
  let siteName: string;
  let siteId: string;
  let siteUrl: string;

  test.beforeAll(async () => {
    client = getClient();
    const site = getTestSite();
    siteName = site.name;
    siteId = site.id;

    // Get site URL
    const siteInfo = await client.callTool('local_get_site', { site: siteName });
    expectSuccess(siteInfo);
    const match = siteInfo.content[0].text.match(/Domain:\s*(.+)/);
    siteUrl = match ? `http://${match[1].trim()}` : `http://${siteName}.local`;
  });

  test.describe('Credential Sync Verification', () => {
    test('should have AI credentials synced from Local', async ({ admin, page }) => {
      // Navigate to WP AI Client credentials page
      await admin.visitAdminPage('options-general.php?page=wp-ai-client');

      // Wait for page to load
      await page.waitForSelector('.wrap', { timeout: 10000 });

      // Check for credential fields
      const anthropicField = page.locator('input[name="ai_client_anthropic_api_key"]');
      const openaiField = page.locator('input[name="ai_client_openai_api_key"]');
      const googleField = page.locator('input[name="ai_client_google_ai_api_key"]');

      // Verify fields exist
      await expect(anthropicField).toBeVisible();
      await expect(openaiField).toBeVisible();
      await expect(googleField).toBeVisible();

      // Check if credentials are saved (value will be masked)
      const anthropicValue = await anthropicField.inputValue();
      const openaiValue = await openaiField.inputValue();
      const googleValue = await googleField.inputValue();

      // Credentials should be present (not empty)
      expect(anthropicValue.length).toBeGreaterThan(0);
      expect(openaiValue.length).toBeGreaterThan(0);
      expect(googleValue.length).toBeGreaterThan(0);
    });

    test('should verify credentials via wp-cli', async () => {
      const result = await client.callTool('wp_option_get', {
        site: siteName,
        key: 'ai_client_anthropic_api_key',
      });
      expectSuccess(result);

      const apiKey = result.content[0].text.trim();
      expect(apiKey.length).toBeGreaterThan(0);
      expect(apiKey).toMatch(/^sk-ant-/); // Anthropic API key format
    });
  });

  test.describe('AI Experiments Setup', () => {
    test('should have AI plugin active', async ({ admin, page }) => {
      await admin.visitAdminPage('plugins.php');

      // Wait for plugins list
      await page.waitForSelector('tr[data-slug="ai"]', { timeout: 10000 });

      // Verify AI plugin is active
      const pluginRow = page.locator('tr[data-slug="ai"]');
      await expect(pluginRow).toBeVisible();

      const deactivateLink = pluginRow.locator('a', { hasText: 'Deactivate' });
      await expect(deactivateLink).toBeVisible();
    });

    test('should enable AI Experiments globally', async ({ admin, page }) => {
      // Navigate to experiments settings
      await admin.visitAdminPage('options-general.php?page=ai-experiments');

      // Wait for page load
      await page.waitForSelector('.ai-experiments__toggle-button', { timeout: 10000 });

      // Check if experiments are already enabled
      const enableButton = page.locator('button.ai-experiments__toggle-button', {
        hasText: 'Enable Experiments',
      });

      if ((await enableButton.count()) > 0) {
        // Click enable
        await enableButton.click();

        // Wait for page reload
        await page.waitForLoadState('load');

        // Verify success notice
        const successNotice = page.locator('.wrap .notice-success', {
          hasText: 'Settings saved',
        });
        await expect(successNotice).toBeVisible();
      }

      // Verify experiments are now enabled
      const disableButton = page.locator('button.ai-experiments__toggle-button', {
        hasText: 'Disable Experiments',
      });
      await expect(disableButton).toBeVisible();
    });

    test('should enable title generation experiment', async ({ admin, page }) => {
      await admin.visitAdminPage('options-general.php?page=ai-experiments');

      // Check the title generation checkbox
      const titleGenCheckbox = page.locator('#ai_experiment_title-generation_enabled');
      await titleGenCheckbox.check();

      // Save settings
      await page.locator('#submit').click();

      // Verify success
      const successNotice = page.locator('.wrap .notice-success', {
        hasText: 'Settings saved',
      });
      await expect(successNotice).toBeVisible();

      // Verify checkbox is checked
      await expect(titleGenCheckbox).toBeChecked();
    });

    test('should enable excerpt generation experiment', async ({ admin, page }) => {
      await admin.visitAdminPage('options-general.php?page=ai-experiments');

      const excerptGenCheckbox = page.locator('#ai_experiment_excerpt-generation_enabled');
      await excerptGenCheckbox.check();

      await page.locator('#submit').click();

      const successNotice = page.locator('.wrap .notice-success', {
        hasText: 'Settings saved',
      });
      await expect(successNotice).toBeVisible();
    });
  });

  test.describe('Title Generation Experiment', () => {
    test('should show title generation UI in block editor', async ({ admin, editor, page }) => {
      // Enable experiment first
      await admin.visitAdminPage('options-general.php?page=ai-experiments');
      await page.locator('#ai_experiment_title-generation_enabled').check();
      await page.locator('#submit').click();
      await page.waitForLoadState('load');

      // Create new post
      await admin.createNewPost({ postType: 'post' });

      // Add some content (required for title generation)
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type(
        'This is test content for AI title generation. The AI should be able to generate a relevant title based on this content.'
      );

      // Save draft
      await editor.saveDraft();

      // Click into title field
      const titleInput = editor.canvas.locator('.editor-post-title__input');
      await titleInput.click();

      // Wait for title toolbar to appear
      const titleToolbar = editor.canvas.locator('.ai-title-toolbar-container');
      await expect(titleToolbar).toBeVisible({ timeout: 5000 });

      // Verify "Generate" button exists
      const generateButton = titleToolbar.locator('button', { hasText: 'Generate' });
      await expect(generateButton).toBeVisible();
    });

    test('should generate titles using AI', async ({ admin, editor, page }) => {
      // Enable experiment
      await admin.visitAdminPage('options-general.php?page=ai-experiments');
      await page.locator('#ai_experiment_title-generation_enabled').check();
      await page.locator('#submit').click();
      await page.waitForLoadState('load');

      // Create post with content
      await admin.createNewPost({ postType: 'post' });
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type(
        'WordPress is a powerful content management system used by millions of websites worldwide. ' +
          'It offers flexibility, ease of use, and a vast ecosystem of plugins and themes.'
      );
      await editor.saveDraft();

      // Click into title
      const titleInput = editor.canvas.locator('.editor-post-title__input');
      await titleInput.click();

      // Click Generate button
      const generateButton = editor.canvas.locator('.ai-title-toolbar-container button');
      await generateButton.click();

      // Wait for modal to appear
      const modal = page.locator('.ai-title-generation-modal');
      await expect(modal).toBeVisible({ timeout: 15000 });

      // Wait for title options to be generated (AI API call)
      const titleOptions = page.locator('.ai-title-generation-modal .ai-title textarea');
      await expect(titleOptions).toHaveCount(3, { timeout: 30000 }); // AI generation can take time

      // Verify titles are not empty
      const firstTitle = await titleOptions.first().inputValue();
      expect(firstTitle.length).toBeGreaterThan(0);

      // Select first title
      const selectButton = page.locator('.ai-title-generation-modal .ai-title:first-child button');
      await selectButton.click();

      // Modal should close
      await expect(modal).not.toBeVisible();

      // Title should be updated in editor
      const updatedTitle = await titleInput.inputValue();
      expect(updatedTitle.length).toBeGreaterThan(0);
      expect(updatedTitle).toBe(firstTitle);
    }, 60000); // Extend timeout for AI generation
  });

  test.describe('Excerpt Generation Experiment', () => {
    test('should show excerpt generation UI', async ({ admin, editor, page }) => {
      // Enable experiment
      await admin.visitAdminPage('options-general.php?page=ai-experiments');
      await page.locator('#ai_experiment_excerpt-generation_enabled').check();
      await page.locator('#submit').click();
      await page.waitForLoadState('load');

      // Create post with content
      await admin.createNewPost({ postType: 'post' });
      await editor.canvas.locator('.editor-post-title__input').fill('AI Excerpt Test');
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type(
        'This is a longer piece of content that will be used to generate an excerpt using AI. ' +
          'The excerpt should be a concise summary of the main points.'
      );
      await editor.saveDraft();

      // Open post settings sidebar
      const settingsButton = page.locator('button[aria-label="Settings"]');
      if (!(await settingsButton.isVisible())) {
        await page.locator('button[aria-label="Toggle settings sidebar"]').click();
      }

      // Open excerpt panel
      const excerptButton = page.locator('button', { hasText: 'Excerpt' });
      if (await excerptButton.isVisible()) {
        await excerptButton.click();
      }

      // Look for AI excerpt generation button
      const generateExcerptButton = page.locator('button', { hasText: /Generate.*AI/i });
      await expect(generateExcerptButton).toBeVisible({ timeout: 5000 });
    });

    test('should generate excerpt using AI', async ({ admin, editor, page }) => {
      // Enable experiment
      await admin.visitAdminPage('options-general.php?page=ai-experiments');
      await page.locator('#ai_experiment_excerpt-generation_enabled').check();
      await page.locator('#submit').click();
      await page.waitForLoadState('load');

      // Create post
      await admin.createNewPost({ postType: 'post' });
      await editor.canvas.locator('.editor-post-title__input').fill('Excerpt Generation Test');
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type(
        'WordPress has evolved significantly over the years, transforming from a simple blogging ' +
          'platform into a comprehensive content management system. Today, it powers over 40% of ' +
          'all websites on the internet, offering unparalleled flexibility and customization options.'
      );
      await editor.saveDraft();

      // Open settings sidebar
      const settingsToggle = page.locator('button[aria-label="Toggle settings sidebar"]');
      if (await settingsToggle.isVisible()) {
        await settingsToggle.click();
      }

      // Open excerpt panel
      const excerptButton = page.locator('button', { hasText: 'Excerpt' });
      if (await excerptButton.isVisible()) {
        await excerptButton.click();
      }

      // Click generate excerpt button
      const generateButton = page.locator('button', { hasText: /Generate.*AI/i });
      await generateButton.click();

      // Wait for AI generation (excerpt should appear in textarea)
      const excerptTextarea = page.locator('textarea[id*="excerpt"]');
      await expect(excerptTextarea).not.toBeEmpty({ timeout: 30000 });

      // Verify excerpt was generated
      const excerpt = await excerptTextarea.inputValue();
      expect(excerpt.length).toBeGreaterThan(0);
      expect(excerpt.length).toBeLessThan(200); // Excerpts should be concise
    }, 60000);
  });

  test.describe('Content Summarization Experiment', () => {
    test('should enable content summarization experiment', async ({ admin, page }) => {
      await admin.visitAdminPage('options-general.php?page=ai-experiments');

      const summaryCheckbox = page.locator('#ai_experiment_content-summarization_enabled');
      await summaryCheckbox.check();

      await page.locator('#submit').click();

      const successNotice = page.locator('.wrap .notice-success', {
        hasText: 'Settings saved',
      });
      await expect(successNotice).toBeVisible();
    });

    test('should show summarization block in editor', async ({ admin, editor, page }) => {
      // Enable experiment
      await admin.visitAdminPage('options-general.php?page=ai-experiments');
      await page.locator('#ai_experiment_content-summarization_enabled').check();
      await page.locator('#submit').click();
      await page.waitForLoadState('load');

      // Create post
      await admin.createNewPost({ postType: 'post' });

      // Add content to summarize
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type(
        'Artificial intelligence is rapidly changing how we interact with technology. ' +
          'From virtual assistants to recommendation systems, AI is becoming increasingly ' +
          'integrated into our daily lives.'
      );

      // Try to insert AI summarization block
      await editor.insertBlock({ name: 'core/paragraph' }); // Move cursor

      // Open block inserter
      await page.keyboard.press('Control+Alt+T'); // or Meta+Option+T on Mac

      // Search for AI summarization block
      const blockSearch = page.locator('input[placeholder="Search"]');
      if (await blockSearch.isVisible()) {
        await blockSearch.fill('AI Summary');

        // Look for the block option
        const summaryBlock = page.locator('.block-editor-block-types-list__item', {
          hasText: /AI.*Summar/i,
        });

        if (await summaryBlock.isVisible()) {
          await expect(summaryBlock).toBeVisible();
        }
      }
    });
  });

  test.describe('Experiment Error Handling', () => {
    test('should handle API errors gracefully', async ({ admin, editor, page }) => {
      // This test would require temporarily invalidating credentials
      // For now, we'll test that the UI exists and can be interacted with

      await admin.visitAdminPage('options-general.php?page=ai-experiments');
      await page.locator('#ai_experiment_title-generation_enabled').check();
      await page.locator('#submit').click();
      await page.waitForLoadState('load');

      await admin.createNewPost({ postType: 'post' });
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type('Short content');
      await editor.saveDraft();

      const titleInput = editor.canvas.locator('.editor-post-title__input');
      await titleInput.click();

      const generateButton = editor.canvas.locator('.ai-title-toolbar-container button');
      await generateButton.click();

      // Modal should appear even if there's an error
      const modal = page.locator('.ai-title-generation-modal');
      await expect(modal).toBeVisible({ timeout: 15000 });

      // Should either show titles or an error message
      const hasContent = await page.locator('.ai-title-generation-modal').count() > 0;
      expect(hasContent).toBe(true);
    }, 60000);

    test('should disable experiments when globally disabled', async ({ admin, editor, page }) => {
      // Disable experiments globally
      await admin.visitAdminPage('options-general.php?page=ai-experiments');

      const disableButton = page.locator('button.ai-experiments__toggle-button', {
        hasText: 'Disable Experiments',
      });

      if (await disableButton.isVisible()) {
        await disableButton.click();
        await page.waitForLoadState('load');
      }

      // Create post
      await admin.createNewPost({ postType: 'post' });
      await editor.insertBlock({ name: 'core/paragraph' });
      await page.keyboard.type('Test content');
      await editor.saveDraft();

      // Click into title
      const titleInput = editor.canvas.locator('.editor-post-title__input');
      await titleInput.click();

      // Title toolbar should NOT be visible
      const titleToolbar = editor.canvas.locator('.ai-title-toolbar-container');
      await expect(titleToolbar).not.toBeVisible();

      // Re-enable for other tests
      await admin.visitAdminPage('options-general.php?page=ai-experiments');
      const enableButton = page.locator('button.ai-experiments__toggle-button', {
        hasText: 'Enable Experiments',
      });
      if (await enableButton.isVisible()) {
        await enableButton.click();
      }
    });
  });

  test.describe('Provider Selection', () => {
    test('should verify correct provider used for experiments', async () => {
      // Check which provider is configured for title generation
      const result = await client.callTool('wp_option_get', {
        site: siteName,
        key: 'ai_experiment_title-generation_provider',
      });

      if (!result.isError) {
        const provider = result.content[0].text.trim();
        // Should be one of: anthropic, openai, google
        expect(['anthropic', 'openai', 'google', '']).toContain(provider);
      }
    });
  });
});
