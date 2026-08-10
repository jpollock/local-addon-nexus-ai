// Integration test for the usage-wiring decision inside OllamaProvider: extractOllamaUsage is a
// pure function, but nothing in ollamaUsage.test.ts drives the actual generator, so a regression
// that forgot to attach `usage` to a `done` event — or wired it into one of Ollama's two chat
// paths but not the other — would pass every test in that file. This file drives streamChat()
// itself, mocking http-utils, for both the streaming path (streamingChat, no tools, uses
// streamingRequest) and the non-streaming path (nonStreamingChat, tools present, uses apiRequest),
// and asserts the emitted `done` event carries the counts on each.

jest.mock('../../../src/main/chat/providers/http-utils', () => ({
  streamingRequest: jest.fn(),
  apiRequest: jest.fn(),
}));

import { streamingRequest, apiRequest } from '../../../src/main/chat/providers/http-utils';
import { OllamaProvider } from '../../../src/main/chat/providers/ollama';
import type { ChatMessage, ProviderStreamEvent } from '../../../src/common/chat-types';
import type { ChatProviderConfig, ProviderToolDefinition } from '../../../src/main/chat/providers/types';

const mockStreamingRequest = streamingRequest as jest.Mock;
const mockApiRequest = apiRequest as jest.Mock;

async function* linesFrom(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line;
}

async function drain(events: AsyncGenerator<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('OllamaProvider.streamChat — usage wiring across both chat paths', () => {
  const provider = new OllamaProvider();
  // 'llama3.2' matches KNOWN_TOOL_CAPABLE_PREFIXES, so checkToolSupport() resolves synchronously
  // off the hardcoded allowlist without an /api/show round trip — keeps these tests focused on
  // usage wiring, not tool-capability detection.
  const config: ChatProviderConfig = { model: 'llama3.2' };
  const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];
  const tools: ProviderToolDefinition[] = [
    { name: 'foo', description: 'does foo', parameters: { type: 'object', properties: {} } },
  ];

  afterEach(() => {
    mockStreamingRequest.mockReset();
    mockApiRequest.mockReset();
  });

  it('streaming path (no tools): reads usage off the final done:true chunk', async () => {
    mockStreamingRequest.mockReturnValue(linesFrom([
      JSON.stringify({ message: { content: 'hi' }, done: false }),
      JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 1204, eval_count: 318 }),
    ]));

    const events = await drain(provider.streamChat(messages, [], config, new AbortController().signal));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    expect(done!.type === 'done' && done!.usage).toEqual({ inputTokens: 1204, outputTokens: 318 });
  });

  it('streaming path (no tools): reports no usage when the stream carries none — undefined, not {} and not zeros', async () => {
    mockStreamingRequest.mockReturnValue(linesFrom([
      JSON.stringify({ message: { content: 'hi' }, done: false }),
      JSON.stringify({ message: { content: '' }, done: true }),
    ]));

    const events = await drain(provider.streamChat(messages, [], config, new AbortController().signal));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    expect(done!.type === 'done' && done!.usage).toBeUndefined();
  });

  it('non-streaming path (tools present): reads usage off the single response object', async () => {
    mockApiRequest.mockResolvedValue(JSON.stringify({
      message: { content: 'hi', tool_calls: [] },
      done: true,
      prompt_eval_count: 900,
      eval_count: 210,
    }));

    const events = await drain(provider.streamChat(messages, tools, config, new AbortController().signal));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    expect(done!.type === 'done' && done!.usage).toEqual({ inputTokens: 900, outputTokens: 210 });
  });

  it('non-streaming path (tools present): reports no usage when the response carries none', async () => {
    mockApiRequest.mockResolvedValue(JSON.stringify({
      message: { content: 'hi', tool_calls: [] },
      done: true,
    }));

    const events = await drain(provider.streamChat(messages, tools, config, new AbortController().signal));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    expect(done!.type === 'done' && done!.usage).toBeUndefined();
  });
});
