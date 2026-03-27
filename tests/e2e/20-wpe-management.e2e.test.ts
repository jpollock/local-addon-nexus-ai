/**
 * E2E tests for WP Engine CAPI management operations
 *
 * Tests WPE account/install management via the addon's internal CAPI integration.
 * The addon provides markdown-formatted output from CAPI data.
 *
 * Available tools (from src/main/mcp/modules/wpe/index.ts):
 * - wpe_get_accounts
 * - wpe_get_installs
 * - wpe_get_install
 * - wpe_create_backup
 * - wpe_purge_cache
 * - local_wpe_link
 * - local_wpe_pull
 * - local_wpe_push
 * - nexus_list_sites
 * - local_get_site_changes
 * - local_get_sync_history
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from './helpers/client';
import { getClient, expectSuccess, deserializeEnvironment } from './helpers/environment';

describe('WPE Management E2E', () => {
  let client: McpClient;
  let capiAvailable: boolean;

  beforeAll(async () => {
    client = getClient();
    const env = deserializeEnvironment();
    capiAvailable = env.capiAvailable;

    if (!capiAvailable) {
      console.warn('[WPE Management] CAPI not available - skipping tests');
    }
  });

  describe('Account Discovery', () => {
    it('should list WPE accounts', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      const result = await client.callTool('wpe_get_accounts');
      expectSuccess(result);

      const text = result.content[0].text;
      expect(text).toBeTruthy();

      // Should be markdown formatted
      expect(text).toContain('## WP Engine Accounts');

      // If accounts exist, should list them
      if (!text.includes('No WP Engine accounts found')) {
        expect(text).toMatch(/- \*\*.*\*\* \(ID:/);
      }
    });
  });

  describe('Install Discovery', () => {
    it('should list WPE installs', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      const result = await client.callTool('wpe_get_installs');
      expectSuccess(result);

      const text = result.content[0].text;
      expect(text).toBeTruthy();

      // Should be markdown formatted
      expect(text).toContain('## WP Engine Installs');

      // If installs exist, should list them
      if (!text.includes('No WP Engine installs found')) {
        expect(text).toMatch(/- \*\*.*\*\* \(ID:.*env:/);
      }
    });

    it('should get install details by ID', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      // First get list of installs
      const listResult = await client.callTool('wpe_get_installs');
      expectSuccess(listResult);

      const listText = listResult.content[0].text;
      if (listText.includes('No WP Engine installs found')) {
        console.log('[SKIP] No installs available');
        return;
      }

      // Extract first install ID from markdown
      // Format: "- **name** (ID: abc123, env: production)"
      const match = listText.match(/\(ID:\s*([^,]+),/);
      if (!match) {
        console.log('[SKIP] Could not parse install ID from output');
        return;
      }

      const installId = match[1].trim();

      // Get specific install
      const result = await client.callTool('wpe_get_install', {
        install_id: installId,
      });
      expectSuccess(result);

      const text = result.content[0].text;
      expect(text).toBeTruthy();
      expect(text).toContain(installId);
    });
  });

  describe('Cache Operations', () => {
    it('should purge cache for an install', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      // Get first install
      const listResult = await client.callTool('wpe_get_installs');
      expectSuccess(listResult);

      const listText = listResult.content[0].text;
      if (listText.includes('No WP Engine installs found')) {
        console.log('[SKIP] No installs available');
        return;
      }

      // Extract first install ID
      const match = listText.match(/\(ID:\s*([^,]+),/);
      if (!match) {
        console.log('[SKIP] Could not parse install ID');
        return;
      }

      const installId = match[1].trim();

      // Attempt cache purge
      const result = await client.callTool('wpe_purge_cache', {
        install_id: installId,
      });

      // May succeed or fail depending on permissions
      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();
        // Success message varies
      } else {
        // Expected if no permissions
        console.log(`[INFO] Cache purge failed (expected if no permissions): ${result.content[0].text}`);
      }
    });
  });

  describe('Backup Operations', () => {
    it('should create backup for an install', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      // Get first install
      const listResult = await client.callTool('wpe_get_installs');
      expectSuccess(listResult);

      const listText = listResult.content[0].text;
      if (listText.includes('No WP Engine installs found')) {
        console.log('[SKIP] No installs available');
        return;
      }

      // Extract first install ID
      const match = listText.match(/\(ID:\s*([^,]+),/);
      if (!match) {
        console.log('[SKIP] Could not parse install ID');
        return;
      }

      const installId = match[1].trim();

      // Attempt backup creation
      const result = await client.callTool('wpe_create_backup', {
        install_id: installId,
        description: 'E2E test backup',
      });

      // May succeed or fail depending on permissions
      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();
        expect(text).toContain('backup');
      } else {
        // Expected if no permissions
        console.log(`[INFO] Backup creation failed (expected if no permissions): ${result.content[0].text}`);
      }
    });
  });

  describe('Local-WPE Integration', () => {
    it('should list sites with WPE link status', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      const result = await client.callTool('nexus_list_sites');
      expectSuccess(result);

      const text = result.content[0].text;
      expect(text).toBeTruthy();

      // Should show local sites and WPE installs
      expect(text).toMatch(/## Local Sites|## Cloud Environments/);
    });

    it('should get sync history for a site', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      // Get list of sites first
      const sitesResult = await client.callTool('nexus_list_sites');
      expectSuccess(sitesResult);

      const sitesText = sitesResult.content[0].text;

      // Extract a local site name
      // Format: "- **sitename** (domain.local)"
      const match = sitesText.match(/- \*\*([^*]+)\*\* \([^)]+\.local\)/);
      if (!match) {
        console.log('[SKIP] No local sites found');
        return;
      }

      const siteName = match[1].trim();

      const result = await client.callTool('local_get_sync_history', {
        site: siteName,
      });

      // May succeed or fail if site has never synced
      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();
      } else {
        // Expected if site has never synced
        console.log(`[INFO] Sync history failed (expected if never synced): ${result.content[0].text}`);
      }
    });

    it('should get site changes for a linked site', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      // Get list of sites
      const sitesResult = await client.callTool('nexus_list_sites');
      expectSuccess(sitesResult);

      const sitesText = sitesResult.content[0].text;

      // Extract a local site name
      const match = sitesText.match(/- \*\*([^*]+)\*\* \([^)]+\.local\)/);
      if (!match) {
        console.log('[SKIP] No local sites found');
        return;
      }

      const siteName = match[1].trim();

      const result = await client.callTool('local_get_site_changes', {
        site: siteName,
      });

      // May succeed or fail if site is not linked
      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();
      } else {
        // Expected if site not linked to WPE
        console.log(`[INFO] Site changes failed (expected if not linked): ${result.content[0].text}`);
      }
    });
  });

  describe('Error Handling', () => {
    it('should return error for invalid install ID', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      const result = await client.callTool('wpe_get_install', {
        install_id: 'invalid-install-id-999999',
      });

      expect(result.isError).toBe(true);
      const errorText = result.content[0].text;
      expect(errorText).toBeTruthy();
    });

    it('should handle missing required parameters', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      // Call wpe_get_install without install_id parameter
      const result = await client.callTool('wpe_get_install', {});

      expect(result.isError).toBe(true);
    });

    it('should handle empty install ID gracefully', async () => {
      if (!capiAvailable) {
        console.log('[SKIP] CAPI not available');
        return;
      }

      const result = await client.callTool('wpe_get_install', {
        install_id: '',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('Tool Availability', () => {
    it('should have all expected WPE tools available', async () => {
      const tools = await client.listTools();
      const toolNames = tools.map((t) => t.name);

      // Check for WPE tools
      const wpeTools = [
        'wpe_get_accounts',
        'wpe_get_installs',
        'wpe_get_install',
        'wpe_create_backup',
        'wpe_purge_cache',
      ];

      for (const toolName of wpeTools) {
        expect(toolNames).toContain(toolName);
      }

      // Check for local-WPE integration tools
      const localWpeTools = [
        'local_wpe_link',
        'local_wpe_pull',
        'local_wpe_push',
        'nexus_list_sites',
        'local_get_site_changes',
        'local_get_sync_history',
      ];

      for (const toolName of localWpeTools) {
        expect(toolNames).toContain(toolName);
      }
    });

    it('should provide tool descriptions', async () => {
      const tools = await client.listTools();
      const wpeTool = tools.find((t) => t.name === 'wpe_get_accounts');

      expect(wpeTool).toBeDefined();
      expect(wpeTool?.description).toBeTruthy();
      expect(wpeTool?.description.length).toBeGreaterThan(10);
    });
  });
});
