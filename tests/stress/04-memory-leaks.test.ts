/**
 * Memory Leak Detection Tests
 *
 * Runs operations repeatedly to detect memory leaks.
 * Run with: node --expose-gc node_modules/.bin/jest --config tests/stress/jest.stress.config.js tests/stress/04-memory-leaks.test.ts
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from '../e2e/helpers/client';
import { getClient, getAnySite } from '../e2e/helpers/environment';
import { MemoryLeakDetector } from './memory-leak-detector';

describe('Memory Leak Detection', () => {
  let client: McpClient;
  let siteName: string;
  const detector = new MemoryLeakDetector();

  beforeAll(() => {
    client = getClient();
    siteName = getAnySite().name;

    if (!global.gc) {
      console.warn('⚠️  Run with --expose-gc for accurate leak detection');
    }
  });

  describe('MCP Tool Operations', () => {
    it('should not leak memory on repeated wp_core_version calls', async () => {
      const report = await detector.detectLeaks(
        'wp_core_version (1000 calls)',
        async () => {
          await client.callTool('wp_core_version', { site: siteName });
        },
        1000,
        100 // Sample every 100 iterations
      );

      MemoryLeakDetector.printReport(report);

      // Should not have severe leaks
      expect(report.leak_severity).not.toBe('severe');

      // Growth should be less than 25% (moderate leak threshold)
      expect(report.memory_growth_percent).toBeLessThan(25);
    }, 300000); // 5 minutes

    it('should not leak memory on repeated plugin list calls', async () => {
      const report = await detector.detectLeaks(
        'wp_plugin_list (500 calls)',
        async () => {
          await client.callTool('wp_plugin_list', { site: siteName });
        },
        500,
        50
      );

      MemoryLeakDetector.printReport(report);

      expect(report.leak_severity).not.toBe('severe');
      expect(report.memory_growth_percent).toBeLessThan(25);
    }, 300000);
  });

  describe('Search Operations', () => {
    it('should not leak memory on repeated search queries', async () => {
      const report = await detector.detectLeaks(
        'search_site_content (500 calls)',
        async () => {
          await client.callTool('search_site_content', {
            site: siteName,
            query: 'test',
            limit: 10,
          });
        },
        500,
        50
      );

      MemoryLeakDetector.printReport(report);

      expect(report.leak_severity).not.toBe('severe');
      expect(report.memory_growth_percent).toBeLessThan(25);
    }, 300000);

    it('should not leak memory on cross-site searches', async () => {
      const report = await detector.detectLeaks(
        'search_across_sites (200 calls)',
        async () => {
          await client.callTool('search_across_sites', {
            query: 'WordPress',
            limit: 5,
          });
        },
        200,
        20
      );

      MemoryLeakDetector.printReport(report);

      expect(report.leak_severity).not.toBe('severe');
      expect(report.memory_growth_percent).toBeLessThan(30); // Slightly higher threshold for cross-site
    }, 300000);
  });

  describe('Indexing Operations', () => {
    it('should not leak memory on repeated reindex operations', async () => {
      const report = await detector.detectLeaks(
        'reindex_site (20 calls)',
        async () => {
          await client.callTool('reindex_site', { site: siteName });
        },
        20,
        5 // Sample every 5 iterations (reindex is slow)
      );

      MemoryLeakDetector.printReport(report);

      expect(report.leak_severity).not.toBe('severe');
      // Indexing may grow more due to vector operations, but should stabilize
      expect(report.memory_growth_percent).toBeLessThan(40);
    }, 600000); // 10 minutes
  });

  describe('Fleet Operations', () => {
    it('should not leak memory on repeated fleet summary calls', async () => {
      const report = await detector.detectLeaks(
        'get_fleet_summary (200 calls)',
        async () => {
          await client.callTool('get_fleet_summary');
        },
        200,
        20
      );

      MemoryLeakDetector.printReport(report);

      expect(report.leak_severity).not.toBe('severe');
      expect(report.memory_growth_percent).toBeLessThan(25);
    }, 300000);

    it('should not leak memory on repeated list_indexed_sites calls', async () => {
      const report = await detector.detectLeaks(
        'list_indexed_sites (500 calls)',
        async () => {
          await client.callTool('list_indexed_sites');
        },
        500,
        50
      );

      MemoryLeakDetector.printReport(report);

      expect(report.leak_severity).not.toBe('severe');
      expect(report.memory_growth_percent).toBeLessThan(20);
    }, 300000);
  });
});
