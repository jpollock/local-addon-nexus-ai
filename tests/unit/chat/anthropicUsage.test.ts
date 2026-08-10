import { extractAnthropicUsage } from '../../../src/main/chat/providers/anthropic';

describe('extractAnthropicUsage', () => {
  it('reads input tokens off message_start', () => {
    expect(extractAnthropicUsage('message_start', { message: { usage: { input_tokens: 1204 } } }))
      .toEqual({ inputTokens: 1204 });
  });

  it('reads output tokens off message_delta', () => {
    expect(extractAnthropicUsage('message_delta', { usage: { output_tokens: 318 } }))
      .toEqual({ outputTokens: 318 });
  });

  it('returns undefined for an event that carries no usage', () => {
    expect(extractAnthropicUsage('content_block_delta', { delta: { text: 'hi' } })).toBeUndefined();
    expect(extractAnthropicUsage('message_delta', { delta: { stop_reason: 'end_turn' } })).toBeUndefined();
  });

  it('ignores a non-numeric count rather than passing it through', () => {
    // A string here would reach the log as `in=NaN` or `in=lots`. Absent is the honest answer.
    expect(extractAnthropicUsage('message_start', { message: { usage: { input_tokens: 'many' } } }))
      .toBeUndefined();
  });

  it('survives a malformed payload', () => {
    expect(extractAnthropicUsage('message_start', undefined)).toBeUndefined();
    expect(extractAnthropicUsage('message_start', null)).toBeUndefined();
    expect(extractAnthropicUsage('message_start', {})).toBeUndefined();
  });
});
