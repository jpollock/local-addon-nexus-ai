/**
 * Content indexing for external hosts, and the vector-table collision.
 *
 * NON-VACUITY: in src/main/vector-store/vectorSiteId.ts, drop the hash suffix
 * (return `sanitized` instead of `${sanitized}_${hash}`) and
 * "keeps each install's content in its own table" must go RED. Both installs
 * then sanitize to the same table name and one host's content silently
 * overwrites the other's.
 */
import { runCli } from './helpers/cli-test-utils';
import { FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey } from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host content indexing', () => {
  beforeAll(async () => {
    await trustFixtureHostKey();
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
    await runCli(['host', 'index', FIXTURE_ALIAS], { timeout: 600_000 });
  });

  it('indexes the alpha install', async () => {
    const r = await runCli(['content', 'search', `ssh:${FIXTURE_ALIAS}/alpha@production`,
      'unique-marker-for-alpha-install', '--json'], { timeout: 120_000 });
    expect(r.stdout).toContain('Marker alpha');
  });

  it('indexes the beta install', async () => {
    const r = await runCli(['content', 'search', `ssh:${FIXTURE_ALIAS}/beta@production`,
      'unique-marker-for-beta-install', '--json'], { timeout: 120_000 });
    expect(r.stdout).toContain('Marker beta');
  });

  it('keeps each install\'s content in its own table', async () => {
    // The collision symptom is that one install's content vanishes because the
    // other overwrote the shared table. Both markers surviving is the proof.
    const alpha = await runCli(['content', 'search', `ssh:${FIXTURE_ALIAS}/alpha@production`,
      'unique-marker-for-alpha-install', '--json'], { timeout: 120_000 });
    const beta = await runCli(['content', 'search', `ssh:${FIXTURE_ALIAS}/beta@production`,
      'unique-marker-for-beta-install', '--json'], { timeout: 120_000 });
    expect(alpha.stdout).toContain('Marker alpha');
    expect(beta.stdout).toContain('Marker beta');
    // And neither result set is contaminated with the other install's content.
    expect(alpha.stdout).not.toContain('Marker beta');
    expect(beta.stdout).not.toContain('Marker alpha');
  });
});
