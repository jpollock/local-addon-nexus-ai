import { McpClient } from './helpers/client';
import { getClient, getAnySite, resultText, expectSuccess } from './helpers/environment';

/**
 * Tests for MCP instructions, resources, and composite tools — Phase 8.
 */
describe('13 — Instructions & Resources', () => {
  let client: McpClient;

  beforeAll(async () => {
    client = getClient();
    await client.initialize();
  });

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  describe('resources', () => {
    it('resources/list returns registered resources', async () => {
      const resources = await client.listResources();
      expect(resources.length).toBeGreaterThanOrEqual(6);

      for (const r of resources) {
        expect(r.uri).toMatch(/^nexus:\/\//);
        expect(r.name).toBeTruthy();
        expect(r.description).toBeTruthy();
      }
    });

    it('resources/list includes expected URIs', async () => {
      const resources = await client.listResources();
      const uris = resources.map((r) => r.uri);

      expect(uris).toContain('nexus://guide/getting-started');
      expect(uris).toContain('nexus://guide/safety');
      expect(uris).toContain('nexus://guide/remote-wp-cli');
    });

    it('resources/read returns content for getting-started', async () => {
      const res = await client.readResource('nexus://guide/getting-started');
      expect(res.error).toBeUndefined();

      const result = res.result as {
        contents: Array<{ uri: string; text: string; mimeType: string }>;
      };
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('nexus://guide/getting-started');
      expect(result.contents[0].mimeType).toBe('text/markdown');
      expect(result.contents[0].text.length).toBeGreaterThan(100);
      expect(result.contents[0].text).toMatch(/^#/m);
    });

    it('resources/read returns content for safety guide', async () => {
      const res = await client.readResource('nexus://guide/safety');
      expect(res.error).toBeUndefined();

      const result = res.result as {
        contents: Array<{ uri: string; text: string; mimeType: string }>;
      };
      expect(result.contents[0].text).toMatch(/tier\s*1/i);
      expect(result.contents[0].text).toMatch(/tier\s*2/i);
      expect(result.contents[0].text).toMatch(/tier\s*3/i);
    });

    it('resources/read returns error for unknown URI', async () => {
      const res = await client.readResource('nexus://nonexistent');
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(-32602);
    });
  });

  // -------------------------------------------------------------------------
  // Composite Tools — registration
  // -------------------------------------------------------------------------

  describe('composite tools registration', () => {
    it('tools/list includes nexus_site_audit', async () => {
      const tools = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('nexus_site_audit');
    });

    it('tools/list includes nexus_plugin_audit', async () => {
      const tools = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('nexus_plugin_audit');
    });
  });

  // -------------------------------------------------------------------------
  // Composite Tools — execution against a real site
  // -------------------------------------------------------------------------

  describe('composite tools execution', () => {
    let siteName: string;

    beforeAll(() => {
      siteName = getAnySite().name;
    });

    it('nexus_site_audit returns unified report for a running site', async () => {
      const result = await client.callTool('nexus_site_audit', { site: siteName });
      expectSuccess(result);

      const text = resultText(result);

      // Should contain all audit sections
      expect(text).toContain('Site Audit');
      expect(text).toMatch(/WordPress.*\d+\.\d+/); // version number
      expect(text).toContain('Plugins');
      expect(text).toContain('Themes');
      expect(text).toContain('Site Health');
    });

    it('nexus_site_audit rejects unknown site', async () => {
      const result = await client.callTool('nexus_site_audit', { site: 'nonexistent-site-xyz' });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain('not found');
    });

    it('nexus_plugin_audit returns fleet-wide report', async () => {
      const result = await client.callTool('nexus_plugin_audit', {});
      expectSuccess(result);

      const text = resultText(result);

      // Should contain fleet header and summary
      expect(text).toContain('Fleet Plugin Audit');
      expect(text).toMatch(/\d+ sites/);
      expect(text).toContain('Total');
    });
  });
});
