/**
 * CLI E2E Tests — Blueprints and Content Commands
 *
 * Covers: nexus blueprints list/save
 *         nexus content search/search-all/structure/index-status/list-indexed/reindex
 */

import { describe, it, expect } from '@jest/globals';
import { runCli, getLocalSites, skipTest } from './helpers/cli-test-utils';

describe('nexus blueprints list', () => {
  it('returns exit 0 and blueprint list or empty', async () => {
    const r = await runCli('blueprints list');
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus blueprints save', () => {
  it('requires a site target and blueprint name', async () => {
    const r = await runCli('blueprints save');
    expect(r.exitCode).toBe(1);
  });

  it('requires blueprint name', async () => {
    const r = await runCli('blueprints save mysite@local');
    expect(r.exitCode).toBe(1);
  });
});

describe('nexus content index-status', () => {
  it('requires a site target', async () => {
    const r = await runCli('content index-status');
    expect(r.exitCode).toBe(1);
  });

  it('returns status for a real site', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`content index-status ${sites[0].name}@local`);
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus content list-indexed', () => {
  it('returns list of indexed sites', async () => {
    const r = await runCli('content list-indexed');
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus content search', () => {
  it('requires site and query', async () => {
    const r = await runCli('content search');
    expect(r.exitCode).toBe(1);
  });

  it('returns results or no matches for a query', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`content search ${sites[0].name}@local wordpress`, { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus content search-all', () => {
  it('requires a query argument', async () => {
    const r = await runCli('content search-all');
    expect(r.exitCode).toBe(1);
  });

  it('searches across all indexed sites', async () => {
    const r = await runCli('content search-all wordpress', { timeout: 30000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus content structure', () => {
  it('requires a site target', async () => {
    const r = await runCli('content structure');
    expect(r.exitCode).toBe(1);
  });
});

describe('nexus content reindex', () => {
  it('requires a site target', async () => {
    const r = await runCli('content reindex');
    expect(r.exitCode).toBe(1);
  });

  it('reindexes a real site', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`content reindex ${sites[0].name}@local`, { timeout: 120000 });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});
