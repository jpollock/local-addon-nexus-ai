// Integration test for the usage-accumulation decision inside GoogleProvider.streamChat: Gemini
// reports usageMetadata on the SAME chunk that carries finishReason (unlike OpenAI, which splits
// them across chunks — see openaiStreamUsage.test.ts). `providerUsage.test.ts` only exercises the
// pure `extractGoogleUsage` helper directly — nothing there drives the generator, so a regression
// at the merge site (e.g. `usage = eventUsage` instead of `usage = { ...usage, ...eventUsage }`)
// would pass every test in that file. This file is the test that actually protects the wiring.

jest.mock('../../../src/main/chat/providers/http-utils', () => ({
  streamingRequest: jest.fn(),
  apiRequest: jest.fn(),
}));

import { streamingRequest } from '../../../src/main/chat/providers/http-utils';
import { GoogleProvider } from '../../../src/main/chat/providers/google';
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

describe('GoogleProvider.streamChat — usage on the finishReason chunk', () => {
  const provider = new GoogleProvider();
  const config: ChatProviderConfig = { apiKey: 'test-key', model: 'gemini-2.5-flash' };
  const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

  afterEach(() => {
    mockStreamingRequest.mockReset();
  });

  it('reads usageMetadata off the same chunk that carries finishReason', async () => {
    mockStreamingRequest.mockReturnValue(linesFrom([
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }),
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: ' there' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 210 },
      }),
    ]));

    const events = await drain(provider.streamChat(messages, [], config, new AbortController().signal));
    const doneEvents = events.filter((e) => e.type === 'done');

    expect(doneEvents).toHaveLength(1);
    const done = doneEvents[0];
    expect(done.type === 'done' && done.stopReason).toBe('end_turn');
    expect(done.type === 'done' && done.usage).toEqual({ inputTokens: 900, outputTokens: 210 });
  });

  it('reports no usage when the stream carries none — undefined, not {} and not zeros', async () => {
    mockStreamingRequest.mockReturnValue(linesFrom([
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] }),
    ]));

    const events = await drain(provider.streamChat(messages, [], config, new AbortController().signal));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    expect(done!.type === 'done' && done!.usage).toBeUndefined();
  });
});
