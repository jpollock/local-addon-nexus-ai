#!/usr/bin/env node
/**
 * spike/power-ai-sdk · live verification against real Power.
 *
 * Usage: POWER_API_KEY=wpe_xxx node scripts/spike-power-aisdk-live.mjs
 *
 * Three checks, in order of what they prove:
 *   1. text     — the AI SDK path streams a plain reply through live Power
 *   2. tool     — a forced tool call round-trips (the generateObject contract)
 *   3. capProbe — binary-search the REAL tool-count limit. ChatService's
 *                 POWER_MAX_TOOLS=128 was borrowed from Vertex's documented
 *                 cap, never measured against api.ai.wpengine.com (see commit
 *                 502d3554). This measures it.
 *
 * Read-only against the API; costs a handful of small completions.
 */
import { streamText, dynamicTool, jsonSchema } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const API_KEY = process.env.POWER_API_KEY;
const MODEL = process.env.POWER_MODEL || 'anthropic/claude-sonnet-4-5';
if (!API_KEY) {
  console.error('Usage: POWER_API_KEY=wpe_xxx node scripts/spike-power-aisdk-live.mjs');
  process.exit(1);
}

const power = createOpenAICompatible({
  name: 'power',
  baseURL: 'https://api.ai.wpengine.com/v1',
  apiKey: API_KEY,
});

const dummyTool = (i) => dynamicTool({
  description: `Dummy probe tool number ${i}. Never call this.`,
  inputSchema: jsonSchema({
    type: 'object',
    properties: { value: { type: 'string', description: 'unused' } },
  }),
});

function toolSet(n) {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`probe_tool_${i}`, dummyTool(i)]));
}

async function attempt({ tools, toolChoice, prompt }) {
  const result = streamText({
    model: power(MODEL),
    messages: [{ role: 'user', content: prompt }],
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { toolChoice } : {}),
    maxOutputTokens: 128,
    maxRetries: 0,
    onError: () => {},
  });
  let text = '';
  let toolCalls = 0;
  let error = null;
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') text += part.text;
    if (part.type === 'tool-call') toolCalls++;
    if (part.type === 'error') { error = part.error; break; }
  }
  return { text, toolCalls, error };
}

function errSummary(error) {
  const e = /** @type {{message?: string, responseBody?: string, statusCode?: number}} */ (error ?? {});
  return `${e.statusCode ?? ''} ${(e.responseBody || e.message || String(error)).slice(0, 160)}`.trim();
}

// ── 1. plain text ───────────────────────────────────────────────────────────
{
  const r = await attempt({ prompt: 'Reply with exactly: SPIKE OK' });
  if (r.error) { console.error('✗ text:', errSummary(r.error)); process.exit(1); }
  console.log(`✓ text: "${r.text.trim().slice(0, 40)}"`);
}

// ── 2. forced tool call ─────────────────────────────────────────────────────
{
  const r = await attempt({
    prompt: 'What is the weather in Austin?',
    tools: {
      get_weather: dynamicTool({
        description: 'Get weather for a city',
        inputSchema: jsonSchema({ type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }),
      }),
    },
    toolChoice: { type: 'tool', toolName: 'get_weather' },
  });
  if (r.error || r.toolCalls === 0) { console.error('✗ tool:', r.error ? errSummary(r.error) : 'no tool call emitted'); process.exit(1); }
  console.log(`✓ tool: ${r.toolCalls} forced call(s) round-tripped`);
}

// ── 3. tool-count cap probe ─────────────────────────────────────────────────
// Binary search the largest N that succeeds. Bounds chosen from the evidence:
// 128 was observed working (the shipped cap), ~190 was observed failing (the
// full registry) — but neither edge was ever isolated, so verify both first.
{
  const probe = async (n) => {
    const r = await attempt({ prompt: 'Reply with exactly: OK', tools: toolSet(n) });
    const ok = !r.error;
    console.log(`  probe n=${n}: ${ok ? 'ok' : `FAIL (${errSummary(r.error)})`}`);
    return ok;
  };

  let lo = 128, hi = 200;
  if (!(await probe(lo))) {
    console.log('! n=128 fails — the shipped cap is itself too high; searching below');
    hi = lo; lo = 1;
  } else if (await probe(hi)) {
    console.log('✓ capProbe: 200 tools accepted — no cap at the sizes chat sends; POWER_MAX_TOOLS may be unnecessary');
    process.exit(0);
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    (await probe(mid)) ? (lo = mid) : (hi = mid);
  }
  console.log(`✓ capProbe: largest accepted tool count = ${lo} (first failure at ${hi})`);
  console.log(lo === 128
    ? '  → POWER_MAX_TOOLS=128 is exactly right.'
    : `  → POWER_MAX_TOOLS should be ${lo}, not 128 — update ChatService.ts and powerToolCap.test.ts.`);
}
