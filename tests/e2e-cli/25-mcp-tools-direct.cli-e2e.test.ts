/**
 * MCP Direct Coverage — high-risk tools without an AI agent
 *
 * Calls MCP tools via NexusMcpClient HTTP POST. No API key required.
 * Skip pattern: skipAll fires if MCP is unreachable; per-test skip fires if no running site.
 *
 * Fixture site priority:
 *   1. CLI_E2E_TEST_SITE env var (set by globalSetup after WP-CLI validation)
 *   2. Any running site from getRunningSite()
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { NexusMcpClient, loadConnectionInfo } from './helpers/mcp-client';
import { getRunningSite, skipTest } from './helpers/cli-test-utils';

let mcpClient: NexusMcpClient;
let skipAll = false;
let testSite: string | null = null;

beforeAll(async () => {
  const info = loadConnectionInfo();
  if (!info) {
    console.log('[SKIP-ALL] MCP connection info not found — is Local running?');
    skipAll = true;
    return;
  }
  try {
    const h = await fetch(`${info.url}/health`);
    if (!h.ok) throw new Error(`health: ${h.status}`);
  } catch (err) {
    console.log(`[SKIP-ALL] MCP server unreachable: ${err}`);
    skipAll = true;
    return;
  }
  mcpClient = new NexusMcpClient(info);

  const preferred = process.env.CLI_E2E_TEST_SITE;
  if (preferred) {
    testSite = preferred;
  } else {
    const s = await getRunningSite();
    testSite = s?.name ?? null;
  }
  if (!testSite) console.log('[WARN] No running local site — per-site tool tests will skip');
  else console.log(`[mcp-direct] Using test site: ${testSite}`);
});

// ---------------------------------------------------------------------------
// Database scanner tools
// ---------------------------------------------------------------------------

describe('db-scanner MCP tools', () => {
  it('scan_database_health returns a numeric score in 0–100 range', async () => {
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    const result = await mcpClient.callTool('scan_database_health', { site: testSite });
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/\b([0-9]|[1-9][0-9]|100)\b/);
    console.log(`[scan_database_health] snippet: "${result.slice(0, 200)}"`);
  }, 60_000);

  it('get_database_recommendations returns non-empty advice text', async () => {
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    const result = await mcpClient.callTool('get_database_recommendations', { site: testSite });
    expect(result.length).toBeGreaterThan(0);
    console.log(`[get_database_recommendations] snippet: "${result.slice(0, 200)}"`);
  }, 60_000);

  it('clean_database_items with dry_run=true does not report actual deletions', async () => {
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    const result = await mcpClient.callTool('clean_database_items', {
      site: testSite,
      dry_run: true,
    });
    expect(result.length).toBeGreaterThan(0);
    // dry_run must never say it actually deleted something
    expect(result.toLowerCase()).not.toContain('deleted successfully');
    console.log(`[clean_database_items dry_run] snippet: "${result.slice(0, 200)}"`);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Site comparison tools
// ---------------------------------------------------------------------------

describe('compare_sites and detect_drift', () => {
  it('compare_sites with same site on both sides returns without error', async () => {
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    const result = await mcpClient.callTool('compare_sites', {
      site_a: testSite,
      site_b: testSite,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.toLowerCase()).not.toContain('error:');
    console.log(`[compare_sites] snippet: "${result.slice(0, 200)}"`);
  }, 60_000);

  it('detect_drift returns a drift report without crashing', async () => {
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    const result = await mcpClient.callTool('detect_drift', { baseline_site: testSite });
    expect(result.length).toBeGreaterThan(0);
    console.log(`[detect_drift] snippet: "${result.slice(0, 200)}"`);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Plugin lifecycle tools — install → activate → deactivate
// ---------------------------------------------------------------------------

describe('wp_plugin install / activate / deactivate', () => {
  const TEST_PLUGIN = 'hello-dolly'; // safe: tiny, on wp.org, no side-effects beyond DB row

  it('wp_plugin_install installs hello-dolly on the test site', async () => {
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    const result = await mcpClient.callTool('wp_plugin_install', {
      site: testSite,
      slug: TEST_PLUGIN,
    });
    expect(result.length).toBeGreaterThan(0);
    console.log(`[wp_plugin_install] snippet: "${result.slice(0, 200)}"`);
  }, 60_000);

  it('wp_plugin_activate activates hello-dolly', async () => {
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    const result = await mcpClient.callTool('wp_plugin_activate', {
      site: testSite,
      slug: TEST_PLUGIN,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.toLowerCase()).not.toContain('error');
    console.log(`[wp_plugin_activate] snippet: "${result.slice(0, 200)}"`);
  }, 30_000);

  it('wp_plugin_deactivate deactivates hello-dolly', async () => {
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    const result = await mcpClient.callTool('wp_plugin_deactivate', {
      site: testSite,
      slug: TEST_PLUGIN,
    });
    expect(result.length).toBeGreaterThan(0);
    console.log(`[wp_plugin_deactivate] snippet: "${result.slice(0, 200)}"`);
  }, 30_000);

  it('wp_plugin_update --all does not crash', async () => {
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    const result = await mcpClient.callTool('wp_plugin_update', {
      site: testSite,
      slug: '--all',
    });
    expect(result.length).toBeGreaterThan(0);
    console.log(`[wp_plugin_update --all] snippet: "${result.slice(0, 200)}"`);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// local_clone_site — most destructive non-delete operation
// ---------------------------------------------------------------------------

describe('local_clone_site', () => {
  const CLONE_NAME = 'nexus-e2e-mcp-clone-tmp';

  it('clones a running site and clone appears in local_list_sites output', async () => {
    if (process.env.NEXUS_E2E_SKIP_SLOW) { skipTest('NEXUS_E2E_SKIP_SLOW set'); return; }
    if (skipAll || !testSite) { skipTest('No MCP or no running site'); return; }
    try {
      const cloneResult = await mcpClient.callTool('local_clone_site', {
        site: testSite,
        new_name: CLONE_NAME,
      });
      expect(cloneResult.length).toBeGreaterThan(0);
      console.log(`[local_clone_site] snippet: "${cloneResult.slice(0, 200)}"`);

      const listResult = await mcpClient.callTool('local_list_sites', {});
      expect(listResult).toContain(CLONE_NAME);
    } finally {
      // Two-step delete (Tier 3 requires confirmation token)
      try {
        const r1 = await mcpClient.callTool('local_delete_site', { site: CLONE_NAME });
        const token = r1.match(/"confirmationToken"\s*:\s*"([^"]+)"/)?.[1];
        if (token) {
          await mcpClient.callTool('local_delete_site', { site: CLONE_NAME, _confirmationToken: token });
        }
      } catch { /* best effort */ }
    }
  }, 360_000);
});
