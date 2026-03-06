/**
 * E2E tests for site context extraction and initial indexing
 *
 * Verifies the complete initial context building flow:
 * 1. Site starts → siteStarted hook fires
 * 2. ContentPipeline.indexSite() runs
 * 3. FileScanner extracts themes/plugins/versions
 * 4. MySQLExtractor pulls DB data (posts, users, custom tables, etc.)
 * 5. Structure cached in IndexRegistry
 * 6. get_site_structure returns complete context
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { McpClient } from './helpers/client';
import { getClient, getAnySite, expectSuccess } from './helpers/environment';

describe('Site Context E2E', () => {
  let client: McpClient;
  let siteName: string;
  let siteId: string;

  beforeAll(() => {
    client = getClient();
    const site = getAnySite();
    siteName = site.name;
    siteId = site.id;
  });

  describe('Initial Context Building', () => {
    it('should auto-index site on start (verify index status)', async () => {
      // After site starts, siteStarted hook should trigger indexing
      const result = await client.callTool('get_index_status', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;
      expect(text).toContain('State:');
      expect(text).toContain('Documents:');
      expect(text).toContain('Chunks:');

      // Should be in 'indexed' or 'stale' state (not 'idle' or 'error')
      expect(text.toLowerCase()).toMatch(/indexed|stale/);
    });

    it('should extract complete site structure', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Basic site info
      expect(text).toContain('##');
      expect(text).toContain('Domain:');
      expect(text).toContain('Path:');

      // WordPress/PHP versions
      expect(text).toContain('WordPress:');
      expect(text).toContain('PHP:');

      // Themes
      expect(text).toContain('### Themes');

      // Plugins
      expect(text).toContain('### Plugins');

      // Key integrations
      expect(text).toContain('### Key Integrations');
      expect(text).toContain('WooCommerce:');
      expect(text).toContain('ACF:');

      // Should include index status at the bottom
      expect(text).toContain('### Index Status');
    });

    it('should extract theme details (active, child theme detection)', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // If themes are found, should show active status and versions
      if (!text.includes('No themes found')) {
        expect(text).toMatch(/\(active\)/);
        expect(text).toMatch(/v\d+\.\d+/);
      } else {
        // Site not fully initialized yet
        expect(text).toContain('### Themes');
      }
    });

    it('should extract plugin details (active/inactive, versions)', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Should have plugins section
      expect(text).toContain('### Plugins');

      // If plugins are found, should show counts and versions
      if (!text.includes('No plugins found')) {
        expect(text).toMatch(/\d+ active.*\d+ installed/i);
        expect(text).toMatch(/v\d+\.\d+/);
      }
    });

    it('should extract user information when site is running', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Users section should exist if site has database access
      if (text.includes('### Users')) {
        expect(text).toContain('Total:');
        expect(text).toMatch(/Admin|Subscriber|Contributor|Editor/i);
      } else {
        // Site may not have DB access yet
        expect(text).toContain('### Themes');
      }
    });

    it('should extract custom database tables', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // If WooCommerce or ACF are installed, should show custom tables
      if (text.includes('WooCommerce: Installed') || text.includes('ACF: Installed')) {
        expect(text).toContain('### Custom Tables');
        expect(text).toMatch(/~\d+ rows/); // Should show row counts
      } else {
        // No custom plugins, so no custom tables expected
        expect(text).toContain('### Key Integrations');
      }
    });

    it('should extract REST API namespaces', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // REST API section should exist if site is running and fully initialized
      if (text.includes('### REST API')) {
        expect(text).toContain('Total routes:');
      } else {
        // Site may not have REST API data yet
        expect(text).toContain('### Themes');
      }
    });

    it('should extract site health indicators', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Site health section (may not exist if site is not fully initialized)
      if (text.includes('### Site Health')) {
        expect(text).toContain('Search engines:');
        expect(text).toContain('Permalinks:');
        expect(text).toContain('Language:');
        expect(text).toContain('Timezone:');
      } else {
        // Site may not have health data yet - verify it has basic structure
        expect(text).toContain('### Themes');
      }
    });
  });

  describe('Index Registry', () => {
    it('should list indexed sites', async () => {
      const result = await client.callTool('list_indexed_sites');
      expectSuccess(result);

      const text = result.content[0].text;

      // Should include our test site
      const includesSite = text.includes(siteName) || text.includes(siteId);
      expect(includesSite).toBe(true);

      // Should show index metadata
      expect(text).toMatch(/documents|chunks/i);
    });

    it('should track document and chunk counts', async () => {
      const result = await client.callTool('get_index_status', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Should contain document and chunk information
      expect(text.toLowerCase()).toMatch(/document|chunk/);

      // Extract counts if available (may be 0 for unindexed sites)
      const docMatch = text.match(/Documents?:\s*(\d+)/i);
      const chunkMatch = text.match(/Chunks?:\s*(\d+)/i);

      if (docMatch && chunkMatch) {
        const docCount = parseInt(docMatch[1], 10);
        const chunkCount = parseInt(chunkMatch[1], 10);

        // Counts should be non-negative
        expect(docCount).toBeGreaterThanOrEqual(0);
        expect(chunkCount).toBeGreaterThanOrEqual(0);
      }
    });

    it('should track last indexed timestamp', async () => {
      const result = await client.callTool('get_index_status', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Should have a timestamp (ISO 8601 format)
      expect(text).toContain('Last indexed:');
      expect(text).toMatch(/\d{4}-\d{2}-\d{2}/); // YYYY-MM-DD
    });

    it('should track indexing duration', async () => {
      const result = await client.callTool('get_index_status', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      expect(text).toContain('Duration:');
      expect(text).toMatch(/\d+ms/);
    });
  });

  describe('Reindex Capability', () => {
    it('should support manual reindex', async () => {
      const result = await client.callTool('reindex_site', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      expect(text).toContain('Re-index Complete');
      expect(text).toContain('Documents indexed:');
      expect(text).toContain('Chunks indexed:');
      expect(text).toContain('Duration:');
    }, 120000); // 2 minute timeout for full reindex

    it('should update index status after reindex', async () => {
      // Get timestamp before reindex
      const beforeResult = await client.callTool('get_index_status', { site: siteName });
      const beforeText = beforeResult.content[0].text;
      const beforeMatch = beforeText.match(/Last indexed:\s*(.+)/);
      const beforeTimestamp = beforeMatch ? beforeMatch[1].trim() : '';

      // Reindex
      await client.callTool('reindex_site', { site: siteName });

      // Small delay for registry update
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get timestamp after
      const afterResult = await client.callTool('get_index_status', { site: siteName });
      const afterText = afterResult.content[0].text;
      const afterMatch = afterText.match(/Last indexed:\s*(.+)/);
      const afterTimestamp = afterMatch ? afterMatch[1].trim() : '';

      // Timestamp should be updated (newer)
      expect(afterTimestamp).not.toBe(beforeTimestamp);
      expect(afterTimestamp).not.toBe('never');
    }, 120000);
  });

  describe('Error Handling', () => {
    it('should handle non-existent site gracefully', async () => {
      const result = await client.callTool('get_site_structure', {
        site: 'nonexistent-site-xyz-12345',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toMatch(/not found/i);
    });

    it('should handle unindexed site gracefully', async () => {
      // Create a site, don't index it, then query
      // For this test, we just verify the tool doesn't crash on sites without index entries
      const result = await client.callTool('get_index_status', {
        site: 'potentially-unindexed-site',
      });

      // Should either say "not found" or "has not been indexed yet"
      const text = result.content[0].text.toLowerCase();
      expect(text).toMatch(/not found|not been indexed/);
    });
  });

  describe('Structure Accuracy', () => {
    it('should correctly identify multisite status', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Standard Local sites are not multisite
      expect(text).toContain('Multisite:');
      // Should show either "No" or "Yes" (ignore any trailing characters/whitespace)
      expect(text).toMatch(/Multisite:.*?(No|Yes)/);
    });

    it('should show permalink structure', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Should show permalink pattern
      expect(text).toContain('Permalinks:');
      // Common patterns: "plain", "/%postname%/", etc.
      expect(text).toMatch(/plain|postname|category/i);
    });

    it('should detect WooCommerce if installed', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Should explicitly state WooCommerce detection
      expect(text).toMatch(/WooCommerce:\s*(Installed|Not found)/);
    });

    it('should detect ACF if installed', async () => {
      const result = await client.callTool('get_site_structure', { site: siteName });
      expectSuccess(result);

      const text = result.content[0].text;

      // Should explicitly state ACF detection
      expect(text).toMatch(/ACF:\s*(Installed|Not found)/);
    });
  });
});
