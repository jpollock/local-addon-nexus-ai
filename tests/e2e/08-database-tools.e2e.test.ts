import { McpClient } from './helpers/client';
import { getClient, getAnySite, resultText, expectSuccess } from './helpers/environment';

/**
 * Database tools — export and search-replace (dry-run).
 * These operations are safe to run on any site (export is read-only,
 * search-replace defaults to dry-run).
 */
describe('08 — Database Tools', () => {
  let client: McpClient;
  let siteName: string;

  beforeAll(() => {
    client = getClient();
    siteName = getAnySite().name;
  });

  it('wp_db_export creates a SQL dump', async () => {
    const result = await client.callTool('wp_db_export', { site: siteName });
    expectSuccess(result);

    const text = resultText(result);
    // Should mention the export file path or success
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toMatch(/export|sql|dump|success/);
  }, 60000);

  it('wp_search_replace dry-run shows preview without modifying data', async () => {
    const result = await client.callTool('wp_search_replace', {
      site: siteName,
      search: 'http://localhost',
      replace: 'https://example.com',
    });
    expectSuccess(result);

    const text = resultText(result).toLowerCase();
    // Default is dry-run — should mention "dry run" or show replacements without applying
    expect(text).toMatch(/dry.?run|preview|would|replacement/);
  });

  it('wp_search_replace dry-run does not modify data', async () => {
    // Verify the siteurl is unchanged after dry-run
    const before = await client.callTool('wp_option_get', {
      site: siteName,
      option: 'siteurl',
    });
    expectSuccess(before);
    const urlBefore = resultText(before);

    // Run dry-run search-replace
    await client.callTool('wp_search_replace', {
      site: siteName,
      search: 'http://localhost',
      replace: 'https://example.com',
    });

    // siteurl should be unchanged
    const after = await client.callTool('wp_option_get', {
      site: siteName,
      option: 'siteurl',
    });
    expect(resultText(after)).toBe(urlBefore);
  });
});
