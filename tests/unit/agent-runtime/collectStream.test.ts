import { collectStream } from '../../../src/main/agent-runtime/AgentAIClient';
import type { ProviderStreamEvent } from '../../../src/common/chat-types';

async function* stream(...events: ProviderStreamEvent[]) { for (const e of events) yield e; }

describe('collectStream', () => {
  it('carries usage off the done event', async () => {
    const r = await collectStream(stream(
      { type: 'token', text: 'hello' },
      { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 1204, outputTokens: 318 } },
    ));
    expect(r.content).toBe('hello');
    expect(r.usage).toEqual({ inputTokens: 1204, outputTokens: 318 });
  });

  it('leaves usage undefined when the provider reported none', async () => {
    const r = await collectStream(stream(
      { type: 'token', text: 'hi' },
      { type: 'done', stopReason: 'end_turn' },
    ));
    expect(r.usage).toBeUndefined();
  });

  it('still collects content and tool calls exactly as before', async () => {
    const r = await collectStream(stream(
      { type: 'token', text: 'a' },
      { type: 'tool_call_end', id: 't1', name: 'wp_plugin_list', arguments: { site: 'x' } },
      { type: 'token', text: 'b' },
      { type: 'done', stopReason: 'tool_use' },
    ));
    expect(r.content).toBe('ab');
    expect(r.toolCalls).toEqual([{ id: 't1', name: 'wp_plugin_list', arguments: { site: 'x' } }]);
  });

  it('still throws on a provider error event', async () => {
    await expect(collectStream(stream({ type: 'error', message: 'rate limited' })))
      .rejects.toThrow(/rate limited/);
  });
});
