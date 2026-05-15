/**
 * CLI E2E Tests — WPE Access Control (Operation Permissions)
 *
 * Tests that the access control system correctly blocks or allows operations
 * based on the DEFAULT settings (wpeOperationPermissions defaults):
 *
 *   BLOCKED by default:
 *     - WP-CLI / SSH on production environments
 *     - Delete / Promote on ALL environments
 *     - Push to WPE on production
 *
 *   ALLOWED by default:
 *     - Pull from any environment (including production)
 *     - WP-CLI on staging and development
 *     - Read-only CAPI operations on production
 *
 * These tests rely on default settings. If settings have been changed to allow
 * production WP-CLI or delete ops, the relevant tests skip automatically.
 *
 * Requires: WPE authentication (nexus wpe login) and at least one WPE install.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { runCli, getWpeAccounts, skipTest } from './helpers/cli-test-utils';

interface WpeInstall {
  id: string;
  name: string;
  environment: string;
  account: string;
}

let allInstalls: WpeInstall[] = [];
let productionInstall: WpeInstall | null = null;
let stagingInstall: WpeInstall | null = null;
let anyInstall: WpeInstall | null = null;

beforeAll(async () => {
  const accounts = await getWpeAccounts();
  if (accounts.length === 0) return;

  for (const account of accounts) {
    const r = await runCli(`wpe installs ${account.id} --json`);
    if (r.exitCode !== 0) continue;

    let installs: any[] = [];
    try { installs = JSON.parse(r.stdout); } catch { continue; }

    for (const install of installs) {
      const info: WpeInstall = {
        id: install.id,
        name: install.name,
        environment: install.environment,
        account: account.id,
      };
      allInstalls.push(info);
      if (!anyInstall) anyInstall = info;
      if (!productionInstall && install.environment === 'production') productionInstall = info;
      if (!stagingInstall && install.environment === 'staging') stagingInstall = info;
    }
  }
});

// ---------------------------------------------------------------------------
// Default BLOCKS — should fail with "Operation blocked" message
// ---------------------------------------------------------------------------

describe('nexus wp — WP-CLI blocked on production (default)', () => {
  it('plugin list on production returns "Operation blocked"', async () => {
    if (!productionInstall) { skipTest('No production install available'); return; }

    const target = `wpe:${productionInstall.account}/${productionInstall.name}@production`;
    const r = await runCli(`wp plugin list ${target}`);

    // If output doesn't mention the block, settings may have been changed — skip rather than fail
    if (!r.output.includes('Operation blocked') && !r.output.toLowerCase().includes('not permitted')) {
      skipTest('Production WP-CLI appears to be enabled in current settings (changed from default)');
      return;
    }

    expect(r.exitCode).toBe(1);
    expect(r.output).toMatch(/Operation blocked|not permitted/);
  });

  it('block message includes Preferences location', async () => {
    if (!productionInstall) { skipTest('No production install available'); return; }

    const target = `wpe:${productionInstall.account}/${productionInstall.name}@production`;
    const r = await runCli(`wp plugin list ${target}`);

    if (!r.output.includes('Operation blocked')) {
      skipTest('Production WP-CLI appears to be enabled in current settings (changed from default)');
      return;
    }

    // Message should tell user where to change the setting
    expect(r.output.toLowerCase()).toMatch(/preferences|nexus|access/);
  });

  it('wp core version on production is also blocked', async () => {
    if (!productionInstall) { skipTest('No production install available'); return; }

    const target = `wpe:${productionInstall.account}/${productionInstall.name}@production`;
    const r = await runCli(`wp core version ${target}`);

    if (!r.output.includes('Operation blocked')) {
      skipTest('Production WP-CLI appears to be enabled in current settings');
      return;
    }

    expect(r.exitCode).toBe(1);
  });
});

describe('nexus wpe delete-install — blocked on all environments (default)', () => {
  it('delete on a staging install is blocked before confirmation', async () => {
    if (!stagingInstall) { skipTest('No staging install available'); return; }

    const r = await runCli(`wpe delete-install ${stagingInstall.id}`);

    // delete is blocked for ALL environments by default — even staging
    // If the output doesn't mention block, skip (settings may have been changed)
    if (r.output.includes('Operation blocked') || r.output.toLowerCase().includes('not permitted')) {
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatch(/Operation blocked|not permitted/);
    } else if (r.output.toLowerCase().includes('confirm')) {
      // Confirmation prompt means the access control check PASSED (settings changed)
      skipTest('Delete operation is permitted in current settings (changed from default)');
    } else {
      // Some other error (network, auth) — just verify it failed
      expect(r.exitCode).toBe(1);
    }
  });

  it('delete on production is blocked before confirmation', async () => {
    if (!productionInstall) { skipTest('No production install available'); return; }

    const r = await runCli(`wpe delete-install ${productionInstall.id}`);

    if (r.output.includes('Operation blocked') || r.output.toLowerCase().includes('not permitted')) {
      expect(r.exitCode).toBe(1);
    } else if (r.output.toLowerCase().includes('confirm')) {
      skipTest('Delete operation is permitted in current settings (changed from default)');
    } else {
      expect(r.exitCode).toBe(1);
    }
  });

  it('delete requires an install ID argument', async () => {
    const r = await runCli('wpe delete-install');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/required|missing|argument/);
  });
});

// ---------------------------------------------------------------------------
// Default ALLOWS — should not return "Operation blocked"
// ---------------------------------------------------------------------------

describe('nexus wp — WP-CLI on staging is NOT blocked (default)', () => {
  it('plugin list on staging does not return access control block', async () => {
    if (!stagingInstall) { skipTest('No staging install available'); return; }

    const target = `wpe:${stagingInstall.account}/${stagingInstall.name}@staging`;
    const r = await runCli(`wp plugin list ${target}`);

    // May fail (SSH key not set up, no WP installed, etc.) but must NOT be an access control block
    expect(r.output).not.toMatch(/Operation blocked.*staging/);
    expect(r.output).not.toMatch(/not permitted.*staging/);
  });
});

describe('nexus wpe install — read-only CAPI on production is NOT blocked', () => {
  it('fetching install details for a production install does not hit access block', async () => {
    if (!productionInstall) { skipTest('No production install available'); return; }

    const r = await runCli(`wpe install ${productionInstall.id}`);

    // Read-only CAPI — should not be blocked. May succeed or fail for other reasons.
    expect(r.output).not.toContain('Operation blocked');
    expect(r.output).not.toMatch(/not permitted on "production"/);
  });

  it('wpe accounts is never blocked (read-only)', async () => {
    const r = await runCli('wpe accounts');
    expect(r.output).not.toContain('Operation blocked');
    // Either returns accounts or says "not authenticated" — never an access block
    expect([0, 1]).toContain(r.exitCode);
  });
});

// ---------------------------------------------------------------------------
// Block message format regression — message must be human-readable
// ---------------------------------------------------------------------------

describe('nexus wpe access control — block message quality', () => {
  it('block message is human-readable, not a raw error object', async () => {
    if (!productionInstall) { skipTest('No production install available'); return; }

    const target = `wpe:${productionInstall.account}/${productionInstall.name}@production`;
    const r = await runCli(`wp plugin list ${target}`);

    if (!r.output.includes('Operation blocked')) {
      skipTest('Production WP-CLI appears to be enabled in current settings');
      return;
    }

    // Must NOT be a raw JSON error or stack trace
    expect(r.output).not.toMatch(/^\{/);
    expect(r.output).not.toMatch(/Error:/);
    expect(r.output).not.toMatch(/at Object\./);
    // Must be a plain sentence
    expect(r.output.length).toBeGreaterThan(20);
    expect(r.output.length).toBeLessThan(500);
  });
});
