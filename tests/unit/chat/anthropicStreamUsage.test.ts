// Integration test for the accumulation decision inside AnthropicProvider.streamChat: Anthropic
// reports input tokens on `message_start` and output tokens on `message_delta` as two separate
// SSE events, and the adapter merges rather than replaces so the second event's report cannot
// clobber the first. `anthropicUsage.test.ts` only exercises the pure `extractAnthropicUsage`
// helper directly — nothing there drives the generator across two events, so a destructive
// `usage = eventUsage` regression at the merge site would pass every test in that file. This file
// is the test that actually protects the merge.

jest.mock('../../../src/main/chat/providers/http-utils', () => ({
  streamingRequest: jest.fn(),
  apiRequest: jest.fn(),
}));

import { streamingRequest } from '../../../src/main/chat/providers/http-utils';
import { AnthropicProvider } from '../../../src/main/chat/providers/anthropic';
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

describe('AnthropicProvider.streamChat — usage accumulation across SSE events', () => {
  const provider = new AnthropicProvider();
  const config: ChatProviderConfig = { apiKey: 'test-key', model: 'claude-sonnet-5' };
  const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

  afterEach(() => {
    mockStreamingRequest.mockReset();
  });

  it('merges input tokens from message_start with output tokens from message_delta', async () => {
    mockStreamingRequest.mockReturnValue(linesFrom([
      JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1204 } } }),
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 318 },
      }),
    ]));

    const events = await drain(provider.streamChat(messages, [], config, new AbortController().signal));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    expect(done!.type === 'done' && done!.usage).toEqual({ inputTokens: 1204, outputTokens: 318 });
  });

  it('reports no usage when the stream carries none — undefined, not {} and not zeros', async () => {
    mockStreamingRequest.mockReturnValue(linesFrom([
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
      JSON.stringify({ type: 'message_stop' }),
    ]));

    const events = await drain(provider.streamChat(messages, [], config, new AbortController().signal));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    expect(done!.type === 'done' && done!.usage).toBeUndefined();
  });
});
