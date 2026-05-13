# Smart Search Local Backend — Design Spec

**Date:** 2026-05-08  
**Status:** Approved  
**Scope:** Make Nexus AI the local backend for the WP Engine AI Toolkit (`atlas-search`) plugin, replacing the WPE cloud GraphQL endpoint when running in Local.

---

## Problem

The `atlas-search` plugin (WP Engine AI Toolkit) requires a cloud GraphQL endpoint to function. Local sites have no WPE hosting connection, so Smart Search, Recommendations, Insights, and the Tracker API are all inoperative in local development. Developers can't test or build against Smart Search locally.

## Solution

Nexus exposes a `/smart-search/graphql` route on its existing `HttpEventInterface` server. The MU plugin overrides `wpe_content_engine_option_name` to point at Nexus. The `atlas-search` plugin sends all operations to Nexus transparently — no plugin modification required.

---

## Architecture

```
atlas-search plugin (WordPress)
    │
    │  POST /smart-search/graphql
    │  Authorization: Bearer {NEXUS_AI_AUTH_TOKEN}
    ▼
HttpEventInterface (~port 13000)
    │
    ├── SmartSearchHandler
    │       ├── find        → EmbeddingService + VectorStore + SynonymStore
    │       ├── index       → EmbeddingService + VectorStore.upsert()
    │       ├── bulkIndex   → EmbeddingService + VectorStore.upsert() (batch)
    │       ├── delete      → VectorStore.delete()
    │       ├── deleteAll   → VectorStore.truncate()
    │       ├── config.synonyms.*       → SynonymStore (SQLite)
    │       ├── config.semanticSearch   → SemanticConfig (SQLite)
    │       ├── tracker.*               → TrackerStore (SQLite)
    │       ├── recommendations.*       → TrackerStore + VectorStore
    │       └── insights.*              → TrackerStore aggregations
    │
    └── existing routes unchanged

MU plugin (per-site, generated on site start)
    └── option_wpe_content_engine_option_name filter
            → url: http://127.0.0.1:{port}/smart-search/graphql
            → access_token: {NEXUS_AI_AUTH_TOKEN}
```

No new server. No new port. Existing Bearer auth in `HttpEventInterface.validateAuth()` covers the Smart Search route automatically.

---

## Component Design

### SmartSearchHandler

**File:** `src/main/smart-search/SmartSearchHandler.ts`

Single class. Parses the incoming GraphQL POST body and dispatches by operation name. No full GraphQL runtime — the plugin sends a small, predictable operation set.

```typescript
class SmartSearchHandler {
  constructor(
    private vectorStore: VectorStore,
    private embeddingService: EmbeddingService,
    private graphService: GraphService,
    private synonymStore: SynonymStore,
    private trackerStore: TrackerStore,
    private semanticConfig: SemanticConfig,
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}
```

**Operation dispatch:**

| Operation | Handler method |
|-----------|---------------|
| `find` | `handleFind()` |
| `index` | `handleIndex()` |
| `bulkIndex` | `handleBulkIndex()` |
| `delete` | `handleDelete()` |
| `deleteAll` | `handleDeleteAll()` |
| `config { synonyms { ... } }` | `handleSynonyms()` |
| `config { semanticSearch(...) }` | `handleSemanticConfig()` |
| `tracker { track* }` | `handleTracker()` |
| `recommendations { ... }` | `handleRecommendations()` |
| `insights { ... }` | `handleInsights()` |

**`find` execution pipeline:**

```
1. Parse: query, filter, semanticSearch, limit, offset, orderBy,
          promotions, customResults, aggregate, tolerance, timeDecay,
          includeFields, excludeFields

2. Synonyms: expand query using SynonymStore rules
   "laptop" → "(laptop OR notebook OR computer)"

3. Embed: if semanticSearch.searchBias > 0
   vectorWeight = searchBias / 10.0  (0.0–1.0)
   queryVector = EmbeddingService.embed(expandedQuery)

4. Search: VectorStore.search(siteId, queryVector, {
     vectorWeight, ftsQuery: expandedQuery,
     limit: limit + promotionCount,  // over-fetch for post-processing
     offset
   })

5. Post-process (in order):
   a. Filter string → field match on returned doc data_json
   b. timeDecay → re-score by post_date_gmt
   c. Aggregations → compute term/range counts from result set
   d. customResults → prepend phrase-matched overrides
   e. Promotions → prepend pinned docs (fetched from VectorStore by ID)
   f. includeFields/excludeFields → filter data_json keys

6. Response: { data: { find: { total, documents: [{ id, score, sort, data }] } } }
```

**`index` / `bulkIndex` execution:**

```
1. Extract: id, data (all WP fields)
2. Read SemanticConfig.fields for site (default: ["post_title","post_content"])
3. Concatenate configured fields from data → embedText
4. Embed: EmbeddingService.embedBatch([embedText])
5. Upsert: VectorStore.upsert(siteId, [{
     id, vector, content: embedText,
     post_type, post_date_gmt, post_modified_gmt,
     post_url, data_json: JSON.stringify(data)
   }])
6. Response: { data: { index: { success: true, code: "200", document: { id } } } }
```

---

## LanceDB Schema Migration

`VectorDocument` (existing) gains four new fields:

| Field | Type | Purpose |
|-------|------|---------|
| `post_date_gmt` | string (ISO) | orderBy date, timeDecay |
| `post_modified_gmt` | string (ISO) | orderBy modified |
| `data_json` | string (JSON) | full doc for includeFields + relatedDocuments |
| `doc_url` | string | tracker/recommendations source linking |

Existing tables are migrated on first access: if a table lacks these columns, Nexus adds them with null defaults. No data loss.

---

## New SQLite Tables (in GraphService db)

### `smart_search_synonyms`

```sql
CREATE TABLE IF NOT EXISTS smart_search_synonyms (
  id         TEXT PRIMARY KEY,
  site_id    TEXT NOT NULL,
  synonyms   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_synonyms_site ON smart_search_synonyms(site_id);
```

Synonym expansion at query time:
- Equivalents (`a, b, c`): all terms become OR alternatives
- One-way (`a => b`): left terms expand to right only

### `smart_search_tracker`

```sql
CREATE TABLE IF NOT EXISTS smart_search_tracker (
  id           TEXT PRIMARY KEY,
  site_id      TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  user_id      TEXT,
  document_id  TEXT,
  query        TEXT,
  result_count INTEGER,
  position     INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracker_site_event
  ON smart_search_tracker(site_id, event_type, created_at);
```

7-day TTL: on Nexus startup, delete rows where `created_at < now - 604800000`.

Feeds:
- `trendingDocuments` — document_id frequency from `search_click` events
- `searchTerms` / `searchTermsNoResults` — query frequency from `search` events
- `siteAnalytics` — impressions + CTR per document_id

### `smart_search_semantic_config`

```sql
CREATE TABLE IF NOT EXISTS smart_search_semantic_config (
  site_id    TEXT PRIMARY KEY,
  fields     TEXT NOT NULL DEFAULT '["post_title","post_content"]',
  type       TEXT NOT NULL DEFAULT 'BASIC',
  updated_at INTEGER NOT NULL
);
```

---

## MU Plugin Changes

**`src/main/ai-gateway/mu-plugin-template.ts`** — new optional config fields:

```typescript
export interface MuPluginConfig {
  // ... existing ...
  smartSearchUrl?: string;   // http://127.0.0.1:{port}/smart-search/graphql
  smartSearchToken?: string; // same as webhookAuthToken
}
```

Generated PHP block (only included when both fields are set):

```php
// Smart Search Local Backend
add_filter('option_wpe_content_engine_option_name', function($value) {
    // is_plugin_active() requires plugin.php — not auto-loaded in MU plugin context
    if (!function_exists('is_plugin_active')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    if (!is_plugin_active('atlas-search/atlas-search.php')) {
        return $value;
    }
    return [
        'url'          => '{smartSearchUrl}',
        'access_token' => '{smartSearchToken}',
    ];
}, 10, 1);
```

**Activation detection** (`src/main/content/lifecycle-hooks.ts`): on site start, run `wp plugin is-active atlas-search`. If active, include `smartSearchUrl` and `smartSearchToken` in `generateMuPluginContent`. If not active, omit the block entirely.

Using `option_` filter (not `update_option`) means:
- No DB write — fully reversible by removing the MU plugin
- WP admin Settings page shows overridden values — acceptable for local dev
- Zero footprint on sites without the plugin

---

## Capability Coverage

### GraphQL Operations

| Operation | Status | Notes |
|-----------|--------|-------|
| `find` — full text | **Full** | LanceDB FTS |
| `find` — `semanticSearch.searchBias` (0–10) | **Full** | Maps to vectorWeight 0.0–1.0 |
| `find` — `semanticSearch.fields` | **Full** | Scopes which fields are embedded |
| `find` — `filter` (field:value, range, exists) | **Partial** | Common fields handled; complex nested paths best-effort |
| `find` — `tolerance.fuzzy` | **Partial** | On/off only; `fuzzyDistance` not per-word |
| `find` — `tolerance.stemming` | **Full** | LanceDB FTS |
| `find` — `orderBy` (score, date, modified) | **Full** | score=default; date/modified in LanceDB schema |
| `find` — `limit`/`offset` | **Full** | |
| `find` — `searchAfter` cursor | **Partial** | Simulated with offset |
| `find` — `aggregate` (terms + ranges) | **Partial** | Computed post-query from result set |
| `find` — `geoConstraints` | **Stub** | Silently ignored |
| `find` — `timeDecay` | **Partial** | Post-hoc score weighting by post_date_gmt |
| `find` — `promotions` | **Full** | WP option read at query time |
| `find` — `customResults` | **Full** | WP option + query-time param |
| `find` — `queryRescorer` | **Stub** | Silently ignored |
| `find` — `includeFields`/`excludeFields` | **Full** | Filter data_json keys |
| `find` — `fields` (field weighting) | **Stub** | Silently ignored |
| `find` — response `data` (full document) | **Full** | From data_json |
| `find` — response `sort` | **Full** | [score, id] |
| `find` — response `aggregations` | **Partial** | Computed from result set |
| `index` | **Full** | ONNX embed + LanceDB upsert |
| `bulkIndex` | **Full** | Batch embed + upsert |
| `delete` | **Full** | Idempotent |
| `deleteAll` | **Full** | Truncate site table |
| `config.synonyms.rules` | **Full** | SQLite SynonymStore |
| `config.synonyms.rule(id)` | **Full** | |
| `config.synonyms.saveRule` | **Full** | |
| `config.synonyms.deleteRule` | **Full** | |
| `config.synonyms.deleteAllRules` | **Full** | |
| `config.semanticSearch` query | **Full** | SQLite SemanticConfig |
| `config.semanticSearch(fields)` mutation | **Full** | |
| `recommendations.trendingDocuments` | **Full** | doc_id frequency from tracker |
| `recommendations.relatedDocuments` | **Full** | LanceDB vector similarity by ref docID |
| `tracker.trackPageView` | **Full** | TrackerStore insert |
| `tracker.trackSearch` | **Full** | TrackerStore insert; feeds trending + insights |
| `tracker.trackSearchClick` | **Full** | TrackerStore insert; feeds CTR |
| `insights.searchTerms` | **Full** | Aggregated from tracker |
| `insights.searchTermsNoResults` | **Full** | result_count = 0 filter |
| `insights.siteAnalytics` | **Full** | Impressions + CTR per document_id |

### Modules & Features

| Feature | Status |
|---------|--------|
| WP lifecycle (save_post → index, delete_post → delete) | **Full** |
| ACF fields in data payload | **Full** |
| WP-CLI `wp wpe-smart-search sync-data` | **Full** |
| Promotions admin UI | **Full** |
| Custom Search Results admin UI | **Full** |
| Synonyms admin UI | **Full** |
| Smart Search MCP tools (`search`, `fetch`) | **Full** — added to existing MCP server |
| Block/Shortcode render | **Full** |
| Recommendations | **Full** |
| Insights analytics | **Full** |
| Smart Attachment (AI image/PDF) | **Out of scope** — cloud vision model required |
| ChatKit | **Redirect** — Local AI Gateway handles this path |
| Cookie Consent | **Unaffected** |

---

## Error Handling

All errors return HTTP 200 with a GraphQL error envelope (plugin expects this):

```json
{ "errors": [{ "message": "...", "extensions": { "code": "INTERNAL_ERROR" } }] }
```

| Scenario | Behavior |
|----------|----------|
| Unknown operation | 200 + GraphQL error "Unknown operation" |
| `EmbeddingService` not ready | Fall back to FTS-only (vectorWeight=0); log warning |
| LanceDB write failure | 200 + GraphQL error; log full stack |
| `index` with unparseable data | 200 + success:false with message |
| `tracker` missing required fields | 200 + success:false "missing session.id" |
| `find` on empty/unindexed site | 200 + `{ total: 0, documents: [] }` |
| `delete` on non-existent ID | 200 + success:true (idempotent) |
| `geoConstraints` present | Silently ignored; log debug |
| `queryRescorer` present | Silently ignored |

---

## Testing

### Unit (`tests/unit/smart-search/`)

- `SmartSearchHandler.test.ts` — operation routing, response shaping per spec
- `synonym-expansion.test.ts` — equivalents, one-way, multi-term, edge cases
- `filter-parser.test.ts` — filter string → WHERE clause
- `tracker-store.test.ts` — insert, 7-day TTL cleanup, trending aggregation
- `find-postprocess.test.ts` — timeDecay, promotions, customResults, aggregations

### Integration (`tests/integration/smart-search/`)

- Raw HTTP POST to `/smart-search/graphql` for each operation; assert response shape
- `index` → `find` round-trip
- Synonym round-trip: save rule → search with synonym → original doc found
- Tracker → `trendingDocuments` round-trip
- `deleteAll` → `find` returns empty

### Eval additions (`tests/evals/cases/`)

- M3 "find" moment cases using Smart Search backend
- Synonym-assisted discovery case

---

## Out of Scope

- Smart Attachment — cloud vision model, not emulatable
- ChatKit — redirect to Local AI Gateway (separate effort)
- Per-site indexing UI changes — existing "Index Site" flow already covers this
- Multisite — out of scope for v1; single-site only

---

## Implementation Notes

- All new code lives under `src/main/smart-search/`
- `HttpEventInterface.handleRequest()` gets one new route: `url.startsWith('/smart-search/graphql')`
- `SmartSearchHandler` is instantiated in `src/main/index.ts` alongside existing services
- LanceDB schema migration is additive (new nullable columns); no data loss
- The three new SQLite tables are created in `GraphService.initialize()` with `CREATE TABLE IF NOT EXISTS`
- Branch: `feature/smart-search-local-backend`

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
