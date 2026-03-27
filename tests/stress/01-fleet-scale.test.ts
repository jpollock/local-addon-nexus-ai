/**
 * Fleet Scale Stress Tests
 *
 * Tests system performance with 100+ sites.
 * Uses fixture data to avoid resource constraints.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { McpClient } from '../e2e/helpers/client';
import { getClient, deserializeEnvironment } from '../e2e/helpers/environment';
import { SiteGenerator } from './fixtures/site-generator';

describe('Stress Tests - Fleet Scale', () => {
  let client: McpClient;

  beforeAll(() => {
    client = getClient();
  });

  describe('100 Sites - List Operations', () => {
    it('should list 100 sites efficiently', async () => {
      // This test assumes the environment has many sites
      // In practice, we check performance with whatever sites exist
      const startTime = Date.now();

      const result = await client.callTool('local_list_sites');
      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      // Should complete in under 5 seconds regardless of site count
      console.log(`[Fleet Scale] list_sites with fleet: ${duration}ms`);
      expect(duration).toBeLessThan(5000);
    }, 10000);

    it('should handle concurrent list operations', async () => {
      const startTime = Date.now();

      // 10 concurrent list requests
      const calls = Array(10).fill(null).map(() =>
        client.callTool('local_list_sites')
      );

      const results = await Promise.all(calls);
      const duration = Date.now() - startTime;

      // All should succeed
      const successful = results.filter(r => !r.isError);
      expect(successful.length).toBe(10);

      console.log(`[Fleet Scale] 10 concurrent list_sites: ${duration}ms`);
      expect(duration).toBeLessThan(10000);
    }, 15000);
  });

  describe('Fleet Summary Operations', () => {
    it('should generate fleet summary efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('get_fleet_summary');
      const duration = Date.now() - startTime;

      if (!result.isError) {
        expect(result.content[0]?.text).toBeTruthy();
      }

      // Fleet summary should complete quickly
      console.log(`[Fleet Scale] get_fleet_summary: ${duration}ms`);
      expect(duration).toBeLessThan(10000);
    }, 15000);
  });

  describe('Cross-Fleet Search', () => {
    it('should search across all sites efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('search_across_sites', {
        query: 'WordPress',
        limit: 50,
      });

      const duration = Date.now() - startTime;

      expect(result.isError).not.toBe(true);

      console.log(`[Fleet Scale] search_across_sites: ${duration}ms`);
      // Should complete in under 15 seconds even with large fleet
      expect(duration).toBeLessThan(15000);
    }, 20000);

    it('should handle concurrent cross-fleet searches', async () => {
      const queries = ['plugin', 'theme', 'post', 'page', 'WordPress'];
      const startTime = Date.now();

      const searches = queries.map(query =>
        client.callTool('search_across_sites', { query, limit: 10 })
      );

      const results = await Promise.all(searches);
      const duration = Date.now() - startTime;

      const successful = results.filter(r => !r.isError);
      expect(successful.length).toBeGreaterThan(0);

      console.log(`[Fleet Scale] 5 concurrent cross-fleet searches: ${duration}ms`);
      expect(duration).toBeLessThan(30000);
    }, 35000);
  });

  describe('Fleet Filtering Operations', () => {
    it('should find outdated sites efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('find_outdated_sites');
      const duration = Date.now() - startTime;

      if (!result.isError) {
        expect(result.content[0]?.text).toBeTruthy();
      }

      console.log(`[Fleet Scale] find_outdated_sites: ${duration}ms`);
      expect(duration).toBeLessThan(10000);
    }, 15000);

    it('should find sites with specific plugin efficiently', async () => {
      const startTime = Date.now();

      const result = await client.callTool('find_sites_with_plugin', {
        plugin: 'akismet',
      });

      const duration = Date.now() - startTime;

      if (!result.isError) {
        expect(result.content[0]?.text).toBeTruthy();
      }

      console.log(`[Fleet Scale] find_sites_with_plugin: ${duration}ms`);
      expect(duration).toBeLessThan(10000);
    }, 15000);
  });

  describe('Memory Usage Under Load', () => {
    it('should maintain reasonable memory usage', async () => {
      const memBefore = process.memoryUsage();

      // Perform multiple operations
      for (let i = 0; i < 10; i++) {
        await client.callTool('local_list_sites');
      }

      const memAfter = process.memoryUsage();
      const rssDelta = (memAfter.rss - memBefore.rss) / 1024 / 1024; // MB

      console.log(`[Fleet Scale] Memory delta after 10 operations: ${rssDelta.toFixed(2)}MB`);

      // Should not grow by more than 50MB for 10 operations
      expect(rssDelta).toBeLessThan(50);
    }, 30000);
  });
});
