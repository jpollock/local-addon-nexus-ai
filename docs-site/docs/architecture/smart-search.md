---
title: Smart Search Architecture
description: How Nexus AI implements the WP Engine Smart Search local backend
keywords: [smart-search, architecture, atlas-search, graphql, lancedb, onnx]
---

# Smart Search Architecture

Nexus AI acts as a local replacement for WPE's Smart Search cloud backend. The `atlas-search` plugin (WP Engine AI Toolkit) is redirected from WPE's cloud GraphQL endpoint to Nexus's local `HttpEventInterface` server — with no changes to the plugin itself.

## System Overview

Where Smart Search fits in the Nexus architecture:

```mermaid
graph TB
    subgraph WP ["WordPress Site (Local)"]
        WPCore[WordPress Core]
        Plugin[atlas-search plugin\nWP Engine AI Toolkit]
        MU[MU Plugin Filter\nnexus-ai-connector-config.php]
    end

    subgraph Nexus ["Nexus AI Addon"]
        direction TB
        HTTP["HttpEventInterface\n:13000"]

        subgraph SSH ["SmartSearchHandler"]
            direction LR
            Find[find]
            Write[index / bulkIndex\ndelete / deleteAll]
            Config[config\nsynonyms · semanticSearch]
            Track[tracker\nrecommendations\ninsights]
            Caps[capabilities]
        end

        subgraph Storage ["Storage Layer"]
            ONNX["EmbeddingService\nONNX all-MiniLM-L6-v2\n384 dimensions"]
            Lance["VectorStore\nLanceDB"]
            Sqlite["SQLite graph.db\nSynonyms · Tracker · Config"]
        end
    end

    WPCore -->|get_option| MU
    MU -->|returns 127.0.0.1:13000| Plugin
    Plugin -->|"POST /smart-search/graphql\nBearer token"| HTTP
    HTTP --> SSH
    Find --> ONNX --> Lance
    Find --> Sqlite
    Write --> ONNX --> Lance
    Config --> Sqlite
    Track --> Sqlite
```

## Request Flow: Search

End-to-end flow for a WordPress search query:

```mermaid
sequenceDiagram
    actor User
    participant WP as WordPress
    participant MU as MU Plugin Filter
    participant Plugin as atlas-search
    participant HTTP as HttpEventInterface
    participant Handler as SmartSearchHandler
    participant ONNX as EmbeddingService
    participant Lance as VectorStore (LanceDB)
    participant SQLite as SQLite

    User->>WP: Search "road trip planning"
    WP->>MU: get_option('wpe_content_engine_option_name')
    MU->>WP: {url: "http://127.0.0.1:13000/smart-search/graphql"}
    WP->>Plugin: Use local endpoint

    Plugin->>HTTP: POST /smart-search/graphql\nquery: find("road trip planning")
    HTTP->>Handler: detectOperation → "find"

    Handler->>SQLite: getSynonymRules(siteId)
    SQLite->>Handler: [] (no rules)

    Handler->>ONNX: embed("road trip planning")
    Note over ONNX: Generates 384-dim vector
    ONNX->>Handler: Float32Array[384]

    Handler->>Lance: search(siteId, vector, {limit, relevanceFloor: 0})
    Lance->>Handler: SearchResult[] sorted by cosine similarity

    Handler->>Handler: applyPostProcess\n(promotions, customResults,\nincludeFields, timeDecay)

    Handler->>HTTP: {data: {find: {total, documents}}}
    HTTP->>Plugin: 200 OK — document IDs + scores
    Plugin->>WP: Re-query WordPress by post IDs
    WP->>User: Search results
```

## Request Flow: Content Indexing

How content gets into the local index:

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant WPAdmin as WP Admin
    participant Plugin as atlas-search
    participant HTTP as HttpEventInterface
    participant Handler as SmartSearchHandler
    participant ONNX as EmbeddingService
    participant Lance as VectorStore (LanceDB)
    participant SQLite as SQLite

    Dev->>WPAdmin: WP Engine AI Toolkit → Sync
    WPAdmin->>Plugin: Trigger full index

    loop Each post batch (50–200 posts)
        Plugin->>HTTP: POST /smart-search/graphql\nmutation: bulkIndex([{id, data}])
        HTTP->>Handler: detectOperation → "bulkIndex"

        Handler->>SQLite: getSemanticConfig(siteId)
        SQLite->>Handler: {fields: ["post_title", "post_content"]}

        Handler->>ONNX: embedBatch(texts[])
        Note over ONNX: Concatenates configured fields\nGenerates one vector per doc
        ONNX->>Handler: Float32Array[] batch

        Handler->>Lance: upsert(siteId, [{id, vector,\ncontent, postType,\npost_date_gmt, metadata}])
    end

    Plugin->>Dev: Sync complete ✅
```

Real-time indexing uses the same `index` mutation path triggered by WordPress `save_post` hooks.

## Auto-Setup Flow

How Nexus configures a site automatically:

```mermaid
flowchart TD
    A([Site starts in Local]) --> B{Site has AI configured?\nSiteAIConfig entry exists}

    B -->|No| Z([Skip Smart Search setup])
    B -->|Yes| C{atlas-search files\non disk?}

    C -->|No| D["wp plugin install atlas-search\n--activate\n(from wordpress.org)"]
    D --> E{Install success?}
    E -->|No| F([Log skip message\nmanual install URL shown])
    E -->|Yes| G[detectAtlasSearch = true]
    C -->|Yes| G

    G --> H["Generate MU plugin\nnexus-ai-connector-config.php\nwith Smart Search endpoint"]
    H --> I([atlas-search routes to\nhttp://127.0.0.1:13000])

    style A fill:#4CAF50,color:#fff
    style I fill:#2196F3,color:#fff
    style F fill:#FF9800,color:#fff
    style Z fill:#9E9E9E,color:#fff
```

## MU Plugin Intercept

The WordPress option filter is the key to transparent redirection:

```mermaid
sequenceDiagram
    participant Plugin as atlas-search plugin
    participant WP as WordPress Options API
    participant MU as MU Plugin Filter
    participant Nexus as Nexus Endpoint

    Note over Plugin: Any atlas-search operation\n(search, sync, capabilities...)
    Plugin->>WP: get_option('wpe_content_engine_option_name')

    Note over WP,MU: option_wpe_content_engine_option_name\nfilter fires early in bootstrap
    WP->>MU: apply_filters(option, false)
    MU->>WP: {url: "http://127.0.0.1:13000/smart-search/graphql",\naccess_token: "{local-token}"}

    WP->>Plugin: Return overridden value
    Plugin->>Nexus: All requests go here\ninstead of WPE cloud

    Note over MU: This filter is excluded from\nWPE file pushes via .wpe-push-ignore\nProduction keeps its real WPE credentials
```

## Data Architecture

Where Smart Search data lives:

```mermaid
erDiagram
    LANCE_DB {
        string id PK "post:123 or wp_siteId_postId"
        float32_384 vector "ONNX embedding"
        string content "Embedded text (title + content)"
        string postType "post, page, custom"
        string post_date_gmt "ISO 8601"
        string post_modified_gmt "ISO 8601"
        string doc_url "Post permalink"
        string metadata "Full document JSON"
        string siteId "Site identifier"
        integer indexedAt "Unix ms"
    }

    SMART_SEARCH_SYNONYMS {
        string id PK
        string site_id FK
        string synonyms "laptop, notebook OR phone => smartphone"
        integer created_at
    }

    SMART_SEARCH_TRACKER {
        string id PK
        string site_id FK
        string event_type "page_view | search | search_click"
        string session_id
        string document_id
        string query
        integer result_count
        integer position
        integer created_at "7-day TTL"
    }

    SMART_SEARCH_SEMANTIC_CONFIG {
        string site_id PK
        string fields "JSON array of field names"
        string type "BASIC"
        integer updated_at
    }

    LANCE_DB ||--o{ SMART_SEARCH_SYNONYMS : "same siteId"
    LANCE_DB ||--o{ SMART_SEARCH_TRACKER : "document_id refs id"
    LANCE_DB ||--|| SMART_SEARCH_SEMANTIC_CONFIG : "determines embed fields"
```

## Capability Coverage

What the local backend supports vs WPE cloud:

```mermaid
graph LR
    subgraph Full ["✅ Full Support"]
        F1[find: full-text + semantic]
        F2[index / bulkIndex / delete]
        F3[capabilities]
        F4[synonyms CRUD]
        F5[tracker events]
        F6[recommendations: trending + related]
        F7[insights analytics]
        F8[promotions + custom results]
        F9[ACF field indexing]
        F10[semantic config]
    end

    subgraph Partial ["⚠️ Partial"]
        P1[aggregate / facets\npost-query only]
        P2[fuzzyDistance\non/off only]
        P3[searchBias\ngates embedding only]
        P4[timeDecay\napproximated]
        P5[searchAfter cursor\noffset simulation]
    end

    subgraph Stub ["🚫 Stubbed / Out of Scope"]
        S1[geoConstraints\nsilently ignored]
        S2[queryRescorer\nsilently ignored]
        S3[Smart Attachment\ncloud vision only]
        S4[ChatKit\nredirects to Local Gateway]
    end
```

## Related

- [Feature Overview](../features/smart-search/index.md) — what Smart Search is and how the intercept works
- [Getting Started](../features/smart-search/getting-started.md) — step-by-step setup
- [Local vs Cloud](../features/smart-search/limitations.md) — detailed behavior differences
- [Architecture Overview](overview.md) — where Smart Search fits in the full Nexus picture
- [Vector Database](vector-database.md) — LanceDB internals
