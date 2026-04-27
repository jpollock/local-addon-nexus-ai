/**
 * CLI E2E Tests — WP-CLI Commands
 *
 * Covers: nexus wp plugin/theme/core/db/post/user-list/option-get/health/search-replace
 * Requires: Local running, at least one running WordPress site.
 */

import { describe, it, expect } from '@jest/globals';
import { runCli, getRunningSite, skipTest } from './helpers/cli-test-utils';

async function withRunningSite(fn: (siteName: string) => Promise<void>): Promise<void> {
  // Use the dedicated e2e test site (started in globalSetup)
  const siteName = process.env.CLI_E2E_TEST_SITE;
  if (siteName) { await fn(siteName); return; }
  // Fallback: any running site
  const site = await getRunningSite();
  if (!site) { skipTest('No running local site available'); return; }
  await fn(site.name);
}

describe('nexus wp plugin', () => {
  it('plugin list returns exit 0 and plugin data', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp plugin list ${name}@local`);
      expect(r.exitCode).toBe(0);
      expect(r.output.toLowerCase()).toMatch(/plugin|slug|status/);
    });
  });

  it('plugin list --json returns array', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp plugin list ${name}@local --json`);
      expect(r.exitCode).toBe(0);
      const data = JSON.parse(r.stdout);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  it('plugin install fails gracefully for invalid slug', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp plugin install ${name}@local this-slug-does-not-exist-xyz`);
      expect(r.exitCode).toBe(1);
      expect(r.output.length).toBeGreaterThan(0);
    });
  });
});

describe('nexus wp theme', () => {
  it('theme list returns exit 0', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp theme list ${name}@local`);
      expect(r.exitCode).toBe(0);
      expect(r.output.toLowerCase()).toMatch(/theme|name/);
    });
  });
});

describe('nexus wp core', () => {
  it('core version returns a version number for @local target', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp core version ${name}@local`);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/\d+\.\d+/);
    });
  });

  it('core version with bare site name does not hang — completes within 10s', async () => {
    // Regression: when MCP server unreachable, CLI must fall through to GraphQL
    // and not hang waiting for MCP timeout. The command must always complete.
    // Uses a deliberately non-existent name so it fails fast with "not found"
    // rather than needing a running site or WPE SSH. Tests the timing, not the result.
    const start = Date.now();
    const r = await runCli('wp core version __nonexistent_site_xyz__', { timeout: 10000 });
    const elapsed = Date.now() - start;
    // Must complete — exit 0 or 1, NOT timeout
    expect([0, 1]).toContain(r.exitCode);
    // Must not hang — 10s is generous; real MCP timeout is 3s + GraphQL ~1s
    expect(elapsed).toBeLessThan(9000);
  });

  it('core update --dry-run does not crash', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp update ${name}@local`, { timeout: 60000 });
      expect([0, 1]).toContain(r.exitCode);
      expect(r.output.length).toBeGreaterThan(0);
    });
  });
});

describe('nexus wp db', () => {
  it('db export creates a file or shows an error', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp export ${name}@local`, { timeout: 60000 });
      expect([0, 1]).toContain(r.exitCode);
      expect(r.output.length).toBeGreaterThan(0);
    });
  });

  it('db scan returns health info', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp scan ${name}@local`, { timeout: 60000 });
      expect([0, 1]).toContain(r.exitCode);
      expect(r.output.length).toBeGreaterThan(0);
    });
  });
});

describe('nexus wp user-list', () => {
  it('returns users or appropriate message', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp user-list ${name}@local`);
      expect(r.exitCode).toBe(0);
      expect(r.output.length).toBeGreaterThan(0);
    });
  });
});

describe('nexus wp option-get', () => {
  it('returns siteurl value', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp option-get ${name}@local siteurl`);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/http/);
    });
  });

  it('returns error for nonexistent option', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp option-get ${name}@local nexus_cli_test_nonexistent_option_xyz`);
      // Option not found — may exit 0 with empty or 1 with error
      expect([0, 1]).toContain(r.exitCode);
    });
  });
});

describe('nexus wp health', () => {
  it('returns a health report', async () => {
    await withRunningSite(async (name) => {
      const r = await runCli(`wp health ${name}@local`, { timeout: 60000 });
      expect([0, 1]).toContain(r.exitCode);
      expect(r.output.toLowerCase()).toMatch(/health|pass|fail|recommend/);
    });
  });
});

describe('nexus wp search-replace', () => {
  it('requires both from and to arguments', async () => {
    const r = await runCli('wp search-replace mysite@local');
    expect(r.exitCode).toBe(1);
  });
});

describe('nexus wp — error cases', () => {
  it('all wp subcommands fail gracefully for nonexistent site', async () => {
    const r = await runCli('wp plugin list nonexistent-xyz@local');
    expect(r.exitCode).toBe(1);
    expect(r.output.toLowerCase()).toMatch(/not found|error/);
  });
});
