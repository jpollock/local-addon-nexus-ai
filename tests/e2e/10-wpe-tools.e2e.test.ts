import { McpClient } from './helpers/client';
import { getClient, deserializeEnvironment, resultText, expectSuccess } from './helpers/environment';

/**
 * WPE tools — conditional on CAPI availability.
 * These tests only run if the developer has WP Engine API credentials configured.
 *
 * Install-level operations use a WPE-linked local site (default: "nexus-test-site").
 * Override with NEXUS_E2E_WPE_SITE env var.
 */
describe('10 — WPE Tools', () => {
  let client: McpClient;
  let capiAvailable: boolean;

  beforeAll(() => {
    client = getClient();
    const env = deserializeEnvironment();
    capiAvailable = env.capiAvailable;
    if (!capiAvailable) {
      console.log('CAPI not available — skipping WPE tool tests');
    }
  });

  // -------------------------------------------------------------------------
  // Read-only CAPI queries
  // -------------------------------------------------------------------------

  it('wpe_get_accounts returns account list', async () => {
    if (!capiAvailable) return;

    const result = await client.callTool('wpe_get_accounts');
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it('wpe_get_installs returns install list', async () => {
    if (!capiAvailable) return;

    const result = await client.callTool('wpe_get_installs');
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it('wpe_get_install returns single install details', async () => {
    if (!capiAvailable) return;

    const listResult = await client.callTool('wpe_get_installs');
    if (listResult.isError) return;

    const text = resultText(listResult);
    const idMatch = text.match(/\(ID:\s*([^,)]+)/);
    if (!idMatch) {
      console.log('Could not extract install ID from wpe_get_installs output');
      return;
    }

    const installId = idMatch[1].trim();
    const result = await client.callTool('wpe_get_install', { install_id: installId });
    expectSuccess(result);
    expect(resultText(result).length).toBeGreaterThan(0);
  });

  it('nexus_list_sites shows WPE section when CAPI available', async () => {
    if (!capiAvailable) return;

    const result = await client.callTool('nexus_list_sites');
    expectSuccess(result);

    const text = resultText(result).toLowerCase();
    expect(text).toMatch(/wpe|wp engine|cloud|remote/);
  });

  // -------------------------------------------------------------------------
  // Install-level operations on a WPE-linked site
  // -------------------------------------------------------------------------

  describe('Install-level operations', () => {
    const WPE_SITE_NAME = process.env.NEXUS_E2E_WPE_SITE ?? 'nexus-test-site';
    let installId: string | null = null;
    let wpeSiteAvailable = false;

    beforeAll(async () => {
      if (!capiAvailable) return;

      // Verify the WPE-linked site exists in Local
      const siteResult = await client.callTool('local_get_site', { site: WPE_SITE_NAME });
      if (siteResult.isError) {
        console.log(`WPE site "${WPE_SITE_NAME}" not found in Local — skipping install-level tests`);
        return;
      }

      // Start it if halted
      const siteText = resultText(siteResult).toLowerCase();
      if (siteText.includes('halted') || siteText.includes('stopped')) {
        console.log(`[WPE Tests] Starting halted site "${WPE_SITE_NAME}"...`);
        const startResult = await client.callTool('local_start_site', { site: WPE_SITE_NAME });
        if (startResult.isError) {
          console.log(`Failed to start "${WPE_SITE_NAME}": ${resultText(startResult)}`);
          return;
        }
        // Wait for it to be running
        await waitForRunning(client, WPE_SITE_NAME);
      }

      // Discover the install ID from the installs list
      const installsResult = await client.callTool('wpe_get_installs');
      if (installsResult.isError) return;

      const installsText = resultText(installsResult);
      // Match install lines and find one containing the site name (without hyphens)
      // WPE install names are typically lowercase no-hyphen versions of site names
      const siteSlug = WPE_SITE_NAME.replace(/-/g, '').toLowerCase();
      const lines = installsText.split('\n');
      for (const line of lines) {
        const lineIdMatch = line.match(/\(ID:\s*([^,)]+)/);
        if (lineIdMatch && line.toLowerCase().replace(/-/g, '').includes(siteSlug)) {
          installId = lineIdMatch[1].trim();
          break;
        }
      }

      // Fallback: try matching just 'nexus' or 'test'
      if (!installId) {
        for (const line of lines) {
          const lineIdMatch = line.match(/\(ID:\s*([^,)]+)/);
          if (lineIdMatch && line.toLowerCase().includes('nexus')) {
            installId = lineIdMatch[1].trim();
            break;
          }
        }
      }

      if (installId) {
        wpeSiteAvailable = true;
        console.log(`[WPE Tests] Using install "${installId}" for site "${WPE_SITE_NAME}"`);
      } else {
        console.log(`[WPE Tests] Could not find WPE install matching "${WPE_SITE_NAME}" — skipping install-level tests`);
      }
    }, 120000);

    // -- Read-only link check -----------------------------------------------

    it('local_wpe_link shows WPE connection for linked site', async () => {
      if (!wpeSiteAvailable) return;

      const result = await client.callTool('local_wpe_link', { site: WPE_SITE_NAME });
      expectSuccess(result);

      const text = resultText(result);
      expect(text).toContain('WPE Link');
      expect(text).toContain(WPE_SITE_NAME);
    });

    it('local_wpe_link returns "not linked" for unlinked site', async () => {
      if (!capiAvailable) return;

      // Use a site that's definitely not linked to WPE
      const env = deserializeEnvironment();
      const unlinked = env.runningSites.find(
        (s) => s.name.toLowerCase() !== WPE_SITE_NAME.toLowerCase(),
      );

      if (!unlinked) {
        console.log('No unlinked site available to test — skipping');
        return;
      }

      const result = await client.callTool('local_wpe_link', { site: unlinked.name });
      expectSuccess(result);

      const text = resultText(result).toLowerCase();
      expect(text).toMatch(/not linked/);
    });

    // -- CAPI write operations (real WPE API calls) -------------------------

    it('wpe_create_backup creates a backup on WPE', async () => {
      if (!wpeSiteAvailable || !installId) return;

      const result = await client.callTool('wpe_create_backup', {
        install_id: installId,
        description: 'E2E test backup — safe to delete',
      });

      const text = resultText(result).toLowerCase();

      // CAPI write ops may fail with 401/403 if token lacks write scope
      if (result.isError && text.match(/401|403|unauthorized|forbidden/)) {
        console.log('CAPI token lacks write scope — skipping backup test');
        return;
      }

      expectSuccess(result);
      expect(text).toMatch(/backup.*created|created.*backup/);
    }, 60000);

    it('wpe_purge_cache purges the cache on WPE', async () => {
      if (!wpeSiteAvailable || !installId) return;

      const result = await client.callTool('wpe_purge_cache', {
        install_id: installId,
      });

      const text = resultText(result).toLowerCase();

      // May fail with 401/403 (no write scope) or 429 (rate limited)
      if (result.isError && text.match(/401|403|429|unauthorized|forbidden|rate/)) {
        console.log(`CAPI write not available: ${text.slice(0, 80)}`);
        return;
      }

      expectSuccess(result);
      expect(text).toMatch(/cache.*purged|purged.*cache/);
    });

    // -- Async local operations (queue only, don't wait for completion) ------

    it('local_wpe_pull returns queued status', async () => {
      if (!wpeSiteAvailable) return;

      const result = await client.callTool('local_wpe_pull', {
        site: WPE_SITE_NAME,
        include_database: false,
      });
      expectSuccess(result);

      const parsed = JSON.parse(resultText(result));
      expect(parsed.status).toBe('queued');
      expect(parsed.async).toBe(true);
      expect(parsed.site).toBe(WPE_SITE_NAME);
    });

    // -- Tier 3 confirmation flow (push) ------------------------------------

    it('local_wpe_push returns Tier 3 confirmation prompt', async () => {
      if (!wpeSiteAvailable) return;

      const result = await client.callTool('local_wpe_push', {
        site: WPE_SITE_NAME,
      });
      // First call without token should return confirmation prompt (not an error)
      expectSuccess(result);

      const parsed = JSON.parse(resultText(result));
      expect(parsed.requiresConfirmation).toBe(true);
      expect(parsed.tier).toBe(3);
      expect(parsed.confirmationToken).toBeTruthy();
      expect(parsed.action).toMatch(/overwrite/i);
    });

    it('local_wpe_push with valid token queues the push', async () => {
      if (!wpeSiteAvailable) return;

      // Step 1: get confirmation token
      const confirmResult = await client.callTool('local_wpe_push', {
        site: WPE_SITE_NAME,
        include_database: false,
      });
      const confirmParsed = JSON.parse(resultText(confirmResult));
      expect(confirmParsed.confirmationToken).toBeTruthy();

      // Step 2: confirm with token
      const result = await client.callTool('local_wpe_push', {
        site: WPE_SITE_NAME,
        include_database: false,
        _confirmationToken: confirmParsed.confirmationToken,
      });
      expectSuccess(result);

      const parsed = JSON.parse(resultText(result));
      expect(parsed.status).toBe('queued');
      expect(parsed.async).toBe(true);
      expect(parsed.include_database).toBe(false);
    });

    it('local_wpe_push with invalid token returns error', async () => {
      if (!wpeSiteAvailable) return;

      const result = await client.callTool('local_wpe_push', {
        site: WPE_SITE_NAME,
        _confirmationToken: 'invalid-token-12345',
      });
      expect(result.isError).toBe(true);
      expect(resultText(result).toLowerCase()).toMatch(/invalid|expired/);
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForRunning(client: McpClient, siteName: string, timeoutMs = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await client.callTool('local_get_site', { site: siteName });
      if (!result.isError && resultText(result).toLowerCase().includes('running')) {
        return;
      }
    } catch { /* keep polling */ }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
