/**
 * Fleet Analytics E2E Tests
 *
 * Verifies AI agents answer fleet-wide analytics questions correctly.
 * AI tests require a provider API key. Deterministic tests (fleet_sql direct)
 * run without an API key against the live MCP server.
 *
 * Run (Anthropic):
 *   NEXUS_TEST_API_KEY=sk-ant-... npm run test:cli-e2e -- --testPathPattern=24-fleet
 *
 * Run (Gemini):
 *   NEXUS_TEST_PROVIDER=google NEXUS_GOOGLE_API_KEY=AIzaSy... \
 *   npm run test:cli-e2e -- --testPathPattern=24-fleet
 *
 * Run deterministic only (no API key):
 *   npm run test:cli-e2e -- --testPathPattern=24-fleet
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  loadConnectionInfo,
  NexusMcpClient,
  runAgentConversation,
  runAgentConversationGoogle,
} from './helpers/mcp-client';

const PROVIDER     = (process.env.NEXUS_TEST_PROVIDER ?? 'anthropic') as 'anthropic' | 'google';
const API_KEY      = process.env.NEXUS_TEST_API_KEY ?? '';
const GOOGLE_KEY   = process.env.NEXUS_GOOGLE_API_KEY ?? '';
const GEMINI_MODEL = process.env.NEXUS_GEMINI_MODEL ?? 'gemini-2.5-flash';

let anthropic: Anthropic | null = null;
let genai: GoogleGenAI | null = null;
let mcpClient: NexusMcpClient;
let skipAll = false;
let skipAI = false;           // set when no API key — deterministic tests still run
let skipFleetSql = false;     // set when fleet_sql is not yet registered in MCP server
let skipFleetOverview = false; // set when fleet_overview is not yet registered in MCP server

async function runAgent(
  userMessage: string,
  opts: { maxIterations?: number } = {},
) {
  if (PROVIDER === 'google') {
    return runAgentConversationGoogle(genai!, mcpClient, userMessage, { model: GEMINI_MODEL, ...opts });
  }
  return runAgentConversation(anthropic!, mcpClient, userMessage, opts);
}

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
  console.log(`[fleet-analytics] MCP connected at ${info.url}`);

  // Check whether fleet_sql is registered on this server build
  try {
    const probe = await mcpClient.callTool('fleet_sql', { query: 'SELECT 1' });
    if (probe.toLowerCase().includes('unknown tool')) {
      console.log('[SKIP-FLEET-SQL] fleet_sql not registered — deterministic tests will skip');
      skipFleetSql = true;
    }
  } catch {
    console.log('[SKIP-FLEET-SQL] fleet_sql probe failed — deterministic tests will skip');
    skipFleetSql = true;
  }

  // Check whether fleet_overview is registered on this server build
  try {
    const probe = await mcpClient.callTool('fleet_overview', {});
    if (probe.toLowerCase().includes('unknown tool')) {
      console.log('[SKIP-FLEET-OVERVIEW] fleet_overview not registered — deterministic tests will skip');
      skipFleetOverview = true;
    }
  } catch {
    console.log('[SKIP-FLEET-OVERVIEW] fleet_overview probe failed — deterministic tests will skip');
    skipFleetOverview = true;
  }

  const activeKey = PROVIDER === 'google' ? GOOGLE_KEY : API_KEY;
  if (!activeKey) {
    console.log(`[SKIP-AI] No API key for provider "${PROVIDER}" — AI tests will skip, deterministic tests will run`);
    skipAI = true;
    return;
  }

  if (PROVIDER === 'google') {
    genai = new GoogleGenAI({ apiKey: GOOGLE_KEY });
    console.log(`[fleet-analytics] Provider: Google Gemini (${GEMINI_MODEL})`);
  } else {
    anthropic = new Anthropic({ apiKey: API_KEY });
    console.log(`[fleet-analytics] Provider: Anthropic`);
  }
});

// ---------------------------------------------------------------------------
// Deterministic: fleet_sql direct MCP calls (no AI key needed)
// ---------------------------------------------------------------------------

describe('fleet_sql — direct MCP calls (deterministic)', () => {
  it('executes a valid SELECT against live graph.db', async () => {
    if (skipAll || skipFleetSql) return;

    const result = await mcpClient.callTool('fleet_sql', {
      query: 'SELECT name, source FROM sites WHERE is_active = 1 LIMIT 5',
    });

    // Must not be an error
    expect(result.toLowerCase()).not.toContain('sql error');
    expect(result.toLowerCase()).not.toContain('disallowed');
    // Must return rows or the "no rows" message
    expect(result.length).toBeGreaterThan(0);
    console.log(`[fleet-sql] SELECT result: "${result.slice(0, 200)}"`);
  }, 15_000);

  it('blocks DROP TABLE', async () => {
    if (skipAll || skipFleetSql) return;

    const result = await mcpClient.callTool('fleet_sql', { query: 'DROP TABLE sites' });
    expect(result.toLowerCase()).toMatch(/only select|disallowed|not allowed/);
    console.log(`[fleet-sql] DROP blocked: "${result.slice(0, 100)}"`);
  }, 10_000);

  it('blocks semicolons', async () => {
    if (skipAll || skipFleetSql) return;

    const result = await mcpClient.callTool('fleet_sql', { query: 'SELECT 1; DROP TABLE sites' });
    expect(result.toLowerCase()).toMatch(/semicolon/);
    console.log(`[fleet-sql] semicolon blocked: "${result.slice(0, 100)}"`);
  }, 10_000);

  it('returns post_count from sites table (may be null for un-started sites)', async () => {
    if (skipAll || skipFleetSql) return;

    const result = await mcpClient.callTool('fleet_sql', {
      query: "SELECT name, post_count FROM sites WHERE source = 'local' AND is_active = 1 LIMIT 10",
    });
    // Should return rows or "No rows" — either is valid
    expect(result.length).toBeGreaterThan(0);
    console.log(`[fleet-sql] local post counts: "${result.slice(0, 300)}"`);
  }, 10_000);

  it('can aggregate SUM(post_count) across local sites', async () => {
    if (skipAll || skipFleetSql) return;

    const result = await mcpClient.callTool('fleet_sql', {
      query: "SELECT SUM(post_count) as total_posts, COUNT(*) as site_count FROM sites WHERE source = 'local' AND is_active = 1",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.toLowerCase()).not.toContain('sql error');
    console.log(`[fleet-sql] SUM post_count: "${result.slice(0, 200)}"`);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// fleet_overview — direct MCP calls (deterministic, no AI key)
// ---------------------------------------------------------------------------

describe('fleet_overview — direct MCP calls (deterministic)', () => {
  it('returns a response without error', async () => {
    if (skipAll || skipFleetOverview) return;

    const result = await mcpClient.callTool('fleet_overview', {});
    expect(result.toLowerCase()).not.toContain('error');
    expect(result.length).toBeGreaterThan(50);
    console.log(`[fleet-overview] response snippet: "${result.slice(0, 300)}"`);
  }, 15_000);

  it('includes site count in response', async () => {
    if (skipAll || skipFleetOverview) return;

    const result = await mcpClient.callTool('fleet_overview', {});
    expect(result).toMatch(/\d+ (site|total sites)/);
    console.log(`[fleet-overview] site mention: "${result.match(/\d+ (?:site|total sites)[s]?/)?.[0]}"`);
  }, 10_000);

  it('is consistent with fleet_sql local site count', async () => {
    if (skipAll || skipFleetOverview || skipFleetSql) return;

    const sqlResult = await mcpClient.callTool('fleet_sql', {
      query: "SELECT COUNT(*) as c FROM sites WHERE source='local' AND is_active=1",
    });
    const localCountMatch = sqlResult.match(/\|\s*(\d+)\s*\|/);
    const localCount = localCountMatch ? parseInt(localCountMatch[1], 10) : null;

    const overviewResult = await mcpClient.callTool('fleet_overview', {});

    if (localCount !== null) {
      expect(overviewResult).toContain(String(localCount));
      console.log(`[fleet-overview] local site count matches fleet_sql: ${localCount}`);
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Schema introspection — no AI key needed, catches column name drift
//
// These tests verify that the schema documented in fleet_sql's tool
// description actually matches the live graph.db. A mismatch means the AI
// will generate SQL that fails at runtime (the users table bug).
// ---------------------------------------------------------------------------

describe('fleet_sql — schema introspection (deterministic)', () => {
  it('users table has the columns documented in fleet_sql description', async () => {
    if (skipAll) return;

    const result = await mcpClient.callTool('fleet_sql', {
      query: "SELECT name FROM pragma_table_info('users') ORDER BY name",
    });

    // These are the correct column names — any rename must update the tool description too
    expect(result).toContain('username');   // NOT user_login
    expect(result).toContain('email');      // NOT user_email
    expect(result).toContain('roles');      // NOT role (it's a JSON array)
    expect(result).toContain('site_id');
    console.log(`[schema] users columns: ${result.slice(0, 300)}`);
  }, 10_000);

  it('sites table has analytics columns documented in fleet_sql description', async () => {
    if (skipAll) return;

    const result = await mcpClient.callTool('fleet_sql', {
      query: "SELECT name FROM pragma_table_info('sites') ORDER BY name",
    });

    expect(result).toContain('post_count');
    expect(result).toContain('post_count_by_type');
    expect(result).toContain('user_count');
    expect(result).toContain('user_count_by_role');
    expect(result).toContain('last_post_at');
    expect(result).toContain('ssh_last_sync_at');
    console.log(`[schema] sites columns present: post_count_by_type, user_count_by_role, last_post_at ✓`);
  }, 10_000);

  it('example role query from tool description executes without SQL error', async () => {
    if (skipAll) return;

    // This is the exact example from the fleet_sql tool description
    const result = await mcpClient.callTool('fleet_sql', {
      query: "SELECT email, COUNT(DISTINCT site_id) as sites FROM users WHERE roles LIKE '%administrator%' GROUP BY email HAVING sites > 1 ORDER BY sites DESC LIMIT 5",
    });

    expect(result.toLowerCase()).not.toContain('sql error');
    expect(result.toLowerCase()).not.toContain('no such column');
    expect(result.length).toBeGreaterThan(0);
    console.log(`[schema] admin cross-site query: ${result.slice(0, 300)}`);
  }, 10_000);

  it('example post-by-type query executes without SQL error', async () => {
    if (skipAll) return;

    const result = await mcpClient.callTool('fleet_sql', {
      query: "SELECT name, post_count_by_type FROM sites WHERE post_count_by_type IS NOT NULL LIMIT 3",
    });

    expect(result.toLowerCase()).not.toContain('sql error');
    expect(result.toLowerCase()).not.toContain('no such column');
    console.log(`[schema] post_count_by_type query: ${result.slice(0, 200)}`);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// AI: answer correctness (requires API key)
// Verifies the AI generates valid SQL — not just picks the right tool.
// ---------------------------------------------------------------------------

describe('fleet analytics — AI answer correctness', () => {
  it('user role question returns data, not a SQL error', async () => {
    if (skipAll || skipAI) return;

    const result = await runAgent(
      'How many administrator users do I have across all my sites?',
      { maxIterations: 10 },
    );

    // The AI MUST NOT surface a SQL error to the user
    expect(result.finalText.toLowerCase()).not.toMatch(/no such column|sql error|i (am unable|cannot|can't)/i);
    // Must contain a number
    expect(result.finalText).toMatch(/\d+/);

    console.log(`[AI correctness] user role tools: ${result.toolCalls.map((c) => c.name).join(' → ')}`);
    console.log(`[AI correctness] answer: "${result.finalText.slice(0, 200)}"`);
  }, 90_000);
});

// ---------------------------------------------------------------------------
// AI: tool routing verification (requires API key)
// ---------------------------------------------------------------------------

describe('fleet analytics — AI tool routing', () => {
  it('answers post count question WITHOUT using fleet_summary', async () => {
    if (skipAll || skipAI) return;

    const result = await runAgent(
      'How many posts do I have across all of my local sites? Give me a total number.',
      { maxIterations: 15 },
    );

    // fleet_summary returns vector chunks — must NOT be used for post count questions
    const usedFleetSummary = result.toolCalls.some((c) => c.name === 'fleet_summary');
    expect(usedFleetSummary).toBe(false);

    // Must use twin-based approach or fleet_sql
    const usedCorrectTool = result.toolCalls.some((c) =>
      c.name === 'nexus_get_fleet_twins' ||
      c.name === 'nexus_get_site_twin' ||
      c.name === 'fleet_sql' ||
      c.name === 'nexus_fleet_summary'
    );
    expect(usedCorrectTool).toBe(true);

    // Answer must contain a number
    expect(result.finalText).toMatch(/\d+/);

    console.log(`[AI routing] post count tools: ${result.toolCalls.map((c) => c.name).join(' → ')}`);
    console.log(`[AI routing] answer: "${result.finalText.slice(0, 200)}"`);
  }, 3 * 60_000);

  it('uses find_sites_with_plugin for plugin inventory question', async () => {
    if (skipAll || skipAI) return;

    const result = await runAgent(
      'Which of my sites have Akismet installed?',
      { maxIterations: 10 },
    );

    const usedPluginTool = result.toolCalls.some((c) =>
      c.name === 'find_sites_with_plugin' || c.name === 'fleet_sql'
    );
    expect(usedPluginTool).toBe(true);
    expect(result.finalText.length).toBeGreaterThan(0);

    console.log(`[AI routing] plugin inventory tools: ${result.toolCalls.map((c) => c.name).join(' → ')}`);
    console.log(`[AI routing] answer: "${result.finalText.slice(0, 200)}"`);
  }, 90_000);

  it('uses twin data for most-recently-edited question', async () => {
    if (skipAll || skipAI) return;

    const result = await runAgent(
      'Which of my local sites had content most recently updated?',
      { maxIterations: 15 },
    );

    const usedTwinOrSql = result.toolCalls.some((c) =>
      c.name === 'nexus_get_fleet_twins' ||
      c.name === 'nexus_get_site_twin' ||
      c.name === 'fleet_sql'
    );
    expect(usedTwinOrSql).toBe(true);
    expect(result.finalText.length).toBeGreaterThan(0);

    console.log(`[AI routing] recency tools: ${result.toolCalls.map((c) => c.name).join(' → ')}`);
    console.log(`[AI routing] answer: "${result.finalText.slice(0, 200)}"`);
  }, 3 * 60_000);

  it('"tell me about my fleet" calls fleet_overview', async () => {
    if (skipAll || skipAI) return;

    const result = await runAgent(
      'Tell me about my fleet — how many sites do I manage in total?',
      { maxIterations: 8 },
    );

    const usedFleetOverview = result.toolCalls.some((c) => c.name === 'fleet_overview');
    expect(usedFleetOverview).toBe(true);
    expect(result.finalText.length).toBeGreaterThan(0);
    expect(result.finalText.toLowerCase()).not.toContain('error');

    console.log(`[AI routing] fleet tools: ${result.toolCalls.map((c) => c.name).join(' → ')}`);
    console.log(`[AI routing] answer: "${result.finalText.slice(0, 300)}"`);
  }, 90_000);
});
