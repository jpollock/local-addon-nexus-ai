---
title: Smart Search — Local vs Cloud
description: Where Nexus's local Smart Search backend differs from WPE's cloud
keywords: [smart-search, limitations, local-development, differences]
---

# Smart Search — Local vs Cloud

Nexus provides a high-fidelity local replacement for WPE Smart Search, but some features work differently or are not yet supported.

## Search Behavior

### `searchBias` gates embedding only — not result weighting

The `semanticSearch.searchBias` parameter (0–10) controls the blend between keyword and semantic search in the cloud. Locally, it only determines whether an embedding is generated:

- **`searchBias = 0`** → FTS-only, no embedding
- **`searchBias > 0`** → semantic vector generated and used

The actual blending between vector score and FTS score is handled internally by LanceDB and cannot be controlled per-query.

### `fuzzyDistance` is on/off, not per-word

`tolerance: { name: "fuzzy", fuzzyDistance: 2 }` is accepted but `fuzzyDistance` is ignored. LanceDB FTS doesn't expose per-word character distance. Typo tolerance works through semantic embeddings instead — which often produces better results anyway.

### Geographic search is silently ignored

`geoConstraints` in `find` queries has no effect locally. LanceDB is a vector database, not a geo-search engine. Queries still return results, just without geographic filtering.

### `queryRescorer` is silently ignored

The re-ranking parameter is accepted but not applied. Results are ranked by LanceDB's hybrid scoring.

### Field weighting is ignored

Per-field relevance boost (`fields`, `options.fields.types`) is not supported. All indexed fields contribute equally to FTS scoring.

## Aggregations

`aggregate.terms` and `aggregate.ranges` are computed post-query from the returned result set rather than from a pre-built index:

- Facet counts reflect only documents returned by the search, not the full corpus
- Performance degrades with large result sets

## Pagination

`searchAfter` cursor-based pagination is simulated with `offset`. At large page depths this gets slower (offset scans all prior results).

## Recommendations

### `relatedDocuments` accuracy

The local ONNX model (`all-MiniLM-L6-v2-quantized`, 384 dimensions) produces different vectors than WPE's cloud model. Related document rankings may differ from production.

### `trendingDocuments` retention: 7 days

Tracker events older than 7 days are purged on Nexus startup — matching the cloud API's retention policy.

## Synonyms

Synonyms are applied via query string expansion before embedding and FTS. The cloud applies synonyms at the index analysis layer, which can produce subtly different results for phrase queries.

## Out of Scope

These features require WPE cloud infrastructure and are not available locally:

| Feature | Reason |
|---------|--------|
| Smart Attachment (image/PDF AI analysis) | Requires WPE cloud vision models |
| ChatKit | Redirect to Local AI Gateway instead |
| Semantic Search Config type `ADVANCED` | Accepted and stored, no behavioral effect |

## Reporting Issues

If you find a case where local behavior differs significantly from production, [open an issue](https://github.com/jpollock/local-addon-nexus-ai/issues).
