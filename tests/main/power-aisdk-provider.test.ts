/**
 * spike/power-ai-sdk · PowerAiSdkProvider — the Vercel AI SDK behind the
 * existing AIProvider interface.
 *
 * The spike's claim is PARITY: the new adapter must emit the same
 * ProviderStreamEvent sequences power.ts emits for the same wire traffic, so
 * ChatService needs zero changes. Each test drives the provider through a
 * mocked `fetch` serving real OpenAI-compatible SSE frames — the AI SDK's own
 * parser runs; nothing internal to the SDK is mocked.
 */
import { PowerAiSdkProvider } from '../../src/main/chat/providers/power-aisdk';
import type { ChatMessage, ProviderStreamEvent } from '../../src/common/chat-types';
import type { ProviderToolDefinition } from '../../src/main/chat/providers/types';

// ── SSE plumbing ────────────────────────────────────────────────────────────

function sseResponse(frames: object[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'anthropic/claude-sonnet-4-5',
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

/** Run streamChat over a mocked fetch; return the events plus the request body fetch saw. */
async function run(opts: {
  frames?: object[];
  errorResponse?: Response;
  messages?: ChatMessage[];
  tools?: ProviderToolDefinition[];
  forceTool?: string;
}): Promise<{ events: ProviderStreamEvent[]; requestBody: any }> {
  let requestBody: any = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return opts.errorResponse ?? sseResponse(opts.frames ?? []);
  };
  const provider = new PowerAiSdkProvider(fetchImpl);
  const events: ProviderStreamEvent[] = [];
  const gen = provider.streamChat(
    opts.messages ?? [{ role: 'user', content: 'hi' }],
    opts.tools ?? [],
    { model: 'anthropic/claude-sonnet-4-5', apiKey: 'wpe_test', forceTool: opts.forceTool },
    new AbortController().signal,
  );
  for await (const e of gen) events.push(e);
  return { events, requestBody };
}

const WEATHER_TOOL: ProviderToolDefinition = {
  name: 'get_weather',
  description: 'Get weather for a city',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

// ── parity: plain text turn ─────────────────────────────────────────────────

it('streams text deltas as token events and finishes end_turn', async () => {
  const { events } = await run({
    frames: [
      chunk({ role: 'assistant', content: 'Hel' }),
      chunk({ content: 'lo' }),
      chunk({}, 'stop'),
    ],
  });
  expect(events.filter((e) => e.type === 'token').map((e: any) => e.text)).toEqual(['Hel', 'lo']);
  expect(events[events.length - 1]).toMatchObject({ type: 'done', stopReason: 'end_turn' });
});

// ── parity: tool-call turn ──────────────────────────────────────────────────

it('streams a tool call as start → args deltas → end with parsed arguments, then done(tool_use)', async () => {
  const { events } = await run({
    tools: [WEATHER_TOOL],
    frames: [
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"Austin"}' } }] }),
      chunk({}, 'tool_calls'),
    ],
  });

  const start = events.find((e) => e.type === 'tool_call_start') as any;
  expect(start).toMatchObject({ name: 'get_weather' });

  const deltas = events.filter((e) => e.type === 'tool_call_args_delta') as any[];
  expect(deltas.map((d) => d.argsDelta).join('')).toBe('{"city":"Austin"}');

  const end = events.find((e) => e.type === 'tool_call_end') as any;
  expect(end).toMatchObject({ name: 'get_weather', arguments: { city: 'Austin' } });

  expect(events[events.length - 1]).toMatchObject({ type: 'done', stopReason: 'tool_use' });
});

// ── parity: request shape ───────────────────────────────────────────────────

it('sends tools in OpenAI function shape with the schema passed through', async () => {
  const { requestBody } = await run({ tools: [WEATHER_TOOL], frames: [chunk({}, 'stop')] });
  expect(requestBody.model).toBe('anthropic/claude-sonnet-4-5');
  expect(requestBody.stream).toBe(true);
  expect(requestBody.tools).toHaveLength(1);
  expect(requestBody.tools[0]).toMatchObject({
    type: 'function',
    function: { name: 'get_weather', parameters: WEATHER_TOOL.parameters },
  });
});

it('maps forceTool to tool_choice function — the generateObject contract power.ts honors', async () => {
  const { requestBody } = await run({
    tools: [WEATHER_TOOL],
    forceTool: 'get_weather',
    frames: [chunk({}, 'tool_calls')],
  });
  expect(requestBody.tool_choice).toMatchObject({ type: 'function', function: { name: 'get_weather' } });
});

it('caps output like power.ts — Power backends have small implicit defaults', async () => {
  const { requestBody } = await run({ frames: [chunk({}, 'stop')] });
  const cap = requestBody.max_tokens ?? requestBody.max_completion_tokens;
  expect(cap).toBe(8192);
});

// ── parity: finish-reason mapping ───────────────────────────────────────────

it('maps finish_reason length to max_tokens', async () => {
  const { events } = await run({ frames: [chunk({ content: 'x' }), chunk({}, 'length')] });
  expect(events[events.length - 1]).toMatchObject({ type: 'done', stopReason: 'max_tokens' });
});

// ── parity: the 400 that started all of this ────────────────────────────────

it('translates the "incompatible with the selected model" 400 into the actionable sentence', async () => {
  const { events } = await run({
    errorResponse: new Response(
      JSON.stringify({ error: { message: 'The request is incompatible with the selected model (request id: req_x)' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ),
  });
  const err = events.find((e) => e.type === 'error') as any;
  expect(err).toBeDefined();
  expect(err.message).toMatch(/incompatible with "anthropic\/claude-sonnet-4-5"/);
  expect(err.message).toMatch(/Settings → Chat/);
  // no-overclaim pin, same as powerModelError.test.ts: never claim the model is unserved
  expect(err.message).not.toMatch(/not served|unknown model|does not exist/i);
});

it('surfaces other HTTP errors as a Power error, not a crash', async () => {
  const { events } = await run({
    errorResponse: new Response(JSON.stringify({ error: { message: 'insufficient quota' } }), {
      status: 429, headers: { 'content-type': 'application/json' },
    }),
  });
  const err = events.find((e) => e.type === 'error') as any;
  expect(err).toBeDefined();
  expect(err.message).toMatch(/Power error/);
});

// ── parity: multi-turn history mapping ──────────────────────────────────────

it('maps an assistant tool-call turn and its tool result through to the wire', async () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'weather in austin?' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: { city: 'Austin' } }] },
    { role: 'tool', content: '72F sunny', toolCallId: 'call_1', toolName: 'get_weather' },
  ];
  const { requestBody } = await run({ messages, tools: [WEATHER_TOOL], frames: [chunk({ content: 'Sunny.' }), chunk({}, 'stop')] });

  const wire = requestBody.messages;
  const assistant = wire.find((m: any) => m.role === 'assistant' && m.tool_calls);
  expect(assistant.tool_calls[0]).toMatchObject({ id: 'call_1', function: { name: 'get_weather' } });
  const toolMsg = wire.find((m: any) => m.role === 'tool');
  expect(toolMsg).toMatchObject({ tool_call_id: 'call_1' });
  expect(JSON.stringify(toolMsg.content)).toContain('72F sunny');
});

// ── parity: no silent retries ───────────────────────────────────────────────
// power.ts makes exactly one attempt; the SDK defaults to 2 retries with
// backoff, which turned the 429 test above into a 6-second wait. A chat UI
// must not sit in a hidden retry loop — surface the error and let the caller
// decide.
it('makes exactly one attempt — no hidden retry loop on retryable errors', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'insufficient quota' } }), {
      status: 429, headers: { 'content-type': 'application/json' },
    });
  };
  const provider = new PowerAiSdkProvider(fetchImpl);
  const events: ProviderStreamEvent[] = [];
  for await (const e of provider.streamChat(
    [{ role: 'user', content: 'hi' }], [],
    { model: 'anthropic/claude-sonnet-4-5', apiKey: 'wpe_test' },
    new AbortController().signal,
  )) events.push(e);
  expect(calls).toBe(1);
  expect(events.some((e) => e.type === 'error')).toBe(true);
});

// ── opt-in wiring ───────────────────────────────────────────────────────────
// The spike ships dark: power.ts stays the default; NEXUS_POWER_AISDK=1
// swaps the implementation under the same 'power' id, so ChatService and the
// renderer see no difference either way.
describe('provider registry opt-in', () => {
  afterEach(() => {
    delete process.env.NEXUS_POWER_AISDK;
    jest.resetModules();
  });

  function freshRegistry() {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const reg = require('../../src/main/chat/providers/index');
    reg.initializeProviders();
    return reg;
  }

  it('serves the original PowerProvider by default', () => {
    const reg = freshRegistry();
    const { PowerProvider } = require('../../src/main/chat/providers/power');
    expect(reg.getProvider('power')).toBeInstanceOf(PowerProvider);
  });

  it('serves PowerAiSdkProvider under the same id when NEXUS_POWER_AISDK=1', () => {
    process.env.NEXUS_POWER_AISDK = '1';
    const reg = freshRegistry();
    const { PowerAiSdkProvider: Cls } = require('../../src/main/chat/providers/power-aisdk');
    const p = reg.getProvider('power');
    expect(p).toBeInstanceOf(Cls);
    expect(p.id).toBe('power');
  });
});

// ── the v7 system-message seam ──────────────────────────────────────────────
// AI SDK v7 REJECTS role:'system' inside `messages` ("Use the instructions
// option instead") — and ChatService always sends one. The original parity
// suite missed it because no fixture carried a system message; found while
// building the anthropic provider. The system message must reach the wire
// via streamText's system/instructions option, not the message array.
it('carries a system message to the wire instead of erroring on it', async () => {
  const { events, requestBody } = await run({
    messages: [
      { role: 'system', content: 'You are Nexus AI.' },
      { role: 'user', content: 'hi' },
    ],
    frames: [chunk({ content: 'ok' }), chunk({}, 'stop')],
  });
  expect(events.find((e) => e.type === 'error')).toBeUndefined();
  expect(JSON.stringify(requestBody)).toContain('You are Nexus AI.');
});
