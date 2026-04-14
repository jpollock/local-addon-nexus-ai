/**
 * CLI E2E Tests — Sync Commands
 *
 * Covers: nexus sync pull / push / history
 *
 * NOTE: nexus sync push is argument-validation only (destructive).
 * nexus sync pull is tested for argument validation and live execution
 * when WPE auth + a real install are available.
 */

import { describe, it, expect } from '@jest/globals';
import { runCli, getLocalSites, getWpeAccounts, skipTest, DESTRUCTIVE_NOTE } from './helpers/cli-test-utils';

describe('nexus sync history', () => {
  it('requires @local suffix on site target', async () => {
    const r = await runCli('sync history somesite');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('@local');
  });

  it('shows history or empty for a real site', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`sync history ${sites[0].name}@local`);
    // exits 0 with history, or 1 if site has never been synced
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus sync pull — argument validation', () => {
  it('requires @local suffix on localSite', async () => {
    const r = await runCli('sync pull somesite --from wpe:account/install@production');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('@local');
  });

  it('requires --from flag', async () => {
    const r = await runCli('sync pull somesite@local');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/required|--from|missing/);
  });

  it('requires valid wpe: target format for --from', async () => {
    const r = await runCli('sync pull somesite@local --from badformat');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/invalid|format|syntax/);
  });

  it('requires environment in --from target', async () => {
    const r = await runCli('sync pull somesite@local --from wpe:account/install');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/invalid|format|syntax|environment/);
  });
});

describe('nexus sync pull — live execution (skips if not ready)', () => {
  it('starts pull when site and wpe install exist', async () => {
    const sites = await getLocalSites();
    const running = sites.find((s) => s.status === 'running');
    if (!running) { skipTest('No running local site'); return; }

    const accounts = await getWpeAccounts();
    if (accounts.length === 0) { skipTest('Not authenticated to WPE'); return; }

    // Get first install
    const installsResult = await runCli(`wpe installs ${accounts[0].id} --json`);
    if (installsResult.exitCode !== 0) { skipTest('Could not get WPE installs'); return; }

    let installs: any[];
    try { installs = JSON.parse(installsResult.stdout); } catch { skipTest('Could not parse installs'); return; }
    if (installs.length === 0) { skipTest('No WPE installs available'); return; }

    const install = installs[0];
    const env = install.environment || 'production';
    const accountName = accounts[0].name || accounts[0].id;

    const r = await runCli(
      `sync pull ${running.name}@local --from wpe:${accountName}/${install.name}@${env}`,
      { timeout: 30000 },
    );

    // Pull is async — success means it started, not that it completed
    expect(r.exitCode).toBe(0);
    expect(r.output.toLowerCase()).toMatch(/pull|started|progress|linked/);
  });
});

describe(`nexus sync push — ${DESTRUCTIVE_NOTE}`, () => {
  it('requires @local suffix on localSite', async () => {
    const r = await runCli('sync push somesite --to wpe:account/install@production');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('@local');
  });

  it('requires --to flag', async () => {
    const r = await runCli('sync push somesite@local');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/required|--to|missing/);
  });

  it('requires valid wpe: target format for --to', async () => {
    const r = await runCli('sync push somesite@local --to badformat');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/invalid|format|syntax/);
  });
});
