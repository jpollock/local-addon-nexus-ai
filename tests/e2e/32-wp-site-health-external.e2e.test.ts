/**
 * wp_site_health against an external SSH host.
 *
 * This lives here rather than in tests/e2e-cli/ because `nexus wp health` has
 * no GraphQL fallback — it calls the MCP tool and exits 1 if the MCP server is
 * unreachable, which the CLI suite cannot guarantee.
 */
import { McpClient } from './helpers/client';
import { loadConnectionInfo } from './helpers/environment';
import { FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey } from '../e2e-cli/helpers/ssh-fixture';
import { runCli } from '../e2e-cli/helpers/cli-test-utils';

const d = fixtureAvailable() ? describe : describe.skip;

d('wp_site_health on an external host', () => {
  let client: McpClient;

  beforeAll(async () => {
    await trustFixtureHostKey();
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });

    const info = loadConnectionInfo();
    if (!info) throw new Error('MCP connection info not available');
    client = new McpClient(info.url, info.authToken);
    await client.initialize();
  }, 200_000);

  it('returns a health report for a full ssh target', async () => {
    const result = await client.callTool('wp_site_health', {
      ssh_target: `ssh:${FIXTURE_ALIAS}/alpha@production`,
    });
    expect(result.isError).toBeFalsy();
    // The pre-port failure mode was a literal 'Site "undefined" not found.'
    expect(result.content[0].text).not.toContain('undefined');
  });
});
