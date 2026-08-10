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
});
