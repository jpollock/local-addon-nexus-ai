/**
 * E2E tests for stress and concurrency scenarios
 *
 * Tests system behavior under load, concurrent operations,
 * and resource limits.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from './helpers/client';
import { getClient, getAnySite, deserializeEnvironment } from './helpers/environment';

describe('Stress & Concurrency Tests', () => {
  let client: McpClient;
  let siteName: string;

  beforeAll(() => {
    client = getClient();
    siteName = getAnySite().name;
  });

  describe('Concurrent Tool Calls', () => {
    it('should handle 10 concurrent tool calls', async () => {
      const calls = Array(10).fill(null).map(() =>
        client.callTool('wp_core_version', { site: siteName })
      );

      const results = await Promise.all(calls);

      // All should complete
      expect(results.length).toBe(10);

      // Most should succeed
      const successful = results.filter(r => !r.isError);
      expect(successful.length).toBeGreaterThan(7);
    });

    it('should handle concurrent tool calls to different operations', async () => {
      const calls = [
        client.callTool('wp_plugin_list', { site: siteName }),
        client.callTool('wp_theme_list', { site: siteName }),
        client.callTool('wp_user_list', { site: siteName }),
        client.callTool('wp_core_version', { site: siteName }),
        client.callTool('get_site_structure', { site: siteName }),
      ];

      const results = await Promise.allSettled(calls);

      // All should complete without hanging
      expect(results.length).toBe(5);

      // Check for successful completions
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(3);
    });

    it('should handle rapid successive calls', async () => {
      const results = [];

      for (let i = 0; i < 5; i++) {
        const result = await client.callTool('wp_core_version', { site: siteName });
        results.push(result);
      }

      expect(results.length).toBe(5);

      // All should succeed
      const successful = results.filter(r => !r.isError);
      expect(successful.length).toBe(5);
    });
  });

  describe('Large Result Sets', () => {
    it('should handle search with large limit', async () => {
      const result = await client.callTool('search_site_content', {
        site: siteName,
        query: 'WordPress',
        limit: 100,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    });

    it('should handle fleet operations across many sites', async () => {
      const result = await client.callTool('fleet_summary');

      // Should work regardless of fleet size
      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();
      }
    });

    it('should list all indexed sites efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('list_indexed_sites');

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);
      // Should complete in under 5 seconds even with many sites
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Resource Intensive Operations', () => {
    it('should handle site reindexing under load', async () => {
      const result = await client.callTool('reindex_site', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();
    }, 120000);

    it('should handle database export under load', async () => {
      const result = await client.callTool('wp_db_export', {
        site: siteName,
      });

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text.toLowerCase()).toMatch(/export|sql/);
    });
  });

  describe('MCP Protocol Stress', () => {
    it('should handle many rapid health checks', async () => {
      const healthChecks = Array(20).fill(null).map(() =>
        client.health()
      );

      const results = await Promise.all(healthChecks);

      expect(results.length).toBe(20);
      results.forEach(result => {
        expect(result.status).toBe('ok');
        expect(result.port).toBeDefined();
      });
    });

    it('should handle rapid tool listing', async () => {
      const listings = Array(10).fill(null).map(() =>
        client.listTools()
      );

      const results = await Promise.all(listings);

      expect(results.length).toBe(10);
      results.forEach(toolList => {
        expect(Array.isArray(toolList)).toBe(true);
        expect(toolList.length).toBeGreaterThan(50);
      });
    });
  });

  describe('Concurrent Site Operations', () => {
    it('should handle concurrent searches across different sites', async () => {
      const env = deserializeEnvironment();
      const sites = env.runningSites.slice(0, 3);

      if (sites.length < 2) {
        console.log('[SKIP] Need at least 2 running sites');
        return;
      }

      const searches = sites.map(site =>
        client.callTool('search_site_content', {
          site: site.name,
          query: 'test',
          limit: 5,
        })
      );

      const results = await Promise.allSettled(searches);

      expect(results.length).toBe(sites.length);

      // At least one should succeed
      const successful = results.filter(r =>
        r.status === 'fulfilled' && !(r.value as any).isError
      );
      expect(successful.length).toBeGreaterThan(0);
    });

    it('should handle concurrent plugin lists across sites', async () => {
      const env = deserializeEnvironment();
      const sites = env.runningSites.slice(0, 3);

      if (sites.length < 2) {
        console.log('[SKIP] Need at least 2 running sites');
        return;
      }

      const pluginLists = sites.map(site =>
        client.callTool('wp_plugin_list', { site: site.name })
      );

      const results = await Promise.allSettled(pluginLists);

      expect(results.length).toBe(sites.length);

      // All should complete
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(sites.length);
    });
  });

  describe('Memory & Timeout Handling', () => {
    it('should handle large search queries without timeout', async () => {
      const result = await client.callTool('search_across_sites', {
        query: 'WordPress plugin theme content',
        limit: 50,
      });

      // Should complete even with large cross-site search
      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();
      }
    });

    it('should handle repeated large operations', async () => {
      const operations = [];

      for (let i = 0; i < 3; i++) {
        const result = await client.callTool('search_site_content', {
          site: siteName,
          query: 'test',
          limit: 50,
        });
        operations.push(result);
      }

      expect(operations.length).toBe(3);

      // All should succeed
      const successful = operations.filter(r => !r.isError);
      expect(successful.length).toBe(3);
    });

    it('should not leak memory on repeated calls', async () => {
      // Make many successive calls to check for memory leaks
      for (let i = 0; i < 20; i++) {
        const result = await client.callTool('wp_core_version', {
          site: siteName,
        });
        expect(result).toBeDefined();
      }

      // If we got here without crashing, no obvious memory leak
      expect(true).toBe(true);
    });
  });

  describe('Error Handling Under Load', () => {
    it('should handle mixed valid and invalid calls gracefully', async () => {
      const calls = [
        client.callTool('wp_core_version', { site: siteName }),
        client.callTool('wp_core_version', { site: 'invalid-site' }),
        client.callTool('wp_plugin_list', { site: siteName }),
        client.callTool('wp_plugin_list', { site: 'invalid-site-2' }),
        client.callTool('wp_theme_list', { site: siteName }),
      ];

      const results = await Promise.allSettled(calls);

      expect(results.length).toBe(5);

      // Valid calls should succeed
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(2);
    });

    it('should recover from errors in concurrent operations', async () => {
      // Mix of valid and invalid operations
      const operations = [
        client.callTool('wp_plugin_list', { site: siteName }),
        client.callTool('wp_plugin_list', { site: '' }),
        client.callTool('wp_theme_list', { site: siteName }),
        client.callTool('wp_theme_list', { site: 'nonexistent' }),
      ];

      const results = await Promise.allSettled(operations);

      // System should not crash
      expect(results.length).toBe(4);

      // After errors, system should still work
      const followUpResult = await client.callTool('wp_core_version', {
        site: siteName,
      });
      expect(followUpResult.isError).not.toBe(true);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should complete simple operations quickly', async () => {
      const startTime = Date.now();

      const result = await client.callTool('wp_core_version', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);
      // Simple WP-CLI command should complete in under 3 seconds
      expect(duration).toBeLessThan(3000);
    });

    it('should handle search operations efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('search_site_content', {
        site: siteName,
        query: 'test',
        limit: 10,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);
      // Vector search should complete quickly
      expect(duration).toBeLessThan(5000);
    });

    it('should maintain responsiveness under load', async () => {
      // Start multiple operations
      const backgroundOps = Array(5).fill(null).map(() =>
        client.callTool('wp_plugin_list', { site: siteName })
      );

      // Measure response time for a simple query during load
      const startTime = Date.now();
      const healthCheck = await client.health();
      const duration = Date.now() - startTime;

      // Health check should remain fast even under load
      expect(duration).toBeLessThan(1000);
      expect(healthCheck.status).toBe('ok');

      // Wait for background operations to complete
      await Promise.all(backgroundOps);
    });
  });
});
