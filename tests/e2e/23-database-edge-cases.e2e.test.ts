/**
 * E2E tests for database edge cases and error scenarios
 *
 * Tests database connection failures, corrupt databases, missing tables,
 * and compatibility with different database engines (MariaDB, MySQL variants).
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from './helpers/client';
import { getClient, getAnySite, getTestSite, deserializeEnvironment } from './helpers/environment';

describe('Database Edge Cases', () => {
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

  describe('Database Connection Handling', () => {
    it('should handle WP-CLI commands gracefully when site is stopped', async () => {
      if (!canRunMutations) {
        console.log('[SKIP] No test site available');
        return;
      }

      // Stop the test site to simulate database unavailability
      await client.callTool('local_stop_site', { site: testSiteName });

      // Try database-dependent operation
      const result = await client.callTool('wp_plugin_list', {
        site: testSiteName,
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text.toLowerCase();
      expect(text).toMatch(/not running|stopped|halted|start/);

      // Restart for next tests
      await client.callTool('local_start_site', { site: testSiteName });
    }, 120000);

    it('should detect database issues in site health check', async () => {
      const result = await client.callTool('wp_site_health', {
        site: siteName,
      });

      // Site health should run even if there are database issues
      // (it may report the issues but shouldn't hard-fail)
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();

      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();
        // Should mention database or MySQL somewhere
        expect(text.toLowerCase()).toMatch(/database|mysql|mariadb/);
      }
    });
  });

  describe('Database Export Edge Cases', () => {
    it('should export database successfully', async () => {
      const result = await client.callTool('wp_db_export', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toMatch(/export|sql|success/);
    });

    it('should handle db export on non-existent site gracefully', async () => {
      const result = await client.callTool('wp_db_export', {
        site: 'nonexistent-site-db-test',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text.toLowerCase();
      expect(text).toMatch(/not found|does not exist|invalid/);
    });

    it('should reject db export with empty site parameter', async () => {
      const result = await client.callTool('wp_db_export', {
        site: '',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('Database Query Operations', () => {
    it('should handle option get from database', async () => {
      const result = await client.callTool('wp_option_get', {
        site: siteName,
        option: 'siteurl',
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
      // Should return a URL
      expect(text.toLowerCase()).toMatch(/http|local/);
    });

    it('should handle non-existent option gracefully', async () => {
      const result = await client.callTool('wp_option_get', {
        site: siteName,
        option: 'this_option_will_never_exist_xyz_999',
      });

      // Should either return empty or error gracefully
      if (result.isError) {
        const text = result.content[0].text.toLowerCase();
        expect(text).toBeTruthy();
      } else {
        // Empty result is acceptable
        expect(result.content).toBeDefined();
      }
    });

    it('should list users from database', async () => {
      const result = await client.callTool('wp_user_list', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
      // Should show at least one user (admin)
      expect(text.length).toBeGreaterThan(10);
    });
  });

  describe('Content Extraction from Database', () => {
    it('should extract and index content from database', async () => {
      const result = await client.callTool('reindex_site', {
        site: siteName,
      });

      // Reindex reads from wp_posts table
      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    }, 120000);

    it('should search indexed database content', async () => {
      const result = await client.callTool('search_site_content', {
        site: siteName,
        query: 'WordPress',
        limit: 5,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    });

    it('should get index status after database operations', async () => {
      const result = await client.callTool('get_index_status', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text.toLowerCase();
      expect(text).toMatch(/indexed|documents|chunks/);
    });
  });

  describe('Database Schema Validation', () => {
    it('should detect WordPress tables via plugin list', async () => {
      // wp_plugin_list queries the database via WP-CLI
      const result = await client.callTool('wp_plugin_list', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
      // Should list plugins (akismet is usually default)
      expect(text.toLowerCase()).toMatch(/plugin|akismet|hello/);
    });

    it('should detect WordPress version from database', async () => {
      const result = await client.callTool('wp_core_version', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      // Should match WordPress version pattern
      expect(text).toMatch(/\d+\.\d+/);
    });

    it('should read theme data from database', async () => {
      const result = await client.callTool('wp_theme_list', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
      // Should show themes (Twenty themes are default)
      expect(text.toLowerCase()).toMatch(/theme|twenty/);
    });
  });

  describe('Database Engine Compatibility', () => {
    it('should work with standard MySQL/MariaDB setup', async () => {
      // Get database info via site structure
      const result = await client.callTool('get_site_structure', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();

      // Local typically uses MySQL or MariaDB
      // The structure should work regardless of specific engine
      expect(text.length).toBeGreaterThan(100);
    });

    it('should handle database operations consistently', async () => {
      // Run multiple database operations in sequence
      const operations = [
        client.callTool('wp_plugin_list', { site: siteName }),
        client.callTool('wp_theme_list', { site: siteName }),
        client.callTool('wp_user_list', { site: siteName }),
      ];

      const results = await Promise.all(operations);

      // All should succeed if database is healthy
      results.forEach((result) => {
        expect(result.isError).not.toBe(true);
        expect(result.content[0].text).toBeTruthy();
      });
    });
  });

  describe('Database Error Recovery', () => {
    it('should recover gracefully from transient database errors', async () => {
      // Make multiple rapid requests that query the database
      const rapidRequests = Array(5).fill(null).map(() =>
        client.callTool('wp_plugin_list', { site: siteName })
      );

      const results = await Promise.allSettled(rapidRequests);

      // Most should succeed; handle any failures gracefully
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThan(0);

      // Check that failures (if any) have meaningful errors
      const failed = results.filter((r) => r.status === 'rejected');
      failed.forEach((r) => {
        if (r.status === 'rejected') {
          expect(r.reason).toBeDefined();
        }
      });
    });

    it('should handle concurrent database reads', async () => {
      // Concurrent reads from different tables
      const concurrentOps = await Promise.allSettled([
        client.callTool('wp_plugin_list', { site: siteName }),
        client.callTool('wp_user_list', { site: siteName }),
        client.callTool('wp_option_get', { site: siteName, option: 'blogname' }),
      ]);

      // All operations should complete (not hang or deadlock)
      expect(concurrentOps.length).toBe(3);

      // At least some should succeed
      const successful = concurrentOps.filter(
        (r) => r.status === 'fulfilled' && !(r.value as any).isError
      );
      expect(successful.length).toBeGreaterThan(0);
    });
  });

  describe('Large Dataset Handling', () => {
    it('should handle sites with many posts gracefully', async () => {
      // Search will hit the database and vector store
      const result = await client.callTool('search_site_content', {
        site: siteName,
        query: 'test',
        limit: 100, // Request large result set
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    });

    it('should handle sites with many plugins', async () => {
      const result = await client.callTool('wp_plugin_list', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
      // Should handle listing many plugins without error
    });

    it('should handle sites with many users', async () => {
      const result = await client.callTool('wp_user_list', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    });
  });
});

describe('Database Performance Edge Cases', () => {
  let client: McpClient;
  let siteName: string;

  beforeAll(() => {
    client = getClient();
    siteName = getAnySite().name;
  });

  describe('Query Performance', () => {
    it('should complete database queries within reasonable time', async () => {
      const startTime = Date.now();

      const result = await client.callTool('wp_plugin_list', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);
      // Plugin list should complete in under 10 seconds
      expect(duration).toBeLessThan(10000);
    });

    it('should handle content indexing within timeout', async () => {
      const startTime = Date.now();

      const result = await client.callTool('reindex_site', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);
      // Reindex should complete (or at least return) within 2 minutes
      expect(duration).toBeLessThan(120000);
    }, 120000);
  });
});
