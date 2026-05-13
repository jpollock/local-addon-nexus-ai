---
title: WP Engine Smart Search — Locally
description: How Nexus AI makes WP Engine Smart Search work in Local without a WPE hosting connection
keywords: [smart-search, ai-toolkit, atlas-search, semantic-search, local-development, wpe]
---

# WP Engine Smart Search — Locally

Nexus AI makes **WP Engine Smart Search** work in Local by acting as a local drop-in for WPE's cloud backend — running the same GraphQL API on your machine using LanceDB and ONNX embeddings.

## What Is WP Engine Smart Search?

[WP Engine Smart Search](https://wpengine.com/support/wp-engine-smart-search/) (part of the [WP Engine AI Toolkit](https://developers.wpengine.com/docs/ai-toolkit)) replaces WordPress's default keyword search with semantic understanding.

Key capabilities:

- **Semantic / hybrid search** — finds relevant content even when the exact words don't appear
- **Typo tolerance** — "roade" finds "road trip" content
- **Recommendations** — "you might also like" powered by vector similarity  
- **Insights** — what people search for, what returns no results
- **Synonyms** — "laptop" finds "notebook" content
- **ACF field indexing** — custom fields are searchable

## How It Normally Works (WPE Hosting)

```
WordPress Site (WPE hosted)
    └── WP Engine AI Toolkit plugin
            └── POST /graphql → WPE Smart Search Cloud
                    ├── Vector index + AI embeddings
                    ├── Recommendations engine
                    └── Analytics
```

The plugin sends all queries and content to WPE's cloud. Credentials are provisioned automatically when Smart Search is enabled on a WPE plan.

## How Nexus Makes It Work Locally

```
WordPress Site (Local)
    └── WP Engine AI Toolkit plugin
            └── Reads endpoint from WP option
    
    ← Nexus MU Plugin filter intercepts option read →
            Returns: http://127.0.0.1:13000/smart-search/graphql
    
            └── POST /smart-search/graphql → Nexus AI
                    ├── ONNX embeddings (all-MiniLM-L6-v2, local)
                    ├── LanceDB vector store (local)
                    └── SQLite (synonyms, tracker, config)
```

**The plugin doesn't know it's talking to Nexus.** It sends the same GraphQL it would send to WPE cloud, and Nexus responds in the same shape.

### The MU Plugin Intercept

```
Plugin calls:  get_option('wpe_content_engine_option_name')
                         │
              MU Plugin filter fires (early WP bootstrap)
                         │
              Returns: { url: 'http://127.0.0.1:13000/smart-search/graphql',
                          access_token: '{local-token}' }
                         │
              Plugin uses Nexus — no code changes needed
```

The MU plugin (`nexus-ai-connector-config.php`) is auto-generated when your site starts. It is **excluded from WPE file pushes** via `.wpe-push-ignore` so production keeps its real WPE credentials.

## Auto-Setup Flow

```
1. Site starts in Local
         │
2. Nexus detects atlas-search files on disk
         │
         ├── Site has AI config but NO atlas-search?
         │         └── Auto-installs from wordpress.org
         │
3. Nexus generates MU plugin with Smart Search endpoint
         │
4. atlas-search routes all traffic to Nexus
         │
5. Developer syncs content (WP Admin → Smart Search → Sync)
         │
6. atlas-search sends bulkIndex → Nexus embeds + stores in LanceDB
         │
7. WordPress search uses local semantic index ✅
```

## What Works Locally

| Feature | Status |
|---------|--------|
| Full-text search | ✅ Full |
| Semantic / hybrid search | ✅ Full |
| Typo tolerance | ✅ Full |
| Synonyms | ✅ Full |
| Recommendations (related) | ✅ Full |
| Recommendations (trending) | ✅ Full |
| Tracker (views, clicks, searches) | ✅ Full |
| Insights analytics | ✅ Full |
| Promotions / custom results | ✅ Full |
| ACF field indexing | ✅ Full |
| Aggregations / facets | ⚠️ Post-query |
| Geographic search | ⚠️ Ignored |

See [Known Limitations](limitations.md) for details on partial support.

## What Carries to Production

| | Local (Nexus) | WPE Production |
|--|---------------|----------------|
| Backend | `127.0.0.1:13000` | WPE Smart Search cloud |
| Credentials | Local token | WPE-provisioned |
| Vector index | LanceDB on your Mac | WPE managed cloud |
| MU plugin | Auto-generated, excluded from push | Not present |
| Synonyms / tracker | Local SQLite | WPE cloud |

## Further Reading

- [Getting Started](getting-started.md) — step-by-step setup
- [Known Limitations](limitations.md) — where local differs from cloud
- [WPE Smart Search Docs](https://wpengine.com/support/wp-engine-smart-search/) — official product docs
- [Smart Search API Reference](https://developers.wpengine.com/docs/ai-toolkit/smart-search/find-api/) — GraphQL reference
