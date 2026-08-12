/**
 * External host registration lifecycle, against the Docker sshd fixture.
 *
 * NON-VACUITY: the soft-delete test below is the one that matters. To prove it
 * is real, delete `AND is_active = 1` from:
 * - src/main/mcp/site-resolver.ts:108 (reached by `nexus host list --json`, line 69)
 * - src/main/graphql/resolvers.ts:674 (reached by `nexus sites list --json`, line 73)
 * and re-run — "stops listing a removed host" must go RED. `nexus host remove`
 * only sets is_active = 0 and resets domain to the alias; every reader must filter,
 * and three of them did not.
 */
import { runCli } from './helpers/cli-test-utils';
import {
  FIXTURE_ALIAS, FIXTURE_SITES, fixtureAvailable, trustFixtureHostKey,
} from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host lifecycle', () => {
  beforeAll(async () => {
    await trustFixtureHostKey();
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']); // clean slate
  });

  it('host test discovers both WordPress installs', async () => {
    const r = await runCli(['host', 'test', FIXTURE_ALIAS, '--json'], { timeout: 120_000 });
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(report.error).toBeUndefined();
    expect(report.candidates).toHaveLength(2);
    expect(report.candidates.join(' ')).toContain('/home/wp/alpha');
    expect(report.candidates.join(' ')).toContain('/home/wp/beta');
  });

  it('refuses to guess which install to register when two exist', async () => {
    // --json without --all: the picker cannot prompt, so it must decline.
    const r = await runCli(['host', 'add', FIXTURE_ALIAS, '--json'], { timeout: 120_000 });
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(out.registered).toBe(false);
    expect(out.error).toMatch(/2 WordPress installations/);
  });

  it('host add --all registers both installs', async () => {
    const r = await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(out.registered).toBe(true);
    expect(out.error).toBeNull();
    expect(out.sites.map((s: any) => s.site).sort()).toEqual([...FIXTURE_SITES].sort());
    expect(out.sites.every((s: any) => s.registered)).toBe(true);
  });

  it('host list shows both sites under one alias with full targets', async () => {
    const r = await runCli(['host', 'list', '--json']);
    const hosts = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
    const host = hosts.find((h: any) => h.alias === FIXTURE_ALIAS);
    expect(host).toBeDefined();
    expect(host.sites.map((s: any) => s.name).sort()).toEqual([...FIXTURE_SITES].sort());
  });

  it('host remove-site removes one site and leaves the other', async () => {
    await runCli(['host', 'remove-site', `${FIXTURE_ALIAS}/beta`, '-y']);
    const r = await runCli(['host', 'list', '--json']);
    const hosts = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
    const host = hosts.find((h: any) => h.alias === FIXTURE_ALIAS);
    expect(host.sites.map((s: any) => s.name)).toEqual(['alpha']);
  });

  it('stops listing a removed host — soft-delete must be filtered by every reader', async () => {
    expect(FIXTURE_ALIAS).toBe('nexus-e2e-host'); // guard before a destructive step
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);

    const list = await runCli(['host', 'list', '--json']);
    expect(list.exitCode).toBe(0);
    const hosts = JSON.parse(list.stdout.slice(list.stdout.indexOf('[')));
    expect(hosts.find((h: any) => h.alias === FIXTURE_ALIAS)).toBeUndefined();

    // `sites list` reads a different query and missed is_active = 1 too.
    const sites = await runCli(['sites', 'list', '--json']);
    expect(sites.exitCode).toBe(0);
    const parsed = JSON.parse(sites.stdout.slice(sites.stdout.indexOf('{')));
    const externals = parsed.external || [];
    expect(externals.find((s: any) => s.alias === FIXTURE_ALIAS)).toBeUndefined();
  });

  // Regression: commit 3ff8a15c — ExternalSite.alias is non-nullable in schema.ts:95,
  // but resolvers.ts:678 returned NULL for legacy rows (account_id NULL when id has no /),
  // killing `nexus sites list` with "Cannot return null for non-nullable field."
  // src/main/graphql/resolvers.ts:678 and src/main/ipc-handlers.ts:1415 read separately.
  it('sites list succeeds and every external entry has a non-null alias', async () => {
    const r = await runCli(['sites', 'list', '--json']);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    const externals = parsed.external || [];
    // May be zero if fixture not registered, but every one present must have an alias.
    externals.forEach((s: any) => {
      expect(s.alias).toBeTruthy();
      expect(typeof s.alias).toBe('string');
    });
  });
});
