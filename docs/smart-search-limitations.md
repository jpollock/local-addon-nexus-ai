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

## Out of Scope (not implemented locally)

- **Smart Attachment** — AI image/PDF analysis requires WPE cloud vision models
- **ChatKit** — redirect to Local AI Gateway for conversational AI
- **Semantic Search Config type** — always returns `BASIC`; `ADVANCED` type configuration is accepted and stored but has no behavioral effect
