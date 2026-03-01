import { McpClient } from './helpers/client';
import { getClient, getAnySite, deserializeEnvironment, resultText, expectSuccess } from './helpers/environment';

/**
 * Site discovery tools — read-only, uses whatever sites exist in Local.
 */
describe('02 — Site Discovery', () => {
  let client: McpClient;

  beforeAll(() => {
    client = getClient();
  });

  describe('local_list_sites', () => {
    it('returns sites with correct status', async () => {
      const result = await client.callTool('local_list_sites');
      expectSuccess(result);

      const text = resultText(result);
      expect(text.length).toBeGreaterThan(0);

      // Should mention at least one site
      const env = deserializeEnvironment();
      const allSites = [...env.runningSites, ...env.haltedSites];
      expect(allSites.length).toBeGreaterThan(0);

      // At least one running site name should appear in the output
      const hasRunning = env.runningSites.some(
        (s) => text.includes(s.name) || text.includes(s.id),
      );
      if (env.runningSites.length > 0) {
        expect(hasRunning).toBe(true);
      }
    });

    it('output mentions "running" for running sites', async () => {
      const env = deserializeEnvironment();
      if (env.runningSites.length === 0) {
        return; // skip if no running sites
      }

      const result = await client.callTool('local_list_sites');
      const text = resultText(result).toLowerCase();
      expect(text).toContain('running');
    });
  });

  describe('local_get_site', () => {
    it('returns detailed info for a site by name', async () => {
      const site = getAnySite();
      const result = await client.callTool('local_get_site', { site: site.name });
      expectSuccess(result);

      const text = resultText(result);
      // Should include domain or path info
      expect(text.length).toBeGreaterThan(10);
    });

    it('returns detailed info for a site by ID', async () => {
      const site = getAnySite();
      const result = await client.callTool('local_get_site', { site: site.id });
      expectSuccess(result);
      expect(resultText(result).length).toBeGreaterThan(10);
    });

    it('returns error for non-existent site', async () => {
      const result = await client.callTool('local_get_site', {
        site: 'nonexistent-site-that-does-not-exist-12345',
      });
      expect(result.isError).toBe(true);
      expect(resultText(result).toLowerCase()).toContain('not found');
    });
  });

  describe('nexus_list_sites', () => {
    it('returns unified local + WPE view', async () => {
      const result = await client.callTool('nexus_list_sites');
      expectSuccess(result);

      const text = resultText(result);
      expect(text.length).toBeGreaterThan(0);

      // Should include the local section at minimum
      const env = deserializeEnvironment();
      if (env.runningSites.length > 0) {
        const site = env.runningSites[0];
        const mentionsSite = text.includes(site.name) || text.includes(site.id);
        expect(mentionsSite).toBe(true);
      }
    });
  });
});
