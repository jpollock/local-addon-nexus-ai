import { estimateCostUsd, PRICES_AS_OF } from '../../../src/main/logging/modelPricing';

describe('estimateCostUsd', () => {
  it('prices a known model from its token counts', () => {
    const cost = estimateCostUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBeGreaterThan(0);
  });

  it('returns undefined for a model it does not know, rather than guessing', () => {
    // A wrong cost is worse than no cost: it is indistinguishable from a right one, and it is the
    // number a user would budget against.
    expect(estimateCostUsd('some-model-shipped-next-year', { inputTokens: 1000, outputTokens: 100 }))
      .toBeUndefined();
  });

  it('returns undefined when usage is absent', () => {
    expect(estimateCostUsd('claude-opus-5', undefined)).toBeUndefined();
    expect(estimateCostUsd('claude-opus-5', {})).toBeUndefined();
  });

  it('prices a half-known call on the half it knows', () => {
    // Output tokens alone still cost money; refusing to price them loses real spend.
    expect(estimateCostUsd('claude-opus-5', { outputTokens: 1000 })).toBeGreaterThan(0);
  });

  it('matches models regardless of a version suffix', () => {
    // Providers append dates and revisions: claude-opus-5-20260501 is still claude-opus-5.
    const exact = estimateCostUsd('claude-opus-5', { inputTokens: 1000 });
    expect(estimateCostUsd('claude-opus-5-20260501', { inputTokens: 1000 })).toBe(exact);
  });

  it('carries the date the prices were accurate', () => {
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
