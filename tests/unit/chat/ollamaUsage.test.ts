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

  it('omits the key it did not find, rather than including it as undefined', () => {
    // A caller merges usage across chunks with `{ ...usage, ...chunkUsage }` (streamingChat in
    // ollama.ts). If this ever returned `{ inputTokens: undefined, outputTokens: 318 }`, that
    // explicit `undefined` would overwrite a real inputTokens the caller already captured from an
    // earlier chunk — corrupting a real count rather than merely omitting one. `.toBeUndefined()`
    // / `.toEqual()` on the missing field pass either way (Jest ignores undefined-valued keys), so
    // this must check key presence directly. Same hazard, same fix, as extractOpenAiUsage /
    // extractGoogleUsage.
    const result = extractOllamaUsage({ eval_count: 318 });
    expect(result).toEqual({ outputTokens: 318 });
    expect('inputTokens' in (result as object)).toBe(false);
  });
});
