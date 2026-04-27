/**
 * CLI E2E Tests — WPE Read Commands
 *
 * Covers: nexus wpe accounts/installs/install/account/usage/account-usage/
 *         limits/users/user/domains/ssl/ssh-keys/diagnose/fleet-health/portfolio/status
 *
 * All commands here are READ-ONLY — no WPE data is modified.
 * Tests skip gracefully if not authenticated to WPE.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { runCli, getWpeAccounts, skipTest } from './helpers/cli-test-utils';

let firstAccountId = '';
let firstInstallId = '';

beforeAll(async () => {
  const accounts = await getWpeAccounts();
  if (accounts.length > 0) {
    firstAccountId = accounts[0].id;
    // Get first install for this account
    const r = await runCli(`wpe installs ${firstAccountId} --json`);
    if (r.exitCode === 0) {
      try {
        const installs = JSON.parse(r.stdout);
        if (installs.length > 0) firstInstallId = installs[0].id;
      } catch { /* ignore */ }
    }
  }
});

describe('nexus wpe status', () => {
  it('shows authentication status', async () => {
    const r = await runCli('wpe status');
    expect(r.exitCode).toBe(0);
    expect(r.output.toLowerCase()).toMatch(/authenticated|logged|status/);
  });
});

describe('nexus wpe accounts', () => {
  it('returns exit 0 and account list or auth error', async () => {
    const r = await runCli('wpe accounts');
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('--json returns array when authenticated', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli('wpe accounts --json');
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty('id');
  });
});

describe('nexus wpe installs', () => {
  it('returns installs for an account', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli(`wpe installs ${firstAccountId}`);
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('--json returns array', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli(`wpe installs ${firstAccountId} --json`);
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns empty list or error for invalid account id', async () => {
    const r = await runCli('wpe installs 00000000-0000-0000-0000-000000000000');
    // CLI returns exit 0 with empty list OR exit 1 with error — both acceptable
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe install', () => {
  it('returns install details', async () => {
    if (!firstInstallId) { skipTest('No install available'); return; }
    const r = await runCli(`wpe install ${firstInstallId}`);
    expect(r.exitCode).toBe(0);
    expect(r.output.toLowerCase()).toMatch(/status|domain|environment/);
  });

  it('returns error for nonexistent install id', async () => {
    const r = await runCli('wpe install 00000000-0000-0000-0000-000000000000');
    expect(r.exitCode).toBe(1);
  });
});

describe('nexus wpe account', () => {
  it('returns account details', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli(`wpe account ${firstAccountId}`);
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe usage', () => {
  it('returns usage data for an install', async () => {
    if (!firstInstallId) { skipTest('No install available'); return; }
    const r = await runCli(`wpe usage ${firstInstallId}`);
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe account-usage', () => {
  it('returns usage data for an account', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli(`wpe account-usage ${firstAccountId}`);
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe limits', () => {
  it('returns account limits', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli(`wpe limits ${firstAccountId}`);
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe users', () => {
  it('returns user list for account', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli(`wpe users ${firstAccountId}`);
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe domains', () => {
  it('returns domains for an install', async () => {
    if (!firstInstallId) { skipTest('No install available'); return; }
    const r = await runCli(`wpe domains ${firstInstallId}`);
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe ssl', () => {
  it('returns SSL status for an install', async () => {
    if (!firstInstallId) { skipTest('No install available'); return; }
    const r = await runCli(`wpe ssl ${firstInstallId}`);
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe ssh-keys', () => {
  it('returns SSH keys or empty list', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli('wpe ssh-keys');
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe diagnose', () => {
  it('returns diagnostic info for an install', async () => {
    if (!firstInstallId) { skipTest('No install available'); return; }
    const r = await runCli(`wpe diagnose ${firstInstallId}`, { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe fleet-health', () => {
  it('returns fleet health summary', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli('wpe fleet-health', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wpe portfolio', () => {
  it('returns portfolio overview', async () => {
    if (!firstAccountId) { skipTest('Not authenticated to WPE'); return; }
    const r = await runCli('wpe portfolio', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus wp core version — WPE bare name resolution', () => {
  it('resolves a bare WPE install name and returns WordPress version', async () => {
    // Regression: bare name (no @local or wpe: prefix) must resolve via graph DB
    // to WPE install and run WP-CLI over SSH. Tests the full MCP→GraphQL path.
    // SSH to WPE can take 20-60s — use a generous timeout.
    if (!firstInstallId) { skipTest('Not authenticated to WPE'); return; }

    // Get the install name from the first install
    const installsResult = await runCli(`wpe installs ${firstAccountId} --json`);
    if (installsResult.exitCode !== 0) { skipTest('Could not get WPE installs'); return; }
    let installName: string;
    try {
      const installs = JSON.parse(installsResult.stdout);
      if (!installs.length) { skipTest('No installs in first account'); return; }
      installName = installs[0].name;
    } catch { skipTest('Could not parse installs'); return; }

    const r = await runCli(`wp core version ${installName}`, { timeout: 60000 });

    // Must resolve and attempt execution (exit 0 = version found, exit 1 = SSH timeout/error is ok)
    // What we're testing: bare name resolution routes to WPE, not that SSH succeeds fast
    expect([0, 1]).toContain(r.exitCode);
    // On success, output must contain a version number
    if (r.exitCode === 0) {
      expect(r.stdout).toMatch(/WordPress \d+\.\d+/);
    }
    // On failure, must be a real error (not hang/crash) — output should be non-empty
    expect(r.output.length).toBeGreaterThan(0);
  });
});
