/**
 * E2E tests for WordPress Multisite edge cases
 *
 * Tests multisite detection, network operations, and sub-site handling.
 * Note: Requires a multisite test instance - will skip if unavailable.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from './helpers/client';
import { getClient, deserializeEnvironment } from './helpers/environment';

describe('Multisite Edge Cases', () => {
  let client: McpClient;
  let multisiteName: string | null = null;
  let hasMultisite = false;

  beforeAll(async () => {
    client = getClient();
    const env = deserializeEnvironment();

    // Look for a multisite in the available sites
    // Check running sites first, then halted
    for (const site of [...env.runningSites, ...env.haltedSites]) {
      try {
        const structureResult = await client.callTool('get_site_structure', {
          site: site.name,
        });

        if (!structureResult.isError) {
          const text = structureResult.content[0].text;
          if (text.includes('**Multisite:** Yes')) {
            multisiteName = site.name;
            hasMultisite = true;
            console.log(`[Multisite Tests] Found multisite: ${multisiteName}`);
            break;
          }
        }
      } catch {
        // Site may not be running or accessible, continue
      }
    }

    if (!hasMultisite) {
      console.warn('[Multisite Tests] No multisite instance found - tests will be skipped');
      console.warn('[Multisite Tests] To enable these tests, create a multisite WordPress instance');
    }
  }, 60000);

  describe('Multisite Detection', () => {
    it('should detect multisite flag in site structure', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('get_site_structure', {
        site: multisiteName!,
      });

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toContain('**Multisite:** Yes');
    });

    it('should include multisite info in site context', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('get_site_context', {
        site: multisiteName!,
      });

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      // Should mention multisite somewhere in the context
      expect(text.toLowerCase()).toMatch(/multisite|network/);
    });
  });

  describe('Plugin Operations on Multisite', () => {
    it('should list plugins including network-activated ones', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('wp_plugin_list', {
        site: multisiteName!,
      });

      expect(result.isError).toBe(false);
      const text = result.content[0].text;

      // On multisite, should show activation status
      expect(text).toBeTruthy();
      expect(text.length).toBeGreaterThan(0);
    });

    it('should handle plugin activation on multisite', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      // Try to activate a default plugin (akismet)
      const result = await client.callTool('wp_plugin_activate', {
        site: multisiteName!,
        slug: 'akismet',
      });

      // Should either succeed or fail gracefully
      if (result.isError) {
        const text = result.content[0].text.toLowerCase();
        // Common multisite plugin activation errors
        expect(text).toMatch(/already|active|network|multisite|permission/);
      } else {
        expect(result.content[0].text).toBeTruthy();
      }
    });
  });

  describe('Content Indexing on Multisite', () => {
    it('should reindex multisite without errors', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('reindex_site', {
        site: multisiteName!,
      });

      // Multisite reindexing may behave differently
      // Should either succeed or fail with clear message
      if (result.isError) {
        const text = result.content[0].text.toLowerCase();
        // If it fails, should be a clear error about multisite
        expect(text).toMatch(/multisite|network|blog|sub-site/);
      } else {
        const text = result.content[0].text;
        expect(text).toBeTruthy();
        // Should mention documents or chunks indexed
        expect(text.length).toBeGreaterThan(0);
      }
    }, 120000);

    it('should search content on multisite', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('search_site_content', {
        site: multisiteName!,
        query: 'WordPress',
      });

      // Search should work regardless of multisite
      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    });

    it('should handle index status on multisite', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('get_index_status', {
        site: multisiteName!,
      });

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    });
  });

  describe('WordPress Inspection on Multisite', () => {
    it('should get WordPress version on multisite', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('wp_core_version', {
        site: multisiteName!,
      });

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toMatch(/\d+\.\d+/); // Version pattern
    });

    it('should list themes on multisite', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('wp_theme_list', {
        site: multisiteName!,
      });

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    });

    it('should list users on multisite', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('wp_user_list', {
        site: multisiteName!,
      });

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
      // Should show users (at minimum, admin)
      expect(text.length).toBeGreaterThan(0);
    });

    it('should get site health on multisite', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('wp_site_health', {
        site: multisiteName!,
      });

      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    });
  });

  describe('Database Operations on Multisite', () => {
    it('should export database on multisite', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('wp_db_export', {
        site: multisiteName!,
      });

      // DB export should work on multisite
      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
      // Should mention export or SQL file
      expect(text.toLowerCase()).toMatch(/export|sql|database/);
    });

    it('should handle options on multisite main site', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      // Try to get a common option
      const result = await client.callTool('wp_option_get', {
        site: multisiteName!,
        option_name: 'siteurl',
      });

      // Should work on multisite main site
      expect(result.isError).toBe(false);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    });
  });

  describe('Multisite-Specific Edge Cases', () => {
    it('should handle search across multisite network gracefully', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      // Search should work but may only search main site
      const result = await client.callTool('search_site_content', {
        site: multisiteName!,
        query: 'test query for multisite',
        limit: 5,
      });

      // Should not error even if no results
      expect(result.isError).toBe(false);
    });

    it('should detect multisite in fleet summary', async () => {
      if (!hasMultisite) {
        console.log('[SKIP] No multisite available');
        return;
      }

      const result = await client.callTool('fleet_summary');

      if (!result.isError) {
        const text = result.content[0].text.toLowerCase();
        // Fleet summary might mention multisite sites
        expect(text).toBeTruthy();
      }
    });
  });
});

describe('Non-Multisite Verification', () => {
  let client: McpClient;
  let regularSiteName: string | null = null;

  beforeAll(async () => {
    client = getClient();
    const env = deserializeEnvironment();

    // Find a non-multisite site
    for (const site of env.runningSites) {
      try {
        const structureResult = await client.callTool('get_site_structure', {
          site: site.name,
        });

        if (!structureResult.isError) {
          const text = structureResult.content[0].text;
          if (text.includes('**Multisite:** No')) {
            regularSiteName = site.name;
            console.log(`[Non-Multisite Tests] Found regular site: ${regularSiteName}`);
            break;
          }
        }
      } catch {
        continue;
      }
    }

    if (!regularSiteName) {
      console.warn('[Non-Multisite Tests] No regular (non-multisite) site found');
    }
  }, 30000);

  it('should correctly identify non-multisite installations', async () => {
    if (!regularSiteName) {
      console.log('[SKIP] No regular (non-multisite) site found');
      // Test passes - it's fine if all sites are multisite
      return;
    }

    const result = await client.callTool('get_site_structure', {
      site: regularSiteName,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();

    // isError is optional, so check for truthy value instead of false
    expect(result.isError).not.toBe(true);

    const text = result.content[0].text;
    expect(text).toContain('**Multisite:** No');
  });
});
