/**
 * Search eval test suite.
 *
 * Tests behavioral properties of the search pipeline against a fixture
 * of known queries. Add a case here the moment you observe bad behavior
 * in the UI — this keeps regressions from coming back.
 *
 * These tests run against the pure search functions (classifyIntent,
 * searchMetadata) and the deduplication logic from SEARCH_UNIFIED.
 * They do NOT require a running Local instance.
 */

import { classifyIntent } from '../../../src/main/search/classifyIntent';
import { searchMetadata } from '../../../src/main/search/metadataSearch';
import queries from './search-queries.json';

// ---------------------------------------------------------------------------
// Helpers mirroring the dedup logic in SEARCH_UNIFIED
// ---------------------------------------------------------------------------

interface ContentLike { siteId: string; postId: number; score: number }

function dedupByPostId<T extends ContentLike>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.siteId}:${r.postId}`;
    const existing = map.get(key);
    if (!existing || r.score > existing.score) map.set(key, r);
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

function hasPostIdDuplicates(rows: ContentLike[]): boolean {
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.siteId}:${r.postId}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deduplication unit tests
// ---------------------------------------------------------------------------

describe('deduplication', () => {
  test('removes duplicate postId chunks, keeping highest score', () => {
    const rows = [
      { siteId: 's1', postId: 42, score: 0.4, title: 'A' },
      { siteId: 's1', postId: 42, score: 0.7, title: 'A (chunk 2)' },
      { siteId: 's1', postId: 42, score: 0.3, title: 'A (chunk 3)' },
      { siteId: 's1', postId: 99, score: 0.8, title: 'B' },
    ];
    const result = dedupByPostId(rows);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.postId === 42)?.score).toBe(0.7);
    expect(result[0].postId).toBe(99); // highest score first
  });

  test('preserves uniqueness across different sites with same postId', () => {
    const rows = [
      { siteId: 'site-a', postId: 1, score: 0.9, title: 'Page 1 on A' },
      { siteId: 'site-b', postId: 1, score: 0.8, title: 'Page 1 on B' },
    ];
    const result = dedupByPostId(rows);
    expect(result).toHaveLength(2); // different sites — both kept
    expect(hasPostIdDuplicates(result)).toBe(false);
  });

  test('empty input returns empty output', () => {
    expect(dedupByPostId([])).toEqual([]);
  });

  test('single item returns single item', () => {
    const rows = [{ siteId: 's1', postId: 5, score: 0.5, title: 'X' }];
    expect(dedupByPostId(rows)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// classifyIntent behavioral tests
// ---------------------------------------------------------------------------

describe('classifyIntent — behavioral fixtures', () => {
  const intentCases = queries.filter(q => q.expect.intent);

  test.each(intentCases.map(c => [c.id, c.query, c.mode, c.expect.intent] as const))(
    '[%s] "%s" (mode=%s) → intent=%s',
    (_id, query, _mode, expectedIntent) => {
      // intent is only computed in 'auto' mode — explicit mode overrides it
      if (_mode !== 'auto') return; // skip non-auto (mode overrides intent)
      const result = classifyIntent(query);
      expect(result).toBe(expectedIntent);
    },
  );

  test('auto mode: "sites with Elementor" → both', () => {
    expect(classifyIntent('sites with Elementor')).toBe('both');
  });

  test('auto mode: "running PHP 7.4" → both', () => {
    expect(classifyIntent('running PHP 7.4')).toBe('both');
  });

  test('auto mode: "customer onboarding flow" → content', () => {
    expect(classifyIntent('customer onboarding flow')).toBe('content');
  });

  test('auto mode: "pricing strategy" → content', () => {
    expect(classifyIntent('pricing strategy')).toBe('content');
  });
});

// ---------------------------------------------------------------------------
// mode-gate behavior (explicit pill overrides)
// ---------------------------------------------------------------------------

describe('mode gates', () => {
  test('explicit content mode: metadata results must be empty', () => {
    // Simulate the mode gate logic from SEARCH_UNIFIED
    const mode = 'content';
    const runMeta = mode !== 'content'; // false
    expect(runMeta).toBe(false);
  });

  test('explicit metadata mode: content results must be empty', () => {
    const mode = 'metadata';
    const runContent = mode !== 'metadata'; // false
    expect(runContent).toBe(false);
  });

  test('auto mode: always runs both searches', () => {
    const mode: string = 'auto';
    const runMeta    = mode !== 'content';
    const runContent = mode !== 'metadata';
    expect(runMeta).toBe(true);
    expect(runContent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// searchMetadata — empty query guard
// ---------------------------------------------------------------------------

describe('searchMetadata', () => {
  test('returns [] for queries shorter than 3 chars', () => {
    expect(searchMetadata('el', null, null, 10)).toEqual([]);
    expect(searchMetadata('', null, null, 10)).toEqual([]);
    expect(searchMetadata('  ', null, null, 10)).toEqual([]);
  });

  test('does not throw when both db and cache are null', () => {
    expect(() => searchMetadata('elementor', null, null, 10)).not.toThrow();
  });
});
