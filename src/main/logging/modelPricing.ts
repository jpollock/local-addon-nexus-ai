import type { TokenUsage } from '../../common/chat-types';

/**
 * The date these prices were checked. Vendors change them; a cost figure without a date is a
 * claim nobody can audit. Print this in the docs and in the Logging preferences panel so a stale
 * table is visible rather than silently believed.
 */
export const PRICES_AS_OF = '2026-08-09';

/** USD per million tokens, keyed by model family prefix. */
const PRICES: ReadonlyArray<{ prefix: string; inPerM: number; outPerM: number }> = [
  { prefix: 'claude-opus-5',   inPerM: 15,   outPerM: 75 },
  { prefix: 'claude-sonnet-5', inPerM: 3,    outPerM: 15 },
  { prefix: 'claude-haiku-4-5', inPerM: 0.8, outPerM: 4 },
  { prefix: 'gpt-4o',          inPerM: 2.5,  outPerM: 10 },
  { prefix: 'gpt-4o-mini',     inPerM: 0.15, outPerM: 0.6 },
  { prefix: 'gemini-2.5-pro',  inPerM: 1.25, outPerM: 10 },
  { prefix: 'gemini-2.5-flash', inPerM: 0.3, outPerM: 2.5 },
];

/**
 * What this call cost, or undefined when that cannot be known.
 *
 * Undefined has two causes and both must stay undefined: the model is not in the table, or the
 * provider reported no usage. Returning 0 for either would put a free call in the log next to a
 * real one and make any total silently wrong.
 */
export function estimateCostUsd(model: string, usage: TokenUsage | undefined): number | undefined {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) return undefined;
  // Longest prefix wins, so gpt-4o-mini is not priced as gpt-4o.
  const row = [...PRICES].sort((a, b) => b.prefix.length - a.prefix.length)
    .find(p => model.startsWith(p.prefix));
  if (!row) return undefined;
  const cost = ((usage.inputTokens ?? 0) / 1_000_000) * row.inPerM
             + ((usage.outputTokens ?? 0) / 1_000_000) * row.outPerM;
  return Number(cost.toFixed(6));
}
