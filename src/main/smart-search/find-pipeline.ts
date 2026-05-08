import type { SynonymRule } from './SynonymStore';

export interface FindDoc {
  id: string;
  score: number;
  sort: string[];
  data: Record<string, any>;
}

export interface PostProcessOptions {
  filter?: string | null;
  promotedDocs?: FindDoc[];
  customResultDocs?: FindDoc[];
  includeFields?: string[];
  excludeFields?: string[];
  timeDecay?: Array<{ field: string; scale: string; decayRate: number }>;
}

export interface AggregationTermInput {
  field: string;
  size?: number;
}

/** Expand query string using synonym rules */
export function expandSynonyms(query: string, rules: SynonymRule[]): string {
  let result = query;

  for (const rule of rules) {
    if (rule.synonyms.includes('=>')) {
      // One-way: "phone => smartphone" — only expand if EXACT LHS match
      const [lhs, rhs] = rule.synonyms.split('=>').map(s => s.trim());
      const lefts = lhs.split(',').map(s => s.trim());
      const rights = rhs.split(',').map(s => s.trim());
      const queryLower = result.toLowerCase();

      // Check if query exactly equals any left side term
      if (lefts.some(t => queryLower === t.toLowerCase())) {
        result = `(${query} OR ${rights.join(' OR ')})`;
      }
      // If query matches RHS, DON'T expand (one-way is directional)
    } else {
      // Equivalent: "laptop, notebook, computer" — bidirectional
      const terms = rule.synonyms.split(',').map(s => s.trim());
      if (terms.some(t => result.toLowerCase().includes(t.toLowerCase()))) {
        result = `(${terms.join(' OR ')})`;
      }
    }
  }

  return result;
}

/** Map searchBias 0-10 to vectorWeight 0.0-1.0 */
export function applySearchBias(searchBias: number): number {
  return Math.max(0, Math.min(10, searchBias)) / 10;
}

/** Apply time decay scoring based on post_date_gmt */
export function applyTimeDecay(
  docs: FindDoc[],
  decayConfig: Array<{ field: string; scale: string; decayRate: number }>,
): FindDoc[] {
  if (!decayConfig.length) return docs;
  const now = Date.now();
  return docs
    .map(doc => {
      let multiplier = 1;
      for (const cfg of decayConfig) {
        const dateStr = doc.data[cfg.field];
        if (!dateStr) continue;
        const docTs = new Date(dateStr).getTime();
        if (isNaN(docTs)) continue;
        const scaleDays = parseFloat(cfg.scale) || 30;
        const ageMs = now - docTs;
        const ageDays = ageMs / 86400000;
        multiplier *= Math.exp(-cfg.decayRate * (ageDays / scaleDays));
      }
      return { ...doc, score: doc.score * multiplier };
    })
    .sort((a, b) => b.score - a.score);
}

/** Apply post-processing to result set */
export function applyPostProcess(docs: FindDoc[], opts: PostProcessOptions): FindDoc[] {
  let result = [...docs];

  // Time decay re-scoring
  if (opts.timeDecay?.length) {
    result = applyTimeDecay(result, opts.timeDecay);
  }

  // Prepend custom results (before promotions)
  if (opts.customResultDocs?.length) {
    const customIds = new Set(opts.customResultDocs.map(d => d.id));
    result = [...opts.customResultDocs, ...result.filter(d => !customIds.has(d.id))];
  }

  // Prepend promotions (first in results)
  if (opts.promotedDocs?.length) {
    const promotedIds = new Set(opts.promotedDocs.map(d => d.id));
    result = [...opts.promotedDocs, ...result.filter(d => !promotedIds.has(d.id))];
  }

  // Field filtering
  if (opts.includeFields?.length) {
    const keep = new Set(opts.includeFields);
    result = result.map(d => ({ ...d, data: filterKeys(d.data, k => keep.has(k)) }));
  } else if (opts.excludeFields?.length) {
    const drop = new Set(opts.excludeFields);
    result = result.map(d => ({ ...d, data: filterKeys(d.data, k => !drop.has(k)) }));
  }

  return result;
}

export function computeAggregations(
  docs: FindDoc[],
  termAggs: AggregationTermInput[],
): {
  terms: Array<{ field: string; terms: Array<{ term: string; count: number }> }>;
} {
  return {
    terms: termAggs.map(agg => {
      const counts = new Map<string, number>();
      for (const doc of docs) {
        const val = doc.data[agg.field];
        if (val === undefined || val === null) continue;
        const vals = Array.isArray(val) ? val : [val];
        for (const v of vals) {
          const key = typeof v === 'object' ? (v.name ?? JSON.stringify(v)) : String(v);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const sorted = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, agg.size ?? 10)
        .map(([term, count]) => ({ term, count }));
      return { field: agg.field, terms: sorted };
    }),
  };
}

function filterKeys(obj: Record<string, any>, predicate: (k: string) => boolean): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => predicate(k)));
}
