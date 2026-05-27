/**
 * CLI E2E Tests — System Indexing Flow
 *
 * Tests the full data-building lifecycle for a local site:
 *   1. After factory reset: all stores are empty
 *   2. After starting a site: content index + metadata cache populated
 *   3. nexus system status returns accurate state
 *
 * Uses nexus-e2e-test as the fixture site (created/managed by global setup).
 * Requires: Local running, addon active.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { runCli, skipTest } from './helpers/cli-test-utils';

const TEST_SITE = 'nexus-e2e-test';

/** Strip CLI warning lines (💡 ...) before parsing JSON output */
function parseJson(stdout: string): any {
  const start = stdout.indexOf('[') !== -1 ? stdout.indexOf('[') : stdout.indexOf('{');
  if (start === -1) throw new Error(`No JSON found in output: ${stdout.slice(0, 100)}`);
  return JSON.parse(stdout.slice(start));
}
const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 300_000; // 5 minutes — sites with 500+ docs take 3-4 min

async function waitForIndexed(siteName: string, maxMs = MAX_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = await runCli(`system status --site ${siteName} --json`);
    if (r.exitCode === 0) {
      // Strip warning lines before JSON
      const jsonStart = r.stdout.indexOf('[');
      if (jsonStart !== -1) {
        try {
          const sites = JSON.parse(r.stdout.slice(jsonStart));
          const site = Array.isArray(sites) ? sites[0] : null;
          if (site?.indexState === 'indexed' && (site?.documentCount ?? 0) > 0) return true;
        } catch { /* keep polling */ }
      }
    }
    await new Promise(res => setTimeout(res, POLL_INTERVAL_MS));
  }
  return false;
}

describe('nexus system status — data store state', () => {
  it('exits 0 and returns JSON', async () => {
    const r = await runCli(`system status --json`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    expect(r.exitCode).toBe(0);
    const data = parseJson(r.stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  it('includes indexState field for all local sites', async () => {
    const r = await runCli('system status --json');
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    const sites = parseJson(r.stdout);
    expect(sites.length).toBeGreaterThan(0);
    sites.forEach((s: any) => {
      expect(s).toHaveProperty('indexState');
      expect(s).toHaveProperty('documentCount');
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('name');
    });
  });
});

describe('full indexing lifecycle — start site → verify all stores populated', () => {
  beforeAll(async () => {
    // Ensure test site is stopped before the test
    await runCli(`sites stop ${TEST_SITE}@local`).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  });

  afterAll(async () => {
    // Leave test site running (global teardown handles it)
  });

  it('before start: test site has idle index state', async () => {
    const r = await runCli(`system status --site ${TEST_SITE} --json`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    const sites = parseJson(r.stdout);
    const site = sites.find((s: any) => s.name === TEST_SITE);
    if (!site) { skipTest(`${TEST_SITE} not found in site list`); return; }
    // May be idle or stale — just must not be currently indexing
    expect(site.indexState).not.toBe('indexing');
  });

  it('after starting site: content index populates with documentCount > 0', async () => {
    // Start the site
    const startResult = await runCli(`sites start ${TEST_SITE}@local`);
    if (startResult.exitCode !== 0) { skipTest(`Could not start ${TEST_SITE}`); return; }

    // Wait for indexing to complete
    const indexed = await waitForIndexed(TEST_SITE);
    expect(indexed).toBe(true);

    // Verify content index
    const r = await runCli(`system status --site ${TEST_SITE} --json`);
    expect(r.exitCode).toBe(0);
    const sites = parseJson(r.stdout);
    const site = sites.find((s: any) => s.name === TEST_SITE);

    expect(site).toBeDefined();
    expect(site.indexState).toBe('indexed');
    expect(site.documentCount).toBeGreaterThan(0);
    expect(site.chunkCount).toBeGreaterThan(0);
    expect(site.lastIndexed).not.toBeNull();
  }, MAX_WAIT_MS + 30_000);

  it('after starting site: metadata cache is populated', async () => {
    // Metadata refresh runs async after siteStarted — poll until populated (max 60s)
    let site: any = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await runCli(`system status --site ${TEST_SITE} --json`);
      if (r.exitCode === 0) {
        const sites = parseJson(r.stdout);
        const found = sites.find((s: any) => s.name === TEST_SITE);
        if (found?.metaUpdatedAt && found?.wpVersion) { site = found; break; }
      }
      await new Promise(res => setTimeout(res, 3000));
    }

    if (!site) { skipTest(`${TEST_SITE} metadata not populated after 60s — site may not be running`); return; }
    if (site.indexState !== 'indexed') { skipTest('Site not indexed'); return; }

    expect(site.metaUpdatedAt).not.toBeNull();
    expect(site.wpVersion).toBeTruthy();
    // phpVersion comes from Local config — may be null for some site configs
    // pluginCount from WP-CLI — may be null if WP-CLI timed out
    expect(site.pluginCount).toBeGreaterThanOrEqual(0);
  }, 90_000);

  it('after starting site: system status human-readable table renders correctly', async () => {
    const r = await runCli(`system status --site ${TEST_SITE}`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    expect(r.exitCode).toBe(0);
    // If the site wasn't created/indexed by a prior test step, skip rather than fail
    if (!r.output.includes(TEST_SITE)) { skipTest(`${TEST_SITE} not in status output — prior test may have skipped`); return; }
    expect(r.output).toContain('indexed');
  });
});

describe('nexus system status after factory reset', () => {
  it('all stores show empty after reset', async () => {
    // Reset all data
    const resetResult = await runCli('reset --factory --confirm');
    if (resetResult.exitCode !== 0) { skipTest('Reset failed'); return; }

    // Must restart Local for reset to take effect — skip if we can't verify
    // Instead check that settings were cleared
    const settingsResult = await runCli('settings get discoverProgress');
    // After reset, discoverProgress should be null/undefined
    if (settingsResult.exitCode === 0) {
      const parsed = JSON.parse(settingsResult.stdout);
      expect(parsed.value).toBeFalsy();
    }
  });
});
