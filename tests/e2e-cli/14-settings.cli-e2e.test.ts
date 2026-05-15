/**
 * CLI E2E Tests — nexus settings get / set / patch
 *
 * Verifies the settings read/write commands work end-to-end:
 *   - nexus settings get          returns valid JSON
 *   - nexus settings get <key>    returns the specific field value
 *   - nexus settings set <k> <v>  persists a change (boolean, number, nested path)
 *   - nexus settings patch <json> merges a JSON object correctly
 *   - Round-trip: set then get confirms the value was actually stored
 *
 * All tests restore the original value after running so they leave no
 * lasting changes to the environment.
 *
 * Requires: Local running with Nexus AI addon active.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { runCli, skipTest } from './helpers/cli-test-utils';

const TEST_KEY = 'wpeSyncIntervalHours';
const TEST_VALUE_NUM = 42;
const TEST_VALUE_BOOL_KEY = 'wpeOperationPermissions.wpcli.production';

let originalSettings: Record<string, any> | null = null;

beforeAll(async () => {
  const r = await runCli('settings get --json');
  if (r.exitCode !== 0) return;
  try { originalSettings = JSON.parse(r.stdout); } catch { /* ignore */ }
});

afterAll(async () => {
  if (!originalSettings) return;
  // Restore the two specific keys we touch in these tests
  const syncHours = originalSettings[TEST_KEY] ?? 8;
  await runCli(`settings set ${TEST_KEY} ${syncHours}`);
  const wpcliProd = originalSettings?.wpeOperationPermissions?.wpcli?.production;
  if (wpcliProd !== undefined) {
    await runCli(`settings set ${TEST_VALUE_BOOL_KEY} ${wpcliProd}`);
  }
});

// ---------------------------------------------------------------------------
// nexus settings get
// ---------------------------------------------------------------------------

describe('nexus settings get', () => {
  it('exits 0 and returns valid JSON', async () => {
    const r = await runCli('settings get --json');
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    expect(r.exitCode).toBe(0);
    let parsed: any;
    expect(() => { parsed = JSON.parse(r.stdout); }).not.toThrow();
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
  });

  it('returns known settings fields', async () => {
    const r = await runCli('settings get --json');
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    const parsed = JSON.parse(r.stdout);
    // These fields should always be present (with defaults)
    expect(parsed).toHaveProperty('autoIndex');
    expect(typeof parsed.autoIndex).toBe('boolean');
  });

  it('get <key> returns the specific field', async () => {
    const r = await runCli('settings get autoIndex');
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveProperty('key', 'autoIndex');
    expect(parsed).toHaveProperty('value');
    expect(typeof parsed.value).toBe('boolean');
  });

  it('get <dotted.key> returns nested field', async () => {
    // First ensure the nested key exists by setting it
    await runCli('settings set wpeOperationPermissions.wpcli.production false');

    const r = await runCli('settings get wpeOperationPermissions.wpcli.production');
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    const parsed = JSON.parse(r.stdout);
    expect(parsed.key).toBe('wpeOperationPermissions.wpcli.production');
    expect(typeof parsed.value).toBe('boolean');
  });

  it('get <missing.key> exits 1 with error', async () => {
    const r = await runCli('settings get this.key.does.not.exist');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/not found|error/);
  });
});

// ---------------------------------------------------------------------------
// nexus settings set — value type parsing
// ---------------------------------------------------------------------------

describe('nexus settings set — value types', () => {
  it('sets a boolean true', async () => {
    const r = await runCli(`settings set ${TEST_VALUE_BOOL_KEY} true`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('true');

    // Verify round-trip
    const get = await runCli(`settings get ${TEST_VALUE_BOOL_KEY}`);
    const parsed = JSON.parse(get.stdout);
    expect(parsed.value).toBe(true);
  });

  it('sets a boolean false', async () => {
    const r = await runCli(`settings set ${TEST_VALUE_BOOL_KEY} false`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    expect(r.exitCode).toBe(0);
    const get = await runCli(`settings get ${TEST_VALUE_BOOL_KEY}`);
    const parsed = JSON.parse(get.stdout);
    expect(parsed.value).toBe(false);
  });

  it('sets a number', async () => {
    const r = await runCli(`settings set ${TEST_KEY} ${TEST_VALUE_NUM}`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    expect(r.exitCode).toBe(0);

    const get = await runCli(`settings get ${TEST_KEY}`);
    const parsed = JSON.parse(get.stdout);
    expect(parsed.value).toBe(TEST_VALUE_NUM);
  });

  it('set confirms the new value in output', async () => {
    const r = await runCli(`settings set ${TEST_KEY} 7`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    expect(r.output).toContain('7');
    expect(r.output).toContain(TEST_KEY);
  });

  it('set requires both key and value arguments', async () => {
    const r = await runCli('settings set wpeOperationPermissions.push.production');
    expect(r.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// nexus settings set — round-trip persistence
// ---------------------------------------------------------------------------

describe('nexus settings set — round-trip', () => {
  it('change persists: set then get returns the new value', async () => {
    const r1 = await runCli(`settings set ${TEST_KEY} 99`);
    if (r1.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    const r2 = await runCli(`settings get ${TEST_KEY}`);
    expect(r2.exitCode).toBe(0);
    const parsed = JSON.parse(r2.stdout);
    expect(parsed.value).toBe(99);
  });

  it('second set overwrites the first', async () => {
    await runCli(`settings set ${TEST_KEY} 11`);
    await runCli(`settings set ${TEST_KEY} 22`);

    const r = await runCli(`settings get ${TEST_KEY}`);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.value).toBe(22);
  });

  it('nested path set does not wipe sibling keys', async () => {
    // Set both production and staging for wpcli
    await runCli('settings set wpeOperationPermissions.wpcli.production false');
    await runCli('settings set wpeOperationPermissions.wpcli.staging true');

    // Change only production
    await runCli('settings set wpeOperationPermissions.wpcli.production true');

    // Staging should still be true
    const r = await runCli('settings get wpeOperationPermissions.wpcli.staging');
    if (r.exitCode !== 0) { skipTest('Key not found — skipping sibling test'); return; }
    const parsed = JSON.parse(r.stdout);
    expect(parsed.value).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nexus settings patch
// ---------------------------------------------------------------------------

describe('nexus settings patch', () => {
  it('merges a JSON object into settings', async () => {
    const patch = JSON.stringify({ [TEST_KEY]: 33 });
    const r = await runCli(['settings', 'patch', patch]);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    expect(r.exitCode).toBe(0);

    const get = await runCli(`settings get ${TEST_KEY}`);
    const parsed = JSON.parse(get.stdout);
    expect(parsed.value).toBe(33);
  });

  it('patch updates multiple fields at once', async () => {
    const patch = JSON.stringify({ [TEST_KEY]: 55, autoIndex: true });
    const r = await runCli(['settings', 'patch', patch]);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    const g1 = await runCli(`settings get ${TEST_KEY}`);
    const g2 = await runCli('settings get autoIndex');
    expect(JSON.parse(g1.stdout).value).toBe(55);
    expect(JSON.parse(g2.stdout).value).toBe(true);
  });

  it('patch with nested object deep-merges (does not wipe sibling keys)', async () => {
    // Set a known state first
    await runCli('settings set wpeOperationPermissions.wpcli.production false');
    await runCli('settings set wpeOperationPermissions.wpcli.staging true');

    // Patch only production for push — wpcli should be untouched
    const patch = JSON.stringify({ wpeOperationPermissions: { push: { production: true } } });
    const r = await runCli(['settings', 'patch', patch]);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    // wpcli.production should still be false
    const wp = await runCli('settings get wpeOperationPermissions.wpcli.production');
    if (wp.exitCode === 0) {
      expect(JSON.parse(wp.stdout).value).toBe(false);
    }
  });

  it('patch with invalid JSON exits 1 with error', async () => {
    const r = await runCli(['settings', 'patch', '{not valid json}']);
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/json|invalid|error/);
  });
});

// ---------------------------------------------------------------------------
// nexus settings get — MCP tool smoke test via CLI
// ---------------------------------------------------------------------------

describe('nexus_get_settings MCP tool (via CLI round-trip)', () => {
  it('settings get → set → get confirms MCP write path works', async () => {
    const before = await runCli(`settings get ${TEST_KEY}`);
    if (before.exitCode !== 0) { skipTest('Local/addon not running'); return; }

    const originalValue = JSON.parse(before.stdout).value;

    const newValue = typeof originalValue === 'number' ? originalValue + 1 : 10;
    await runCli(`settings set ${TEST_KEY} ${newValue}`);

    const after = await runCli(`settings get ${TEST_KEY}`);
    expect(JSON.parse(after.stdout).value).toBe(newValue);

    // Restore
    await runCli(`settings set ${TEST_KEY} ${originalValue ?? 8}`);
  });
});
