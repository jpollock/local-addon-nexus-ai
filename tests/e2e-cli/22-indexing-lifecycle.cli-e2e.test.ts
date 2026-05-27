/**
 * CLI E2E Tests — Indexing Lifecycle (Direct MCP Tool Calls)
 *
 * Tests the indexing lifecycle end-to-end by calling MCP tools directly —
 * no AI agent in this file. Covers:
 *   L2 — nexus_site_refresh (twin refresh with force=true)
 *   L3 — reindex_site + get_index_status poll + search_site_content
 *   Fleet — list_indexed_sites
 *   WPE L2 — wpe_site_deep_refresh (skip if NEXUS_WPE_TEST_INSTALL not set)
 *   WPE twin — nexus_get_site_twin for WPE install (skip if not set)
 *
 * Requires: Local running with Nexus AI addon active.
 * Uses NEXUS_TEST_SITE_NAME (default: nexus-e2e-test) as the fixture site.
 * CRITICAL: nexus-e2e-cli-test-site is a broken fixture — skip it everywhere.
 *
 * Run:
 *   npm run test:cli-e2e -- --testPathPattern=22-indexing-lifecycle
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { loadConnectionInfo, NexusMcpClient } from './helpers/mcp-client';

const SITE = process.env.NEXUS_TEST_SITE_NAME ?? 'nexus-e2e-test';
const WPE_INSTALL = process.env.NEXUS_WPE_TEST_INSTALL ?? '';

// Poll constants for L3
const POLL_INTERVAL_MS = 5_000;
const REINDEX_DEADLINE_MS = 5 * 60 * 1000; // 5 min

let client: NexusMcpClient;
let skipAll = false;

beforeAll(async () => {
  const info = loadConnectionInfo();
  if (!info) {
    console.log('[SKIP-ALL] MCP connection info not found — is Local running?');
    skipAll = true;
    return;
  }

  // Verify MCP server is reachable
  try {
    const health = await fetch(`${info.url}/health`);
    if (!health.ok) throw new Error(`Health: ${health.status}`);
  } catch (err) {
    console.log(`[SKIP-ALL] MCP server unreachable: ${err}`);
    skipAll = true;
    return;
  }

  client = new NexusMcpClient(info);
  console.log(`[indexing-lifecycle] MCP connected. site="${SITE}", wpe="${WPE_INSTALL || '(none)'}"`);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse state/documentCount/chunkCount from get_index_status markdown output.
 *
 * The tool returns markdown like:
 *   ## Index Status: <name>
 *   **State:** indexed
 *   **Documents:** 42
 *   **Chunks:** 180
 */
function parseIndexStatus(text: string): { state: string | null; documentCount: number; chunkCount: number } {
  const stateMatch = text.match(/\*\*State:\*\*\s*(\S+)/);
  const docsMatch  = text.match(/\*\*Documents:\*\*\s*(\d+)/);
  const chunksMatch = text.match(/\*\*Chunks:\*\*\s*(\d+)/);
  return {
    state:         stateMatch  ? stateMatch[1].trim()  : null,
    documentCount: docsMatch   ? parseInt(docsMatch[1],  10) : 0,
    chunkCount:    chunksMatch ? parseInt(chunksMatch[1], 10) : 0,
  };
}

/** Poll get_index_status until state='indexed'|'error' or deadline exceeded. */
async function waitForIndexed(
  siteName: string,
  deadlineMs = REINDEX_DEADLINE_MS,
): Promise<{ state: string | null; documentCount: number; chunkCount: number }> {
  const deadline = Date.now() + deadlineMs;
  let last = { state: null as string | null, documentCount: 0, chunkCount: 0 };

  while (Date.now() < deadline) {
    try {
      const raw = await client.callTool('get_index_status', { site: siteName });
      last = parseIndexStatus(raw);
      console.log(`[indexing-lifecycle] get_index_status → state=${last.state}, docs=${last.documentCount}`);

      // 'stale' also means indexed (content changed since last index but docs exist)
      if (last.state === 'indexed' || last.state === 'stale' || last.state === 'error') return last;
    } catch (err) {
      console.log(`[indexing-lifecycle] get_index_status error (will retry): ${err}`);
    }

    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }

  console.log('[indexing-lifecycle] deadline exceeded — returning last known state');
  return last;
}

// ---------------------------------------------------------------------------
// L2 — nexus_site_refresh
// ---------------------------------------------------------------------------

describe('Local L2 — nexus_site_refresh', () => {
  it('refreshes the site twin with force=true and returns non-error text', async () => {
    if (skipAll) return;

    const result = await client.callTool('nexus_site_refresh', { site: SITE, force: true });

    console.log(`[indexing-lifecycle] nexus_site_refresh result (first 300 chars): ${result.slice(0, 300)}`);

    if (/not found/i.test(result.toLowerCase())) {
      console.log(`[SKIP] ${SITE} not found — skipping L2 test. Ensure global setup created the site.`);
      return;
    }
    expect(result.length).toBeGreaterThan(0);
    // Tool returns "## <site> — twin refreshed" on success
    expect(result).toMatch(/refreshed|twin|scan/i);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// L3 — reindex_site + get_index_status poll + search_site_content
// ---------------------------------------------------------------------------

describe('Local L3 — reindex_site + get_index_status', () => {
  it('reindex_site completes and get_index_status eventually shows state=indexed with documentCount>0', async () => {
    if (skipAll) return;

    // reindex_site requires the site to be running (MySQL must be available).
    // Start it, reindex, then stop it — same lifecycle as INDEX_ALL_AUTO.
    console.log(`[indexing-lifecycle] starting "${SITE}" for indexing...`);
    await client.callTool('local_start_site', { site: SITE });
    // Give MySQL a moment to be ready
    await new Promise(r => setTimeout(r, 8_000));

    let reindexResult = '';
    try {
      console.log(`[indexing-lifecycle] calling reindex_site for "${SITE}"...`);
      reindexResult = await client.callTool('reindex_site', { site: SITE });
      console.log(`[indexing-lifecycle] reindex_site result: ${reindexResult.slice(0, 300)}`);
    } finally {
      // Always stop the site afterwards
      await client.callTool('local_stop_site', { site: SITE }).catch(() => {});
    }

    // Check for hard failures — skip gracefully if site doesn't exist
    if (/not found/i.test(reindexResult)) {
      console.log(`[SKIP] ${SITE} not found — skipping L3 reindex test.`);
      return;
    }
    // "MySQL not available" or 0 docs = site wasn't ready — fail clearly
    if (/mysql not available/i.test(reindexResult)) {
      throw new Error(`MySQL still unavailable after wait: ${reindexResult}`);
    }

    expect(reindexResult).toMatch(/re-index complete|documents indexed/i);

    // Poll get_index_status until indexed
    const status = await waitForIndexed(SITE);
    console.log(`[indexing-lifecycle] final index status: ${JSON.stringify(status)}`);

    // 'indexed' = fresh; 'stale' = indexed but content changed since — both mean the index exists
    expect(['indexed', 'stale']).toContain(status.state);
    expect(status.documentCount).toBeGreaterThan(0);
  }, 6 * 60_000);
});

// ---------------------------------------------------------------------------
// L3 — search_site_content
// ---------------------------------------------------------------------------

describe('Local L3 — search_site_content', () => {
  it('returns search results for "WordPress" query', async () => {
    if (skipAll) return;

    const result = await client.callTool('search_site_content', {
      site: SITE,
      query: 'WordPress',
      limit: 3,
    });

    console.log(`[indexing-lifecycle] search_site_content result (first 300 chars): ${result.slice(0, 300)}`);

    expect(result.length).toBeGreaterThan(0);

    // If site has no indexed content yet, the tool returns "not indexed" — log and pass
    const notIndexed = /not indexed|not found|no results/i.test(result);
    if (notIndexed) {
      console.log('[indexing-lifecycle] search returned no-index message — acceptable if site has no posts');
      return;
    }

    // With indexed content, should NOT be an error
    expect(result.toLowerCase()).not.toContain('error: ');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Fleet — list_indexed_sites
// ---------------------------------------------------------------------------

describe('Local — list_indexed_sites', () => {
  it('lists indexed sites and includes the fixture site name', async () => {
    if (skipAll) return;

    const result = await client.callTool('list_indexed_sites', {});

    console.log(`[indexing-lifecycle] list_indexed_sites result (first 400 chars): ${result.slice(0, 400)}`);

    expect(result.length).toBeGreaterThan(0);

    // If nothing has been indexed yet the tool returns a "no sites" message
    if (/no sites have been indexed/i.test(result)) {
      console.log('[indexing-lifecycle] no sites indexed yet — acceptable for a fresh install');
      return;
    }

    // The fixture site should appear in the list
    expect(result).toContain(SITE);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// WPE L2 — wpe_site_deep_refresh
// ---------------------------------------------------------------------------

describe('WPE L2 — wpe_site_deep_refresh', () => {
  it('refreshes the WPE install twin via SSH and returns success summary', async () => {
    if (skipAll) return;
    if (!WPE_INSTALL) {
      console.log('[SKIP] NEXUS_WPE_TEST_INSTALL not set — skipping WPE deep refresh test');
      return;
    }

    const result = await client.callTool('wpe_site_deep_refresh', { install_name: WPE_INSTALL });

    console.log(`[indexing-lifecycle] wpe_site_deep_refresh result (first 400 chars): ${result.slice(0, 400)}`);

    expect(result.length).toBeGreaterThan(0);

    // Tool emits "✅ **<name>** refreshed via SSH" on success
    const isSuccess = /refreshed|success/i.test(result);
    const isSshError = /ssh connection failed|not found|ssh key not found/i.test(result);

    if (isSshError) {
      console.log(`[indexing-lifecycle] WPE SSH not available for "${WPE_INSTALL}" — acceptable in CI without SSH key`);
      return;
    }

    expect(isSuccess).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// WPE twin — nexus_get_site_twin for WPE install
// ---------------------------------------------------------------------------

describe('WPE — nexus_get_site_twin', () => {
  it('returns twin data with wpVersion for the WPE install', async () => {
    if (skipAll) return;
    if (!WPE_INSTALL) {
      console.log('[SKIP] NEXUS_WPE_TEST_INSTALL not set — skipping WPE twin test');
      return;
    }

    const result = await client.callTool('nexus_get_site_twin', { site: WPE_INSTALL });

    console.log(`[indexing-lifecycle] nexus_get_site_twin result (first 400 chars): ${result.slice(0, 400)}`);

    expect(result.length).toBeGreaterThan(0);

    const notFound = /not found|no twin/i.test(result);
    if (notFound) {
      console.log(`[indexing-lifecycle] No twin for "${WPE_INSTALL}" — run wpe_site_deep_refresh first`);
      return;
    }

    // Twin should contain WordPress version info
    const hasVersion = /wordpress|wp version|\d+\.\d+/i.test(result);
    expect(hasVersion).toBe(true);
  }, 30_000);
});
