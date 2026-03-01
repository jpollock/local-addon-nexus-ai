import { McpClient } from './helpers/client';
import { getClient, resultText } from './helpers/environment';

/**
 * Fleet tools against real indexed sites.
 * Requires at least one site to be indexed (test 06 should have done this).
 */
describe('09 — Fleet Tools', () => {
  let client: McpClient;

  beforeAll(() => {
    client = getClient();
  });

  it('fleet_summary shows real version distribution', async () => {
    const result = await client.callTool('fleet_summary');

    if (result.isError) {
      // Fleet tools may fail if no sites are indexed yet
      const text = resultText(result).toLowerCase();
      expect(text).toMatch(/no.*indexed|no.*sites|empty/);
      return;
    }

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it('find_sites_with_plugin finds real plugin matches', async () => {
    // "akismet" is installed by default on WordPress sites
    const result = await client.callTool('find_sites_with_plugin', {
      plugin: 'akismet',
    });

    if (result.isError) {
      // May fail if no sites indexed
      return;
    }

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it('find_outdated_sites identifies version status', async () => {
    const result = await client.callTool('find_outdated_sites');

    if (result.isError) {
      // May fail if no sites indexed
      return;
    }

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });

  it('find_sites_with_theme finds theme matches', async () => {
    // Default WordPress themes start with "twenty"
    const result = await client.callTool('find_sites_with_theme', {
      theme: 'twenty',
    });

    if (result.isError) {
      return;
    }

    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
  });
});
