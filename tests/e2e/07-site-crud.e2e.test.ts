import { McpClient } from './helpers/client';
import { getClient, resultText, expectSuccess } from './helpers/environment';

/**
 * Site CRUD tests — create and delete a site with Tier 3 confirmation flow.
 * This is a self-contained lifecycle: create → verify → delete.
 */
describe('07 — Site CRUD', () => {
  let client: McpClient;
  // Use a unique name to avoid collisions with leftover sites from previous runs
  const CRUD_SITE_NAME = `nexus-crud-${Date.now().toString(36).slice(-6)}`;
  let createdSiteId: string | null = null;

  beforeAll(() => {
    client = getClient();
  });

  afterAll(async () => {
    // Safety net: delete the test site if tests didn't clean it up
    if (createdSiteId) {
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
    }
  });

  it('local_create_site creates a new WordPress site', async () => {
    const result = await client.callTool('local_create_site', { name: CRUD_SITE_NAME });

    const text = resultText(result);
    if (result.isError) {
      throw new Error(`local_create_site failed: ${text}`);
    }
    expect(text.length).toBeGreaterThan(0);

    // Output format: "- **ID:** abc123"
    const idMatch = text.match(/\*\*ID:\*\*\s*(\S+)/);
    createdSiteId = idMatch ? idMatch[1] : CRUD_SITE_NAME;
    expect(createdSiteId).toBeTruthy();
  }, 120000); // Site creation can take up to 2 minutes

  it('newly created site appears in local_list_sites', async () => {
    if (!createdSiteId) {
      console.log('Skipping: site was not created');
      return;
    }

    // Wait for site to be ready
    await waitForSite(client, createdSiteId);

    const result = await client.callTool('local_list_sites');
    expectSuccess(result);

    const text = resultText(result);
    const mentionsSite = text.includes(CRUD_SITE_NAME) || text.includes(createdSiteId!);
    expect(mentionsSite).toBe(true);
  }, 120000);

  it('wp_core_version works on the new site', async () => {
    if (!createdSiteId) {
      console.log('Skipping: site was not created');
      return;
    }

    const result = await client.callTool('wp_core_version', { site: createdSiteId });
    expectSuccess(result);

    const text = resultText(result);
    expect(text).toMatch(/\d+\.\d+/);
  }, 60000);

  it('local_delete_site returns confirmation prompt (Tier 3)', async () => {
    if (!createdSiteId) {
      console.log('Skipping: site was not created');
      return;
    }

    const result = await client.callTool('local_delete_site', {
      site: createdSiteId,
      trashFiles: true,
    });
    expectSuccess(result);

    const parsed = JSON.parse(resultText(result));
    expect(parsed.requiresConfirmation).toBe(true);
    expect(parsed.tier).toBe(3);
    expect(parsed.confirmationToken).toBeTruthy();

    // Store token for next test
    (global as any).__deleteToken = parsed.confirmationToken;
  });

  it('local_delete_site with valid token deletes the site', async () => {
    if (!createdSiteId) {
      console.log('Skipping: site was not created');
      return;
    }

    const token = (global as any).__deleteToken;
    if (!token) {
      // If previous test didn't get a token, request a new one
      const confirmResult = await client.callTool('local_delete_site', {
        site: createdSiteId,
        trashFiles: true,
      });
      const parsed = JSON.parse(resultText(confirmResult));
      (global as any).__deleteToken = parsed.confirmationToken;
    }

    const result = await client.callTool('local_delete_site', {
      site: createdSiteId,
      trashFiles: true,
      _confirmationToken: (global as any).__deleteToken,
    });
    expectSuccess(result);

    const text = resultText(result).toLowerCase();
    expect(text).toMatch(/deleted|removed|success/);
  }, 60000);

  it('deleted site no longer in local_list_sites', async () => {
    if (!createdSiteId) {
      console.log('Skipping: site was not created');
      return;
    }

    const result = await client.callTool('local_list_sites');
    const text = resultText(result);

    // Site should not appear anymore
    expect(text).not.toContain(CRUD_SITE_NAME);

    // Clear the ID so afterAll doesn't try to clean up
    createdSiteId = null;
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
}
