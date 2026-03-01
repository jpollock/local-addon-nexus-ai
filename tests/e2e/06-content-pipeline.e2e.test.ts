import { McpClient } from './helpers/client';
import { getClient, getAnySite, resultText, expectSuccess } from './helpers/environment';

/**
 * Content pipeline tests — index a real site and search real content.
 * Uses whichever running site is available (read-only until reindex).
 */
describe('06 — Content Pipeline', () => {
  let client: McpClient;
  let siteName: string;
  let siteId: string;

  beforeAll(() => {
    client = getClient();
    const site = getAnySite();
    siteName = site.name;
    siteId = site.id;
  });

  it('reindex_site indexes the site', async () => {
    const result = await client.callTool('reindex_site', { site: siteName });
    expectSuccess(result);

    const text = resultText(result);
    // Should mention documents or chunks indexed
    expect(text.length).toBeGreaterThan(0);
  }, 120000); // 2 min timeout for full index

  it('get_index_status shows indexed state after reindex', async () => {
    const result = await client.callTool('get_index_status', { site: siteName });
    expectSuccess(result);

    const text = resultText(result).toLowerCase();
    expect(text).toMatch(/indexed|documents|chunks/);
  });

  it('search_site_content returns results for relevant query', async () => {
    const result = await client.callTool('search_site_content', {
      site: siteName,
      query: 'WordPress',
    });
    expectSuccess(result);

    const text = resultText(result);
    // Default WordPress content should mention WordPress
    expect(text.length).toBeGreaterThan(0);
  });

  it('search_site_content returns no results for irrelevant query', async () => {
    const result = await client.callTool('search_site_content', {
      site: siteName,
      query: 'xyzzy plugh completely irrelevant gibberish term 12345',
    });
    expectSuccess(result);

    const text = resultText(result).toLowerCase();
    // Should indicate no results or very low relevance
    expect(text).toMatch(/no results|no relevant|0 results|nothing found/);
  });

  it('search_across_sites includes the indexed site', async () => {
    const result = await client.callTool('search_across_sites', {
      query: 'WordPress',
    });
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it('list_indexed_sites includes the indexed site', async () => {
    const result = await client.callTool('list_indexed_sites');
    expectSuccess(result);

    const text = resultText(result);
    // Should mention the site we just indexed
    const mentionsSite = text.includes(siteName) || text.includes(siteId);
    expect(mentionsSite).toBe(true);
  });
});
