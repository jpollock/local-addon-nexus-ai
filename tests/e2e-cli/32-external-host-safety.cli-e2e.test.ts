/**
 * Host-key trust and alias safety.
 *
 * NON-VACUITY: at src/main/external/probeExternalHost.ts:173, return
 * 'host-key-unknown' instead of 'host-key-changed' and "a changed host key is
 * hard-refused" must go RED (failure.kind assertion) — the rotated host would
 * then be offered an approval path, which is precisely the MITM/reinstall case
 * ssh never re-prompts for. The "no Settings path offered" assertion is NOT
 * independently proven by mutation; it is structurally tied to the kind.
 *
 * There is deliberately NO test that approving a key succeeds: approval is the
 * TRUST_EXTERNAL_HOST_KEY IPC channel, which the CLI cannot and must not reach.
 */
import { runCli } from './helpers/cli-test-utils';
import {
  FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey, forgetFixtureHostKey,
  rotateFixtureHostKey,
} from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host safety', () => {
  afterAll(async () => {
    await rotateFixtureHostKey(); // leave the fixture in a known state
    await trustFixtureHostKey();
  });

  it('classifies a never-seen host key as unknown and returns its fingerprint', async () => {
    await forgetFixtureHostKey();
    const r = await runCli(['host', 'test', FIXTURE_ALIAS, '--json'], { timeout: 120_000 });
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(report.failure?.kind).toBe('host-key-unknown');
    // Historical: this assertion was skipped with a claim that captureOfferedHostKey
    // failed in the fixture environment. The real cause was that PROBE_FIELDS in
    // src/cli/commands/host.ts did not select fingerprint or keyType from the GraphQL
    // schema, so they were never returned. GraphQL returns only what is selected.
    expect(report.failure?.fingerprint).toBeTruthy();
    expect(typeof report.failure?.fingerprint).toBe('string');
  });

  it('does not register a host whose key is unknown, even with --yes', async () => {
    const r = await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--yes', '--json'],
      { timeout: 120_000 });
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(out.registered).toBe(false);
  });

  it('a changed host key is hard-refused, with no approval path offered', async () => {
    await trustFixtureHostKey();
    await rotateFixtureHostKey();

    const r = await runCli(['host', 'test', FIXTURE_ALIAS, '--json'], { timeout: 120_000 });
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(report.failure?.kind).toBe('host-key-changed');
    // Unlike host-key-unknown, nothing may point the user at an approval flow.
    expect(r.output).not.toMatch(/Settings/i);
  });

  it('rejects an alias that ssh would read as an option', async () => {
    // A leading '-' makes the alias an argv option: -oProxyCommand=... is local
    // command execution.
    const fs = require('fs');
    try { fs.unlinkSync('/tmp/nexus-e2e-pwned'); } catch { /* absent is fine */ }
    const r = await runCli(['host', 'test', '-oProxyCommand=touch /tmp/nexus-e2e-pwned'],
      { timeout: 30_000 });
    expect(r.exitCode).not.toBe(0);
    expect(fs.existsSync('/tmp/nexus-e2e-pwned')).toBe(false);
  });
});
