import type { TokenUsage } from '../../common/chat-types';

/**
 * The date these prices were checked. Vendors change them; a cost figure without a date is a
 * claim nobody can audit. Print this in the docs and in the Logging preferences panel so a stale
 * table is visible rather than silently believed.
 */
export const PRICES_AS_OF = '2026-08-09';

/** USD per million tokens, keyed by model family prefix. */
const PRICES: ReadonlyArray<{ prefix: string; inPerM: number; outPerM: number }> = [
  // Anthropic — https://www.anthropic.com/pricing (accessed 2026-08-09)
  { prefix: 'claude-fable-5',   inPerM: 0.25,  outPerM: 1.25 },
  { prefix: 'claude-opus-5',    inPerM: 15,    outPerM: 75 },
  { prefix: 'claude-sonnet-5',  inPerM: 3,     outPerM: 15 },
  { prefix: 'claude-opus-4-8',  inPerM: 15,    outPerM: 75 },
  { prefix: 'claude-sonnet-4-6', inPerM: 3,    outPerM: 15 },
  { prefix: 'claude-opus-4-6',  inPerM: 15,    outPerM: 75 },
  { prefix: 'claude-haiku-4-5', inPerM: 0.8,   outPerM: 4 },
  // OpenAI — https://openai.com/api/pricing/ (accessed 2026-08-09)
  { prefix: 'gpt-4o',           inPerM: 2.5,   outPerM: 10 },
  { prefix: 'gpt-4o-mini',      inPerM: 0.15,  outPerM: 0.6 },
  { prefix: 'o3',               inPerM: 10,    outPerM: 40 },
  // Google Gemini — https://ai.google.dev/pricing (accessed 2026-08-09)
  { prefix: 'gemini-2.5-pro',   inPerM: 1.25,  outPerM: 10 },
  { prefix: 'gemini-2.5-flash', inPerM: 0.3,   outPerM: 2.5 },
  { prefix: 'gemini-1.5-flash', inPerM: 0.075, outPerM: 0.3 },
];

/**
 * Sorted once at module load: longest prefix wins, so gpt-4o-mini is not priced as gpt-4o.
 */
const PRICES_SORTED = [...PRICES].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * What this call cost, or undefined when that cannot be known.
 *
 * Undefined has three causes and all must stay undefined: the model is not in the table, the
 * provider reported no usage, or the cost rounds to exactly zero. Returning 0 for any of these
 * would put a free call in the log next to a real one and make any total silently wrong.
 */
export function estimateCostUsd(model: string, usage: TokenUsage | undefined): number | undefined {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) return undefined;
  // Strip vendor/ prefix if present (Power provider returns 'anthropic/claude-haiku-4-5').
  const normalizedModel = model.includes('/') ? model.split('/').slice(1).join('/') : model;
  const row = PRICES_SORTED.find(p => normalizedModel.startsWith(p.prefix));
  if (!row) return undefined;
  const cost = ((usage.inputTokens ?? 0) / 1_000_000) * row.inPerM
             + ((usage.outputTokens ?? 0) / 1_000_000) * row.outPerM;
  const rounded = Number(cost.toFixed(6));
  // Do not return 0 — it reads as "this call was free". Return undefined for sub-microcent costs.
  return rounded === 0 ? undefined : rounded;
}
