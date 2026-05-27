/**
 * Chat Agent E2E Tests
 *
 * Tests the full AI → tool-call → side-effect loop talking directly to our
 * running MCP server. Supports both Anthropic and Google Gemini providers.
 *
 * Requires:
 *   - Local must be running with the Nexus AI addon active
 *   - For Anthropic: NEXUS_TEST_API_KEY=sk-ant-...
 *   - For Gemini:    NEXUS_TEST_PROVIDER=google  NEXUS_GOOGLE_API_KEY=AIzaSy...
 *   - nexus-e2e-cli-test-site must EXIST (halted is fine — local_export_site auto-starts it)
 *
 * Run (Anthropic):
 *   NEXUS_TEST_API_KEY=sk-ant-... npm run test:cli-e2e -- --testPathPattern=20-chat
 *
 * Run (Gemini — best model):
 *   NEXUS_TEST_PROVIDER=google \
 *   NEXUS_GOOGLE_API_KEY=AIzaSy... \
 *   npm run test:cli-e2e -- --testPathPattern=20-chat
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  loadConnectionInfo,
  NexusMcpClient,
  runAgentConversation,
  runAgentConversationGoogle,
  type AgentRunResult,
  type GeminiAgentRunResult,
} from './helpers/mcp-client';

const PROVIDER      = (process.env.NEXUS_TEST_PROVIDER ?? 'anthropic') as 'anthropic' | 'google';
const API_KEY       = process.env.NEXUS_TEST_API_KEY ?? '';      // Anthropic
const GOOGLE_KEY    = process.env.NEXUS_GOOGLE_API_KEY ?? '';    // Google
const GEMINI_MODEL  = process.env.NEXUS_GEMINI_MODEL ?? 'gemini-2.5-pro';
const EXPORT_SITE   = process.env.NEXUS_AGENT_EXPORT_SITE ?? 'nexus-e2e-cli-test-site';
const DOWNLOADS_ZIP = path.join(os.homedir(), 'Downloads', `${EXPORT_SITE}.zip`);

let anthropic: Anthropic | null = null;
let genai: GoogleGenAI | null = null;
let mcpClient: NexusMcpClient;
let skipAll = false;
let skipExport = false;

/** Provider-agnostic agent runner — returns { toolCalls, finalText }. */
async function runAgent(
  userMessage: string,
  opts: { maxIterations?: number } = {},
): Promise<{ toolCalls: Array<{ name: string; input: Record<string, unknown>; result: string }>; finalText: string }> {
  if (PROVIDER === 'google') {
    return runAgentConversationGoogle(genai!, mcpClient, userMessage, {
      model: GEMINI_MODEL,
      ...opts,
    });
  }
  return runAgentConversation(anthropic!, mcpClient, userMessage, opts);
}

beforeAll(async () => {
  const activeKey = PROVIDER === 'google' ? GOOGLE_KEY : API_KEY;
  if (!activeKey) {
    console.log(`[SKIP-ALL] No API key set for provider "${PROVIDER}" ` +
      `(${PROVIDER === 'google' ? 'NEXUS_GOOGLE_API_KEY' : 'NEXUS_TEST_API_KEY'})`);
    skipAll = true;
    return;
  }

  const info = loadConnectionInfo();
  if (!info) {
    console.log('[SKIP-ALL] MCP connection info not found — is Local running?');
    skipAll = true;
    return;
  }

  try {
    const health = await fetch(`${info.url}/health`);
    if (!health.ok) throw new Error(`Health check: ${health.status}`);
  } catch (err) {
    console.log(`[SKIP-ALL] MCP server unreachable at ${info.url}: ${err}`);
    skipAll = true;
    return;
  }

  if (PROVIDER === 'google') {
    genai = new GoogleGenAI({ apiKey: GOOGLE_KEY });
    console.log(`[chat-agent] Provider: Google Gemini (${GEMINI_MODEL}), MCP at ${info.url} (${info.tools.length} tools)`);
  } else {
    anthropic = new Anthropic({ apiKey: API_KEY });
    console.log(`[chat-agent] Provider: Anthropic, MCP at ${info.url} (${info.tools.length} tools)`);
  }

  mcpClient = new NexusMcpClient(info);
});

/** Clean up any stray sites the AI may have created as a side-effect. */
async function cleanupAiCreatedSites(): Promise<void> {
  // The AI may call local_create_site when asked about a non-existent site.
  // A site created without WordPress being installed poisons later tests.
  const strayNames = ['nexus-e2e-test'];
  for (const name of strayNames) {
    try {
      const r1 = await mcpClient.callTool('local_delete_site', { site: name });
      const token = r1.match(/"confirmationToken"\s*:\s*"([^"]+)"/)?.[1];
      if (token) {
        await mcpClient.callTool('local_delete_site', { site: name, _confirmationToken: token });
      }
    } catch { /* site didn't exist — fine */ }
  }
}

describe('Chat agent — tool selection', () => {
  afterAll(async () => {
    if (!skipAll) await cleanupAiCreatedSites();
  });

  it('calls local_list_sites when asked to list sites', async () => {
    if (skipAll) return;

    const result = await runAgent('List all my local WordPress sites. Use your tools.');

    const called = result.toolCalls.some((c) => c.name === 'local_list_sites');
    expect(called).toBe(true);
    expect(result.finalText.length).toBeGreaterThan(0);
    console.log(`[chat-agent] local_list_sites → "${result.finalText.slice(0, 120)}..."`);
  }, 60_000);

  it('calls nexus_list_sites (unified) when asked for all sites including WPE', async () => {
    if (skipAll) return;

    const result = await runAgent('Show me all my sites including WP Engine environments.');

    const called = result.toolCalls.some(
      (c) => c.name === 'nexus_list_sites' || c.name === 'local_list_sites',
    );
    expect(called).toBe(true);
    console.log(`[chat-agent] site list tool: ${result.toolCalls.map((c) => c.name).join(', ')}`);
  }, 60_000);

  it('calls wp_core_version when asked about WP version', async () => {
    if (skipAll) return;

    // Use a site that is guaranteed to exist (the e2e fixture site from global setup)
    // rather than nexus-e2e-test. Asking about a non-existent site can cause the
    // AI to call local_create_site to "help", which creates an empty (no-WordPress)
    // site that poisons later tests expecting a proper WordPress installation.
    const siteName = process.env.CLI_E2E_TEST_SITE ?? 'nexus-e2e-cli-test-site';
    const listResult = await runAgent(`What WordPress version is ${siteName} running?`);

    const called = listResult.toolCalls.some(
      (c) => c.name === 'wp_core_version' || c.name === 'nexus_get_site_twin',
    );
    expect(called).toBe(true);
    console.log(`[chat-agent] WP version tools: ${listResult.toolCalls.map((c) => c.name).join(', ')}`);
  }, 90_000);
});

describe('Chat agent — export flow', () => {
  beforeAll(async () => {
    if (skipAll) { skipExport = true; return; }

    // Check site exists — halted is fine, local_export_site auto-starts it
    try {
      const result = await mcpClient.callTool('local_list_sites', {});
      if (!result.includes(EXPORT_SITE)) {
        console.log(`[SKIP-export] Site "${EXPORT_SITE}" not found — create it first`);
        skipExport = true;
      }
    } catch {
      console.log('[SKIP-export] Could not list sites');
      skipExport = true;
    }
  });

  it('calls local_export_site and zip lands in ~/Downloads', async () => {
    if (skipAll || skipExport) return;

    try { fs.unlinkSync(DOWNLOADS_ZIP); } catch { /* ok */ }

    const result = await runAgent(
      `Export the site named ${EXPORT_SITE} to ~/Downloads. ` +
      `Use local_export_site, then poll local_operation_status every 15 seconds until completed.`,
      { maxIterations: 20 },
    );

    const exportCall = result.toolCalls.find((c) => c.name === 'local_export_site');
    expect(exportCall).toBeDefined();
    console.log(`[chat-agent] local_export_site input: ${JSON.stringify(exportCall?.input)}`);

    if (!fs.existsSync(DOWNLOADS_ZIP)) {
      throw new Error(
        `Zip not found at ${DOWNLOADS_ZIP}. Tool calls: ${result.toolCalls.map((c) => c.name).join(', ')}`,
      );
    }
    expect(fs.statSync(DOWNLOADS_ZIP).size).toBeGreaterThan(0);

    console.log(`[chat-agent] ✓ Export complete: ${DOWNLOADS_ZIP} (${fs.statSync(DOWNLOADS_ZIP).size} bytes)`);
    console.log(`[chat-agent] Tool calls: ${result.toolCalls.map((c) => c.name).join(' → ')}`);

    try { fs.unlinkSync(DOWNLOADS_ZIP); } catch { /* ok */ }
  }, 10 * 60 * 1000);
});
