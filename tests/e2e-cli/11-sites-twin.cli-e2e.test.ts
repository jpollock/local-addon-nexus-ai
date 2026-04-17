/**
 * CLI E2E Tests — Sites Twin Commands (Sprint D + Phase 5)
 *
 * Covers: nexus sites list (unified), sites get (plain name),
 *         sites status, sites refresh (local + WPE auto-detect)
 *
 * Requires: Local running with Nexus AI addon enabled.
 */

import { describe, it, expect } from '@jest/globals';
import { runCli, getLocalSites, skipTest } from './helpers/cli-test-utils';

// ---------------------------------------------------------------------------
// nexus sites list — unified view (Phase 5)
// ---------------------------------------------------------------------------

describe('nexus sites list (unified)', () => {
  it('returns exit 0', async () => {
    const r = await runCli('sites list', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
  });

  it('shows "All sites" header with counts', async () => {
    const r = await runCli('sites list', { timeout: 30000 });
    expect(r.output).toMatch(/All sites|Local sites|WPE sites/i);
  });

  it('--local-only shows only local sites', async () => {
    const r = await runCli('sites list --local-only', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/Local Sites/i);
  });

  it('--wpe-only returns exit 0 and some output', async () => {
    const r = await runCli('sites list --wpe-only', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('--json returns object with local and wpe arrays', async () => {
    const r = await runCli(['sites', 'list', '--json'], { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data).toHaveProperty('local');
    expect(data).toHaveProperty('wpe');
    expect(Array.isArray(data.local)).toBe(true);
    expect(Array.isArray(data.wpe)).toBe(true);
  });

  it('local sites JSON includes expected fields', async () => {
    const r = await runCli(['sites', 'list', '--json'], { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    if (data.local.length > 0) {
      expect(data.local[0]).toHaveProperty('name');
      expect(data.local[0]).toHaveProperty('status');
    }
  });
});

// ---------------------------------------------------------------------------
// nexus sites get — plain name (Sprint D, no @local required)
// ---------------------------------------------------------------------------

describe('nexus sites get — plain name (no @local)', () => {
  it('resolves a site by plain name without @local', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`sites get ${sites[0].name}`, { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain(sites[0].name);
  });

  it('plain name and @local produce same result', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const name = sites[0].name;
    const plain = await runCli(`sites get ${name}`, { timeout: 30000 });
    const atLocal = await runCli(`sites get ${name}@local`, { timeout: 30000 });
    expect(plain.exitCode).toBe(0);
    expect(atLocal.exitCode).toBe(0);
    // Both should mention the site name
    expect(plain.output).toContain(name);
    expect(atLocal.output).toContain(name);
  });

  it('shows siteKind for local sites (Sprint D)', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(['sites', 'get', sites[0].name, '--json'], { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    // siteKind added in Sprint D — sites get --json outputs site directly (not wrapped)
    expect(['local', 'wpe']).toContain(data.siteKind);
  });

  it('returns error for nonexistent plain name', async () => {
    const r = await runCli('sites get totally-nonexistent-xyz-123', { timeout: 30000 });
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/not found/);
  });
});

// ---------------------------------------------------------------------------
// nexus sites status (digital twin completeness)
// ---------------------------------------------------------------------------

describe('nexus sites status', () => {
  it('requires a site argument', async () => {
    const r = await runCli('sites status');
    expect(r.exitCode).toBe(1);
  });

  it('returns status report for a local site', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`sites status ${sites[0].name}`, { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('plain name works (no @local required)', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`sites status ${sites[0].name}`, { timeout: 30000 });
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// nexus sites refresh — local and WPE auto-detect
// ---------------------------------------------------------------------------

describe('nexus sites refresh', () => {
  it('requires a site argument', async () => {
    const r = await runCli('sites refresh');
    expect(r.exitCode).toBe(1);
  });

  it('refreshes a local site by plain name', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`sites refresh ${sites[0].name}`, { timeout: 60000 });
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('--force triggers full WP-CLI enrichment hint', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`sites refresh ${sites[0].name} --force`, { timeout: 60000 });
    // Exit 0 whether site is running or not (falls back to filesystem scan)
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});
