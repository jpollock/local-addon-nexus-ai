/**
 * P4.2 · AnthropicAiSdkProvider — the second AI SDK provider, and the one
 * that banks P3's caching win.
 *
 * Parity claims mirror power-aisdk-provider.test.ts: same ProviderStreamEvent
 * sequences as the hand-rolled anthropic.ts for the same wire traffic — plus
 * the two contracts Power's adapter never had: TOKEN USAGE on done (input
 * from message_start, output from message_delta) and max_tokens 4096.
 *
 * New behaviour under test: cache_control breakpoints in the request —
 *   - on the LAST tool: caches the entire tool block (~36.8k tokens, the
 *     dominant cost term measured 2026-08-25)
 *   - on the system message: opportunistic; hits whenever the volatile tail
 *     (fleet context — moved there by P3) hasn't churned
 * Verified against the REQUEST BODY the SDK actually sends, driven through a
 * mocked fetch serving real Anthropic SSE frames — the SDK's own parser runs.
 */
import { AnthropicAiSdkProvider } from '../../src/main/chat/providers/anthropic-aisdk';
import type { ChatMessage, ProviderStreamEvent } from '../../src/common/chat-types';
import type { ProviderToolDefinition } from '../../src/main/chat/providers/types';

// ── Anthropic SSE plumbing ──────────────────────────────────────────────────

function sse(events: Array<[string, object]>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [type, data] of events) {
        controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const MSG_START: [string, object] = ['message_start', {
  message: { id: 'msg_1', role: 'assistant', content: [], usage: { input_tokens: 1234, output_tokens: 0 } },
}];

function textTurn(text: string): Array<[string, object]> {
  return [
    MSG_START,
    ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { index: 0 }],
    ['message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 56 } }],
    ['message_stop', {}],
  ];
}

async function run(opts: {
  events?: Array<[string, object]>;
  errorResponse?: Response;
  messages?: ChatMessage[];
  tools?: ProviderToolDefinition[];
  forceTool?: string;
}): Promise<{ events: ProviderStreamEvent[]; requestBody: any }> {
  let requestBody: any = null;
  // The @ai-sdk/anthropic client may invoke fetch with (url, init) or a
  // Request object — read the body from whichever shape arrives.
  const fetchImpl: typeof fetch = async (input, init) => {
    const raw = init?.body != null
      ? String(init.body)
      : await (input as Request).clone().text();
    requestBody = JSON.parse(raw);
    return opts.errorResponse ?? sse(opts.events ?? textTurn('hi'));
  };
  const provider = new AnthropicAiSdkProvider(fetchImpl);
  const events: ProviderStreamEvent[] = [];
  for await (const e of provider.streamChat(
    opts.messages ?? [
      { role: 'system', content: 'You are Nexus AI.' },
      { role: 'user', content: 'hi' },
    ],
    opts.tools ?? [],
    { model: 'claude-sonnet-4-6', apiKey: 'sk-ant-test', forceTool: opts.forceTool },
    new AbortController().signal,
  )) events.push(e);
  return { events, requestBody };
}

const WEATHER_TOOL: ProviderToolDefinition = {
  name: 'get_weather',
  description: 'Get weather for a city',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};
const SECOND_TOOL: ProviderToolDefinition = {
  name: 'get_time',
  description: 'Get current time',
  parameters: { type: 'object', properties: {} },
};

// ── parity: text + usage ────────────────────────────────────────────────────

it('streams text and attaches accumulated usage to done', async () => {
  const { events } = await run({ events: textTurn('Hello') });
  expect(events.filter((e) => e.type === 'token').map((e: any) => e.text).join('')).toBe('Hello');
  const done = events[events.length - 1] as any;
  expect(done.type).toBe('done');
  expect(done.stopReason).toBe('end_turn');
  expect(done.usage).toMatchObject({ inputTokens: 1234, outputTokens: 56 });
});

// ── parity: tool call turn ──────────────────────────────────────────────────

it('streams a tool call start → deltas → end with parsed args, done(tool_use)', async () => {
  const { events } = await run({
    tools: [WEATHER_TOOL],
    events: [
      MSG_START,
      ['content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} } }],
      ['content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":' } }],
      ['content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '"Austin"}' } }],
      ['content_block_stop', { index: 0 }],
      ['message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }],
      ['message_stop', {}],
    ],
  });
  const start = events.find((e) => e.type === 'tool_call_start') as any;
  expect(start).toMatchObject({ name: 'get_weather' });
  const end = events.find((e) => e.type === 'tool_call_end') as any;
  expect(end).toMatchObject({ name: 'get_weather', arguments: { city: 'Austin' } });
  expect(events[events.length - 1]).toMatchObject({ type: 'done', stopReason: 'tool_use' });
});

// ── parity: request shape ───────────────────────────────────────────────────

it('sends system, max_tokens 4096, and Anthropic-shaped tools', async () => {
  const { requestBody } = await run({ tools: [WEATHER_TOOL] });
  expect(requestBody.model).toBe('claude-sonnet-4-6');
  expect(requestBody.max_tokens).toBe(4096);
  expect(requestBody.stream).toBe(true);
  expect(JSON.stringify(requestBody.system)).toContain('You are Nexus AI.');
  expect(requestBody.tools[requestBody.tools.length - 1]).toMatchObject({
    name: 'get_weather',
    input_schema: WEATHER_TOOL.parameters,
  });
});

it('maps forceTool to tool_choice — the generateObject contract', async () => {
  const { requestBody } = await run({ tools: [WEATHER_TOOL], forceTool: 'get_weather' });
  expect(requestBody.tool_choice).toMatchObject({ type: 'tool', name: 'get_weather' });
});

// ── P4.2's point: cache breakpoints in the wire request ─────────────────────

it('marks the LAST tool with cache_control — the whole tool block caches', async () => {
  const { requestBody } = await run({ tools: [WEATHER_TOOL, SECOND_TOOL] });
  const toolsSent = requestBody.tools;
  expect(toolsSent[toolsSent.length - 1].cache_control).toMatchObject({ type: 'ephemeral' });
  // Only the breakpoint carries it — 4 breakpoints max per request is the API rule.
  expect(toolsSent[0].cache_control).toBeUndefined();
});

it('marks the system message with cache_control — opportunistic prefix hit', async () => {
  const { requestBody } = await run({ tools: [WEATHER_TOOL] });
  const system = requestBody.system;
  // Anthropic system-as-blocks shape: [{type:'text', text, cache_control}]
  expect(Array.isArray(system)).toBe(true);
  expect(system[system.length - 1].cache_control).toMatchObject({ type: 'ephemeral' });
});

// ── parity: multi-turn history ──────────────────────────────────────────────

it('maps assistant tool_use and tool_result history to the wire', async () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'weather?' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_1', name: 'get_weather', arguments: { city: 'Austin' } }] },
    { role: 'tool', content: '72F', toolCallId: 'toolu_1', toolName: 'get_weather' },
  ];
  const { requestBody } = await run({ messages, tools: [WEATHER_TOOL] });
  const wire = requestBody.messages;
  const assistant = wire.find((m: any) => m.role === 'assistant');
  expect(JSON.stringify(assistant.content)).toContain('"toolu_1"');
  const toolResult = wire.find((m: any) => JSON.stringify(m).includes('tool_result'));
  expect(JSON.stringify(toolResult)).toContain('72F');
});

// ── parity: errors, single attempt ──────────────────────────────────────────

it('surfaces an HTTP error as an Anthropic error, one attempt, no retry loop', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), {
      status: 529, headers: { 'content-type': 'application/json' },
    });
  };
  const provider = new AnthropicAiSdkProvider(fetchImpl);
  const events: ProviderStreamEvent[] = [];
  for await (const e of provider.streamChat(
    [{ role: 'user', content: 'hi' }], [],
    { model: 'claude-sonnet-4-6', apiKey: 'sk-ant-test' },
    new AbortController().signal,
  )) events.push(e);
  expect(calls).toBe(1);
  const err = events.find((e) => e.type === 'error') as any;
  expect(err.message).toMatch(/Anthropic error/);
});

// ── opt-in wiring — ships dark, same pattern as power-aisdk ─────────────────
describe('provider registry opt-in', () => {
  afterEach(() => {
    delete process.env.NEXUS_ANTHROPIC_AISDK;
    jest.resetModules();
  });

  function freshRegistry() {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const reg = require('../../src/main/chat/providers/index');
    reg.initializeProviders();
    return reg;
  }

  it('serves the hand-rolled AnthropicProvider by default', () => {
    const reg = freshRegistry();
    const { AnthropicProvider } = require('../../src/main/chat/providers/anthropic');
    expect(reg.getProvider('anthropic')).toBeInstanceOf(AnthropicProvider);
  });

  it('serves AnthropicAiSdkProvider under the same id when NEXUS_ANTHROPIC_AISDK=1', () => {
    process.env.NEXUS_ANTHROPIC_AISDK = '1';
    const reg = freshRegistry();
    const { AnthropicAiSdkProvider: Cls } = require('../../src/main/chat/providers/anthropic-aisdk');
    const p = reg.getProvider('anthropic');
    expect(p).toBeInstanceOf(Cls);
    expect(p.id).toBe('anthropic');
  });
});
