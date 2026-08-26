/**
 * P5 stage 4 · ToolRanker — hybrid lexical + semantic tool ranking
 * (charter §P5; tool-context design review stage 3 "Hybrid, because lexical
 * alone already fails").
 *
 * Why hybrid, measured: B-03's first baseline run scored recall@12 = 2/3.
 * Lexical hits "CVE → find_sites_with_plugin" and is blind to "how many
 * sites do I have?" → fleet_overview — zero lexical overlap, the owner's own
 * phrasing from three real sessions. Embeddings close the intent gap. The
 * lexical half STAYS because embeddings are weak at exact identifier recall:
 * a model asking for wpe_get_install_usage by name must get it first, so the
 * lexical exact-name weight (4) strictly exceeds the maximum semantic bonus
 * (COSINE_WEIGHT = 2) — semantic evidence can surface a tool lexical missed,
 * never outvote a named one.
 *
 * Degradation is Walt's template_catalog pattern, ported deliberately
 * (wpe-internal-walt/agent/app/template_catalog.py): the index builds in the
 * background off an injected embedder, ranking is lexical-only until ready
 * or whenever embedding fails, and a changed def set re-indexes (keyed on
 * the sorted name list). Never throws, never blocks a search on warmup —
 * a chat stalling on ONNX warmup would be a regression the lexical-only
 * path never had.
 */

export interface RankableDef {
  name: string;
  description: string;
}

export interface RankedTool extends RankableDef {
  score: number;
}

export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

// ---------------------------------------------------------------------------
// Lexical scoring — moved verbatim from search-tools.ts, which now imports it.
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[_\-\/]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function lexicalScore(query: string, name: string, description: string): number {
  const queryTerms = tokenize(query);
  const nameTerms = new Set(tokenize(name));
  const descTerms = new Set(tokenize(description));

  let total = 0;
  for (const term of queryTerms) {
    if (nameTerms.has(term)) { total += 4; continue; }
    if (Array.from(nameTerms).some((t) => t.includes(term) || term.includes(t))) { total += 2; continue; }
    if (descTerms.has(term) || Array.from(descTerms).some((t) => t.includes(term))) { total += 1; }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Ranker
// ---------------------------------------------------------------------------

/** Max contribution of a perfect cosine match — deliberately below the exact-name lexical weight. */
const COSINE_WEIGHT = 2;
/** Below this hybrid score a tool is noise, not a match. */
const MIN_SCORE = 0.5;

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** The text a tool is embedded as: de-snaked name + description, one string. */
function embeddingText(def: RankableDef): string {
  return `${def.name.replace(/[_\-\/]/g, ' ')} — ${def.description}`;
}

export class ToolRanker {
  private vectors = new Map<string, Float32Array>();
  private indexedKey = '';
  private ready = false;
  private building: Promise<void> | null = null;

  constructor(private readonly embed?: EmbedFn) {}

  /**
   * Fire-and-forget background (re)index. Safe to call on every search —
   * an unchanged def set (keyed on sorted names) is a no-op, a build already
   * in flight is not duplicated, and failure leaves the ranker lexical-only.
   */
  ensureIndex(defs: RankableDef[]): void {
    if (!this.embed) return;
    const key = defs.map((d) => d.name).sort().join('|');
    if (key === this.indexedKey || this.building) return;
    this.building = (async () => {
      try {
        const vecs = await this.embed!(defs.map(embeddingText));
        const next = new Map<string, Float32Array>();
        defs.forEach((d, i) => { if (vecs[i]) next.set(d.name, vecs[i]); });
        this.vectors = next;
        this.indexedKey = key;
        this.ready = true;
      } catch {
        // Walt degradation: stay (or fall back to) lexical-only. A later
        // ensureIndex with a changed key retries.
      } finally {
        this.building = null;
      }
    })();
  }

  get semanticReady(): boolean {
    return this.ready;
  }

  /** Await any in-flight index build — a test seam; production never waits. */
  async whenIdle(): Promise<void> {
    while (this.building) await this.building;
  }

  async rank(query: string, defs: RankableDef[], k: number): Promise<RankedTool[]> {
    const lex = defs.map((d) => ({ d, lex: lexicalScore(query, d.name, d.description) }));

    const cos = new Map<string, number>();
    if (this.ready && this.embed) {
      try {
        const [q] = await this.embed([query]);
        if (q) {
          for (const { d } of lex) {
            const v = this.vectors.get(d.name);
            if (v) cos.set(d.name, cosine(q, v));
          }
        }
      } catch {
        // query-embed failure degrades this one search to lexical
      }
    }

    return lex
      .map(({ d, lex: l }) => ({
        name: d.name,
        description: d.description,
        score: l + COSINE_WEIGHT * Math.max(0, cos.get(d.name) ?? 0),
      }))
      .filter((t) => t.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
