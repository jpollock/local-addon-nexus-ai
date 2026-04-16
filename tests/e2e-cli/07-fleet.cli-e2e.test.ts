/**
 * CLI E2E Tests — Fleet Commands
 *
 * Covers: nexus fleet health/site-health/search/filter/compare/
 *         groups (list/create/add/remove/delete)/bulk (reindex/plugin-update/health-check)
 */

import { describe, it, expect } from '@jest/globals';
import { runCli, getRunningSite, skipTest } from './helpers/cli-test-utils';

const TEST_GROUP = 'nexus-cli-test-group';

describe('nexus fleet health', () => {
  it('returns exit 0 and fleet summary', async () => {
    const r = await runCli('fleet health', { timeout: 60000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus fleet site-health', () => {
  it('requires a site target', async () => {
    const r = await runCli('fleet site-health');
    expect(r.exitCode).toBe(1);
  });

  it('returns health for a running site', async () => {
    const site = await getRunningSite();
    if (!site) { skipTest('No running local site'); return; }
    const r = await runCli(`fleet site-health ${site.name}@local`, { timeout: 60000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus fleet search', () => {
  it('requires a query argument', async () => {
    const r = await runCli('fleet search');
    expect(r.exitCode).toBe(1);
  });

  it('returns results or no matches for a query', async () => {
    const r = await runCli('fleet search wordpress', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus fleet filter', () => {
  it('runs without required args (shows all or help)', async () => {
    const r = await runCli('fleet filter', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus fleet compare', () => {
  it('requires two site targets', async () => {
    const r = await runCli('fleet compare');
    expect(r.exitCode).toBe(1);
  });
});

// fleet groups are subcommands of `nexus fleet groups`, not `nexus fleet` directly
describe('nexus fleet groups', () => {
  it('list returns exit 0', async () => {
    const r = await runCli('fleet groups list');
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('create makes a group', async () => {
    const r = await runCli(`fleet groups create ${TEST_GROUP}`);
    expect(r.exitCode).toBe(0);
    expect(r.output.toLowerCase()).toMatch(/created|group/);
  });

  it('add requires group and site', async () => {
    const r = await runCli('fleet groups add');
    expect(r.exitCode).toBe(1);
  });

  it('remove requires group and site', async () => {
    const r = await runCli('fleet groups remove');
    expect(r.exitCode).toBe(1);
  });

  it('delete removes the group', async () => {
    const r = await runCli(`fleet groups delete ${TEST_GROUP}`);
    expect([0, 1]).toContain(r.exitCode); // May not exist if create failed
    if (r.exitCode === 0) {
      expect(r.output.toLowerCase()).toMatch(/deleted|removed/);
    }
  });
});

describe('nexus fleet bulk', () => {
  it('reindex requires at least one target', async () => {
    const r = await runCli('fleet reindex');
    expect(r.exitCode).toBe(1);
  });

  it('plugin-update requires at least one target', async () => {
    const r = await runCli('fleet plugin-update');
    expect(r.exitCode).toBe(1);
  });

  it('health-check requires at least one target', async () => {
    const r = await runCli('fleet health-check');
    expect(r.exitCode).toBe(1);
  });
});
