/**
 * P5 stage 4 · ToolRanker — hybrid lexical + semantic tool ranking.
 *
 * Why hybrid, measured not argued: B-03's first baseline run scored 2/3 —
 * the lexical scorer hits "CVE → find_sites_with_plugin" but is blind to
 * "how many sites do I have?" → fleet_overview (zero lexical overlap, the
 * owner's own phrasing from three real sessions). Embeddings close the
 * intent gap; the lexical half stays because embeddings are weak at exact
 * identifier recall — a model asking for wpe_get_install_usage BY NAME must
 * get it first.
 *
 * Degradation is Walt's template_catalog pattern, ported: the semantic
 * index builds in the background off an injected embedder, ranking is
 * lexical-only until it's ready or whenever embedding fails, and a changed
 * def set re-indexes. Never throws, never blocks a search on warmup.
 *
 * These tests pin MECHANISM with a deterministic fake embedder. Semantic
 * QUALITY is B-03's job, with the real MiniLM model.
 */
import { ToolRanker, lexicalScore } from '../../../src/main/mcp/tool-ranker';

const DEFS = [
  { name: 'fleet_overview', description: 'Narrative summary of the whole fleet: totals, health, insights' },
  { name: 'wpe_get_install_usage', description: 'Usage metrics for a WP Engine install: visits, bandwidth, storage' },
  { name: 'list_indexed_sites', description: 'List sites present in the content index' },
];

/**
 * Deterministic fake embedder over a tiny hand-built space:
 * axis 0 = "counting/how-many" intent, axis 1 = "usage/metrics" intent,
 * axis 2 = everything else. Vectors chosen so the count-intent query sits
 * next to fleet_overview and nothing else.
 */
function fakeEmbed(texts: string[]): Promise<Float32Array[]> {
  return Promise.resolve(texts.map((t) => {
    const s = t.toLowerCase();
    if (s.includes('how many') || s.includes('fleet overview') || s.includes('totals')) return new Float32Array([1, 0, 0.1]);
    if (s.includes('usage') || s.includes('bandwidth')) return new Float32Array([0, 1, 0.1]);
    return new Float32Array([0.1, 0.1, 1]);
  }));
}

async function readyRanker(embed = fakeEmbed): Promise<ToolRanker> {
  const r = new ToolRanker(embed);
  r.ensureIndex(DEFS);
  await r.whenIdle();
  return r;
}

// ── degradation: lexical until ready, lexical on failure ────────────────────

it('ranks lexically before the semantic index is ready', async () => {
  const r = new ToolRanker(fakeEmbed); // ensureIndex never called
  const out = await r.rank('list indexed sites', DEFS, 3);
  expect(out[0].name).toBe('list_indexed_sites');
  expect(r.semanticReady).toBe(false);
});

it('a failing embedder degrades to lexical and never throws', async () => {
  const r = new ToolRanker(() => Promise.reject(new Error('onnx exploded')));
  r.ensureIndex(DEFS);
  await r.whenIdle();
  expect(r.semanticReady).toBe(false);
  const out = await r.rank('list indexed sites', DEFS, 3);
  expect(out[0].name).toBe('list_indexed_sites');
});

// ── the point: semantic recall where lexical is blind ───────────────────────

it('finds fleet_overview for "how many sites do I have?" — the B-03 miss', async () => {
  const r = await readyRanker();
  // lexical alone scores fleet_overview 0 for this phrasing
  expect(lexicalScore('how many do I have', 'fleet_overview', DEFS[0].description)).toBe(0);
  const out = await r.rank('how many do I have', DEFS, 3);
  expect(out.map((o) => o.name)).toContain('fleet_overview');
  expect(out[0].name).toBe('fleet_overview');
});

// ── lexical dominance: exact identifiers always win ─────────────────────────

it('an exact tool-name query beats any semantic neighbor', async () => {
  const r = await readyRanker();
  // query names the tool; fake space would pull fleet_overview via axis 0 = 0.1 overlap
  const out = await r.rank('wpe_get_install_usage', DEFS, 3);
  expect(out[0].name).toBe('wpe_get_install_usage');
});

// ── invalidation: a changed def set re-indexes ──────────────────────────────

it('re-indexes when the def set changes; a new tool becomes semantically findable', async () => {
  const r = await readyRanker();
  const grown = [...DEFS, { name: 'count_things', description: 'how many totals overview' }];
  r.ensureIndex(grown);
  await r.whenIdle();
  const out = await r.rank('how many do I have', grown, 4);
  expect(out.map((o) => o.name)).toContain('count_things');
});

it('an unchanged def set does not rebuild the index', async () => {
  let calls = 0;
  const counting = (texts: string[]) => { calls++; return fakeEmbed(texts); };
  const r = new ToolRanker(counting);
  r.ensureIndex(DEFS);
  await r.whenIdle();
  const after = calls;
  r.ensureIndex(DEFS);
  await r.whenIdle();
  expect(calls).toBe(after);
});

// ── search_tools consumes the ranker — the discovery floor goes hybrid ──────
// The production payoff before grants ever flip: the 2026-08-25 incident
// class of query ("are we getting more people?") can share ZERO tokens with
// the analytics tool's name and description — hybrid search finds it by
// meaning. (The literal incident phrasing contains "traffic", a name token —
// lexical already matches it, so the test uses a truly zero-overlap query.) Without an embeddingService (or before warmup) search_tools
// behaves exactly as before: lexical.
describe('search_tools · hybrid integration', () => {
  const { createSearchToolsHandler } = require('../../../src/main/mcp/modules/search-tools');
  const { ToolRegistry } = require('../../../src/main/mcp/tool-registry');

  function makeRegistry() {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'agent__web_analytics__traffic_summary',
        namespace: 'agent',
        description: 'Google Analytics visits and pageviews for a bound property — how a site is doing',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async () => ({ content: [] }),
    });
    registry.register({
      definition: {
        name: 'wp_plugin_list',
        namespace: 'wp-cli',
        description: 'List plugins on a site',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async () => ({ content: [] }),
    });
    return registry;
  }

  const analyticsEmbed = (texts: string[]) => Promise.resolve(texts.map((t) => {
    const s = t.toLowerCase();
    return /traffic|analytics|visits|pageviews|visitors|increase/.test(s)
      ? new Float32Array([1, 0])
      : new Float32Array([0, 1]);
  }));

  // Zero token overlap with the tool's name AND description — chosen so the
  // lexical scorer provably returns nothing (asserted inline below): only
  // the semantic path can find it. "traffic" in the query would be vacuous —
  // it IS a name token, and plain lexical already matches it.
  // ('are we getting more people' failed this pin: 'we' partial-matches 'web' +2 — lexical noise, demonstrated)
  const ZERO_OVERLAP_QUERY = 'did visitors increase this month';

  it('finds the analytics tool for a zero-lexical-overlap query when an embedder is available', async () => {
    const { lexicalScore } = require('../../../src/main/mcp/tool-ranker');
    // non-vacuity pin: lexical alone scores this tool 0 for this query
    expect(lexicalScore(
      ZERO_OVERLAP_QUERY,
      'agent__web_analytics__traffic_summary',
      'Google Analytics visits and pageviews for a bound property — how a site is doing',
    )).toBe(0);

    const handler = createSearchToolsHandler(makeRegistry(), () => undefined);
    const services = { embeddingService: { embedBatch: analyticsEmbed } } as any;

    // first call warms the index (lexical results are fine meanwhile)
    await handler.execute({ query: 'warmup' }, services);
    expect((handler as any).__ranker).toBeDefined(); // the seam must exist, not silently no-op
    await (handler as any).__ranker.whenIdle();

    const result = await handler.execute({ query: ZERO_OVERLAP_QUERY }, services);
    const text = result.content.map((c: any) => c.text).join('\n');
    expect(text).toContain('agent__web_analytics__traffic_summary');
  });

  it('stays lexical without an embeddingService — pre-stage-4 behaviour', async () => {
    const handler = createSearchToolsHandler(makeRegistry(), () => undefined);
    const result = await handler.execute({ query: 'plugin list' }, {} as any);
    const text = result.content.map((c: any) => c.text).join('\n');
    expect(text).toContain('wp_plugin_list');
  });
});
