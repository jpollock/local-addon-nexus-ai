import type { ProviderStreamEvent, TokenUsage } from '../../../src/common/chat-types';

describe('the stream can carry token usage', () => {
  it('accepts a done event with usage', () => {
    const e: ProviderStreamEvent = {
      type: 'done', stopReason: 'end_turn', usage: { inputTokens: 1204, outputTokens: 318 },
    };
    expect(e.type === 'done' && e.usage?.inputTokens).toBe(1204);
  });

  it('accepts a done event with NO usage, because most providers do not report it', () => {
    // Ollama and the local gateway may report nothing. Absent must stay absent rather than
    // becoming a zero that reads as "this call used no tokens".
    const e: ProviderStreamEvent = { type: 'done', stopReason: 'end_turn' };
    expect(e.type === 'done' && e.usage).toBeUndefined();
  });

  it('accepts partial usage — one direction known, the other not', () => {
    const u: TokenUsage = { outputTokens: 318 };
    expect(u.inputTokens).toBeUndefined();
  });
});
