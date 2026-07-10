/**
 * Eval CI Tests — Site Finder (SF-*) + Fleet Analytics (FA-*) cases
 *
 * Runs eval YAML cases through the live MCP server with an AI agent.
 * Requires: NEXUS_TEST_API_KEY=sk-ant-... (Anthropic)
 *        or NEXUS_TEST_PROVIDER=google NEXUS_GOOGLE_API_KEY=AIzaSy... (Gemini)
 *
 * Run:
 *   NEXUS_TEST_API_KEY=sk-ant-... npm run test:evals
 *
 * Run without key: all tests skip gracefully (no error).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
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
const CASES_DIR    = path.resolve(__dirname, '../evals/cases');

interface EvalGuardrails {
  must_not_call?: string[];
  expected_tools?: string[];
}

interface EvalCase {
  id: string;
  description: string;
  prompt: string;
  guardrails?: EvalGuardrails;
}

function loadCases(prefix: string): EvalCase[] {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.yaml'))
    .sort()
    .map((f) => yaml.load(fs.readFileSync(path.join(CASES_DIR, f), 'utf-8')) as EvalCase)
    .filter(Boolean);
}

let anthropic: Anthropic | null = null;
let genai: GoogleGenAI | null = null;
let mcpClient: NexusMcpClient;
let skipAll = false;

beforeAll(async () => {
  const activeKey = PROVIDER === 'google' ? GOOGLE_KEY : API_KEY;
  if (!activeKey) {
    console.log(
      `[SKIP-ALL] No API key for provider "${PROVIDER}" — ` +
      `set ${PROVIDER === 'google' ? 'NEXUS_GOOGLE_API_KEY' : 'NEXUS_TEST_API_KEY'}`,
    );
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
    const h = await fetch(`${info.url}/health`);
    if (!h.ok) throw new Error(`health: ${h.status}`);
  } catch (err) {
    console.log(`[SKIP-ALL] MCP server unreachable: ${err}`);
    skipAll = true;
    return;
  }
  mcpClient = new NexusMcpClient(info);
  if (PROVIDER === 'google') {
    genai = new GoogleGenAI({ apiKey: GOOGLE_KEY });
  } else {
    anthropic = new Anthropic({ apiKey: API_KEY });
  }
  console.log(`[evals] Provider: ${PROVIDER}, MCP: ${info.url}`);
});

async function runAgent(prompt: string) {
  if (PROVIDER === 'google') {
    return runAgentConversationGoogle(genai!, mcpClient, prompt, { model: GEMINI_MODEL });
  }
  return runAgentConversation(anthropic!, mcpClient, prompt);
}

function runCaseTest(c: EvalCase): void {
  it(`${c.id}: ${c.description}`, async () => {
    if (skipAll) return;

    const result = await runAgent(c.prompt);
    expect(result.finalText.length).toBeGreaterThan(0);

    if (c.guardrails?.must_not_call) {
      const calledNames = result.toolCalls.map((tc) => tc.name);
      for (const forbidden of c.guardrails.must_not_call) {
        expect(calledNames).not.toContain(forbidden);
      }
    }

    if (c.guardrails?.expected_tools) {
      const calledNames = result.toolCalls.map((tc) => tc.name);
      const anyMatch = c.guardrails.expected_tools.some((t) => calledNames.includes(t));
      expect(anyMatch).toBe(true);
    }

    console.log(`[${c.id}] tools: ${result.toolCalls.map((t) => t.name).join(' → ')}`);
    console.log(`[${c.id}] answer: "${result.finalText.slice(0, 200)}"`);
  }, 120_000);
}

// ---------------------------------------------------------------------------
// Site Finder eval cases (SF-*)
// ---------------------------------------------------------------------------

describe('Site Finder evals (SF-*)', () => {
  const cases = loadCases('SF-');
  if (cases.length === 0) {
    it('no SF-* cases found — check tests/evals/cases/', () => {
      console.log('[WARN] No SF-* eval cases found in', CASES_DIR);
    });
  }
  for (const c of cases) {
    runCaseTest(c);
  }
});

// ---------------------------------------------------------------------------
// Fleet Analytics eval cases (FA-*)
// ---------------------------------------------------------------------------

describe('Fleet Analytics evals (FA-*)', () => {
  const cases = loadCases('FA-');
  if (cases.length === 0) {
    it('no FA-* cases found — check tests/evals/cases/', () => {
      console.log('[WARN] No FA-* eval cases found in', CASES_DIR);
    });
  }
  for (const c of cases) {
    runCaseTest(c);
  }
});
