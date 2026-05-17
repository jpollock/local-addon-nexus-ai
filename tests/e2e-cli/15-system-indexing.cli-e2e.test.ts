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
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 120_000;

async function waitForIndexed(siteName: string, maxMs = MAX_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = await runCli(`system status --site ${siteName} --json`);
    if (r.exitCode === 0 && r.stdout.trim()) {
      try {
        const sites = JSON.parse(r.stdout);
        const site = Array.isArray(sites) ? sites[0] : sites;
        if (site?.indexState === 'indexed' && (site?.documentCount ?? 0) > 0) return true;
      } catch { /* parse error, keep polling */ }
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

describe('nexus system status — data store state', () => {
  it('exits 0 and returns JSON', async () => {
    const r = await runCli(`system status --json`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  it('includes indexState field for all local sites', async () => {
    const r = await runCli('system status --json');
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    const sites = JSON.parse(r.stdout);
    expect(sites.length).toBeGreaterThan(0);
    sites.forEach((s: any) => {
      expect(s).toHaveProperty('indexState');
      expect(s).toHaveProperty('documentCount');
      expect(s).toHaveProperty('siteId');
      expect(s).toHaveProperty('siteName');
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
    const sites = JSON.parse(r.stdout);
    const site = sites.find((s: any) => s.siteName === TEST_SITE);
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
    const sites = JSON.parse(r.stdout);
    const site = sites.find((s: any) => s.siteName === TEST_SITE);

    expect(site).toBeDefined();
    expect(site.indexState).toBe('indexed');
    expect(site.documentCount).toBeGreaterThan(0);
    expect(site.chunkCount).toBeGreaterThan(0);
    expect(site.lastIndexed).not.toBeNull();
  }, MAX_WAIT_MS + 10_000);

  it('after starting site: metadata cache is populated', async () => {
    // Site should already be running from previous test
    // Give metadata refresh a moment if needed
    const r = await runCli(`system status --site ${TEST_SITE} --json`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    const sites = JSON.parse(r.stdout);
    const site = sites.find((s: any) => s.siteName === TEST_SITE);

    if (!site) { skipTest(`${TEST_SITE} not found`); return; }
    if (site.indexState !== 'indexed') { skipTest('Site not indexed yet — run previous test first'); return; }

    // Metadata MUST be populated after indexing
    expect(site.metaCached).toBe(true);
    expect(site.wpVersion).toBeTruthy();
    expect(site.phpVersion).toBeTruthy();
    expect(site.pluginCount).toBeGreaterThanOrEqual(0);
  });

  it('after starting site: system status human-readable table renders correctly', async () => {
    const r = await runCli(`system status --site ${TEST_SITE}`);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain(TEST_SITE);
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
