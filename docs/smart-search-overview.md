# Smart Search Locally — Overview

## What Is WP Engine Smart Search?

**WP Engine Smart Search** (part of the [WP Engine AI Toolkit](https://wpengine.com/support/ai-toolkit/)) is WP Engine's AI-powered search and recommendations product. It replaces WordPress's default keyword search with semantic understanding — finding relevant content even when the user's exact words don't appear in the text.

Key features:
- **Semantic / hybrid search** — understands meaning, not just keywords
- **Typo tolerance** — "roade" finds "road trip" content
- **Recommendations** — "you might also like" powered by vector similarity
- **Insights** — search analytics: what people search for, what returns no results
- **Synonyms** — "laptop" finds "notebook" content

Official docs: [wpengine.com/support/wp-engine-smart-search](https://wpengine.com/support/wp-engine-smart-search/)  
Developer API: [developers.wpengine.com/docs/ai-toolkit](https://developers.wpengine.com/docs/ai-toolkit)  
WordPress.org plugin: [wordpress.org/plugins/atlas-search](https://wordpress.org/plugins/atlas-search/)

---

## How It Normally Works (on WPE hosting)

```
┌──────────────────────────────────┐
│         WordPress Site            │
│  (hosted on WP Engine)           │
│                                  │
│  ┌────────────────────────────┐  │
│  │   WP Engine AI Toolkit     │  │
│  │   (atlas-search plugin)    │  │
│  └────────────┬───────────────┘  │
│               │ GraphQL POST      │
│               │ Authorization: Bearer {token}
└───────────────┼──────────────────┘
                │
                ▼
     ┌──────────────────────┐
     │  WPE Smart Search    │
     │     Cloud API        │
     │                      │
     │  • Vector index      │
     │  • AI embeddings     │
     │  • Recommendations   │
     │  • Analytics         │
     └──────────────────────┘
```

The plugin sends all search queries, content indexing, and tracker events to WPE's cloud. The cloud handles embedding generation, vector storage, and ranking. **Credentials are provisioned automatically** when Smart Search is enabled on a WPE plan.

---

## How It Works Locally (with Nexus AI)

When you're developing in Local, there's no WPE hosting connection. **Nexus AI acts as a local drop-in replacement** for WPE's cloud backend — running the same GraphQL API on your machine.

```
┌──────────────────────────────────────────────────────┐
│              WordPress Site (Local)                   │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │           WP Engine AI Toolkit                 │  │
│  │           (atlas-search plugin)                │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │ Reads endpoint URL from WP option
│  ┌────────────────────▼───────────────────────────┐  │
│  │        Nexus MU Plugin (auto-generated)        │  │
│  │  option_wpe_content_engine_option_name filter  │  │
│  │  → returns http://127.0.0.1:13000/smart-search │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
                        │
                        │ GraphQL POST /smart-search/graphql
                        │ Authorization: Bearer {local-token}
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│              Nexus AI Addon (Local addon)             │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │           SmartSearchHandler                  │    │
│  │                                               │    │
│  │  find ──────────► EmbeddingService (ONNX)    │    │
│  │                         │                    │    │
│  │                         ▼                    │    │
│  │                   VectorStore (LanceDB)       │    │
│  │                                               │    │
│  │  index/bulkIndex ──► embed + store            │    │
│  │  delete/deleteAll ──► remove                  │    │
│  │  synonyms ──────────► SQLite                  │    │
│  │  tracker ───────────► SQLite                  │    │
│  │  recommendations ───► tracker + vectors       │    │
│  │  insights ──────────► tracker aggregations    │    │
│  │  capabilities ──────► static list             │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  Storage:                                            │
│  • LanceDB (/nexus-ai/vectors/) — document vectors   │
│  • SQLite (/nexus-ai/graph.db)  — synonyms, tracker  │
│  • ONNX model (all-MiniLM-L6-v2-quantized, 384-dim)  │
└──────────────────────────────────────────────────────┘
```

**The plugin doesn't know it's talking to Nexus** — it sends the same GraphQL requests it would send to WPE cloud, and Nexus responds in the same shape.

---

## The MU Plugin Intercept

The key to making this transparent is a WordPress filter injected by Nexus's auto-generated MU plugin:

```
Plugin reads:  get_option('wpe_content_engine_option_name')
                         │
                         ▼
         MU Plugin filter fires (very early in WP bootstrap)
                         │
                         ▼
         Returns: { url: 'http://127.0.0.1:13000/smart-search/graphql',
                    access_token: '{local-token}' }
                         │
                         ▼
         Plugin uses Nexus endpoint — no code changes needed
```

This file (`wp-content/mu-plugins/nexus-ai-connector-config.php`) is auto-generated when your site starts. **It is excluded from WPE file pushes** via `.wpe-push-ignore` — so your production site keeps its real WPE credentials.

---

## Auto-Setup Flow

Here's what happens automatically when you work with a site in Local:

```
1. Site starts in Local
         │
         ▼
2. Nexus siteStarted hook fires
         │
         ├── Site has AI configured? (nexus ai setup was run)
         │         │
         │         ▼ YES
         │   atlas-search already installed?
         │         │
         │         ├── NO → wp plugin install atlas-search --activate
         │         │                    (from wordpress.org)
         │         │
         │         └── YES → continue
         │
         ▼
3. Nexus detects atlas-search files on disk
         │
         ▼
4. Generates MU plugin with Smart Search endpoint override
         │
         ▼
5. atlas-search plugin routes all traffic to Nexus

6. Developer syncs content: WP Admin → Smart Search → Sync
         │
         ▼
7. atlas-search sends bulkIndex mutations → Nexus embeds + stores in LanceDB

8. WordPress search now uses local semantic index ✅
```

---

## What Carries to Production

| Component | Local | WPE Production |
|-----------|-------|----------------|
| atlas-search plugin | auto-installed by Nexus | auto-provisioned by WPE |
| Backend endpoint | `http://127.0.0.1:13000` (Nexus) | WPE Smart Search cloud |
| Credentials | Local token (Nexus-generated) | WPE-provisioned credentials |
| Vector index | LanceDB on your Mac | WPE managed cloud index |
| MU plugin | Auto-generated, excluded from push | Not present (WPE manages config) |
| Synonyms / tracker data | Local SQLite | WPE cloud (separate) |

When you push to WPE:
1. Plugin files push normally
2. MU plugin is excluded (`.wpe-push-ignore`)  
3. WPE re-provisions credentials automatically
4. A full sync re-indexes content into WPE's cloud index

---

## Further Reading

- [Getting Started Guide](./smart-search-getting-started.md) — step-by-step setup
- [Known Limitations](./smart-search-limitations.md) — where local differs from cloud
- [WPE Smart Search Docs](https://wpengine.com/support/wp-engine-smart-search/) — official product docs
- [Smart Search Public API](https://developers.wpengine.com/docs/ai-toolkit/smart-search/find-api/) — GraphQL reference
- [Technical Design Spec](./superpowers/specs/2026-05-08-smart-search-local-backend-design.md) — implementation internals
