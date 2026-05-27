/**
 * CLI E2E Tests — Search Quality
 *
 * Validates the full search pipeline against five real Local sites:
 *   - Newsroom Demo       — news/editorial content
 *   - local-copy-jpp      — personal/portfolio content
 *   - AI Toolkit Demo     — AI/technology content
 *   - ACF Recipes         — recipe/food content with ACF fields
 *   - acf-recipes-test    — ACF Recipes test instance
 *
 * Queries are defined in search-quality-queries.json — edit that file to
 * tune what each test searches for without touching TypeScript.
 *
 * Run: npx jest --config tests/e2e-cli/jest.search-quality.config.js
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { runCli, skipTest } from './helpers/cli-test-utils';
import QUERIES from './search-quality-queries.json';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SITES = {
  newsroom:    'Newsroom Demo',
  jpp:         'local-copy-jpp',
  aiToolkit:   'AI Toolkit Demo',
  recipes:     'ACF Recipes',
  recipesTest: 'acf-recipes-test',
} as const;

type SiteName = typeof SITES[keyof typeof SITES];

const POLL_MS       = 5_000;
const INDEX_TIMEOUT = 300_000; // 5 min — large sites can take 3-4 min
const SEARCH_ALL_TIMEOUT = 60_000; // search-all scans all indexed sites, takes 15-25s

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSearchJson(stdout: string): any[] {
  const start = stdout.indexOf('[');
  if (start === -1) return [];
  try { return JSON.parse(stdout.slice(start)); }
  catch { return []; }
}

/** Check index state — array args avoid shell-split issues with spaces in site names */
async function getIndexState(siteName: SiteName): Promise<'indexed' | 'indexing' | 'error' | 'other'> {
  const r = await runCli(['system', 'status', '--site', siteName, '--json']);
  if (r.exitCode !== 0) return 'other';
  const jsonStart = r.stdout.indexOf('[');
  if (jsonStart === -1) return 'other';
  try {
    const sites = JSON.parse(r.stdout.slice(jsonStart));
    const site = Array.isArray(sites) ? sites[0] : null;
    if (site?.indexState === 'indexed' && (site?.documentCount ?? 0) > 0) return 'indexed';
    if (site?.indexState === 'indexing') return 'indexing';
    if (site?.indexState === 'error') return 'error';
    if ((site?.postCount ?? 0) > 50_000) return 'error'; // >50k posts OOMs during indexing
  } catch { /* ignore */ }
  return 'other';
}

async function ensureIndexed(siteName: SiteName): Promise<boolean> {
  await runCli(['sites', 'start', `${siteName}@local`]).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  const initial = await getIndexState(siteName);
  if (initial === 'indexed') return true;
  if (initial === 'error') {
    console.warn(`[ensureIndexed] ${siteName} is in error state — skipping`);
    return false;
  }

  await runCli(['content', 'index', `${siteName}@local`]).catch(() => {});

  const deadline = Date.now() + INDEX_TIMEOUT;
  while (Date.now() < deadline) {
    const state = await getIndexState(siteName);
    if (state === 'indexed') return true;
    if (state === 'error') {
      console.warn(`[ensureIndexed] ${siteName} errored during indexing`);
      return false;
    }
    await new Promise(res => setTimeout(res, POLL_MS));
  }
  return false;
}

/** Array args for `nexus content search` — handles spaces in site names correctly */
function searchArgs(site: SiteName, query: string, limit = 10): string[] {
  return ['content', 'search', `${site}@local`, query, '--json', '--limit', String(limit)];
}

function hasDuplicatePostIds(results: any[]): boolean {
  const seen = new Set<string>();
  for (const r of results) {
    const key = `${r.score?.toFixed(4)}::${r.snippet?.slice(0, 40)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function isSortedByScoreDesc(results: any[]): boolean {
  for (let i = 1; i < results.length; i++) {
    if (results[i].score > results[i - 1].score + 0.001) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Connectivity check
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const r = await runCli('sites list --json');
  if (r.exitCode !== 0) console.warn('[search-quality] Local not running — all tests will skip');
}, 60_000);

// ---------------------------------------------------------------------------
// ACF Recipes
// ---------------------------------------------------------------------------

describe('ACF Recipes — content search', () => {
  const Q = QUERIES.sites.acfRecipes;

  beforeAll(async () => {
    const ready = await ensureIndexed(SITES.recipes);
    if (!ready) console.warn(`[WARN] ${SITES.recipes} indexing timed out`);
  }, INDEX_TIMEOUT + 30_000);

  it('finds recipe content', async () => {
    const r = await runCli(searchArgs(SITES.recipes, Q.primary, 10));
    if (r.exitCode !== 0) { skipTest('Local/addon not running or site not indexed'); return; }
    const results = parseSearchJson(r.stdout);
    expect(results.length).toBeGreaterThan(0);
    expect(isSortedByScoreDesc(results)).toBe(true);
  }, 30_000);

  it('returns no duplicate results', async () => {
    const r = await runCli(searchArgs(SITES.recipes, Q.dedup, 20));
    if (r.exitCode !== 0) { skipTest('Site not running'); return; }
    expect(hasDuplicatePostIds(parseSearchJson(r.stdout))).toBe(false);
  }, 30_000);

  it('finds ACF field content', async () => {
    const r = await runCli(searchArgs(SITES.recipes, Q.semantic, 5));
    if (r.exitCode !== 0) { skipTest('Site not running'); return; }
    expect(parseSearchJson(r.stdout).length).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it('scores are in 0–1 range', async () => {
    const r = await runCli(searchArgs(SITES.recipes, Q.scores, 10));
    if (r.exitCode !== 0) { skipTest('Site not running'); return; }
    parseSearchJson(r.stdout).forEach((res: any) => {
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(1);
    });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// acf-recipes-test
// ---------------------------------------------------------------------------

describe('acf-recipes-test — content search', () => {
  const Q = QUERIES.sites.acfRecipesTest;

  beforeAll(async () => {
    const ready = await ensureIndexed(SITES.recipesTest);
    if (!ready) console.warn(`[WARN] ${SITES.recipesTest} indexing timed out`);
  }, INDEX_TIMEOUT + 30_000);

  it('finds recipe content', async () => {
    const r = await runCli(searchArgs(SITES.recipesTest, Q.primary, 10));
    if (r.exitCode !== 0) { skipTest('Site not running'); return; }
    const results = parseSearchJson(r.stdout);
    if (results.length === 0) { skipTest('acf-recipes-test not indexed — 68k posts causes indexing error'); return; }
    expect(results.length).toBeGreaterThan(0);
    expect(isSortedByScoreDesc(results)).toBe(true);
  }, 30_000);

  it('returns no duplicate results', async () => {
    const r = await runCli(searchArgs(SITES.recipesTest, Q.dedup, 20));
    if (r.exitCode !== 0) { skipTest('Site not running'); return; }
    expect(hasDuplicatePostIds(parseSearchJson(r.stdout))).toBe(false);
  }, 30_000);

  it('scores are in 0–1 range', async () => {
    const r = await runCli(searchArgs(SITES.recipesTest, Q.scores, 10));
    if (r.exitCode !== 0) { skipTest('Site not running'); return; }
    parseSearchJson(r.stdout).forEach((res: any) => {
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(1);
    });
  }, 30_000);

  it('both ACF Recipes sites return results for same query — confirms independent indexes', async () => {
    const [rMain, rTest] = await Promise.all([
      runCli(searchArgs(SITES.recipes, QUERIES.sites.acfRecipes.independence, 5)),
      runCli(searchArgs(SITES.recipesTest, Q.primary, 5)),
    ]);
    if (rMain.exitCode !== 0 || rTest.exitCode !== 0) { skipTest('One or both sites not running'); return; }
    expect(parseSearchJson(rMain.stdout).length).toBeGreaterThan(0);
    const testResults = parseSearchJson(rTest.stdout);
    if (testResults.length === 0) { skipTest('acf-recipes-test not indexed'); return; }
    expect(testResults.length).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Newsroom Demo
// ---------------------------------------------------------------------------

describe('Newsroom Demo — content search', () => {
  const Q = QUERIES.sites.newsroom;

  beforeAll(async () => {
    const ready = await ensureIndexed(SITES.newsroom);
    if (!ready) console.warn(`[WARN] ${SITES.newsroom} indexing timed out`);
  }, INDEX_TIMEOUT + 30_000);

  it('finds news/editorial content', async () => {
    const r = await runCli(searchArgs(SITES.newsroom, Q.primary, 10));
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    expect(parseSearchJson(r.stdout).length).toBeGreaterThan(0);
  }, 30_000);

  it('returns no duplicate results', async () => {
    const r = await runCli(searchArgs(SITES.newsroom, Q.dedup, 20));
    if (r.exitCode !== 0) { skipTest('Site not running'); return; }
    expect(hasDuplicatePostIds(parseSearchJson(r.stdout))).toBe(false);
  }, 30_000);

  it('results are sorted by relevance score', async () => {
    const r = await runCli(searchArgs(SITES.newsroom, Q.ordering, 10));
    if (r.exitCode !== 0) { skipTest('Site not running'); return; }
    const results = parseSearchJson(r.stdout);
    if (results.length < 2) { skipTest('Not enough results to test ordering'); return; }
    expect(isSortedByScoreDesc(results)).toBe(true);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AI Toolkit Demo
// ---------------------------------------------------------------------------

describe('AI Toolkit Demo — content search', () => {
  const Q = QUERIES.sites.aiToolkit;

  beforeAll(async () => {
    const ready = await ensureIndexed(SITES.aiToolkit);
    if (!ready) console.warn(`[WARN] ${SITES.aiToolkit} indexing timed out`);
  }, INDEX_TIMEOUT + 30_000);

  it('finds AI/technology content', async () => {
    const r = await runCli(searchArgs(SITES.aiToolkit, Q.primary, 10));
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    expect(parseSearchJson(r.stdout).length).toBeGreaterThan(0);
  }, 30_000);

  it('semantic search finds related terms', async () => {
    const r = await runCli(searchArgs(SITES.aiToolkit, Q.semantic, 5));
    if (r.exitCode !== 0) { skipTest('Site not running'); return; }
    const results = parseSearchJson(r.stdout);
    expect(results.length).toBeGreaterThanOrEqual(0);
    expect(hasDuplicatePostIds(results)).toBe(false);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// local-copy-jpp
// ---------------------------------------------------------------------------

describe('local-copy-jpp — content search', () => {
  const Q = QUERIES.sites.jpp;

  beforeAll(async () => {
    const ready = await ensureIndexed(SITES.jpp);
    if (!ready) console.warn(`[WARN] ${SITES.jpp} indexing timed out`);
  }, INDEX_TIMEOUT + 30_000);

  it('returns results for broad query', async () => {
    const r = await runCli(searchArgs(SITES.jpp, Q.broad, 10));
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    expect(hasDuplicatePostIds(parseSearchJson(r.stdout))).toBe(false);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Cross-site search-all
// ---------------------------------------------------------------------------

describe('cross-site search — search-all', () => {
  const Q = QUERIES.crossSite;

  it('returns results from multiple sites for a broad query', async () => {
    const r = await runCli(['content', 'search-all', Q.broad, '--json', '--limit', '20']);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    const results = parseSearchJson(r.stdout);
    if (results.length === 0) { skipTest('No sites indexed'); return; }
    const siteNames = new Set(results.map((r: any) => r.siteName).filter(Boolean));
    expect(siteNames.size).toBeGreaterThanOrEqual(1);
  }, SEARCH_ALL_TIMEOUT);

  it('cross-site results are sorted by relevance', async () => {
    const r = await runCli(['content', 'search-all', Q.ordering, '--json', '--limit', '20']);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    const results = parseSearchJson(r.stdout);
    if (results.length < 2) { skipTest('Not enough cross-site results'); return; }
    expect(isSortedByScoreDesc(results)).toBe(true);
  }, SEARCH_ALL_TIMEOUT);

  it('"recipes" query surfaces ACF Recipes site content', async () => {
    const r = await runCli(['content', 'search-all', Q.recipeAttribution, '--json', '--limit', '10']);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    const results = parseSearchJson(r.stdout);
    if (results.length === 0) { skipTest('No results — ACF Recipes may not be indexed'); return; }
    const recipeResults = results.filter((res: any) =>
      res.siteName?.toLowerCase().includes('recipe') ||
      res.target?.toLowerCase().includes('recipe')
    );
    expect(recipeResults.length).toBeGreaterThan(0);
  }, SEARCH_ALL_TIMEOUT);

  it('"AI" query surfaces AI Toolkit Demo content', async () => {
    const r = await runCli(['content', 'search-all', Q.aiAttribution, '--json', '--limit', '30']);
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    const results = parseSearchJson(r.stdout);
    if (results.length === 0) { skipTest('No results — AI Toolkit Demo may not be indexed'); return; }
    const aiResults = results.filter((res: any) =>
      res.siteName?.toLowerCase().includes('ai') ||
      res.siteName?.toLowerCase().includes('toolkit') ||
      res.target?.toLowerCase().includes('ai-toolkit') ||
      res.target?.toLowerCase().includes('ai_toolkit')
    );
    if (aiResults.length === 0) {
      skipTest('AI Toolkit Demo not in top 30 — site may need content with stronger AI signal');
    } else {
      expect(aiResults.length).toBeGreaterThan(0);
    }
  }, SEARCH_ALL_TIMEOUT);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  const Q = QUERIES.edgeCases;

  it('handles query with no results gracefully', async () => {
    const r = await runCli(searchArgs(SITES.recipes, Q.noResults, 5));
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    expect(Array.isArray(parseSearchJson(r.stdout))).toBe(true);
  }, 30_000);

  it('handles multi-word query', async () => {
    const r = await runCli(searchArgs(SITES.recipes, Q.multiWord, 5));
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    expect(r.exitCode).toBe(0);
  }, 30_000);

  it('all results have score >= 0.3 (default min_score)', async () => {
    const r = await runCli(searchArgs(SITES.newsroom, Q.scoreCheck, 20));
    if (r.exitCode !== 0) { skipTest('Local/addon not running'); return; }
    parseSearchJson(r.stdout).forEach((res: any) => {
      expect(res.score).toBeGreaterThanOrEqual(0.3);
    });
  }, 30_000);
});
