// Integration test for the control-flow decision inside OpenAIProvider.streamChat: OpenAI sends
// the finish_reason chunk BEFORE the trailing usage-only chunk (choices: [], usage: {...}), which
// itself arrives immediately before [DONE]. The original code returned from the generator the
// instant it saw finish_reason, which would end the stream before that trailing usage chunk was
// ever read. `providerUsage.test.ts` only exercises the pure `extractOpenAiUsage` helper
// directly — nothing there drives the generator across multiple chunks in wire order, so a
// regression that re-adds the early `return` would pass every test in that file. This file is the
// test that actually protects the fix.

jest.mock('../../../src/main/chat/providers/http-utils', () => ({
  streamingRequest: jest.fn(),
  apiRequest: jest.fn(),
}));

import { streamingRequest } from '../../../src/main/chat/providers/http-utils';
import { OpenAIProvider } from '../../../src/main/chat/providers/openai';
import type { ChatMessage, ProviderStreamEvent } from '../../../src/common/chat-types';
import type { ChatProviderConfig } from '../../../src/main/chat/providers/types';

const mockStreamingRequest = streamingRequest as jest.Mock;

async function* linesFrom(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line;
}

async function drain(events: AsyncGenerator<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('OpenAIProvider.streamChat — usage accumulation across chunks', () => {
  const provider = new OpenAIProvider();
  const config: ChatProviderConfig = { apiKey: 'test-key', model: 'gpt-4o' };
  const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

  afterEach(() => {
    mockStreamingRequest.mockReset();
  });

  it('reads usage from the trailing usage-only chunk that follows finish_reason', async () => {
    mockStreamingRequest.mockReturnValue(linesFrom([
      JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 1204, completion_tokens: 318 } }),
    ]));

    const events = await drain(provider.streamChat(messages, [], config, new AbortController().signal));
    const doneEvents = events.filter((e) => e.type === 'done');

    // Exactly one `done`, and it carries both counts — this is the whole point of not returning
    // on the finish_reason chunk.
    expect(doneEvents).toHaveLength(1);
    const done = doneEvents[0];
    expect(done.type === 'done' && done.stopReason).toBe('end_turn');
    expect(done.type === 'done' && done.usage).toEqual({ inputTokens: 1204, outputTokens: 318 });
  });

  it('reports no usage when the stream carries none — undefined, not {} and not zeros', async () => {
    mockStreamingRequest.mockReturnValue(linesFrom([
      JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ]));

    const events = await drain(provider.streamChat(messages, [], config, new AbortController().signal));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    expect(done!.type === 'done' && done!.usage).toBeUndefined();
  });
});
