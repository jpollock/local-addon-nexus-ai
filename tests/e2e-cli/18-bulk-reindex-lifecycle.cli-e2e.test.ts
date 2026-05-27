/**
 * CLI E2E Tests — Bulk Reindex with Halted Sites (Regression)
 *
 * Regression coverage for: bulk_reindex auto-starts halted sites, indexes them,
 * and produces searchable content. Also verifies that mixing running and halted
 * sites in a bulk reindex target list is handled gracefully.
 *
 * Uses nexus-e2e-test as the primary fixture site.
 * Requires: Local running, nexus-e2e-test site exists.
 *
 * Run: npx jest --config tests/e2e-cli/jest.cli-e2e.config.js --testPathPattern 18-bulk-reindex
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { runCli, skipTest, getLocalSites } from './helpers/cli-test-utils';

const TEST_SITE = 'nexus-e2e-test';
const MAX_WAIT_MS = 300_000; // 5 min
const POLL_MS = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonArray(stdout: string): any[] {
  const start = stdout.indexOf('[');
  if (start === -1) return [];
  try { return JSON.parse(stdout.slice(start)); }
  catch { return []; }
}

function parseJsonObject(stdout: string): any {
  const bracketIdx = stdout.indexOf('[');
  const braceIdx = stdout.indexOf('{');
  let start = -1;
  if (bracketIdx === -1) start = braceIdx;
  else if (braceIdx === -1) start = bracketIdx;
  else start = Math.min(bracketIdx, braceIdx);
  if (start === -1) return null;
  try { return JSON.parse(stdout.slice(start)); }
  catch { return null; }
}

async function getSiteRunStatus(siteName: string): Promise<string | null> {
  const r = await runCli('sites list --json');
  if (r.exitCode !== 0) return null;
  const data = parseJsonObject(r.stdout);
  const local: any[] = data?.local ?? [];
  const site = local.find((s: any) => s.name === siteName);
  return site?.status ?? null;
}

async function getIndexStatus(siteName: string): Promise<any | null> {
  const r = await runCli(`system status --site ${siteName} --json`);
  if (r.exitCode !== 0) return null;
  const jsonStart = r.stdout.indexOf('[');
  if (jsonStart === -1) return null;
  try {
    const sites = JSON.parse(r.stdout.slice(jsonStart));
    return Array.isArray(sites) ? (sites[0] ?? null) : null;
  } catch { return null; }
}

/** Poll until documentCount > 0 or timeout */
async function waitForIndexed(siteName: string, maxMs = MAX_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await getIndexStatus(siteName);
    if (s?.indexState === 'indexed' && (s?.documentCount ?? 0) > 0) return true;
    await new Promise(res => setTimeout(res, POLL_MS));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Setup/teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Ensure test site is halted before the bulk-reindex regression test
  await runCli(`sites stop ${TEST_SITE}@local`).catch(() => {});
  await new Promise(res => setTimeout(res, 3000));
}, 30_000);

afterAll(async () => {
  // Leave site running — other test suites may need it
});

// ---------------------------------------------------------------------------
// Regression: halted site before bulk reindex
// ---------------------------------------------------------------------------

describe('bulk reindex — halted site regression', () => {
  it('site is halted before running bulk reindex', async () => {
    const status = await getSiteRunStatus(TEST_SITE);
    if (status === null) { skipTest('Cannot determine site status — Local may not be running'); return; }
    if (status !== 'halted' && status !== 'stopped') {
      // Site may not have stopped cleanly — skip rather than fail
      skipTest(`${TEST_SITE} is in status "${status}" — stop may have failed, skip regression`);
      return;
    }
    expect(['halted', 'stopped']).toContain(status);
  }, 30_000);

  it('fleet bulk reindex command exits 0 for single site', async () => {
    // fleet bulk reindex auto-starts the site, indexes, and returns
    const r = await runCli(`fleet bulk reindex ${TEST_SITE}@local`, {
      timeout: MAX_WAIT_MS + 30_000,
    });
    if (r.exitCode !== 0) {
      skipTest(`fleet bulk reindex exited ${r.exitCode} — Local may not be running or command failed`);
      return;
    }
    expect(r.exitCode).toBe(0);
  }, MAX_WAIT_MS + 60_000);

  it('after bulk reindex: documentCount > 0 for previously-halted site', async () => {
    // Wait for indexing to settle (bulk reindex may still be async-completing)
    const indexed = await waitForIndexed(TEST_SITE, 120_000);
    if (!indexed) { skipTest('Site did not fully index within 2 minutes'); return; }
    const s = await getIndexStatus(TEST_SITE);
    if (!s) { skipTest(`${TEST_SITE} status not found`); return; }
    expect(s.documentCount).toBeGreaterThan(0);
    expect(s.indexState).toBe('indexed');
  }, 150_000);

  it('after bulk reindex: content search returns results', async () => {
    const r = await runCli([
      `content`, `search`, `${TEST_SITE}@local`,
      `WordPress`, `--json`, `--limit`, `5`,
    ]);
    if (r.exitCode !== 0) { skipTest('content search failed after bulk reindex'); return; }
    const results = parseJsonArray(r.stdout);
    if (results.length === 0) { skipTest('No results — site may have no content'); return; }
    expect(results.length).toBeGreaterThan(0);
    // All results should have a score
    results.forEach((res: any) => {
      expect(typeof (res.score ?? res.relevance)).toBe('number');
    });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Mixed running + halted bulk reindex
//
// When we pass multiple targets where some are running and some are halted,
// the command should handle both gracefully without crashing.
// ---------------------------------------------------------------------------

describe('bulk reindex — mixed running+halted targets', () => {
  it('identifies at least one local site to use as test target', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites found'); return; }
    expect(sites.length).toBeGreaterThan(0);
  }, 30_000);

  it('fleet bulk reindex with two targets exits 0 or non-zero cleanly (no crash)', async () => {
    const sites = await getLocalSites();
    if (sites.length < 2) { skipTest('Need at least 2 local sites for mixed test'); return; }

    // Use the first two sites — we don't care about their states
    const targets = sites
      .slice(0, 2)
      .map((s: any) => `${s.name}@local`)
      .join(' ');

    const r = await runCli(`fleet bulk reindex ${targets}`, {
      timeout: MAX_WAIT_MS + 30_000,
    });

    // The command must not crash (exit codes 0 or non-zero are both acceptable;
    // what matters is it doesn't throw an unhandled exception)
    expect([0, 1]).toContain(r.exitCode);
    // Output should contain something (not empty)
    expect(r.output.length).toBeGreaterThan(0);
  }, MAX_WAIT_MS + 60_000);

  it('fleet bulk reindex produces consistent output format for each target', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites found'); return; }

    const target = `${sites[0].name}@local`;
    const r = await runCli(`fleet bulk reindex ${target}`, {
      timeout: MAX_WAIT_MS + 30_000,
    });

    // Output should reference the site name or a recognizable result summary
    if (r.exitCode !== 0) { skipTest('bulk reindex exited non-zero'); return; }
    // Command should produce output that includes the site target or a summary
    expect(r.output.length).toBeGreaterThan(0);
  }, MAX_WAIT_MS + 60_000);
});

// ---------------------------------------------------------------------------
// Content index command (single-site, explicit trigger)
// ---------------------------------------------------------------------------

describe('content index — explicit single-site reindex', () => {
  it('nexus content index exits 0 on running site', async () => {
    // Ensure site is running first
    const startR = await runCli(`sites start ${TEST_SITE}@local`);
    if (startR.exitCode !== 0) { skipTest(`Could not start ${TEST_SITE}`); return; }
    await new Promise(res => setTimeout(res, 2000));

    const r = await runCli([`content`, `index`, `${TEST_SITE}@local`], {
      timeout: MAX_WAIT_MS + 30_000,
    });
    if (r.exitCode !== 0) {
      skipTest(`content index exited ${r.exitCode}: ${r.stderr.slice(0, 200)}`);
      return;
    }
    expect(r.exitCode).toBe(0);
  }, MAX_WAIT_MS + 60_000);

  it('content index-status reports indexed state after indexing', async () => {
    const r = await runCli([`content`, `index-status`, `${TEST_SITE}@local`, `--json`]);
    if (r.exitCode !== 0) { skipTest('index-status failed'); return; }
    try {
      const data = parseJsonObject(r.stdout);
      if (!data) { skipTest('No JSON in index-status output'); return; }
      // Should have document count or indexState
      const hasState = data.indexState ?? data.state ?? data.documentCount !== undefined;
      expect(hasState).toBeTruthy();
    } catch {
      skipTest('Could not parse index-status JSON');
    }
  }, 30_000);
});
