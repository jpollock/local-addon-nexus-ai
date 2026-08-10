import { extractOllamaUsage } from '../../../src/main/chat/providers/ollama';

describe('extractOllamaUsage', () => {
  it('reads prompt_eval_count and eval_count off the final stream/response object', () => {
    expect(extractOllamaUsage({ done: true, prompt_eval_count: 1204, eval_count: 318 }))
      .toEqual({ inputTokens: 1204, outputTokens: 318 });
  });

  it('is undefined for an ordinary content chunk that carries neither count', () => {
    expect(extractOllamaUsage({ message: { content: 'hi' } })).toBeUndefined();
  });

  it('ignores a non-numeric count rather than passing it through', () => {
    // A string here would reach the log as `in=NaN` or `in=lots`. Absent is the honest answer.
    expect(extractOllamaUsage({ prompt_eval_count: 'many', eval_count: 318 }))
      .toEqual({ inputTokens: undefined, outputTokens: 318 });
  });

  it('survives a malformed payload', () => {
    expect(extractOllamaUsage(undefined)).toBeUndefined();
    expect(extractOllamaUsage(null)).toBeUndefined();
    expect(extractOllamaUsage({})).toBeUndefined();
  });
});
