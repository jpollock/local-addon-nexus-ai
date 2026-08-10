import { extractOpenAiUsage } from '../../../src/main/chat/providers/openai';
import { extractGoogleUsage } from '../../../src/main/chat/providers/google';

describe('extractOpenAiUsage', () => {
  it('reads the final usage chunk', () => {
    expect(extractOpenAiUsage({ usage: { prompt_tokens: 1204, completion_tokens: 318 } }))
      .toEqual({ inputTokens: 1204, outputTokens: 318 });
  });
  it('is undefined for an ordinary content chunk', () => {
    expect(extractOpenAiUsage({ choices: [{ delta: { content: 'hi' } }] })).toBeUndefined();
  });
  it('survives malformed input', () => {
    expect(extractOpenAiUsage(undefined)).toBeUndefined();
    expect(extractOpenAiUsage({ usage: { prompt_tokens: 'x' } })).toBeUndefined();
  });
  it('omits the key it did not find, rather than including it as undefined', () => {
    // A caller merges usage across chunks with `{ ...usage, ...chunkUsage }`. If this ever
    // returns `{ inputTokens: 1204, outputTokens: undefined }`, that explicit `undefined`
    // overwrites a real outputTokens the caller already captured from an earlier chunk.
    // `.toBeUndefined()` on the missing field passes either way, so this must check key presence.
    const result = extractOpenAiUsage({ usage: { prompt_tokens: 1204 } });
    expect(result).toEqual({ inputTokens: 1204 });
    expect('outputTokens' in (result as object)).toBe(false);
  });
});

describe('extractGoogleUsage', () => {
  it('reads usageMetadata', () => {
    expect(extractGoogleUsage({ usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 210 } }))
      .toEqual({ inputTokens: 900, outputTokens: 210 });
  });
  it('is undefined without usageMetadata', () => {
    expect(extractGoogleUsage({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] })).toBeUndefined();
  });
  it('survives malformed input', () => {
    expect(extractGoogleUsage(null)).toBeUndefined();
  });
  it('omits the key it did not find, rather than including it as undefined', () => {
    // Same merge hazard as extractOpenAiUsage — see that test's comment. `config.baseUrl` is
    // user-overridable, so a Gemini-compatible proxy that splits usage across chunks would hit
    // this via the caller's `{ ...usage, ...chunkUsage }` merge.
    const result = extractGoogleUsage({ usageMetadata: { candidatesTokenCount: 210 } });
    expect(result).toEqual({ outputTokens: 210 });
    expect('inputTokens' in (result as object)).toBe(false);
  });
});
