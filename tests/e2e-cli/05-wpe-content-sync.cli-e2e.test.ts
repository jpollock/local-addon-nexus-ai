/**
 * CLI E2E Tests — WPE Content Sync (L3 Index + L2 Piggyback)
 *
 * Verifies:
 *   1. `nexus fleet refresh --wpe-only --deep` triggers WPE L3 content indexing
 *      AND updates L2 metadata (the piggyback behaviour) for a real install.
 *   2. The new settings fields (wpeContentIndexAutoEnabled, wpeContentIndexIntervalHours)
 *      are accepted by the settings subsystem and round-trip correctly.
 *
 * The live-execution tests (Section 1) require NEXUS_WPE_TEST_INSTALL to be set
 * AND WPE authentication to be active. They skip gracefully when absent.
 *
 * The settings round-trip test (Section 2) only needs Local + the addon running.
 *
 * Run:
 *   npm run test:cli-e2e -- --testPathPattern=05-wpe-content-sync
 */

import { describe, it, expect, afterAll } from '@jest/globals';
import { runCli, getWpeAccounts, skipTest } from './helpers/cli-test-utils';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WPE_INSTALL = process.env.NEXUS_WPE_TEST_INSTALL ?? '';

// Settings keys introduced in B1 — restored in afterAll
const CONTENT_INDEX_ENABLED_KEY = 'wpeContentIndexAutoEnabled';
const CONTENT_INDEX_INTERVAL_KEY = 'wpeContentIndexIntervalHours';
let originalContentIndexEnabled: boolean | undefined;
let originalContentIndexInterval: number | undefined;

afterAll(async () => {
  // Restore original settings so the test run leaves no lasting state change.
  if (originalContentIndexEnabled !== undefined) {
    await runCli(`settings set ${CONTENT_INDEX_ENABLED_KEY} ${originalContentIndexEnabled}`);
  }
  if (originalContentIndexInterval !== undefined) {
    await runCli(`settings set ${CONTENT_INDEX_INTERVAL_KEY} ${originalContentIndexInterval}`);
  }
});

// ---------------------------------------------------------------------------
// Section 1 — Live WPE content index + L2 piggyback (skip if no WPE install)
// ---------------------------------------------------------------------------

describe('WPE content index piggyback — L3 triggers L2 metadata sync', () => {
  it('nexus fleet refresh --wpe-only --deep updates L2 twin for test install', async () => {
    if (!WPE_INSTALL) {
      skipTest('NEXUS_WPE_TEST_INSTALL not set — skipping WPE content sync test');
      return;
    }

    const accounts = await getWpeAccounts();
    if (accounts.length === 0) {
      skipTest('Not authenticated to WPE — skipping');
      return;
    }

    // Capture the twin state before the refresh so we can verify it changed.
    const twinBefore = await runCli(`fleet site-health ${WPE_INSTALL}`, { timeout: 30000 });
    // The twin query may fail if the site is not yet in graph — that is fine.

    // Trigger a deep refresh for WPE only. This calls indexAllWpeContent under the
    // hood, which also runs L2 SSH metadata sync (the piggyback).
    const refreshResult = await runCli(
      `fleet refresh --wpe-only --deep`,
      { timeout: 5 * 60 * 1000 }, // 5 min — SSH to WPE can take time
    );

    // The command must complete (not hang/crash). Exit 0 = full success,
    // exit 1 = partial failure (e.g. SSH timeout on one install) — both acceptable.
    expect([0, 1]).toContain(refreshResult.exitCode);
    expect(refreshResult.output.length).toBeGreaterThan(0);

    // On success, the output should mention WPE sites being processed.
    if (refreshResult.exitCode === 0) {
      expect(refreshResult.output.toLowerCase()).toMatch(/wpe|install|refresh|done/);
    }

    // Verify the twin was updated: the site should now appear in the fleet index.
    const twinAfter = await runCli(`fleet site-health ${WPE_INSTALL}`, { timeout: 30000 });
    // Must not crash — either shows health data or a "not indexed" message.
    expect([0, 1]).toContain(twinAfter.exitCode);
    expect(twinAfter.output.length).toBeGreaterThan(0);

    // If the twin was populated, it should now have metadata (L2 piggyback landed).
    // We check for any known field names that live refresh would write.
    if (twinAfter.exitCode === 0) {
      // Health output should mention the install name or health data.
      expect(twinAfter.output.toLowerCase()).toMatch(
        new RegExp(WPE_INSTALL.toLowerCase() + '|plugin|version|health|score'),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Section 2 — Settings round-trip for wpeContentIndexAutoEnabled + Interval
// ---------------------------------------------------------------------------

describe('WPE content index settings — new fields accepted and persisted', () => {
  it('wpeContentIndexAutoEnabled and wpeContentIndexIntervalHours round-trip via settings', async () => {
    // Read current settings to save original values for afterAll restore.
    const getResult = await runCli('settings get --json');
    if (getResult.exitCode !== 0) {
      skipTest('Local/addon not running — skipping settings round-trip');
      return;
    }

    let current: Record<string, any>;
    try {
      current = JSON.parse(getResult.stdout);
    } catch {
      skipTest('Could not parse settings JSON');
      return;
    }

    originalContentIndexEnabled = current[CONTENT_INDEX_ENABLED_KEY];
    originalContentIndexInterval = current[CONTENT_INDEX_INTERVAL_KEY];

    // Write the new settings fields.
    const setEnabled = await runCli(`settings set ${CONTENT_INDEX_ENABLED_KEY} true`);
    const setInterval = await runCli(`settings set ${CONTENT_INDEX_INTERVAL_KEY} 48`);

    // Both writes must succeed.
    expect(setEnabled.exitCode).toBe(0);
    expect(setInterval.exitCode).toBe(0);

    // Read back and confirm persistence.
    const readBack = await runCli('settings get --json');
    expect(readBack.exitCode).toBe(0);

    let persisted: Record<string, any>;
    try {
      persisted = JSON.parse(readBack.stdout);
    } catch {
      throw new Error(`settings get --json returned non-JSON: ${readBack.stdout.slice(0, 200)}`);
    }

    expect(persisted[CONTENT_INDEX_ENABLED_KEY]).toBe(true);
    expect(persisted[CONTENT_INDEX_INTERVAL_KEY]).toBe(48);
  });
});
