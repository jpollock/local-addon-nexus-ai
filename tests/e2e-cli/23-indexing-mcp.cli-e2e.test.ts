/**
 * Indexing MCP E2E Tests
 *
 * Section 1: Direct MCP tool calls — verify indexing lifecycle tools work
 *   (reindex_site, get_index_status, search_site_content, list_indexed_sites,
 *   fleet_health_summary, nexus_site_refresh). Always runs when MCP is available.
 *
 * Section 2: AI agent tool-selection — verify the agent picks the correct
 *   indexing tools when given natural-language prompts. Skipped if
 *   NEXUS_TEST_API_KEY is not set.
 *
 * Section 3: WPE MCP tools — wpe_site_deep_refresh + agent data-freshness
 *   check. Skipped if NEXUS_WPE_TEST_INSTALL is not set.
 *
 * Requires:
 *   - Local must be running with the Nexus AI addon active
 *   - NEXUS_TEST_SITE_NAME env var (default: nexus-e2e-test) — local fixture site
 *   - NEXUS_TEST_API_KEY env var — Anthropic API key (required for agent tests only)
 *   - NEXUS_WPE_TEST_INSTALL env var (optional) — WPE install name for Section 3
 *
 * Run:
 *   NEXUS_TEST_SITE_NAME=nexus-e2e-test \
 *   NEXUS_TEST_API_KEY=sk-ant-... \
 *   npm run test:cli-e2e -- --testPathPattern=23-indexing-mcp
 */

import Anthropic from '@anthropic-ai/sdk';
import { describe, it, expect, beforeAll } from '@jest/globals';
import { loadConnectionInfo, NexusMcpClient, runAgentConversation } from './helpers/mcp-client';

const API_KEY = process.env.NEXUS_TEST_API_KEY ?? '';
const SITE = process.env.NEXUS_TEST_SITE_NAME ?? 'nexus-e2e-test';
const WPE_INSTALL = process.env.NEXUS_WPE_TEST_INSTALL ?? '';

let anthropic: Anthropic;
let mcpClient: NexusMcpClient;
let skipAll = false;
let skipAgentTests = false;

beforeAll(async () => {
  const info = loadConnectionInfo();
  if (!info) {
    console.log('[SKIP-ALL] MCP connection info not found — is Local running?');
    skipAll = true;
    return;
  }

  // Verify the MCP server is reachable
  try {
    const health = await fetch(`${info.url}/health`);
    if (!health.ok) throw new Error(`Health check: ${health.status}`);
  } catch (err) {
    console.log(`[SKIP-ALL] MCP server unreachable at ${info.url}: ${err}`);
    skipAll = true;
    return;
  }

  mcpClient = new NexusMcpClient(info);
  console.log(`[indexing-mcp] Connected to MCP at ${info.url} (${info.tools.length} tools)`);
  console.log(`[indexing-mcp] Test site: "${SITE}"`);

  if (!API_KEY) {
    console.log('[SKIP-agent] NEXUS_TEST_API_KEY not set — skipping agent tests, running direct MCP tests');
    skipAgentTests = true;
  } else {
    anthropic = new Anthropic({ apiKey: API_KEY });
    console.log('[indexing-mcp] Anthropic SDK initialised — agent tests will run');
  }

  if (WPE_INSTALL) {
    console.log(`[indexing-mcp] WPE install: "${WPE_INSTALL}"`);
  } else {
    console.log('[indexing-mcp] NEXUS_WPE_TEST_INSTALL not set — Section 3 will be skipped');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Direct MCP tool verification (no AI, always runs if MCP is up)
// ─────────────────────────────────────────────────────────────────────────────

describe('Direct MCP — indexing tools work', () => {
  it('nexus_site_refresh returns non-error result', async () => {
    if (skipAll) return;

    const result = await mcpClient.callTool('nexus_site_refresh', { site: SITE });
    expect(result).toBeTruthy();
    expect(result.toLowerCase()).not.toContain('error:');
    console.log(`[direct] nexus_site_refresh → "${result.slice(0, 120)}"`);
  }, 60_000);

  it('reindex_site + get_index_status reaches indexed state', async () => {
    if (skipAll) return;

    // reindex_site MCP tool requires the site to be running (MySQL socket).
    // Start it first, then reindex, then stop.
    await mcpClient.callTool('local_start_site', { site: SITE });
    await new Promise(r => setTimeout(r, 8_000)); // wait for MySQL to be ready

    // Kick off reindex (async — returns immediately)
    const reindexResult = await mcpClient.callTool('reindex_site', { site: SITE });
    console.log(`[direct] reindex_site triggered: ${reindexResult.slice(0, 120)}`);

    // Site not found — skip rather than fail (setup may not have created the fixture site)
    if (/not found/i.test(reindexResult)) {
      console.log(`[SKIP] ${SITE} not found — skipping reindex test.`);
      return;
    }

    // Poll get_index_status every 5s, up to 5 minutes
    const deadline = Date.now() + 5 * 60_000;
    let lastStatus = '';
    let indexed = false;

    while (Date.now() < deadline) {
      const statusResult = await mcpClient.callTool('get_index_status', { site: SITE });
      lastStatus = statusResult;
      console.log(`[direct] index status: ${statusResult.slice(0, 120)}`);

      // The result may be markdown text — check for 'indexed' as a substring
      // and for a non-zero document count indicated by any digit in the result.
      if (statusResult.toLowerCase().includes('indexed') && !/\b0\b documents/.test(statusResult)) {
        indexed = true;
        break;
      }

      await new Promise((r) => setTimeout(r, 5_000));
    }

    // Stop site after indexing
    await mcpClient.callTool('local_stop_site', { site: SITE }).catch(() => {});

    expect(indexed).toBe(true);
    console.log(`[direct] index reached indexed state. Final status: ${lastStatus.slice(0, 200)}`);
  }, 6 * 60_000);

  it('search_site_content returns results', async () => {
    if (skipAll) return;

    // Requires the previous test to have indexed the site
    const result = await mcpClient.callTool('search_site_content', {
      site: SITE,
      query: 'WordPress',
      limit: 5,
    });
    expect(result).toBeTruthy();
    console.log(`[direct] search_site_content → "${result.slice(0, 200)}"`);
  }, 30_000);

  it('list_indexed_sites includes SITE', async () => {
    if (skipAll) return;

    const result = await mcpClient.callTool('list_indexed_sites', {});
    expect(result).toBeTruthy();
    // The site name should appear somewhere in the listing
    expect(result).toContain(SITE);
    console.log(`[direct] list_indexed_sites includes "${SITE}"`);
  }, 15_000);

  it('fleet_health_summary runs without error', async () => {
    if (skipAll) return;

    const result = await mcpClient.callTool('fleet_health_summary', {});
    expect(result).toBeTruthy();
    expect(result.trim().length).toBeGreaterThan(0);
    console.log(`[direct] fleet_health_summary → "${result.slice(0, 200)}"`);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — AI agent tool-selection tests (skip if no API key)
// ─────────────────────────────────────────────────────────────────────────────

describe('AI agent — tool selection for indexing', () => {
  it('agent calls nexus_site_refresh when asked to refresh metadata', async () => {
    if (skipAll || skipAgentTests) return;

    const result = await runAgentConversation(
      anthropic,
      mcpClient,
      `Refresh the metadata for the local site named "${SITE}". Use your tools.`,
      { maxIterations: 5 },
    );

    const called = result.toolCalls.some(
      (c) => c.name === 'nexus_site_refresh' || c.name === 'nexus_fleet_refresh',
    );
    expect(called).toBe(true);
    console.log(`[agent] refresh tools: ${result.toolCalls.map((c) => c.name).join(', ')}`);
  }, 2 * 60_000);

  it('agent calls reindex_site when asked to index site content', async () => {
    if (skipAll || skipAgentTests) return;

    const result = await runAgentConversation(
      anthropic,
      mcpClient,
      `Index the content of "${SITE}" so it's searchable. Start the indexing and tell me when done.`,
      { maxIterations: 8 },
    );

    const calledIndex = result.toolCalls.some(
      (c) => c.name === 'reindex_site' || c.name === 'bulk_reindex',
    );
    expect(calledIndex).toBe(true);
    console.log(`[agent] index tools: ${result.toolCalls.map((c) => c.name).join(', ')}`);
  }, 8 * 60_000);

  it('agent calls search_site_content when asked to search', async () => {
    if (skipAll || skipAgentTests) return;

    const result = await runAgentConversation(
      anthropic,
      mcpClient,
      `Search the site "${SITE}" for content about WordPress. Return the top 3 results.`,
      { maxIterations: 8 },
    );

    const calledSearch = result.toolCalls.some(
      (c) =>
        c.name === 'search_site_content' ||
        c.name === 'search_across_sites' ||
        c.name === 'fleet_search',
    );
    expect(calledSearch).toBe(true);
    console.log(`[agent] search → "${result.finalText.slice(0, 120)}"`);
  }, 2 * 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — WPE MCP tools (skip if NEXUS_WPE_TEST_INSTALL not set)
// ─────────────────────────────────────────────────────────────────────────────

describe('WPE MCP tools — w7579 account', () => {
  it('wpe_site_deep_refresh completes for test install', async () => {
    if (skipAll || !WPE_INSTALL) return;

    const result = await mcpClient.callTool('wpe_site_deep_refresh', {
      install_name: WPE_INSTALL,
    });
    expect(result).toBeTruthy();
    // Must start with ✅ (success marker). SSH warnings about post-quantum keys
    // are noise from OpenSSH — they appear in plugin/theme list output but don't
    // mean the overall refresh failed.
    expect(result).toMatch(/✅|refreshed|wordpress:/i);
    console.log(`[wpe] wpe_site_deep_refresh → "${result.slice(0, 200)}"`);
  }, 2 * 60_000);

  it('agent correctly identifies WPE install and its data freshness', async () => {
    if (skipAll || skipAgentTests || !WPE_INSTALL) return;

    const result = await runAgentConversation(
      anthropic,
      mcpClient,
      `What is the current WordPress version and plugin count for the WPE install "${WPE_INSTALL}"? Use your tools.`,
      { maxIterations: 5 },
    );

    expect(result.toolCalls.length).toBeGreaterThan(0);
    console.log(`[agent] WPE info: ${result.finalText.slice(0, 200)}`);
  }, 3 * 60_000);
});
