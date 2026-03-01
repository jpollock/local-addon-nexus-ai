import { McpClient } from './helpers/client';
import { getClient, getAnySite, resultText, expectSuccess } from './helpers/environment';

/**
 * Read-only WP-CLI tools against a running site.
 * No side effects — safe to run against any site.
 */
describe('03 — WordPress Inspection', () => {
  let client: McpClient;
  let siteName: string;

  beforeAll(() => {
    client = getClient();
    siteName = getAnySite().name;
  });

  it('wp_plugin_list returns installed plugins', async () => {
    const result = await client.callTool('wp_plugin_list', { site: siteName });
    expectSuccess(result);

    const text = resultText(result);
    // Every WordPress site has at least one plugin (akismet, hello-dolly, or similar)
    expect(text.length).toBeGreaterThan(0);
  });

  it('wp_theme_list returns installed themes', async () => {
    const result = await client.callTool('wp_theme_list', { site: siteName });
    expectSuccess(result);

    const text = resultText(result);
    // Every WordPress site has at least one theme
    expect(text.length).toBeGreaterThan(0);
  });

  it('wp_core_version returns a version string', async () => {
    const result = await client.callTool('wp_core_version', { site: siteName });
    expectSuccess(result);

    const text = resultText(result);
    // WordPress versions look like "6.x.y"
    expect(text).toMatch(/\d+\.\d+/);
  });

  it('wp_user_list returns at least one admin user', async () => {
    const result = await client.callTool('wp_user_list', { site: siteName });
    expectSuccess(result);

    const text = resultText(result);
    // Default WP install has an admin user
    expect(text.toLowerCase()).toMatch(/admin/);
  });

  it('wp_option_get retrieves blogname', async () => {
    const result = await client.callTool('wp_option_get', {
      site: siteName,
      option: 'blogname',
    });
    expectSuccess(result);

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it('wp_option_get retrieves siteurl', async () => {
    const result = await client.callTool('wp_option_get', {
      site: siteName,
      option: 'siteurl',
    });
    expectSuccess(result);

    const text = resultText(result);
    // siteurl should contain http:// or https://
    expect(text).toMatch(/https?:\/\//);
  });

  it('wp_site_health returns a response', async () => {
    const result = await client.callTool('wp_site_health', { site: siteName });

    // wp_site_health may fail on some sites (e.g. missing WP-CLI health-check package).
    // We just verify the tool executes and returns a non-empty response.
    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });
});
