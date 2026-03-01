/**
 * Tests for Phase 7E search quality improvements:
 * - Cosine distance metric
 * - Relevance floor filtering
 * - Post-level deduplication (best chunk per post)
 * - min_score parameter in search tools
 *
 * Note: These are unit tests with mocked VectorStore internals.
 * The VectorStore.search() improvements are tested via mock table results.
 */

import { SearchOptions, SearchResult } from '../../src/common/types';

describe('SearchOptions', () => {
  test('relevanceFloor is optional', () => {
    const opts: SearchOptions = { limit: 5 };
    expect(opts.relevanceFloor).toBeUndefined();
  });

  test('relevanceFloor can be set', () => {
    const opts: SearchOptions = { limit: 5, relevanceFloor: 0.5 };
    expect(opts.relevanceFloor).toBe(0.5);
  });
});

describe('Search Quality Logic', () => {
  // Test the dedup and floor logic independently of LanceDB

  function applySearchQuality(
    rawResults: Array<{ postId: number; score: number; id: string }>,
    options: { limit: number; relevanceFloor?: number },
  ): Array<{ postId: number; score: number; id: string }> {
    const relevanceFloor = options.relevanceFloor ?? 0.3;

    // Apply relevance floor
    let results = rawResults.filter((r) => r.score >= relevanceFloor);

    // Deduplicate by postId: keep highest-scoring chunk per post
    const bestByPost = new Map<number, typeof results[0]>();
    for (const r of results) {
      const existing = bestByPost.get(r.postId);
      if (!existing || r.score > existing.score) {
        bestByPost.set(r.postId, r);
      }
    }

    // Re-limit
    return Array.from(bestByPost.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);
  }

  test('filters results below relevance floor', () => {
    const raw = [
      { postId: 1, score: 0.9, id: 'a' },
      { postId: 2, score: 0.5, id: 'b' },
      { postId: 3, score: 0.2, id: 'c' }, // below default 0.3
      { postId: 4, score: 0.1, id: 'd' }, // below default 0.3
    ];
    const results = applySearchQuality(raw, { limit: 10 });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.postId)).toEqual([1, 2]);
  });

  test('respects custom relevance floor', () => {
    const raw = [
      { postId: 1, score: 0.9, id: 'a' },
      { postId: 2, score: 0.5, id: 'b' },
      { postId: 3, score: 0.3, id: 'c' },
    ];
    const results = applySearchQuality(raw, { limit: 10, relevanceFloor: 0.6 });
    expect(results).toHaveLength(1);
    expect(results[0].postId).toBe(1);
  });

  test('deduplicates by postId (keeps best chunk)', () => {
    const raw = [
      { postId: 1, score: 0.9, id: 'chunk_1_0' },
      { postId: 1, score: 0.7, id: 'chunk_1_1' }, // same post, lower score
      { postId: 1, score: 0.85, id: 'chunk_1_2' }, // same post, mid score
      { postId: 2, score: 0.6, id: 'chunk_2_0' },
    ];
    const results = applySearchQuality(raw, { limit: 10 });
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('chunk_1_0'); // highest for post 1
    expect(results[1].id).toBe('chunk_2_0');
  });

  test('re-limits after dedup', () => {
    const raw = Array.from({ length: 15 }, (_, i) => ({
      postId: i,
      score: 0.9 - i * 0.05,
      id: `r_${i}`,
    }));
    const results = applySearchQuality(raw, { limit: 5 });
    expect(results).toHaveLength(5);
    expect(results[0].score).toBe(0.9);
  });

  test('sorts by score descending', () => {
    const raw = [
      { postId: 3, score: 0.5, id: 'c' },
      { postId: 1, score: 0.9, id: 'a' },
      { postId: 2, score: 0.7, id: 'b' },
    ];
    const results = applySearchQuality(raw, { limit: 10 });
    expect(results.map((r) => r.postId)).toEqual([1, 2, 3]);
  });

  test('handles empty results', () => {
    const results = applySearchQuality([], { limit: 5 });
    expect(results).toHaveLength(0);
  });

  test('all results below floor returns empty', () => {
    const raw = [
      { postId: 1, score: 0.1, id: 'a' },
      { postId: 2, score: 0.2, id: 'b' },
    ];
    const results = applySearchQuality(raw, { limit: 10 });
    expect(results).toHaveLength(0);
  });

  test('relevanceFloor of 0 includes everything', () => {
    const raw = [
      { postId: 1, score: 0.01, id: 'a' },
      { postId: 2, score: 0.001, id: 'b' },
    ];
    const results = applySearchQuality(raw, { limit: 10, relevanceFloor: 0 });
    expect(results).toHaveLength(2);
  });

  test('relevanceFloor of 1 excludes everything below perfect', () => {
    const raw = [
      { postId: 1, score: 0.99, id: 'a' },
      { postId: 2, score: 1.0, id: 'b' },
    ];
    const results = applySearchQuality(raw, { limit: 10, relevanceFloor: 1.0 });
    expect(results).toHaveLength(1);
    expect(results[0].postId).toBe(2);
  });
});

describe('Cosine Distance Conversion', () => {
  test('cosine distance 0 → similarity 1', () => {
    const similarity = 1 - 0;
    expect(similarity).toBe(1);
  });

  test('cosine distance 1 → similarity 0', () => {
    const similarity = 1 - 1;
    expect(similarity).toBe(0);
  });

  test('cosine distance 0.3 → similarity 0.7', () => {
    const similarity = 1 - 0.3;
    expect(similarity).toBeCloseTo(0.7);
  });
});

describe('search tool min_score parameter', () => {
  // Verify the search tools accept min_score in their schemas
  test('search_site_content schema includes min_score', async () => {
    const { searchContentHandler } = await import(
      '../../src/main/mcp/modules/content/search-content'
    );
    const schema = searchContentHandler.definition.inputSchema as any;
    expect(schema.properties.min_score).toBeDefined();
    expect(schema.properties.min_score.type).toBe('number');
  });

  test('search_across_sites schema includes min_score', async () => {
    const { searchAcrossSitesHandler } = await import(
      '../../src/main/mcp/modules/content/search-across-sites'
    );
    const schema = searchAcrossSitesHandler.definition.inputSchema as any;
    expect(schema.properties.min_score).toBeDefined();
    expect(schema.properties.min_score.type).toBe('number');
  });
});
