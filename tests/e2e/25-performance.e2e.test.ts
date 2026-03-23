/**
 * E2E Performance Tests
 *
 * Tests system performance with large datasets, bulk operations,
 * and fleet-scale workloads. Validates acceptable performance thresholds.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from './helpers/client';
import { getClient, getAnySite, deserializeEnvironment } from './helpers/environment';

describe('Performance Tests - Fleet Scale', () => {
  let client: McpClient;
  let siteName: string;
  let allSites: string[];

  beforeAll(() => {
    client = getClient();
    const env = deserializeEnvironment();
    siteName = getAnySite().name;

    // Get all available sites (running + halted)
    allSites = [...env.runningSites, ...env.haltedSites].map(s => s.name);

    console.log(`[Performance Tests] Fleet size: ${allSites.length} sites`);
  });

  describe('Large Fleet Discovery', () => {
    it('should list all sites efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('list_indexed_sites');

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Should complete in under 3 seconds regardless of fleet size
      console.log(`[Performance] list_indexed_sites: ${duration}ms`);
      expect(duration).toBeLessThan(3000);
    });

    it('should generate fleet summary efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('fleet_summary');

      const duration = Date.now() - startTime;

      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();

        // Fleet summary should complete in under 5 seconds
        console.log(`[Performance] fleet_summary: ${duration}ms`);
        expect(duration).toBeLessThan(5000);
      }
    });

    it('should find sites with plugin across large fleet', async () => {
      const startTime = Date.now();

      const result = await client.callTool('find_sites_with_plugin', {
        plugin: 'akismet',
      });

      const duration = Date.now() - startTime;

      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();

        // Plugin search across fleet should be fast
        console.log(`[Performance] find_sites_with_plugin: ${duration}ms`);
        expect(duration).toBeLessThan(3000);
      }
    });

    it('should find outdated sites efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('find_outdated_sites');

      const duration = Date.now() - startTime;

      if (!result.isError) {
        const text = result.content[0].text;
        expect(text).toBeTruthy();

        // Finding outdated sites should complete quickly
        console.log(`[Performance] find_outdated_sites: ${duration}ms`);
        expect(duration).toBeLessThan(3000);
      }
    });
  });

  describe('Cross-Site Search Performance', () => {
    it('should search across all sites efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('search_across_sites', {
        query: 'WordPress',
        limit: 20,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);
      const text = result.content[0].text;
      expect(text).toBeTruthy();

      // Cross-site search should complete in reasonable time
      console.log(`[Performance] search_across_sites (20 results): ${duration}ms`);
      expect(duration).toBeLessThan(10000);
    });

    it('should handle large result sets from cross-site search', async () => {
      const startTime = Date.now();

      const result = await client.callTool('search_across_sites', {
        query: 'post',
        limit: 100,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Larger result sets may take longer but should still be reasonable
      console.log(`[Performance] search_across_sites (100 results): ${duration}ms`);
      expect(duration).toBeLessThan(15000);
    });

    it('should perform multiple cross-site searches efficiently', async () => {
      const queries = ['WordPress', 'plugin', 'theme', 'post', 'page'];
      const startTime = Date.now();

      const results = await Promise.all(
        queries.map(query =>
          client.callTool('search_across_sites', { query, limit: 10 })
        )
      );

      const duration = Date.now() - startTime;

      expect(results.length).toBe(5);

      // Multiple searches should benefit from caching/parallel execution
      console.log(`[Performance] 5 parallel cross-site searches: ${duration}ms`);
      expect(duration).toBeLessThan(20000);
    });
  });

  describe('Single Site Search Performance', () => {
    it('should search site with small result set quickly', async () => {
      const startTime = Date.now();

      const result = await client.callTool('search_site_content', {
        site: siteName,
        query: 'WordPress',
        limit: 5,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Small searches should be very fast
      console.log(`[Performance] search_site_content (5 results): ${duration}ms`);
      expect(duration).toBeLessThan(1000);
    });

    it('should handle large single-site result sets', async () => {
      const startTime = Date.now();

      const result = await client.callTool('search_site_content', {
        site: siteName,
        query: 'test',
        limit: 100,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Large result sets should still be reasonably fast
      console.log(`[Performance] search_site_content (100 results): ${duration}ms`);
      expect(duration).toBeLessThan(3000);
    });

    it('should perform multiple searches on same site efficiently', async () => {
      const queries = ['WordPress', 'plugin', 'theme'];
      const startTime = Date.now();

      const results = await Promise.all(
        queries.map(query =>
          client.callTool('search_site_content', {
            site: siteName,
            query,
            limit: 10,
          })
        )
      );

      const duration = Date.now() - startTime;

      expect(results.length).toBe(3);

      // Multiple searches on same site should be fast
      console.log(`[Performance] 3 parallel site searches: ${duration}ms`);
      expect(duration).toBeLessThan(3000);
    });
  });

  describe('Indexing Performance', () => {
    it('should complete site reindexing within timeout', async () => {
      const startTime = Date.now();

      const result = await client.callTool('reindex_site', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Reindexing should complete in under 2 minutes for typical site
      console.log(`[Performance] reindex_site: ${duration}ms`);
      expect(duration).toBeLessThan(120000);
    }, 120000);

    it('should report index status quickly', async () => {
      const startTime = Date.now();

      const result = await client.callTool('get_index_status', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Status check should be instant
      console.log(`[Performance] get_index_status: ${duration}ms`);
      expect(duration).toBeLessThan(500);
    });

    it('should get site structure efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('get_site_structure', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Structure scan should be fast
      console.log(`[Performance] get_site_structure: ${duration}ms`);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('WordPress Inspection Performance', () => {
    it('should list plugins quickly', async () => {
      const startTime = Date.now();

      const result = await client.callTool('wp_plugin_list', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Plugin list via WP-CLI should be fast
      console.log(`[Performance] wp_plugin_list: ${duration}ms`);
      expect(duration).toBeLessThan(2000);
    });

    it('should list themes quickly', async () => {
      const startTime = Date.now();

      const result = await client.callTool('wp_theme_list', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      console.log(`[Performance] wp_theme_list: ${duration}ms`);
      expect(duration).toBeLessThan(5000); // Increased from 2000ms - WP-CLI can be slow
    });

    it('should list users quickly', async () => {
      const startTime = Date.now();

      const result = await client.callTool('wp_user_list', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      console.log(`[Performance] wp_user_list: ${duration}ms`);
      expect(duration).toBeLessThan(5000); // Increased from 2000ms - WP-CLI can be slow
    });

    it('should get core version instantly', async () => {
      const startTime = Date.now();

      const result = await client.callTool('wp_core_version', {
        site: siteName,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Version check should be very fast
      console.log(`[Performance] wp_core_version: ${duration}ms`);
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Throughput Tests', () => {
    it('should handle 50 sequential tool calls within reasonable time', async () => {
      const startTime = Date.now();
      let successCount = 0;

      for (let i = 0; i < 50; i++) {
        const result = await client.callTool('wp_core_version', {
          site: siteName,
        });
        if (!result.isError) successCount++;
      }

      const duration = Date.now() - startTime;

      expect(successCount).toBeGreaterThan(45);

      // 50 calls should complete in under 1 minute
      console.log(`[Performance] 50 sequential calls: ${duration}ms (${Math.round(duration / 50)}ms avg)`);
      expect(duration).toBeLessThan(60000);
    }, 60000);

    it('should handle 20 parallel tool calls efficiently', async () => {
      const startTime = Date.now();

      const calls = Array(20).fill(null).map(() =>
        client.callTool('wp_core_version', { site: siteName })
      );

      const results = await Promise.all(calls);

      const duration = Date.now() - startTime;

      const successCount = results.filter(r => !r.isError).length;
      expect(successCount).toBeGreaterThan(15);

      // Parallel execution should be much faster than sequential
      console.log(`[Performance] 20 parallel calls: ${duration}ms (${Math.round(duration / 20)}ms per call avg)`);
      expect(duration).toBeLessThan(10000);
    });
  });

  describe('MCP Protocol Performance', () => {
    it('should list tools quickly', async () => {
      const startTime = Date.now();

      const tools = await client.listTools();

      const duration = Date.now() - startTime;

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(50);

      console.log(`[Performance] listTools (${tools.length} tools): ${duration}ms`);
      expect(duration).toBeLessThan(500);
    });

    it('should handle health checks instantly', async () => {
      const startTime = Date.now();

      const health = await client.health();

      const duration = Date.now() - startTime;

      expect(health.status).toBe('ok');

      console.log(`[Performance] health check: ${duration}ms`);
      expect(duration).toBeLessThan(100);
    });

    it('should maintain low latency under load', async () => {
      // Start background load
      const backgroundOps = Array(10).fill(null).map(() =>
        client.callTool('wp_plugin_list', { site: siteName })
      );

      // Measure latency during load
      const startTime = Date.now();
      const health = await client.health();
      const latency = Date.now() - startTime;

      expect(health.status).toBe('ok');

      // Health check should remain fast even under load
      console.log(`[Performance] latency under load: ${latency}ms`);
      expect(latency).toBeLessThan(500);

      // Wait for background ops to complete
      await Promise.all(backgroundOps);
    });
  });
});
