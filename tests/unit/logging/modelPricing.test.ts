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

  it('prices gpt-4o-mini as mini, never as gpt-4o', () => {
    // Both prefixes match the string "gpt-4o-mini". Without longest-prefix-wins, the shorter one
    // can win and every mini call is logged at roughly 16x its real rate — a cost figure that is
    // wrong in the expensive direction and indistinguishable from a right one.
    const mini = estimateCostUsd('gpt-4o-mini', { inputTokens: 1_000_000 });
    const full = estimateCostUsd('gpt-4o', { inputTokens: 1_000_000 });
    expect(mini).toBeLessThan(full!);
  });

  it('strips vendor/ prefix before lookup (Power provider)', () => {
    // Power returns 'anthropic/claude-haiku-4-5'; the prefix must be stripped or the lookup fails
    // even though the underlying model is priced.
    const vendorPrefixed = estimateCostUsd('anthropic/claude-haiku-4-5', { inputTokens: 1000 });
    const bare = estimateCostUsd('claude-haiku-4-5', { inputTokens: 1000 });
    expect(vendorPrefixed).toBe(bare);
    expect(vendorPrefixed).toBeGreaterThan(0);
  });

  it('prices the default Google model (gemini-1.5-flash)', () => {
    // Google's default from getAIProvider.ts is gemini-1.5-flash. The table must have it.
    const cost = estimateCostUsd('gemini-1.5-flash', { inputTokens: 1000, outputTokens: 100 });
    expect(cost).toBeGreaterThan(0);
  });

  it('returns undefined when the rounded cost is exactly zero', () => {
    // cost=0 reads as "this call was free", which is the one value the module is forbidden to
    // produce. A sub-microcent cost rounds to 0 via Number(cost.toFixed(6)) and must return
    // undefined instead. Reachable with gpt-4o-mini (in=0.15, out=0.6 per million), in=3, out=0.
    expect(estimateCostUsd('gpt-4o-mini', { inputTokens: 3, outputTokens: 0 })).toBeUndefined();
  });
});
