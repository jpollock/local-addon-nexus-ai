# Smart Search Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all testing, documentation, security, and code quality gaps on the Smart Search local backend before merging `feature/smart-search-local-backend` to main.

**Architecture:** Four workstreams in dependency order: (1) tech debt fixes that change code, (2) tests for all gaps including the fixes, (3) user-facing docs, (4) final verification and merge prep.

**Tech Stack:** TypeScript, Jest, better-sqlite3, LanceDB, PHP (MU plugin template), Markdown

**Branch:** `feature/smart-search-local-backend`

---

## File Map

**Modified:**
- `src/main/ai-gateway/mu-plugin-template.ts` — remove `is_plugin_active` PHP guard (Task 1)
- `src/main/vector-store/VectorStore.ts` — add public `lookupById()` method (Task 2)
- `src/main/smart-search/SmartSearchHandler.ts` — use `lookupById()`, remove `@ts-ignore` (Task 2)
- `src/main/content/lifecycle-hooks.ts` — extract `detectAtlasSearch()` as exported helper (Task 3)
- `tests/unit/smart-search/SmartSearchHandler.test.ts` — add 7 missing operation tests (Task 4)
- `tests/integration/smart-search/smart-search.integration.test.ts` — add typo regression test (Task 5)

**Created:**
- `tests/unit/lifecycle-hooks/atlas-search-detection.test.ts` — filesystem detection unit tests (Task 3)
- `docs/smart-search-getting-started.md` — user-facing guide (Task 6)
- `docs/smart-search-limitations.md` — known limitations reference (Task 7)

**Updated:**
- `docs/superpowers/specs/2026-05-08-smart-search-local-backend-design.md` — reflect post-plan changes (Task 8)
- `CLAUDE.md` (project root) — add known pitfalls (Task 8)

---

## Task 1: Fix PHP Template `is_plugin_active` Timing Bug

**Problem:** The generated MU plugin PHP calls `is_plugin_active('atlas-search/atlas-search.php')` inside the `option_wpe_content_engine_option_name` filter. This check fires when WordPress reads the option — which happens early in the bootstrap, before plugins are fully registered. `is_plugin_active()` returns `false` even when the plugin is active, so the filter passes through `$value` (empty/false) rather than our URL. The Node.js side already guarantees the Smart Search block is only included when atlas-search files are present on disk, so the PHP guard is both redundant and broken.

**Fix:** Remove the `is_plugin_active` guard from the PHP template entirely.

**File:** `src/main/ai-gateway/mu-plugin-template.ts`

- [ ] **Step 1: Replace the Smart Search filter block**

Find the section starting at line 311 (`${(smartSearchUrl && smartSearchToken) ? \`` ...) and replace the `option_wpe_content_engine_option_name` filter with the simplified version:

```typescript
${(smartSearchUrl && smartSearchToken) ? `
// ============================================================================
// Smart Search Local Backend (WP Engine AI Toolkit)
// ============================================================================

// This filter is only included when atlas-search is detected on disk (by the
// Nexus addon on site start). The is_plugin_active check was removed because it
// fires too early in WordPress bootstrap — before plugins are registered.
add_filter('option_wpe_content_engine_option_name', function($value) {
    return [
        'url'          => '${smartSearchUrl}',
        'access_token' => '${smartSearchToken}',
    ];
}, 10, 1);

// Inject Nexus site ID header on Smart Search requests
add_filter('http_request_args', function($args, $url) {
    $smart_search_base = '${smartSearchUrl}';
    if (strpos($url, $smart_search_base) === false) {
        return $args;
    }
    if (!isset($args['headers'])) {
        $args['headers'] = [];
    }
    $args['headers']['X-Nexus-Site-Id'] = defined('NEXUS_AI_SITE_ID') ? NEXUS_AI_SITE_ID : '';
    return $args;
}, 10, 2);
` : ''}`;
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | grep "error TS" | head -5
```

Expected: no errors.

- [ ] **Step 3: Verify the generated PHP no longer has `is_plugin_active`**

```bash
node -e "
const { generateMuPluginContent } = require('./lib/main/ai-gateway/mu-plugin-template');
const out = generateMuPluginContent({
  webhookUrl: 'http://127.0.0.1:13000',
  webhookAuthToken: 'testtoken',
  siteId: 'site1',
  smartSearchUrl: 'http://127.0.0.1:13000/smart-search/graphql',
  smartSearchToken: 'testtoken',
});
console.log(out.includes('is_plugin_active') ? 'FAIL: still present' : 'PASS: removed');
console.log(out.includes('option_wpe_content_engine_option_name') ? 'PASS: filter present' : 'FAIL: filter missing');
"
```

Expected:
```
PASS: removed
PASS: filter present
```

- [ ] **Step 4: Commit**

```bash
git add src/main/ai-gateway/mu-plugin-template.ts lib/main/ai-gateway/mu-plugin-template.js
git commit -m "fix(smart-search): remove is_plugin_active guard from MU plugin PHP template

The guard fires during early WordPress bootstrap before plugins register,
so is_plugin_active always returns false. The Node.js lifecycle hook already
checks for atlas-search on disk before including the block, making the PHP
guard both redundant and broken."
```

---

## Task 2: Fix `@ts-ignore` in SmartSearchHandler Recommendations

**Problem:** `handleRecommendations` accesses `this.vectorStore`'s private `getTable()` method via `@ts-ignore` and `as any` cast. This bypasses type safety and could break silently if `VectorStore` internals change.

**Fix:** Add a public `lookupById()` method to `VectorStore` and use it in `SmartSearchHandler`.

**Files:**
- Modify: `src/main/vector-store/VectorStore.ts`
- Modify: `src/main/smart-search/SmartSearchHandler.ts`

- [ ] **Step 1: Add `lookupById` to VectorStore**

In `src/main/vector-store/VectorStore.ts`, add after the `getTable()` method (around line 85):

```typescript
/**
 * Look up a single document by its exact ID. Returns null if not found or table missing.
 * Used by SmartSearchHandler to retrieve a reference document for similarity search.
 */
async lookupById(siteId: string, docId: string): Promise<{ id: string; content: string; title: string } | null> {
  // Validate docId — atlas-search IDs are "type:number" or plain alphanumeric slugs.
  // Reject anything that could break the LanceDB WHERE clause.
  if (!/^[a-zA-Z0-9:_\-]+$/.test(docId)) return null;
  const table = await this.getTable(siteId);
  if (!table) return null;
  try {
    const rows = await table.query().where(`id = '${docId}'`).limit(1).toArray();
    if (!rows.length) return null;
    return {
      id: rows[0].id as string,
      content: rows[0].content as string,
      title: rows[0].title as string,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update `handleRecommendations` in SmartSearchHandler**

Find the `handleRecommendations` method (around line 324). Replace the `@ts-ignore` block:

```typescript
// OLD — remove this:
let refContent: string | undefined;
try {
  // @ts-ignore — accessing private getTable to perform a direct WHERE query
  const table = await (this.vectorStore as any).getTable(siteId);
  if (table) {
    const rows = await table.query().where(`id = '${vars.docID.replace(/'/g, "\\'")}'`).limit(1).toArray();
    refContent = rows[0]?.content;
  }
} catch { /* table may not exist */ }

if (!refContent) {
  return jsonResponse(res, { data: { recommendations: { relatedDocuments: [] } } });
}
```

Replace with:

```typescript
// NEW — uses public lookupById
const ref = await this.vectorStore.lookupById(siteId, vars.docID);
if (!ref) {
  return jsonResponse(res, { data: { recommendations: { relatedDocuments: [] } } });
}
const refContent = ref.content;
```

- [ ] **Step 3: Build and verify no `@ts-ignore` remains**

```bash
npm run build 2>&1 | grep "error TS" | head -5
grep "@ts-ignore" src/main/smart-search/SmartSearchHandler.ts && echo "FAIL: still present" || echo "PASS: removed"
```

Expected: no build errors, "PASS: removed".

- [ ] **Step 4: Run existing tests to check for regressions**

```bash
npx jest --testPathPattern="SmartSearchHandler|vector-store" --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/vector-store/VectorStore.ts src/main/smart-search/SmartSearchHandler.ts
git commit -m "fix(smart-search): replace @ts-ignore with public VectorStore.lookupById()

Adds lookupById(siteId, docId) as a typed public method on VectorStore,
used by handleRecommendations to find a reference document by exact ID.
Includes docId validation to prevent LanceDB WHERE clause injection."
```

---

## Task 3: Extract and Test `detectAtlasSearch` Lifecycle Helper

**Problem:** The atlas-search filesystem detection in `lifecycle-hooks.ts` has no unit test. If the path logic breaks, we won't know until a site fails to get the Smart Search block.

**Fix:** Extract the detection into an exported helper and test it.

**Files:**
- Modify: `src/main/content/lifecycle-hooks.ts`
- Create: `tests/unit/lifecycle-hooks/atlas-search-detection.test.ts`

- [ ] **Step 1: Extract helper in `lifecycle-hooks.ts`**

Find the atlas-search filesystem check block (around line 397). Replace the inline `fs.existsSync` call with a named exported helper:

Add this function just before `installNexusAiConnectorPlugin`:

```typescript
/**
 * Check if the WP Engine AI Toolkit (atlas-search) plugin is installed on a site.
 * Uses a filesystem check rather than WP-CLI to avoid a race condition where
 * siteStarted fires before MySQL is ready.
 */
export function detectAtlasSearch(sitePath: string): boolean {
  const pluginFile = require('path').join(
    sitePath, 'app', 'public', 'wp-content', 'plugins', 'atlas-search', 'atlas-search.php',
  );
  return require('fs-extra').existsSync(pluginFile);
}
```

Then in `installNexusAiConnectorPlugin`, replace the inline block:

```typescript
// OLD:
const atlasSearchPath = path.join(
  site.path, 'app', 'public', 'wp-content', 'plugins', 'atlas-search', 'atlas-search.php',
);
if (fs.existsSync(atlasSearchPath)) {

// NEW:
if (detectAtlasSearch(site.path)) {
```

- [ ] **Step 2: Write failing tests** (`tests/unit/lifecycle-hooks/atlas-search-detection.test.ts`)

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectAtlasSearch } from '../../../src/main/content/lifecycle-hooks';

describe('detectAtlasSearch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-atlas-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when atlas-search.php exists', () => {
    const pluginDir = path.join(
      tmpDir, 'app', 'public', 'wp-content', 'plugins', 'atlas-search',
    );
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'atlas-search.php'), '<?php // stub');

    expect(detectAtlasSearch(tmpDir)).toBe(true);
  });

  it('returns false when plugin directory is absent', () => {
    expect(detectAtlasSearch(tmpDir)).toBe(false);
  });

  it('returns false when plugin directory exists but atlas-search.php is missing', () => {
    const pluginDir = path.join(
      tmpDir, 'app', 'public', 'wp-content', 'plugins', 'atlas-search',
    );
    fs.mkdirSync(pluginDir, { recursive: true });
    // Directory exists but no atlas-search.php

    expect(detectAtlasSearch(tmpDir)).toBe(false);
  });

  it('returns false for a different plugin in the directory', () => {
    const pluginDir = path.join(
      tmpDir, 'app', 'public', 'wp-content', 'plugins', 'some-other-plugin',
    );
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'some-other-plugin.php'), '<?php // stub');

    expect(detectAtlasSearch(tmpDir)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest --testPathPattern="atlas-search-detection" --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module` or export error.

- [ ] **Step 4: Build and run tests to verify they pass**

```bash
npm run build 2>&1 | grep "error TS" | head -5
npx jest --testPathPattern="atlas-search-detection" --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 4 passed`

- [ ] **Step 5: Commit**

```bash
git add src/main/content/lifecycle-hooks.ts tests/unit/lifecycle-hooks/atlas-search-detection.test.ts
git commit -m "test(smart-search): extract detectAtlasSearch helper + 4 unit tests

Extracted filesystem detection to a named exported function so it can be
unit tested in isolation. Tests cover plugin present, absent, directory
only, and wrong plugin cases."
```

---

## Task 4: Fill SmartSearchHandler Test Gaps

**Problem:** The SmartSearchHandler unit tests only cover 5 of 10 operation types (write path + unknown op). The `find`, `synonyms`, `semanticConfig`, `tracker`, `recommendations`, `insights`, and `capabilities` paths have zero unit coverage.

**File:** `tests/unit/smart-search/SmartSearchHandler.test.ts`

- [ ] **Step 1: Add the missing tests**

Append to the existing test file (after the last `describe` block, before the closing):

```typescript
describe('SmartSearchHandler — capabilities', () => {
  it('returns all capability strings', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query GetCapabilities { capabilities }',
      variables: {},
    }), res);
    const caps = getBody().data.capabilities;
    expect(caps).toContain('SEARCH');
    expect(caps).toContain('HYBRID_SEARCH');
    expect(caps).toContain('SIMILARITY_SEARCH');
    expect(caps).toContain('RECOMMENDATIONS');
    expect(caps).toContain('VECTOR_DB');
  });
});

describe('SmartSearchHandler — find', () => {
  it('calls vectorStore.search and returns shaped response', async () => {
    (mockVectorStore.search as jest.Mock).mockResolvedValueOnce([
      { id: 'post:1', score: 0.8, title: 'Hello', content: 'World', postType: 'post', postId: 1, metadata: '{"post_title":"Hello","post_type":"post"}' },
    ]);
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query Search($query: String!) { find(query: $query limit: 5 offset: 0) { total documents { id score } } }',
      variables: { query: 'hello', limit: 5, offset: 0 },
    }), res);
    expect(mockVectorStore.search).toHaveBeenCalledTimes(1);
    const body = getBody();
    expect(body.data.find.total).toBe(1);
    expect(body.data.find.documents[0].id).toBe('post:1');
    expect(body.data.find.documents[0].score).toBeCloseTo(0.8);
  });

  it('returns empty results when vectorStore returns nothing', async () => {
    (mockVectorStore.search as jest.Mock).mockResolvedValueOnce([]);
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query Search($query: String!) { find(query: $query) { total documents { id } } }',
      variables: { query: 'nothing', limit: 5, offset: 0 },
    }), res);
    expect(getBody().data.find.total).toBe(0);
    expect(getBody().data.find.documents).toHaveLength(0);
  });
});

describe('SmartSearchHandler — synonyms', () => {
  it('saves a synonym rule and lists it back', async () => {
    const { res: saveRes, getBody: getSaveBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { config { synonyms { saveRule(synonyms: "laptop, notebook") { success rule { id synonyms } } } } }',
      variables: { synonyms: 'laptop, notebook' },
    }), saveRes);
    expect(getSaveBody().data.config.synonyms.saveRule.success).toBe(true);
    const ruleId = getSaveBody().data.config.synonyms.saveRule.rule.id;

    const { res: listRes, getBody: getListBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { config { synonyms { rules { total rules { id synonyms } } } } }',
      variables: {},
    }), listRes);
    const rules = getListBody().data.config.synonyms.rules;
    expect(rules.total).toBe(1);
    expect(rules.rules[0].synonyms).toBe('laptop, notebook');
    expect(rules.rules[0].id).toBe(ruleId);
  });

  it('deletes all synonym rules', async () => {
    synonymStore.saveRule('site1', 'a, b');
    synonymStore.saveRule('site1', 'c, d');

    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { config { synonyms { deleteAllRules } } }',
      variables: {},
    }), res);
    expect(getBody().data.config.synonyms.deleteAllRules).toBe(true);
    expect(synonymStore.getRules('site1')).toHaveLength(0);
  });
});

describe('SmartSearchHandler — semanticConfig', () => {
  it('sets and retrieves semantic search field configuration', async () => {
    const { res: setRes, getBody: getSetBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation ConfigSemantic { config { semanticSearch(fields: ["post_title"]) { fields type } } }',
      variables: { fields: ['post_title'] },
    }), setRes);
    expect(getSetBody().data.config.semanticSearch.fields).toEqual(['post_title']);
    expect(getSetBody().data.config.semanticSearch.type).toBe('BASIC');

    const { res: getRes, getBody: getGetBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { config { semanticSearch { fields type } } }',
      variables: {},
    }), getRes);
    expect(getGetBody().data.config.semanticSearch.fields).toEqual(['post_title']);
  });

  it('returns default config when nothing set', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { config { semanticSearch { fields type } } }',
      variables: {},
    }), res);
    expect(getBody().data.config.semanticSearch.fields).toEqual(['post_title', 'post_content']);
  });
});

describe('SmartSearchHandler — tracker', () => {
  it('handles trackPageView', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { tracker { trackPageView(session: $session userID: $userID data: $data) { success message } } }',
      variables: { session: { id: 's1' }, userID: 'u1', data: { documentID: 'post:1' } },
    }), res);
    expect(getBody().data.tracker.trackPageView.success).toBe(true);
  });

  it('handles trackSearch', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { tracker { trackSearch(session: $session userID: $userID data: $data) { success message } } }',
      variables: { session: { id: 's1' }, userID: 'u1', data: { search: { query: 'hello', results: [{}, {}] } } },
    }), res);
    expect(getBody().data.tracker.trackSearch.success).toBe(true);
    const terms = trackerStore.getSearchTerms('site1', 10);
    expect(terms[0].term).toBe('hello');
    expect(terms[0].numberOfSearches).toBe(1);
  });

  it('handles trackSearchClick', async () => {
    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'mutation { tracker { trackSearchClick(session: $session userID: $userID data: $data) { success message } } }',
      variables: { session: { id: 's1' }, userID: 'u1', data: { documentID: 'post:1', position: 2 } },
    }), res);
    expect(getBody().data.tracker.trackSearchClick.success).toBe(true);
    const trending = trackerStore.getTrendingDocuments('site1', 5);
    expect(trending[0].docID).toBe('post:1');
  });
});

describe('SmartSearchHandler — recommendations', () => {
  it('returns trendingDocuments from tracker data', async () => {
    trackerStore.trackSearchClick('site1', { sessionId: 's1', userId: 'u1', documentId: 'post:42', position: 1 });
    trackerStore.trackSearchClick('site1', { sessionId: 's2', userId: 'u2', documentId: 'post:42', position: 1 });

    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { recommendations(count: 5) { trendingDocuments(from: "2024-01-01" to: "2099-01-01") { docID count } } }',
      variables: { count: 5 },
    }), res);
    const trending = getBody().data.recommendations.trendingDocuments;
    expect(trending[0].docID).toBe('post:42');
    expect(trending[0].count).toBe(2);
  });

  it('returns empty relatedDocuments when doc not found', async () => {
    // VectorStore.lookupById will be called — mock returns null (no doc found)
    (mockVectorStore as any).lookupById = jest.fn().mockResolvedValue(null);

    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { recommendations(count: 5) { relatedDocuments(docID: "post:999") { docID score } } }',
      variables: { count: 5, docID: 'post:999' },
    }), res);
    expect(getBody().data.recommendations.relatedDocuments).toHaveLength(0);
  });
});

describe('SmartSearchHandler — insights', () => {
  it('returns search terms and no-result terms from tracker', async () => {
    trackerStore.trackSearch('site1', { sessionId: 's1', userId: 'u1', query: 'road trip', resultCount: 5 });
    trackerStore.trackSearch('site1', { sessionId: 's2', userId: 'u2', query: 'xyzzy', resultCount: 0 });

    const { res, getBody } = mockRes();
    await handler.handle(mockReq({
      query: 'query { insights { searchTerms { term numberOfSearches } searchTermsNoResults { term numberOfSearches } } }',
      variables: { top: 10 },
    }), res);
    const body = getBody().data.insights;
    expect(body.searchTerms[0].term).toBe('road trip');
    expect(body.searchTermsNoResults[0].term).toBe('xyzzy');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx jest --testPathPattern="SmartSearchHandler" --no-coverage 2>&1 | tail -15
```

Expected: all tests pass (the relatedDocuments test may need the `lookupById` mock — adjust if the mock shape from Task 2 differs).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/smart-search/SmartSearchHandler.test.ts
git commit -m "test(smart-search): add unit tests for all 10 handler operation types

Previously only 5/10 operations had unit tests (write path + unknown op).
Adds tests for: capabilities, find, synonyms, semanticConfig, tracker
(all 3 events), recommendations (trending + relatedDocuments), insights."
```

---

## Task 5: Add Typo Regression Test to Integration Suite

**Problem:** The relevance floor fix (set to 0 for atlas-search `find` queries) has no automated regression test. If someone accidentally restores the floor, typo queries silently break.

**File:** `tests/integration/smart-search/smart-search.integration.test.ts`

- [ ] **Step 1: Add the typo regression test**

In the integration test file, add a new `describe` block after the existing tests:

```typescript
describe('typo tolerance (relevance floor = 0)', () => {
  it('finds content matching a misspelled query via semantic similarity', async () => {
    if (!hasModel) {
      console.log('Skipping typo test — ONNX model not present (semantic similarity unavailable)');
      return;
    }

    await callHandler(handler, {
      query: 'mutation IndexRecord($input: DocumentInput!) { index(input: $input) { success } }',
      variables: {
        input: {
          id: 'post:road-test',
          data: {
            post_title: 'Road trip planning guide',
            post_content: 'Everything you need to know for planning the perfect road trip across America.',
            post_type: 'post',
            post_date_gmt: '2024-01-01T00:00:00',
            post_modified_gmt: '2024-01-01T00:00:00',
            post_url: 'http://example.com/road-trip',
          },
        },
      },
    });

    // "roade" is a 1-char typo for "road" — semantic embedding should still match
    const findResp = await callHandler(handler, {
      query: 'query Search($query: String!) { find(query: $query limit: 5 offset: 0) { total documents { id score } } }',
      variables: { query: 'roade', limit: 5, offset: 0 },
    });

    expect(findResp.data.find.total).toBeGreaterThan(0);
    expect(findResp.data.find.documents.some((d: any) => d.id === 'post:road-test')).toBe(true);
    // Verify the score is low (typo match) but non-zero (floor not cutting it off)
    const roadDoc = findResp.data.find.documents.find((d: any) => d.id === 'post:road-test');
    expect(roadDoc.score).toBeGreaterThan(0);
    expect(roadDoc.score).toBeLessThan(0.5); // typo match should score below exact match
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
npx jest --testPathPattern="smart-search.integration" --no-coverage --testTimeout=30000 2>&1 | tail -15
```

Expected: all tests pass. If model is absent, the typo test prints a skip message and passes.

- [ ] **Step 3: Run full test suite for regressions**

```bash
npm test 2>&1 | grep -E "Tests:|Test Suites:|FAIL " | head -10
```

Expected: 2 pre-existing failures (`wpe-tier3`, `resolvers-search`). All new tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/smart-search/smart-search.integration.test.ts
git commit -m "test(smart-search): typo tolerance regression test

Verifies that 'roade' (1-char typo for 'road') returns results via semantic
embedding similarity. Guards against accidental restoration of the 0.3
relevance floor that previously caused all typo queries to return nothing."
```

---

## Task 6: Write User-Facing Getting Started Guide

**Problem:** There is no documentation explaining how a developer enables and uses Smart Search locally.

**File:** `docs/smart-search-getting-started.md` (new)

- [ ] **Step 1: Write the guide**

```markdown
# Smart Search Locally — Getting Started

Nexus AI makes WP Engine Smart Search work in Local, backed by LanceDB and ONNX embeddings on your machine instead of WPE's cloud.

## Prerequisites

- Local site with WP Engine AI Toolkit (`atlas-search`) plugin **installed**
- Nexus AI addon active in Local

The plugin can be downloaded from the WordPress admin or copied from another site that has it.

## Setup (automatic)

**There is nothing to configure.** When you start a site that has `atlas-search` installed:

1. Nexus detects the plugin files on disk
2. Adds a Smart Search endpoint override to the MU plugin (`wp-content/mu-plugins/nexus-ai-connector-config.php`)
3. atlas-search routes all requests to `http://127.0.0.1:13000/smart-search/graphql` instead of WPE cloud

You can verify it's working by visiting **WP Engine AI Toolkit → Settings** in the WordPress admin. The URL field should show `http://127.0.0.1:13000/smart-search/graphql`.

## Syncing Content

After activation, sync your content so the local index is populated:

**WP Admin:** WP Engine AI Toolkit → Smart Search → click **Sync** (or the equivalent index/re-index button).

**WP-CLI (via Nexus):**
```bash
nexus wp "wpe-smart-search sync-data" yoursite@local
```

After syncing, WordPress search will use the local Nexus index.

## What Works Locally

| Feature | Status |
|---------|--------|
| Full-text search | ✅ Full |
| Semantic / hybrid search | ✅ Full (requires ONNX model) |
| Typo tolerance | ✅ Full (semantic similarity handles misspellings) |
| Synonyms | ✅ Full |
| Recommendations (related posts) | ✅ Full |
| Recommendations (trending) | ✅ Full |
| Tracker (page views, clicks, searches) | ✅ Full |
| Insights analytics | ✅ Full |
| Promotions / custom search results | ✅ Full |
| ACF field indexing | ✅ Full |
| Facets / aggregations | ⚠️ Computed post-query (correct but slower than cloud) |
| Geographic search | ⚠️ Silently ignored |
| Fuzzy distance control | ⚠️ On/off only — per-word distance not supported |

## Pushing to WPE

Before pushing files or database to WP Engine:

1. **Exclude the MU plugin from file push.** The file `wp-content/mu-plugins/nexus-ai-connector-config.php` contains localhost URLs and must not go to WPE. Add it to `.wpe-push-ignore`:

   ```
   wp-content/mu-plugins/nexus-ai-connector-config.php
   ```

2. **The database option is safe.** Nexus uses a WordPress filter to override the option on-the-fly — nothing is written to the database. The WPE server will use its own provisioned credentials.

## Troubleshooting

**Settings page shows empty URL / "Missing URL" warning:**
The lifecycle hook ran before `atlas-search` was activated. Activate the plugin from WP Admin → Plugins, then restart the site in Local.

**"Failed to query capabilities: Unknown operation":**
Local is running an old compiled version of the addon. Restart Local completely.

**Search returns no results:**
The index may be empty. Run a sync from the Smart Search admin page.

**Typo queries return nothing:**
Ensure the ONNX model is present at `models/all-MiniLM-L6-v2-quantized/model.onnx`. Without it, only exact FTS matches are returned.
```

- [ ] **Step 2: Commit**

```bash
git add docs/smart-search-getting-started.md
git commit -m "docs(smart-search): user-facing getting started guide

Covers: prerequisites, automatic setup, content sync, capability matrix,
WPE push safety, and troubleshooting for the 4 most common failure modes."
```

---

## Task 7: Write Known Limitations Reference

**Problem:** Limitations discovered during implementation and live validation are undocumented. Developers building against the local backend need to know where local behavior differs from WPE cloud.

**File:** `docs/smart-search-limitations.md` (new)

- [ ] **Step 1: Write the limitations doc**

```markdown
# Smart Search Local Backend — Known Limitations

This document describes where the local Nexus backend diverges from WPE's cloud Smart Search service.

## Search Behavior

### `searchBias` only gates embedding, does not weight results

The `semanticSearch.searchBias` parameter (0–10) is documented as controlling the blend between keyword and semantic search. Locally, it only determines whether an embedding is generated:

- `searchBias = 0`: FTS-only, no embedding
- `searchBias > 0`: embedding generated and used for vector search

The actual weighting between vector score and FTS score is handled internally by LanceDB's hybrid search and cannot be controlled per-query. Cloud behavior: continuously adjustable blend.

### `fuzzyDistance` is binary (on/off), not per-word

`tolerance: { name: "fuzzy", fuzzyDistance: 2 }` is accepted but `fuzzyDistance` is ignored. LanceDB FTS has fuzzy support but does not expose per-word character distance configuration. Typo tolerance works via semantic embeddings instead.

### Geographic search is silently ignored

`geoConstraints` in `find` queries is accepted without error but has no effect on results. LanceDB is a vector database, not a geo-search engine.

### `queryRescorer` is silently ignored

The `queryRescorer` parameter for re-ranking top results is accepted but not applied. Results are ranked by LanceDB's hybrid scoring.

### Field weighting (`fields`, `options.fields.types`) is ignored

Per-field relevance boost is not supported. All indexed fields contribute equally to FTS scoring.

## Aggregations / Facets

`aggregate.terms` and `aggregate.ranges` are supported but computed post-query from the returned result set rather than from a pre-built index. This means:

- Facet counts reflect only the documents returned by the search, not the full corpus
- Performance degrades with large result sets

## Cursor Pagination

`searchAfter` (cursor-based pagination) is simulated with `offset`. At large page depths this becomes slower (offset scans all prior results).

## Recommendations

### relatedDocuments accuracy depends on local ONNX model

The local embedding model (`all-MiniLM-L6-v2-quantized`, 384 dimensions) produces different vectors than WPE's cloud model. Related document rankings may differ from cloud.

### trendingDocuments retention is 7 days (matches cloud)

Tracker events older than 7 days are purged on Nexus startup. This matches the cloud API's data retention policy.

## Synonyms

Synonyms are applied via query string expansion before embedding and FTS. The cloud applies synonyms at the index analysis layer, which can produce subtly different results for phrase queries.

## Indexing

### Autoload audit and meta key breakdown unavailable

These are WPE-specific analytics features. The local backend indexes document content and standard WP fields only.

### Custom `id_prefix` filtering

atlas-search supports `filter_id_prefix()` hooks to partition documents across tenants. This works locally because the prefix is part of the document ID stored in LanceDB.

## Out of Scope (not implemented locally)

- **Smart Attachment** — AI image/PDF analysis requires WPE cloud vision models
- **ChatKit** — redirect to Local AI Gateway for conversational AI
- **Semantic Search Config type** — always returns `BASIC`; `ADVANCED` type configuration is accepted and stored but has no behavioral effect
```

- [ ] **Step 2: Commit**

```bash
git add docs/smart-search-limitations.md
git commit -m "docs(smart-search): known limitations reference

Documents where local Nexus behavior diverges from WPE cloud:
searchBias gating, fuzzyDistance binary behavior, silent stubs for geo/
queryRescorer/field weighting, post-query aggregations, and out-of-scope
features."
```

---

## Task 8: Update Spec and CLAUDE.md

**Problem:** Three post-plan changes (capabilities endpoint, relevance floor fix, filesystem detection) aren't reflected in the spec or CLAUDE.md. The `is_plugin_active` timing issue should be captured as a pitfall.

**Files:**
- Modify: `docs/superpowers/specs/2026-05-08-smart-search-local-backend-design.md`
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1: Add addendum section to spec**

Append to the end of `docs/superpowers/specs/2026-05-08-smart-search-local-backend-design.md`:

```markdown
---

## Post-Implementation Addendum

Changes discovered during live validation that differ from the original design:

### Capabilities Query (not in original spec)

The `atlas-search` plugin sends `query GetCapabilities { capabilities }` on every page load before attempting any other operations. The handler returns:

```json
["SEARCH", "HYBRID_SEARCH", "SIMILARITY_SEARCH", "RECOMMENDATIONS", "VECTOR_DB"]
```

Without this, the plugin shows "Failed to query capabilities: Unknown operation" and disables all tabs.

### Relevance Floor Removed for `find`

The original design assumed `VectorStore.search`'s default `relevanceFloor: 0.3` was appropriate. In practice, this filtered out typo queries ("roade" → 0 results) because semantic embeddings for misspellings score just below 0.3 against the correct content. The `find` handler now passes `relevanceFloor: 0`, letting the plugin's own ranking handle result quality.

### Filesystem Detection Replaces WP-CLI for Atlas-Search

The original design used `wp plugin is-active atlas-search` via WP-CLI. This fails intermittently because `siteStarted` fires before MySQL is fully up — WP-CLI gets ECONNREFUSED and returns `success: false`. The fix uses `fs.existsSync(atlas-search.php)` instead, which has no MySQL dependency and is immune to the race condition.

### PHP Template `is_plugin_active` Guard Removed

The generated MU plugin originally included an `is_plugin_active()` check inside the `option_wpe_content_engine_option_name` filter. This check fires during early WordPress bootstrap before plugins are registered, causing it to always return false. The guard was removed — the Node.js filesystem check at site-start time is the single point of control.
```

- [ ] **Step 2: Add pitfall to CLAUDE.md**

Find the "Known Pitfalls" section in `CLAUDE.md`. Add this entry:

```markdown
- [Smart Search MU plugin pitfalls](feedback_smart_search_mu_plugin.md) — `is_plugin_active()` fires too early in WordPress bootstrap; use filesystem checks in Node.js, not WP-CLI. `option_wpe_content_engine_option_name` filter timing; siteStarted races MySQL startup.
```

Then create the memory file at `/Users/jeremy.pollock/.claude/projects/-Users-jeremy-pollock-development-wpengine-local-addon-nexus-ai/memory/feedback_smart_search_mu_plugin.md`:

```markdown
---
name: Smart Search MU Plugin Pitfalls
description: Known timing issues with atlas-search detection and WordPress option filter in the Smart Search local backend
type: feedback
---

Two timing traps discovered during Smart Search local backend implementation:

**Trap 1: `is_plugin_active()` returns false in MU plugin filters**
WordPress filters like `option_{option_name}` fire early in bootstrap before plugins are registered. `is_plugin_active()` reads the `active_plugins` option which may not be initialized yet. Always returns false, defeating the guard.
**Why:** Discovered when myloop site showed empty URL in plugin settings despite atlas-search being active.
**How to apply:** Never use `is_plugin_active()` inside WordPress filters in the Nexus MU plugin. Use the Node.js filesystem check at site-start time instead (see `lifecycle-hooks.ts detectAtlasSearch`).

**Trap 2: `siteStarted` races MySQL startup**
The `siteStarted` hook fires as soon as Local marks a site running, but MySQL may not be accepting connections yet. Any WP-CLI command that needs the database (including `wp plugin is-active`) will fail with ECONNREFUSED and return `success: false`.
**Why:** Discovered in logs — myloop showed `MySQLExtractor: connect ECONNREFUSED` at the exact moment `installNexusAiConnectorPlugin` ran.
**How to apply:** For atlas-search detection in `installNexusAiConnectorPlugin`, use `fs.existsSync()` on the plugin file path. For other WP-CLI checks in `siteStarted`, accept that they may fail and implement retry or deferral if reliability matters.
```

- [ ] **Step 3: Build and full test run**

```bash
npm run build 2>&1 | grep "error TS" | head -5
npm test 2>&1 | grep -E "Tests:|Test Suites:|FAIL " | head -10
```

Expected: no build errors, 2 pre-existing failures only.

- [ ] **Step 4: Commit**

```bash
git add \
  docs/superpowers/specs/2026-05-08-smart-search-local-backend-design.md \
  CLAUDE.md \
  /Users/jeremy.pollock/.claude/projects/-Users-jeremy-pollock-development-wpengine-local-addon-nexus-ai/memory/feedback_smart_search_mu_plugin.md
git commit -m "docs(smart-search): update spec + CLAUDE.md with post-implementation findings

Documents three post-plan discoveries: capabilities query requirement,
relevance floor removal, filesystem vs WP-CLI detection. Captures
is_plugin_active and siteStarted/MySQL race as known pitfalls in memory."
```

---

## Task 9: Regenerate myloop MU Plugin + Final Verification

**Problem:** myloop's MU plugin was manually patched and still contains the old `is_plugin_active` guard (now removed from the template). The on-disk file doesn't match what Nexus generates.

- [ ] **Step 1: Restart Local to pick up new build**

After rebuilding (`npm run build`), restart Local completely so the new `lib/` is loaded.

- [ ] **Step 2: Start myloop in Local**

The lifecycle hook will fire, detect atlas-search via filesystem, and regenerate the MU plugin from the updated template (no `is_plugin_active`, no `@ts-ignore`).

- [ ] **Step 3: Verify the generated MU plugin**

```bash
grep -A 8 "option_wpe_content_engine_option_name" \
  "/Users/jeremy.pollock/Local Sites/myloop/app/public/wp-content/mu-plugins/nexus-ai-connector-config.php"
```

Expected output — should contain the return array but NO `is_plugin_active`:
```php
add_filter('option_wpe_content_engine_option_name', function($value) {
    return [
        'url'          => 'http://127.0.0.1:13000/smart-search/graphql',
        'access_token' => '61e254d38b2dee9427492dc9ccb604d99dac55df16c30da34cffaddcbfae2942',
    ];
}, 10, 1);
```

- [ ] **Step 4: Verify in WordPress admin**

Open myloop's WP Engine AI Toolkit settings page. Confirm URL shows `http://127.0.0.1:13000/smart-search/graphql` without the "Missing URL" warning.

- [ ] **Step 5: Confirm endpoint responds**

```bash
TOKEN=$(grep "access_token" \
  "/Users/jeremy.pollock/Local Sites/myloop/app/public/wp-content/mu-plugins/nexus-ai-connector-config.php" \
  | sed "s/.*=> '//;s/'.*//" | head -1)
curl -s -X POST http://127.0.0.1:13000/smart-search/graphql \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Nexus-Site-Id: l_gaJ0dm1" \
  -d '{"query":"query GetCapabilities { capabilities }","variables":{}}' \
  | python3 -m json.tool
```

Expected: `{ "data": { "capabilities": ["SEARCH", "HYBRID_SEARCH", ...] } }`

- [ ] **Step 6: Commit final state**

```bash
git add src/main/content/lifecycle-hooks.ts
git commit -m "chore(smart-search): final verification — myloop MU plugin regenerated cleanly

After PHP template fix (Task 1) and lifecycle hook refactor (Task 3),
myloop's MU plugin now matches the generated template without manual patches.
Verified via WordPress admin and direct endpoint test."
```

---

## Self-Review

**Spec coverage check:**
- ✅ PHP template `is_plugin_active` timing bug — Task 1
- ✅ `@ts-ignore` in recommendations — Task 2
- ✅ `detectAtlasSearch` testability — Task 3
- ✅ All 10 handler operations tested — Task 4
- ✅ Typo regression test — Task 5
- ✅ User-facing docs — Task 6
- ✅ Known limitations — Task 7
- ✅ Spec + CLAUDE.md updated — Task 8
- ✅ myloop MU plugin regenerated — Task 9

**Placeholder scan:** No TBDs, no "handle edge cases", all code blocks complete.

**Type consistency:** `detectAtlasSearch(sitePath: string): boolean` used consistently in Task 3. `lookupById(siteId, docId)` return type `{ id, content, title } | null` matches usage in Task 2 and Task 4's mock.
