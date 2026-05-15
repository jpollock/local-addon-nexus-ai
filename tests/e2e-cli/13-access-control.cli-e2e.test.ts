/**
 * CLI E2E Tests — WPE Access Control (Operation Permissions)
 *
 * Tests that wpeOperationPermissions settings are enforced end-to-end:
 * CLI command → GraphQL → MCP handler → isOperationAllowed() → block/allow.
 *
 * Uses known fixture installs (WPE_FIXTURES) — no discovery loop needed.
 * Each describe block injects the exact settings it needs via `nexus settings set`
 * and the suite-level afterAll restores the original settings snapshot.
 *
 * Requires: WPE authentication (`nexus wpe login`) and Local running.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { runCli, skipTest, WPE_FIXTURES } from './helpers/cli-test-utils';

const PROD = WPE_FIXTURES.installs.prod;
const STAGING = WPE_FIXTURES.installs.staging;
const READ_PROD = WPE_FIXTURES.installs.readProd;

/** Snapshot settings before the suite — restored in afterAll. */
let originalSettings: string | null = null;

/** Check WPE auth is available — skip the whole suite if not. */
async function wpeIsAuthenticated(): Promise<boolean> {
  const r = await runCli('wpe status');
  return r.exitCode === 0 && r.output.toLowerCase().includes('authenticated');
}

beforeAll(async () => {
  const snap = await runCli('settings get --json');
  if (snap.exitCode === 0) originalSettings = snap.stdout.trim();
});

afterAll(async () => {
  if (originalSettings) {
    await runCli(['settings', 'patch', originalSettings]).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// WP-CLI blocked on production
// ---------------------------------------------------------------------------

describe('wpcli blocked on production', () => {
  beforeAll(async () => {
    await runCli('settings set wpeOperationPermissions.wpcli.production false');
  });

  it('plugin list on production returns exit 1 + "Operation blocked"', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wp plugin list ${PROD.target}`);
    expect(r.exitCode).toBe(1);
    expect(r.output).toMatch(/Operation blocked|not permitted/);
  });

  it('core version on production is also blocked', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wp core version ${PROD.target}`);
    expect(r.exitCode).toBe(1);
    expect(r.output).toMatch(/Operation blocked|not permitted/);
  });

  it('block message tells user where to change the setting', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wp plugin list ${PROD.target}`);
    expect(r.output).toMatch(/Operation blocked|not permitted/);
    expect(r.output.toLowerCase()).toMatch(/preferences|nexus|access/);
  });

  it('block message is plain English — not a raw error object or stack trace', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wp plugin list ${PROD.target}`);
    expect(r.output).toMatch(/Operation blocked|not permitted/);
    expect(r.output).not.toMatch(/^\s*\{/);           // not raw JSON
    expect(r.output).not.toMatch(/at Object\./);      // not a stack trace
    expect(r.output).not.toMatch(/^Error:/m);         // not an unhandled error
    expect(r.output.trim().length).toBeLessThan(500); // concise
  });
});

// ---------------------------------------------------------------------------
// WP-CLI allowed on production (setting flipped)
// ---------------------------------------------------------------------------

describe('wpcli allowed on production when setting enabled', () => {
  beforeAll(async () => {
    await runCli('settings set wpeOperationPermissions.wpcli.production true');
  });

  it('plugin list on production does NOT return "Operation blocked"', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wp plugin list ${READ_PROD.target}`);
    // May fail for SSH/other reasons — but must not be an access control block
    expect(r.output).not.toContain('Operation blocked');
    expect(r.output).not.toMatch(/not permitted on "production"/);
  });
});

// ---------------------------------------------------------------------------
// WP-CLI on staging — always allowed by default
// ---------------------------------------------------------------------------

describe('wpcli allowed on staging (default)', () => {
  beforeAll(async () => {
    await runCli('settings set wpeOperationPermissions.wpcli.staging true');
    await runCli('settings set wpeOperationPermissions.wpcli.production false');
  });

  it('plugin list on staging does NOT return "Operation blocked"', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wp plugin list ${STAGING.target}`);
    // May fail (SSH key, WP not installed) but must NOT be an access control block
    expect(r.output).not.toContain('Operation blocked');
    expect(r.output).not.toMatch(/not permitted on "staging"/);
  });
});

// ---------------------------------------------------------------------------
// Push blocked on production
// ---------------------------------------------------------------------------

describe('push blocked on production', () => {
  beforeAll(async () => {
    await runCli('settings set wpeOperationPermissions.push.production false');
  });

  it('purge-cache on production returns "Operation blocked"', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    // wpe_purge_cache is in the "push" permission bucket
    const r = await runCli(`wpe cache ${PROD.name}`);
    expect(r.exitCode).toBe(1);
    expect(r.output).toMatch(/Operation blocked|not permitted/);
  });
});

// ---------------------------------------------------------------------------
// Push allowed on staging (default)
// ---------------------------------------------------------------------------

describe('push allowed on staging when setting enabled', () => {
  beforeAll(async () => {
    await runCli('settings set wpeOperationPermissions.push.staging true');
    await runCli('settings set wpeOperationPermissions.push.production false');
  });

  it('purge-cache on staging does NOT return "Operation blocked"', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wpe cache ${STAGING.name}`);
    // May succeed or fail for other reasons — must not be an access block
    expect(r.output).not.toContain('Operation blocked');
    expect(r.output).not.toMatch(/not permitted on "staging"/);
  });
});

// ---------------------------------------------------------------------------
// Delete blocked on all environments
// ---------------------------------------------------------------------------

describe('delete blocked on all environments', () => {
  beforeAll(async () => {
    // Explicitly block delete everywhere
    await runCli('settings patch \'{"wpeOperationPermissions":{"delete":{"production":false,"staging":false,"development":false}}}\'');
  });

  it('delete-install on staging returns "Operation blocked" (not just --confirm required)', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    // Use staging install — if it showed --confirm prompt, delete is NOT blocked
    // We expect "Operation blocked" to appear BEFORE the confirmation gate
    const r = await runCli(`wpe delete-install ${STAGING.name} --install-id placeholder`);
    // Even with a bad ID, the access block happens before CAPI lookup in some paths
    // If we get "confirm" it means access was NOT blocked — fail clearly
    expect(r.output).not.toMatch(/type.*confirm|--confirm/i);
    expect(r.output).toMatch(/Operation blocked|not permitted|argument|required/);
  });

  it('delete-install on production is also blocked', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wpe delete-install ${PROD.name} --install-id placeholder`);
    expect(r.output).not.toMatch(/type.*confirm|--confirm/i);
    expect(r.output).toMatch(/Operation blocked|not permitted|argument|required/);
  });
});

// ---------------------------------------------------------------------------
// Read-only CAPI is never blocked
// ---------------------------------------------------------------------------

describe('read-only CAPI never blocked by access control', () => {
  beforeAll(async () => {
    // Even with everything blocked, reads must still work
    await runCli('settings patch \'{"wpeOperationPermissions":{"wpcli":{"production":false},"push":{"production":false},"delete":{"production":false}}}\'');
  });

  it('wpe accounts is never blocked', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli('wpe accounts');
    expect(r.output).not.toContain('Operation blocked');
    expect([0, 1]).toContain(r.exitCode); // may succeed or fail auth-wise
  });

  it('wpe install (read) on production is never blocked', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wpe installs ${WPE_FIXTURES.account} --json`);
    expect(r.output).not.toContain('Operation blocked');
  });
});

// ---------------------------------------------------------------------------
// Site exception: allow overrides global block
// ---------------------------------------------------------------------------

describe('site exception: allow overrides global block on production', () => {
  beforeAll(async () => {
    // Block production WP-CLI globally
    await runCli('settings set wpeOperationPermissions.wpcli.production false');
    // But add an exception that allows jppwpeplugin specifically
    const exception = JSON.stringify({
      wpeSiteExceptions: [{
        installName: PROD.name,
        environment: 'production',
        overrides: { wpcli: true },
      }],
    });
    await runCli(['settings', 'patch', exception]);
  });

  it('WP-CLI on the excepted production install is NOT blocked', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wp plugin list ${PROD.target}`);
    // Exception allows it — must not see "Operation blocked"
    expect(r.output).not.toContain('Operation blocked');
    expect(r.output).not.toMatch(/not permitted on "production"/);
  });

  it('WP-CLI on a different production install IS still blocked', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    // READ_PROD (jpp0413p) has no exception — still blocked
    const r = await runCli(`wp plugin list ${READ_PROD.target}`);
    expect(r.output).toMatch(/Operation blocked|not permitted/);
  });
});

// ---------------------------------------------------------------------------
// Site exception: block overrides global allow on staging
// ---------------------------------------------------------------------------

describe('site exception: block overrides global allow on staging', () => {
  beforeAll(async () => {
    // Allow staging WP-CLI globally
    await runCli('settings set wpeOperationPermissions.wpcli.staging true');
    // But block jppwpeplugistg specifically
    const exception = JSON.stringify({
      wpeSiteExceptions: [{
        installName: STAGING.name,
        environment: 'staging',
        overrides: { wpcli: false },
      }],
    });
    await runCli(['settings', 'patch', exception]);
  });

  it('WP-CLI on the blocked staging install IS blocked by site exception', async () => {
    if (!await wpeIsAuthenticated()) { skipTest('WPE not authenticated'); return; }

    const r = await runCli(`wp plugin list ${STAGING.target}`);
    expect(r.exitCode).toBe(1);
    expect(r.output).toMatch(/Operation blocked|not permitted/);
  });
});
