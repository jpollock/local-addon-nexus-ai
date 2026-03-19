/**
 * E2E Negative Tests - Error Handling & Input Validation
 *
 * Comprehensive coverage of error conditions, invalid inputs, and edge cases
 * across all MCP tool modules. Expands negative test coverage from ~20% to ~40%.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from './helpers/client';
import { getClient, getAnySite, getTestSite, deserializeEnvironment } from './helpers/environment';

describe('Negative Tests - Input Validation', () => {
  let client: McpClient;
  let siteName: string;
  let testSiteName: string;
  let canRunMutations: boolean;

  beforeAll(() => {
    client = getClient();
    const anySite = getAnySite();
    siteName = anySite.name;

    const env = deserializeEnvironment();
    canRunMutations = !!env.testSiteId;
    if (canRunMutations) {
      testSiteName = getTestSite().name;
    }
  });

  describe('Site Operations - Invalid Inputs', () => {
    it('should reject empty site name', async () => {
      const result = await client.callTool('local_get_site', { site: '' });
      expect(result.isError).toBe(true);
    });

    it('should reject non-existent site name', async () => {
      const result = await client.callTool('local_get_site', {
        site: 'this-site-does-not-exist-xyz-12345',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject missing site parameter', async () => {
      const result = await client.callTool('local_get_site', {});
      expect(result.isError).toBe(true);
    });

    it('should reject malformed site name with special characters', async () => {
      const result = await client.callTool('local_get_site', {
        site: '<script>alert("xss")</script>',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('Site Lifecycle - Invalid State Transitions', () => {
    it('should handle stop on already-stopped site gracefully', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      // Ensure site is stopped
      await client.callTool('local_stop_site', { site: testSiteName });

      // Try to stop again
      const result = await client.callTool('local_stop_site', { site: testSiteName });

      // Should either succeed (idempotent) or error gracefully
      if (result.isError) {
        const text = result.content[0].text.toLowerCase();
        expect(text).toMatch(/already|stopped|halted|not running/);
      }

      // Either way, result should be defined
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();

      // Restart for next tests
      await client.callTool('local_start_site', { site: testSiteName });
    }, 120000);

    it('should reject restart on non-existent site', async () => {
      const result = await client.callTool('local_restart_site', {
        site: 'nonexistent-site-xyz',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('WordPress Inspection - Invalid Parameters', () => {
    it('should reject wp_plugin_list with empty site', async () => {
      const result = await client.callTool('wp_plugin_list', { site: '' });
      expect(result.isError).toBe(true);
    });

    it('should reject wp_theme_list with non-existent site', async () => {
      const result = await client.callTool('wp_theme_list', {
        site: 'invalid-site-12345',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject wp_user_list with missing site parameter', async () => {
      const result = await client.callTool('wp_user_list', {});
      expect(result.isError).toBe(true);
    });

    it('should reject wp_core_version on halted site', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      // Stop the test site
      await client.callTool('local_stop_site', { site: testSiteName });

      // Try WP-CLI command on stopped site
      const result = await client.callTool('wp_core_version', { site: testSiteName });
      expect(result.isError).toBe(true);

      const text = result.content[0].text.toLowerCase();
      expect(text).toMatch(/not running|stopped|halted|start/);

      // Restart for next tests
      await client.callTool('local_start_site', { site: testSiteName });
    }, 120000);
  });

  describe('Plugin Management - Invalid Operations', () => {
    it('should reject plugin install with empty slug', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      const result = await client.callTool('wp_plugin_install', {
        site: testSiteName,
        slug: '',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject plugin install with malformed slug', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      const result = await client.callTool('wp_plugin_install', {
        site: testSiteName,
        slug: 'invalid slug with spaces!@#$',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject plugin activate with missing parameters', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      const result = await client.callTool('wp_plugin_activate', {
        site: testSiteName,
        // slug missing
      });
      expect(result.isError).toBe(true);
    });

    it('should handle activate on non-existent plugin gracefully', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      const result = await client.callTool('wp_plugin_activate', {
        site: testSiteName,
        slug: 'plugin-that-does-not-exist-xyz-999',
      });
      expect(result.isError).toBe(true);
    });

    it('should handle deactivate on already-inactive plugin', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      // Deactivate akismet if it exists
      await client.callTool('wp_plugin_deactivate', {
        site: testSiteName,
        slug: 'akismet',
      });

      // Try to deactivate again
      const result = await client.callTool('wp_plugin_deactivate', {
        site: testSiteName,
        slug: 'akismet',
      });

      // Should either succeed (idempotent) or fail gracefully
      if (result.isError) {
        const text = result.content[0].text.toLowerCase();
        expect(text).toMatch(/not active|already|inactive|could not be found|no plugins deactivated/);
      }
    });
  });

  describe('Content Pipeline - Invalid Queries', () => {
    it('should reject search with missing site parameter', async () => {
      const result = await client.callTool('search_site_content', {
        query: 'test query',
        // site missing
      });
      expect(result.isError).toBe(true);
    });

    it('should handle search on non-indexed site', async () => {
      const result = await client.callTool('search_site_content', {
        site: 'definitely-not-indexed-site-xyz',
        query: 'test',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject reindex with non-existent site', async () => {
      const result = await client.callTool('reindex_site', {
        site: 'nonexistent-site-abc-123',
      });
      expect(result.isError).toBe(true);
    });

    it('should handle extremely long query strings', async () => {
      const longQuery = 'a'.repeat(10000);
      const result = await client.callTool('search_site_content', {
        site: siteName,
        query: longQuery,
      });

      // Should either handle it or reject gracefully
      if (!result.isError) {
        expect(result.content[0].text).toBeTruthy();
      } else {
        const text = result.content[0].text.toLowerCase();
        expect(text).toMatch(/too long|invalid|error/);
      }
    });
  });

  describe('Fleet Tools - Invalid Parameters', () => {
    it('should reject find_sites_with_plugin with empty plugin name', async () => {
      const result = await client.callTool('find_sites_with_plugin', {
        plugin: '',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject find_sites_with_plugin with missing parameter', async () => {
      const result = await client.callTool('find_sites_with_plugin', {});
      expect(result.isError).toBe(true);
    });

    it('should reject find_sites_with_theme with empty theme name', async () => {
      const result = await client.callTool('find_sites_with_theme', {
        theme: '',
      });
      expect(result.isError).toBe(true);
    });

    it('should handle find_sites_with_theme with special characters', async () => {
      const result = await client.callTool('find_sites_with_theme', {
        theme: '<script>alert(1)</script>',
      });

      // Should handle gracefully - either no results or error
      if (result.isError) {
        expect(result.content[0].text).toBeTruthy();
      }
    });
  });

  describe('Database Tools - Invalid Operations', () => {
    it('should reject db export with non-existent site', async () => {
      const result = await client.callTool('wp_db_export', {
        site: 'invalid-site-xyz-789',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject db export with missing site parameter', async () => {
      const result = await client.callTool('wp_db_export', {});
      expect(result.isError).toBe(true);
    });

    it('should reject db export on halted site', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      // Stop site
      await client.callTool('local_stop_site', { site: testSiteName });

      const result = await client.callTool('wp_db_export', {
        site: testSiteName,
      });
      expect(result.isError).toBe(true);

      // Restart
      await client.callTool('local_start_site', { site: testSiteName });
    }, 120000);
  });

  describe('Option Tools - Invalid Inputs', () => {
    it('should reject wp_option_get with empty option name', async () => {
      const result = await client.callTool('wp_option_get', {
        site: siteName,
        option_name: '',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject wp_option_get with missing parameters', async () => {
      const result = await client.callTool('wp_option_get', {
        site: siteName,
        // option_name missing
      });
      expect(result.isError).toBe(true);
    });

    it('should handle non-existent option gracefully', async () => {
      const result = await client.callTool('wp_option_get', {
        site: siteName,
        option_name: 'this_option_definitely_does_not_exist_xyz_999',
      });

      // Should either return empty/null or error gracefully
      if (result.isError) {
        const text = result.content[0].text.toLowerCase();
        expect(text).toMatch(/not found|does not exist|no value|required/);
      } else {
        // Empty result is also acceptable
        expect(result.content[0].text).toBeTruthy();
      }
    });
  });

  describe('Site Context - Invalid Requests', () => {
    it('should reject get_site_context with empty site', async () => {
      const result = await client.callTool('get_site_context', {
        site: '',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject get_site_context with non-existent site', async () => {
      const result = await client.callTool('get_site_context', {
        site: 'invalid-site-context-xyz',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject get_site_structure with missing parameter', async () => {
      const result = await client.callTool('get_site_structure', {});
      expect(result.isError).toBe(true);
    });
  });
});

describe('Negative Tests - Concurrent Operations', () => {
  let client: McpClient;
  let testSiteName: string;
  let canRunMutations: boolean;

  beforeAll(() => {
    client = getClient();
    const env = deserializeEnvironment();
    canRunMutations = !!env.testSiteId;
    if (canRunMutations) {
      testSiteName = getTestSite().name;
    }
  });

  describe('Concurrent Plugin Operations', () => {
    it('should handle concurrent plugin activations safely', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      // Try to activate the same plugin twice concurrently
      const results = await Promise.allSettled([
        client.callTool('wp_plugin_activate', {
          site: testSiteName,
          slug: 'akismet',
        }),
        client.callTool('wp_plugin_activate', {
          site: testSiteName,
          slug: 'akismet',
        }),
      ]);

      // Both operations should complete (either succeed or fail gracefully)
      expect(results.length).toBe(2);
      results.forEach((r) => {
        expect(r.status).toBe('fulfilled');
      });
    });
  });

  describe('Concurrent Indexing', () => {
    it('should handle concurrent reindex requests', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      // Try to reindex the same site twice concurrently
      const results = await Promise.allSettled([
        client.callTool('reindex_site', { site: testSiteName }),
        client.callTool('reindex_site', { site: testSiteName }),
      ]);

      // Should handle gracefully - either both succeed or fail with error message
      results.forEach((r) => {
        if (r.status === 'fulfilled') {
          const result = r.value as any;
          if (result.isError) {
            const text = result.content[0].text.toLowerCase();
            // May fail with "already in progress", "table not found", or other concurrency errors
            expect(text).toMatch(/already|in progress|busy|table|not found|failed/);
          }
        }
      });
    }, 120000);
  });
});
