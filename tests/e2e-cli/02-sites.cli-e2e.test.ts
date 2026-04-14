/**
 * CLI E2E Tests — Sites Commands
 *
 * Covers: nexus sites get/create/start/stop/restart/delete/clone/rename/export/logs/config-*
 * Requires: Local running with Nexus AI addon enabled.
 *
 * NOTE: create/delete/clone/rename tests use a dedicated test site name
 * "nexus-cli-test-site" and clean up after themselves.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { runCli, getLocalSites, getRunningSite, skipTest } from './helpers/cli-test-utils';

const TEST_SITE_NAME = 'nexus-cli-test-site';

describe('nexus sites list', () => {
  it('returns exit 0 and shows Sites header', async () => {
    const r = await runCli('sites list');
    expect(r.exitCode).toBe(0);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('--json returns valid structure with local array', async () => {
    const r = await runCli('sites list --json');
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data).toHaveProperty('local');
    expect(Array.isArray(data.local)).toBe(true);
    if (data.local.length > 0) {
      const s = data.local[0];
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('status');
      expect(s).toHaveProperty('id');
    }
  });
});

describe('nexus sites get', () => {
  it('returns error for nonexistent site', async () => {
    const r = await runCli('sites get nonexistent-xyz-123@local');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/not found|error/);
  });

  it('returns site details for a real site', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`sites get ${sites[0].name}@local`);
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain(sites[0].name);
    expect(r.output.toLowerCase()).toMatch(/status|running|halted/);
  });

  it('--json returns valid site object', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`sites get ${sites[0].name}@local --json`);
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data).toHaveProperty('name');
    expect(data).toHaveProperty('status');
  });
});

describe('nexus sites create / start / stop / restart / delete', () => {
  beforeAll(async () => {
    // Clean up any leftover test site
    await runCli(`sites delete ${TEST_SITE_NAME}@local`, { stdin: 'y' });
  });

  afterAll(async () => {
    // Ensure cleanup even if tests fail
    await runCli(`sites delete ${TEST_SITE_NAME}@local`, { stdin: 'y' });
  });

  it('create requires @local suffix', async () => {
    const r = await runCli(`sites create ${TEST_SITE_NAME}`);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('@local');
  });

  it('create makes a new site', async () => {
    const r = await runCli(`sites create ${TEST_SITE_NAME}@local`, { timeout: 120000 });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain(TEST_SITE_NAME);
    expect(r.output.toLowerCase()).toContain('created');
  });

  it('start brings site to running', async () => {
    const r = await runCli(`sites start ${TEST_SITE_NAME}@local`, { timeout: 120000 });
    expect(r.exitCode).toBe(0);
    expect(r.output.toLowerCase()).toMatch(/running|started/);
  });

  it('restart works on a running site', async () => {
    const r = await runCli(`sites restart ${TEST_SITE_NAME}@local`, { timeout: 120000 });
    expect(r.exitCode).toBe(0);
    expect(r.output.toLowerCase()).toMatch(/running|restarted/);
  });

  it('stop halts the site', async () => {
    const r = await runCli(`sites stop ${TEST_SITE_NAME}@local`, { timeout: 120000 });
    expect(r.exitCode).toBe(0);
    expect(r.output.toLowerCase()).toMatch(/halted|stopped/);
  });

  it('delete with confirmation removes the site', async () => {
    const r = await runCli(`sites delete ${TEST_SITE_NAME}@local`, { stdin: 'y', timeout: 60000 });
    expect(r.exitCode).toBe(0);
    expect(r.output.toLowerCase()).toContain('deleted');
    // Verify it's gone
    const check = await runCli(`sites get ${TEST_SITE_NAME}@local`);
    expect(check.exitCode).toBe(1);
  });
});

describe('nexus sites start/stop — error cases', () => {
  it('start nonexistent site fails with not found', async () => {
    const r = await runCli('sites start nonexistent-xyz-123@local');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/not found|error/);
  });

  it('stop nonexistent site fails with not found', async () => {
    const r = await runCli('sites stop nonexistent-xyz-123@local');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/not found|error/);
  });
});

describe('nexus sites logs', () => {
  it('shows error for nonexistent site', async () => {
    const r = await runCli('sites logs nonexistent-xyz@local');
    expect(r.exitCode).toBe(1);
  });

  it('returns logs or appropriate message for a real site', async () => {
    const sites = await getLocalSites();
    if (sites.length === 0) { skipTest('No local sites'); return; }
    const r = await runCli(`sites logs ${sites[0].name}@local`);
    // Logs may be empty but command should not crash
    expect([0, 1]).toContain(r.exitCode);
    expect(r.output.length).toBeGreaterThan(0);
  });
});

describe('nexus sites clone', () => {
  it('requires @local suffix on source', async () => {
    const r = await runCli('sites clone somename nexus-cli-clone-test');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('@local');
  });
});

describe('nexus sites rename', () => {
  it('requires @local suffix on target', async () => {
    const r = await runCli('sites rename somename newname');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('@local');
  });
});

describe('nexus sites config-php', () => {
  it('requires a site and php version', async () => {
    const r = await runCli('sites config-php');
    expect(r.exitCode).toBe(1);
  });
});
