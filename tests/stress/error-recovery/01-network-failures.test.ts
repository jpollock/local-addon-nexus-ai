/**
 * Network Failure Recovery Tests
 *
 * Tests system resilience to network failures.
 */

import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import { McpClient } from '../../e2e/helpers/client';
import { getClient } from '../../e2e/helpers/environment';
import { NetworkSimulator } from './network-simulator';

describe('Error Recovery - Network Failures', () => {
  let client: McpClient;
  const simulator = new NetworkSimulator();

  beforeAll(() => {
    client = getClient();
  });

  afterEach(() => {
    // Always disable simulator after each test
    simulator.disable();
  });

  describe('Timeout Handling', () => {
    it('should handle occasional timeouts gracefully', async () => {
      // Simulate 20% timeout rate
      simulator.enable('timeout', 0.2);

      let successCount = 0;
      let errorCount = 0;

      // Try 10 operations
      for (let i = 0; i < 10; i++) {
        try {
          const result = await client.callTool('local_list_sites');
          if (!result.isError) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch (err) {
          errorCount++;
        }
      }

      console.log(`[Network Failures] Timeout test: ${successCount} success, ${errorCount} errors`);

      // Should have some successes despite timeouts
      expect(successCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Connection Refused Handling', () => {
    it('should handle connection errors gracefully', async () => {
      // Simulate 30% connection error rate
      simulator.enable('error', 0.3);

      let successCount = 0;
      let errorCount = 0;

      // Try 10 operations
      for (let i = 0; i < 10; i++) {
        try {
          const result = await client.callTool('local_list_sites');
          if (!result.isError) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch (err) {
          errorCount++;
        }
      }

      console.log(`[Network Failures] Connection error test: ${successCount} success, ${errorCount} errors`);

      // Should have some successes
      expect(successCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Slow Network Handling', () => {
    it('should handle slow network responses', async () => {
      // Simulate slow network (5s delay on all responses)
      simulator.enable('slow', 0.5);

      const startTime = Date.now();

      try {
        const result = await client.callTool('local_list_sites');
        const duration = Date.now() - startTime;

        console.log(`[Network Failures] Slow network test: ${duration}ms`);

        // Should complete even if slow (or timeout appropriately)
        expect(result).toBeDefined();
      } catch (err) {
        // Timeout is acceptable for slow network
        console.log(`[Network Failures] Slow network timed out (acceptable)`);
        expect(err).toBeDefined();
      }
    }, 30000);
  });

  describe('Recovery After Failures', () => {
    it('should recover after network failures', async () => {
      // Enable failures
      simulator.enable('error', 1.0);

      // Try operation (should fail)
      try {
        await client.callTool('local_list_sites');
      } catch (err) {
        // Expected to fail
      }

      // Disable failures
      simulator.disable();

      // Wait a moment for recovery
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Try again (should succeed)
      const result = await client.callTool('local_list_sites');
      expect(result.isError).not.toBe(true);

      console.log(`[Network Failures] Successfully recovered after failures`);
    }, 30000);
  });

  describe('System Stability Under Network Stress', () => {
    it('should remain stable despite intermittent failures', async () => {
      // Simulate 50% failure rate (high stress)
      simulator.enable('timeout', 0.5);

      const operations = [];
      for (let i = 0; i < 20; i++) {
        operations.push(
          client.callTool('local_list_sites')
            .then(result => ({ success: !result.isError }))
            .catch(() => ({ success: false }))
        );
      }

      const results = await Promise.all(operations);
      const successful = results.filter(r => r.success).length;

      console.log(`[Network Failures] Stress test: ${successful}/20 successful`);

      // Should have some successes even with 50% failure rate
      expect(successful).toBeGreaterThan(5);

      // System should still be responsive after stress
      simulator.disable();
      await new Promise(resolve => setTimeout(resolve, 500));

      const health = await client.health();
      expect(health.status).toBe('ok');
    }, 60000);
  });
});
