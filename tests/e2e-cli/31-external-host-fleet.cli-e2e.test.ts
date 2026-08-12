/**
 * A registered external host must be visible to every fleet-wide reader.
 *
 * NON-VACUITY (each assertion proven independently):
 * 1. "appears in sites list" → resolvers.ts:674 `WHERE source = 'external'`
 * 2. "appears in nexus_list_sites" → nexus-list-sites.ts:101 `WHERE source = 'external'`
 * 3. "appears in nexus://fleet/state" → resources/index.ts:260 `WHERE source = 'external'`
 * 4. "its installs appear in fleet plugins" → resolvers.ts:1825 `WHERE source IN ('wpe','external')`
 *
 * The single-source `'wpe'` filter is what made external hosts invisible — a chat
 * agent would confidently report a registered host as "not registered".
 */
import { runCli } from './helpers/cli-test-utils';
import { NexusMcpClient, loadConnectionInfo } from './helpers/mcp-client';
import { FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey } from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external hosts in fleet-wide views', () => {
  let mcpClient: NexusMcpClient;

  beforeAll(async () => {
    const info = loadConnectionInfo();
    if (!info) throw new Error('MCP connection info not available');
    mcpClient = new NexusMcpClient(info);

    await trustFixtureHostKey();
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
    await runCli(['host', 'refresh', FIXTURE_ALIAS], { timeout: 300_000 });
  });

  it('appears in sites list', async () => {
    const r = await runCli(['sites', 'list', '--json'], { timeout: 120_000 });
    const parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(parsed.external).toBeDefined();
    const aliases = parsed.external.map((e: any) => e.alias);
    expect(aliases).toContain(FIXTURE_ALIAS);
  });

  it('appears in nexus_list_sites — the tool agents call first', async () => {
    // This is the historical gap: a registered host was invisible here, so a
    // chat agent would confidently report it as "not registered".
    const text = await mcpClient.callTool('nexus_list_sites', {});
    // Structural assertion: must have the External SSH Hosts section with our alias
    expect(text).toMatch(/### External SSH Hosts/);
    expect(text).toMatch(new RegExp(`\\*\\*${FIXTURE_ALIAS}/alpha\\*\\*`));
  });

  it('appears in the nexus://fleet/state resource', async () => {
    const text = await mcpClient.readResource('nexus://fleet/state');
    // Structural assertion: must have the External SSH Hosts section with a table row
    expect(text).toMatch(/## External SSH Hosts/);
    expect(text).toMatch(new RegExp(`\\| ${FIXTURE_ALIAS} \\| alpha \\|`));
  });

  it('its installs appear in fleet plugins', async () => {
    // fleet plugins --json lists plugins, each with a `sites` array of SITE
    // NAMES (e.g. "localwpe") — never aliases. So assert the install names.
    // `fleet summary` is deliberately NOT asserted here: it takes no options
    // at all and is a pure aggregate ("filesystem  9 sites"), so it never
    // names an individual site and cannot evidence inclusion.
    const r = await runCli(['fleet', 'plugins', '--json'], { timeout: 180_000 });
    const parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    const allSites = parsed.plugins.flatMap((p: any) => p.sites ?? []);
    expect(allSites).toEqual(expect.arrayContaining(['alpha']));
  });

  it('never reports a coverage figure whose numerator exceeds its denominator', async () => {
    // fleet_overview counted wp_version across WPE + external but divided by
    // the WPE-only count, printing "1 of 0" for a user with SSH hosts and no
    // WP Engine account.
    //
    // Called as an MCP tool, not a CLI subcommand: `nexus fleet overview` does
    // not exist (fleet has health/site-health/summary/plugins/... — verified
    // against src/cli/commands/fleet.ts). Calling MCP directly from this suite
    // is the established pattern in 25-mcp-tools-direct.cli-e2e.test.ts.
    const text = await mcpClient.callTool('fleet_overview', {});
    const pairs = [...text.matchAll(/(\d+)\s+of\s+(\d+)/g)];
    expect(pairs.length).toBeGreaterThan(0); // else the regex silently passes
    for (const [, num, den] of pairs) {
      expect(Number(num)).toBeLessThanOrEqual(Number(den));
    }
  });
});
