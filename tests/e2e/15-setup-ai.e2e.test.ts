import { McpClient } from './helpers/client';
import {
  getClient,
  getTestSite,
  deserializeEnvironment,
  resultText,
  expectSuccess,
} from './helpers/environment';

/**
 * Setup for AI E2E tests — exercises the full wp_setup_ai flow and
 * wp_sync_ai_credentials against real WordPress sites.
 */
describe('15 — Setup for AI', () => {
  let client: McpClient;
  let canRunMutations: boolean;
  let testSiteName: string;

  beforeAll(() => {
    client = getClient();
    const env = deserializeEnvironment();
    canRunMutations = !!env.testSiteId;
    if (canRunMutations) {
      testSiteName = getTestSite().name;
    }
  });

  // ---------------------------------------------------------------------------
  // Fresh site: create -> setup -> verify -> delete
  // ---------------------------------------------------------------------------

  describe('fresh site setup', () => {
    const FRESH_SITE_NAME = `nexus-ai-setup-${Date.now().toString(36).slice(-6)}`;
    let createdSiteId: string | null = null;

    afterAll(async () => {
      // Clean up: delete the fresh site if it was created
      if (!createdSiteId) return;
      try {
        const confirmResult = await client.callTool('local_delete_site', {
          site: createdSiteId,
          trashFiles: true,
        });
        const text = resultText(confirmResult);
        try {
          const parsed = JSON.parse(text);
          if (parsed.requiresConfirmation && parsed.confirmationToken) {
            await client.callTool('local_delete_site', {
              site: createdSiteId,
              trashFiles: true,
              _confirmationToken: parsed.confirmationToken,
            });
          }
        } catch { /* best effort */ }
      } catch { /* best effort */ }
    });

    it('creates a fresh site', async () => {
      const result = await client.callTool('local_create_site', { name: FRESH_SITE_NAME });

      const text = resultText(result);
      if (result.isError) {
        throw new Error(`local_create_site failed: ${text}`);
      }

      const idMatch = text.match(/\*\*ID:\*\*\s*(\S+)/);
      createdSiteId = idMatch ? idMatch[1] : FRESH_SITE_NAME;
      expect(createdSiteId).toBeTruthy();
    }, 120000);

    it('waits for the site to be running', async () => {
      if (!createdSiteId) {
        console.log('Skipping: site was not created');
        return;
      }

      await waitForSite(client, createdSiteId);

      const siteResult = await client.callTool('local_get_site', { site: createdSiteId });
      expectSuccess(siteResult);
      expect(resultText(siteResult).toLowerCase()).toContain('running');
    }, 120000);

    it('wp_setup_ai completes successfully on a fresh site', async () => {
      if (!createdSiteId) {
        console.log('Skipping: site was not created');
        return;
      }

      const result = await client.callTool('wp_setup_ai', { site: createdSiteId });
      expectSuccess(result);

      const text = resultText(result);
      expect(text).toContain('Setup for AI completed');
      expect(text).toContain('AI Plugin: installed');
      expect(text).toContain('AI Experiments: enabled');
    }, 60000);

    it('AI plugin is active after setup', async () => {
      if (!createdSiteId) {
        console.log('Skipping: site was not created');
        return;
      }

      const result = await client.callTool('wp_plugin_list', { site: createdSiteId });
      expectSuccess(result);

      const text = resultText(result).toLowerCase();
      // The "ai" plugin should appear as active
      expect(text).toMatch(/\bai\b.*active|active.*\bai\b/);
    }, 60000);

    it('AI experiments are enabled after setup', async () => {
      if (!createdSiteId) {
        console.log('Skipping: site was not created');
        return;
      }

      const result = await client.callTool('wp_option_get', {
        site: createdSiteId,
        option: 'ai_experiments_enabled',
      });
      expectSuccess(result);

      const text = resultText(result);
      expect(text).toContain('1');
    }, 60000);

    it('deletes the fresh site (Tier 3)', async () => {
      if (!createdSiteId) {
        console.log('Skipping: site was not created');
        return;
      }

      // First call: get confirmation token
      const confirmResult = await client.callTool('local_delete_site', {
        site: createdSiteId,
        trashFiles: true,
      });
      expectSuccess(confirmResult);

      const parsed = JSON.parse(resultText(confirmResult));
      expect(parsed.requiresConfirmation).toBe(true);
      expect(parsed.confirmationToken).toBeTruthy();

      // Second call: confirm deletion
      const deleteResult = await client.callTool('local_delete_site', {
        site: createdSiteId,
        trashFiles: true,
        _confirmationToken: parsed.confirmationToken,
      });
      expectSuccess(deleteResult);

      const text = resultText(deleteResult).toLowerCase();
      expect(text).toMatch(/deleted|removed|success/);

      // Clear so afterAll doesn't double-delete
      createdSiteId = null;
    }, 60000);
  });

  // ---------------------------------------------------------------------------
  // Existing site setup (test site) — setup, verify, cleanup
  // ---------------------------------------------------------------------------

  describe('existing site setup', () => {
    afterAll(async () => {
      if (!canRunMutations) return;

      // Clean up: deactivate plugins we installed
      const pluginsToClean = [
        'ai',
        'ai-provider-for-openai',
        'ai-provider-for-anthropic',
        'ai-provider-for-google',
      ];
      for (const slug of pluginsToClean) {
        try {
          await client.callTool('wp_plugin_deactivate', {
            site: testSiteName,
            slug,
          });
        } catch { /* already inactive or not installed */ }
      }
    });

    it('wp_setup_ai completes on the test site', async () => {
      if (!canRunMutations) {
        console.log('Skipping: no test site available');
        return;
      }

      const result = await client.callTool('wp_setup_ai', { site: testSiteName });
      expectSuccess(result);

      const text = resultText(result);
      expect(text).toContain('Setup for AI completed');
      expect(text).toMatch(/AI Plugin: (installed|activated|already_active)/);
      expect(text).toMatch(/AI Experiments: (enabled|already_enabled)/);
    }, 60000);

    it('AI plugin is active on the test site after setup', async () => {
      if (!canRunMutations) {
        console.log('Skipping: no test site available');
        return;
      }

      const result = await client.callTool('wp_plugin_list', { site: testSiteName });
      expectSuccess(result);

      const text = resultText(result).toLowerCase();
      expect(text).toMatch(/\bai\b.*active|active.*\bai\b/);
    }, 60000);

    it('AI experiments are enabled on the test site', async () => {
      if (!canRunMutations) {
        console.log('Skipping: no test site available');
        return;
      }

      const result = await client.callTool('wp_option_get', {
        site: testSiteName,
        option: 'ai_experiments_enabled',
      });
      expectSuccess(result);
      expect(resultText(result)).toContain('1');
    }, 60000);

    it('wp_setup_ai is idempotent (second run succeeds)', async () => {
      if (!canRunMutations) {
        console.log('Skipping: no test site available');
        return;
      }

      const result = await client.callTool('wp_setup_ai', { site: testSiteName });
      expectSuccess(result);

      const text = resultText(result);
      expect(text).toContain('Setup for AI completed');
      // Second run should report already_active
      expect(text).toContain('AI Plugin: already_active');
    }, 60000);
  });

  // ---------------------------------------------------------------------------
  // Credential sync tool
  // ---------------------------------------------------------------------------

  describe('credential sync', () => {
    it('wp_sync_ai_credentials dry_run shows what would be synced', async () => {
      if (!canRunMutations) {
        console.log('Skipping: no test site available');
        return;
      }

      const result = await client.callTool('wp_sync_ai_credentials', {
        site: testSiteName,
        dry_run: true,
      });

      const text = resultText(result);

      // If keys are configured, should show dry run summary
      // If no keys, should show an error about no keys
      if (result.isError) {
        expect(text).toContain('No AI provider API keys configured');
      } else {
        expect(text).toContain('Dry run');
        expect(text).toContain('would sync');
      }
    }, 60000);

    it('wp_sync_ai_credentials handles no-keys gracefully', async () => {
      if (!canRunMutations) {
        console.log('Skipping: no test site available');
        return;
      }

      // This test only validates when no keys are configured;
      // if keys ARE configured, the sync just succeeds.
      const result = await client.callTool('wp_sync_ai_credentials', {
        site: testSiteName,
      });

      // Either succeeds (keys present) or errors (no keys)
      const text = resultText(result);
      if (result.isError) {
        expect(text).toContain('No AI provider API keys configured');
      } else {
        expect(text).toContain('Synced');
      }
    }, 60000);
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('wp_setup_ai errors on a non-existent site', async () => {
      const result = await client.callTool('wp_setup_ai', {
        site: 'nonexistent-site-that-does-not-exist-99999',
      });
      expect(result.isError).toBe(true);
      expect(resultText(result).toLowerCase()).toContain('not found');
    });

    it('wp_setup_ai errors on a halted site', async () => {
      const env = deserializeEnvironment();
      if (env.haltedSites.length === 0) {
        console.log('Skipping: no halted sites available');
        return;
      }

      const haltedSite = env.haltedSites[0];
      const result = await client.callTool('wp_setup_ai', { site: haltedSite.name });
      expect(result.isError).toBe(true);
      expect(resultText(result).toLowerCase()).toContain('halted');
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForSite(client: McpClient, siteId: string, timeoutMs = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await client.callTool('local_get_site', { site: siteId });
      if (!result.isError && resultText(result).toLowerCase().includes('running')) {
        return;
      }
    } catch { /* keep polling */ }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Timed out waiting for site ${siteId} to be running after ${timeoutMs}ms`);
}
