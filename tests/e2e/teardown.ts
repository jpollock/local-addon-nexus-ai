import { loadConnectionInfo, stopLocal } from './helpers/environment';
import { McpClient } from './helpers/client';

module.exports = async function globalTeardown() {
  // Clean up temporary test site (before stopping Local)
  const createdSiteId = process.env.NEXUS_E2E_CREATED_SITE_ID;
  if (createdSiteId) {
    console.log(`\n[E2E Teardown] Cleaning up temporary test site: ${createdSiteId}`);

    const connectionInfo = loadConnectionInfo();
    if (!connectionInfo) {
      console.warn('[E2E Teardown] Connection info not found — skipping site cleanup');
    } else {
      const client = new McpClient(connectionInfo.url, connectionInfo.authToken);

      try {
        // Tier 3: first call gets confirmation token
        const confirmResult = await client.callTool('local_delete_site', {
          site: createdSiteId,
          trashFiles: true,
        });

        if (!confirmResult.isError && confirmResult.content[0]?.text) {
          try {
            const parsed = JSON.parse(confirmResult.content[0].text);
            if (parsed.requiresConfirmation && parsed.confirmationToken) {
              // Second call with token to actually delete
              await client.callTool('local_delete_site', {
                site: createdSiteId,
                trashFiles: true,
                _confirmationToken: parsed.confirmationToken,
              });
              console.log('[E2E Teardown] Temporary test site deleted');
            }
          } catch {
            // Response wasn't JSON confirmation — might have been deleted already
            console.log('[E2E Teardown] Site may have been deleted by tests already');
          }
        }
      } catch (err) {
        console.warn(`[E2E Teardown] Failed to delete test site: ${err}`);
      }
    }
  }

  // Stop Local if we started it
  if (process.env.NEXUS_E2E_STARTED_LOCAL === 'true') {
    stopLocal();
    delete process.env.NEXUS_E2E_STARTED_LOCAL;
  }
};
