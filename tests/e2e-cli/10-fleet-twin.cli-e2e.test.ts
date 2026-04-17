/**
 * CLI E2E Tests — Fleet Twin Intelligence Commands
 *
 * Covers: nexus fleet summary, fleet plugins, fleet php, fleet wp,
 *         fleet refresh (standard + --deep variants)
 *
 * Requires: Local running with Nexus AI addon enabled.
 * All commands read from twin cache — no live WP-CLI calls.
 */

import { describe, it, expect } from '@jest/globals';
import { runCli, skipTest } from './helpers/cli-test-utils';

// ---------------------------------------------------------------------------
// nexus fleet summary
// ---------------------------------------------------------------------------

describe('nexus fleet summary', () => {
  it('returns exit 0', async () => {
    const r = await runCli('fleet summary', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
  });

  it('shows site count header', async () => {
    const r = await runCli('fleet summary', { timeout: 30000 });
    expect(r.output).toMatch(/Fleet Summary/i);
    expect(r.output).toMatch(/\d+ sites?/i);
  });

  it('shows WordPress versions section', async () => {
    const r = await runCli('fleet summary', { timeout: 30000 });
    expect(r.output).toMatch(/WordPress/i);
  });

  it('shows PHP versions section', async () => {
    const r = await runCli('fleet summary', { timeout: 30000 });
    expect(r.output).toMatch(/PHP/i);
  });

  it('shows Twin completeness section', async () => {
    const r = await runCli('fleet summary', { timeout: 30000 });
    expect(r.output).toMatch(/completeness/i);
  });
});

// ---------------------------------------------------------------------------
// nexus fleet plugins
// ---------------------------------------------------------------------------

describe('nexus fleet plugins', () => {
  it('returns exit 0', async () => {
    const r = await runCli('fleet plugins', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
  });

  it('shows output (plugin table or no-data message)', async () => {
    const r = await runCli('fleet plugins', { timeout: 90000 });
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('--search filters by name', async () => {
    const r = await runCli('fleet plugins --search woocommerce', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    // Either finds woocommerce entries or reports none found
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('--active-on filters by minimum site count', async () => {
    const r = await runCli('fleet plugins --active-on 2', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('--json returns parseable array', async () => {
    const r = await runCli(['fleet', 'plugins', '--json'], { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data).toHaveProperty('plugins');
    expect(Array.isArray(data.plugins)).toBe(true);
    expect(data).toHaveProperty('totalSites');
  });

  it('--search with --active-on combines filters', async () => {
    const r = await runCli('fleet plugins --search w --active-on 1', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// nexus fleet php <version>
// ---------------------------------------------------------------------------

describe('nexus fleet php', () => {
  it('requires a version argument', async () => {
    const r = await runCli('fleet php');
    expect(r.exitCode).toBe(1);
  });

  it('returns exit 0 for a valid version', async () => {
    const r = await runCli('fleet php 8.2', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
  });

  it('shows sites or no-sites message', async () => {
    const r = await runCli('fleet php 8.2', { timeout: 30000 });
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('returns exit 0 and no results for fictional version', async () => {
    const r = await runCli('fleet php 5.3', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/no sites|0 found/i);
  });

  it('--json returns sites array', async () => {
    const r = await runCli(['fleet', 'php', '8.2', '--json'], { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nexus fleet wp <version>
// ---------------------------------------------------------------------------

describe('nexus fleet wp', () => {
  it('requires a version argument', async () => {
    const r = await runCli('fleet wp');
    expect(r.exitCode).toBe(1);
  });

  it('returns exit 0 for a valid version', async () => {
    const r = await runCli('fleet wp 6.9.4', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
  });

  it('shows sites or no-sites message', async () => {
    const r = await runCli('fleet wp 6.9.4', { timeout: 30000 });
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('returns exit 0 and no results for fictional version', async () => {
    const r = await runCli('fleet wp 99.0', { timeout: 30000 });
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/no sites|0 found/i);
  });
});

// ---------------------------------------------------------------------------
// nexus fleet refresh (standard)
// ---------------------------------------------------------------------------

describe('nexus fleet refresh', () => {
  it('returns exit 0', async () => {
    // fleet refresh scans all sites — can be slow with many sites; allow 3 min
    const r = await runCli('fleet refresh', { timeout: 180000 });
    expect(r.exitCode).toBe(0);
  });

  it('reports sites refreshed', async () => {
    const r = await runCli('fleet refresh', { timeout: 180000 });
    expect(r.output).toMatch(/sites?|refresh/i);
  });
});

// ---------------------------------------------------------------------------
// nexus fleet refresh --deep (local only to avoid SSH dependency)
// ---------------------------------------------------------------------------

describe('nexus fleet refresh --deep --local-only', () => {
  it('returns exit 0', async () => {
    const r = await runCli('fleet refresh --deep --local-only', { timeout: 300000 });
    expect(r.exitCode).toBe(0);
  });

  it('shows Local sites section', async () => {
    const r = await runCli('fleet refresh --deep --local-only', { timeout: 300000 });
    expect(r.output).toMatch(/local sites/i);
  });

  it('shows summary at end', async () => {
    const r = await runCli('fleet refresh --deep --local-only', { timeout: 300000 });
    expect(r.output).toMatch(/summary/i);
  });

  it('--concurrency 1 runs sites serially', async () => {
    const r = await runCli('fleet refresh --deep --local-only --concurrency 1', { timeout: 300000 });
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/concurrency: 1/i);
  });
});
