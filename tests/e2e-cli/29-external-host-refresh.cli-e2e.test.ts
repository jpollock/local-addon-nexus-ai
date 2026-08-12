/**
 * External host refresh: what gets collected, and what must stay NULL.
 *
 * NON-VACUITY: change src/main/graphql/resolvers.ts:2950 from
 * `const externalScoreable = hasPlugins && !!row.php_version;` to
 * `const externalScoreable = hasPlugins;` and the batch-loss test must go RED.
 * A host with plugins but no PHP version would be scored with fabricated data.
 *
 * Note: the identical gate also exists at get-site-health.ts:91 for the MCP path.
 * The two are NOT pinned together by any test — a change to one must be mirrored
 * to the other.
 *
 * Also: the `|| '8.0'` fallback at :83 is structurally unreachable on the external
 * path, because externalScoreable gates on the raw `row.php_version` column. The
 * fabrication risk applies to the WPE branch, which is scored unconditionally.
 */
import { runCli } from './helpers/cli-test-utils';
import {
  FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey, resetFixtureGraphState,
  clearFixturePhpVersion,
} from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host refresh', () => {
  beforeAll(async () => {
    await trustFixtureHostKey();
    await resetFixtureGraphState(); // Hard-delete fixture rows for a genuinely unrefreshed state
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
  });

  it('leaves php_version NULL when never refreshed, never defaulting to 8.0', async () => {
    const r = await runCli(['sites', 'get', `ssh:${FIXTURE_ALIAS}/alpha@production`, '--json'],
      { timeout: 120_000 });
    const site = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(site.phpVersion ?? null).toBeNull();
    expect(JSON.stringify(site)).not.toContain('8.0');
  });

  it('is not scored before any refresh has run', async () => {
    const r = await runCli(['fleet', 'site-health', `ssh:${FIXTURE_ALIAS}/alpha@production`],
      { timeout: 120_000 });
    expect(r.output).toMatch(/not enough data to score/i);
  });

  it('host refresh collects plugin, theme and php_version rows for both installs', async () => {
    const r = await runCli(['host', 'refresh', FIXTURE_ALIAS], { timeout: 300_000 });
    expect(r.exitCode).toBe(0);

    const alpha = await runCli(['sites', 'get', `ssh:${FIXTURE_ALIAS}/alpha@production`, '--json'],
      { timeout: 120_000 });
    const alphaData = JSON.parse(alpha.stdout.slice(alpha.stdout.indexOf('{')));
    expect(alphaData.phpVersion).toBe('8.3.33');

    const beta = await runCli(['sites', 'get', `ssh:${FIXTURE_ALIAS}/beta@production`, '--json'],
      { timeout: 120_000 });
    const betaData = JSON.parse(beta.stdout.slice(beta.stdout.indexOf('{')));
    expect(betaData.phpVersion).toBe('8.3.33');
  });

  it('is scored on security and performance once refreshed', async () => {
    const r = await runCli(['fleet', 'site-health', `ssh:${FIXTURE_ALIAS}/alpha@production`],
      { timeout: 120_000 });
    expect(r.output).not.toMatch(/not enough data to score/i);
    // Only two of the five factors apply to a remote host: maintenance and
    // activity read local-only tables, and stability counts local events.
    expect(r.output.toLowerCase()).toContain('security');
    expect(r.output.toLowerCase()).toContain('performance');
  });

  it('is unscored when plugins exist but php_version is NULL — models batch-loss scenario', async () => {
    // runWpCliBatch can lose a section, so plugins land while the version does not.
    await clearFixturePhpVersion();

    const r = await runCli(['sites', 'get', `ssh:${FIXTURE_ALIAS}/alpha@production`, '--json'],
      { timeout: 120_000 });
    const site = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(site.phpVersion ?? null).toBeNull();

    const health = await runCli(['fleet', 'site-health', `ssh:${FIXTURE_ALIAS}/alpha@production`],
      { timeout: 120_000 });
    expect(health.output).toMatch(/not enough data to score/i);
  });
});
