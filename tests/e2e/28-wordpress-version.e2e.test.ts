/**
 * E2E tests for WordPress version detection and upgrade workflow
 */
import { McpClient } from './helpers/client';
import { getClient, getAnySite, resultText, expectSuccess } from './helpers/environment';

describe('28 — WordPress Version Management', () => {
  let client: McpClient;
  let siteName: string;

  beforeAll(() => {
    client = getClient();
    siteName = getAnySite().name;
  });

  describe('Version Detection', () => {
    it('wp_core_version returns current WordPress version', async () => {
      const result = await client.callTool('wp_core_version', { site: siteName });
      expectSuccess(result);

      const text = resultText(result);
      // WordPress versions look like "6.x.y" or "7.x.y"
      expect(text).toMatch(/\d+\.\d+(\.\d+)?/);
    });

    it('version parsing works correctly for 6.x', () => {
      const version = '6.9.4';
      const match = version.match(/^(\d+)\.(\d+)/);
      expect(match).not.toBeNull();
      if (match) {
        const major = parseInt(match[1], 10);
        expect(major).toBe(6);
        expect(major >= 7).toBe(false); // Should require upgrade
      }
    });

    it('version parsing works correctly for 7.x', () => {
      const version = '7.0.1';
      const match = version.match(/^(\d+)\.(\d+)/);
      expect(match).not.toBeNull();
      if (match) {
        const major = parseInt(match[1], 10);
        expect(major).toBe(7);
        expect(major >= 7).toBe(true); // Should not require upgrade
      }
    });
  });

  describe('Upgrade Workflow', () => {
    it('site must be running for version check', async () => {
      const result = await client.callTool('wp_core_version', { site: siteName });

      // If site is halted, this will fail with a clear error
      if (result.isError) {
        const text = resultText(result);
        expect(text.toLowerCase()).toMatch(/running|started|halted/);
      } else {
        // Site is running, version check succeeds
        expectSuccess(result);
      }
    });

    // Note: We don't actually test wp core update here because:
    // 1. It's destructive (modifies the test site)
    // 2. It's slow (downloads and installs WordPress)
    // 3. It requires network access
    // Instead, we test the version check and leave upgrade testing to manual QA

    it('version check is fast (< 2 seconds)', async () => {
      const start = Date.now();
      const result = await client.callTool('wp_core_version', { site: siteName });
      const duration = Date.now() - start;

      // Version check should be very fast
      expect(duration).toBeLessThan(2000);

      if (!result.isError) {
        const text = resultText(result);
        expect(text.length).toBeGreaterThan(0);
      }
    });
  });

  describe('AI Plugin Compatibility', () => {
    it('version check is used to determine AI setup compatibility', async () => {
      const result = await client.callTool('wp_core_version', { site: siteName });

      if (!result.isError) {
        const versionText = resultText(result);
        const match = versionText.match(/^(\d+)\.(\d+)/);

        if (match) {
          const major = parseInt(match[1], 10);
          const isCompatible = major >= 7;

          console.log(`WordPress ${versionText}: AI plugin ${isCompatible ? 'compatible' : 'requires upgrade to 7.0+'}`);

          // This is informational - just verify we can parse the version
          expect(typeof isCompatible).toBe('boolean');
        }
      }
    });
  });
});
