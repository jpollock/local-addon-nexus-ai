/**
 * Target resolution and the permission gate for external hosts.
 *
 * NON-VACUITY: change mostRestrictiveEnvironment (src/main/mcp/utils/
 * operation-permissions.ts, used at src/main/transport/resolve.ts:10) to return
 * the target's suffix instead of the more restrictive of the two, and
 * "a @development suffix cannot loosen a production host" must go RED. Gating
 * on the target alone is exactly how a production host became writable by
 * addressing it as ssh:<alias>@development.
 */
import { runCli } from './helpers/cli-test-utils';
import { FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey } from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host target resolution', () => {
  beforeAll(async () => {
    await trustFixtureHostKey();
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
  });

  it.each([
    ['core', 'version'],
    ['plugin', 'list'],
    ['theme', 'list'],
  ])('wp %s %s reaches the host on a full target', async (a, b) => {
    const r = await runCli(['wp', a, b, `ssh:${FIXTURE_ALIAS}/alpha@production`], { timeout: 120_000 });
    expect(r.exitCode).toBe(0);
  });

  it('option-get returns the value this install was provisioned with', async () => {
    const r = await runCli(['wp', 'option-get', `ssh:${FIXTURE_ALIAS}/alpha@production`, 'blogname'],
      { timeout: 120_000 });
    expect(r.output).toContain('Nexus E2E alpha');
  });

  it('resolves each site independently, not to whichever matched first', async () => {
    const r = await runCli(['wp', 'option-get', `ssh:${FIXTURE_ALIAS}/beta@production`, 'blogname'],
      { timeout: 120_000 });
    expect(r.output).toContain('Nexus E2E beta');
  });

  it('refuses a bare alias when the connection has two sites, and names both forms', async () => {
    const r = await runCli(['wp', 'core', 'version', `ssh:${FIXTURE_ALIAS}@production`],
      { timeout: 120_000 });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain(`ssh:${FIXTURE_ALIAS}/alpha`);
    expect(r.output).toContain(`ssh:${FIXTURE_ALIAS}/beta`);
  });

  it('a @development suffix cannot loosen a production host', async () => {
    // Registered production above. A write is refused on production by default
    // (`wpcli`), and the typed suffix must not override the registered label.
    //
    // db search-replace is the write probe (verified against src/cli/commands/wp.ts).
    // It is also self-verifying: if the gate wrongly permits it, blogname changes
    // and the follow-up assertion below fails loudly.
    const r = await runCli(
      ['wp', 'db', 'search-replace', `ssh:${FIXTURE_ALIAS}/alpha@development`,
       'Nexus E2E alpha', 'hijacked'],
      { timeout: 120_000 });
    expect(r.exitCode).not.toBe(0);
    expect(r.output.toLowerCase()).toMatch(/not allowed|blocked|permission/);

    // And the value on the box is unchanged — the refusal was real, not cosmetic.
    const check = await runCli(['wp', 'option-get', `ssh:${FIXTURE_ALIAS}/alpha@production`, 'blogname'],
      { timeout: 120_000 });
    expect(check.output).toContain('Nexus E2E alpha');
  });

  it('an unregistered alias fails rather than creating a phantom site row', async () => {
    const r = await runCli(['wp', 'core', 'version', 'ssh:nexus-e2e-never-registered@production'],
      { timeout: 60_000 });
    expect(r.exitCode).not.toBe(0);
    const list = await runCli(['host', 'list', '--json']);
    expect(list.stdout).not.toContain('nexus-e2e-never-registered');
  });
});
