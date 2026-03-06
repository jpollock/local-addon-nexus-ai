# local-addon-nexus-ai: Implementation Plan

**Date:** 2026-02-28 (updated 2026-03-02)
**Status:** Phases 1–9 complete, Phase 11 in progress (Phase 10 deferred)
**Prerequisite reading:** `pm-work/local-ai-vision.md`, `pm-work/spike-results.md`

---

## Table of Contents

1. [V1 Scope](#v1-scope)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Implementation Phases](#implementation-phases)
5. [Phase 1: Foundation](#phase-1-foundation) ✅
6. [Phase 2: Content Pipeline](#phase-2-content-pipeline) ✅
7. [Phase 3: MCP Server](#phase-3-mcp-server) ✅
8. [Phase 4: Deep Content Intelligence](#phase-4-deep-content-intelligence) ✅
9. [Phase 5: Richer Structure Layer](#phase-5-richer-structure-layer) ✅
10. [Phase 6: Fleet Intelligence](#phase-6-fleet-intelligence) ✅
11. [Phase 7: Search Quality & MCP-CLI Subsumption](#phase-7-search-quality--mcp-cli-subsumption) ✅
12. [Phase 8: Instructions, Resources & Composite Tools](#phase-8-instructions-resources--composite-tools) ✅
13. [Phase 9: Ollama Integration (Tier 3)](#phase-9-ollama-integration-tier-3) ✅
14. [Phase 10: Local UI](#phase-10-local-ui)
15. [Phase 11: Polish & Distribution](#phase-11-polish--distribution)
15. [Build System](#build-system)
16. [Testing Strategy](#testing-strategy)
17. [CI/CD Pipeline](#cicd-pipeline)
18. [Risk Register](#risk-register)
19. [Out of Scope (V1)](#out-of-scope-v1)

---

## V1 Scope

### What Ships

**Tier 1 — Runs everywhere, zero external dependencies:**
- Embedded LanceDB vector store (per-site table isolation, fleet-wide instance)
- Bundled ONNX Runtime + all-MiniLM-L6-v2 embedding model (CPU-only, 384 dimensions)
- Direct MySQL content extraction (posts, pages, custom post types, metadata)
- File-based structural scanning (themes, plugins, configuration)
- Automatic indexing on site start, incremental re-index on content change
- MCP server exposing semantic search, site context, and fleet intelligence tools
- Local UI panel: per-site index status, fleet overview, settings

**Tier 3 — Optional, detect-and-integrate:**
- Ollama detection via `localhost:11434/api/tags`
- Model listing and hardware-aware recommendations
- Chat completion proxied through MCP tools
- "Install Ollama" prompt with link when not detected

### What Does NOT Ship in V1

- Tier 2 (WP Engine Cloud AI Gateway) — requires backend API work
- Tier 4 (BYOK API keys) — deferred until Gateway exists
- AI agents / autonomous workflows
- Content pipelines
- WordPress plugin (WP Admin surface)
- Cross-site intelligence (fleet-wide semantic queries)
- Observability dashboard
- Evals / testing framework

### Key Architectural Decision: In-Process, Not Per-Site

The existing `local-ai-sandbox` and `local-addon-vectordb` addons spawn a **separate Node.js process per site** (Fastify server). Nexus AI takes a fundamentally different approach:

**Everything runs in Electron's main process.** LanceDB, ONNX Runtime, the embedding model, content extraction, and the MCP server are all library code loaded via `require()`. No child processes, no per-site servers, no port management.

Why this matters:
- Zero additional OS processes (the core Tier 1 promise)
- One LanceDB connection, one ONNX session, shared across all sites
- Simpler lifecycle: starts when Local starts, stops when Local stops
- Lower resource footprint (~200 MB total vs. ~200 MB per site)
- The MCP server is the only network listener (one port, fleet-wide)

The only external process is Tier 3 Ollama, which the addon detects but does not manage.

---

## Architecture

### System Architecture

```
+------------------------------------------------------------------+
|  Electron Main Process (Local)                                    |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |  local-addon-nexus-ai                                       |  |
|  |                                                             |  |
|  |  +------------------+  +------------------+                 |  |
|  |  |  EmbeddingService|  |  VectorStore     |                 |  |
|  |  |  (ONNX Runtime)  |  |  (LanceDB)       |                 |  |
|  |  |                  |  |                  |                 |  |
|  |  |  all-MiniLM-L6-v2|  |  site_{id}_posts |                 |  |
|  |  |  384 dims, CPU   |  |  site_{id}_pages |                 |  |
|  |  |  5ms/doc         |  |  site_{id}_meta  |                 |  |
|  |  +--------+---------+  +--------+---------+                 |  |
|  |           |                      |                          |  |
|  |  +--------v----------------------v---------+                |  |
|  |  |  ContentPipeline                        |                |  |
|  |  |                                         |                |  |
|  |  |  MySQLExtractor  FileScanner  Indexer   |                |  |
|  |  +--------+-------------------+-----------+                 |  |
|  |           |                   |                             |  |
|  |  +--------v-------------------v-----------+                 |  |
|  |  |  McpServer (HTTP, one port)            |                 |  |
|  |  |                                         |                |  |
|  |  |  Tools:                                 |                |  |
|  |  |    search_site_content                  |                |  |
|  |  |    get_site_context                     |                |  |
|  |  |    list_indexed_sites                   |                |  |
|  |  |    get_index_status                     |                |  |
|  |  |    reindex_site                         |                |  |
|  |  |    ask_ollama (Tier 3)                  |                |  |
|  |  |    list_ollama_models (Tier 3)          |                |  |
|  |  +--------+-------------------------------+                |  |
|  |           |                                                 |  |
|  |  +--------v-------------------------------+                 |  |
|  |  |  OllamaClient (Tier 3, detect-only)    |                |  |
|  |  |  HTTP to localhost:11434               |                 |  |
|  |  +----------------------------------------+                 |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  Local Core Services (accessed via ServiceContainer)              |
|  - siteData, siteProcessManager, localLogger, userData            |
+------------------------------------------------------------------+

External:
  +-------------------+      +-------------------+
  |  Claude Code /    | MCP  |  Site MySQL        |
  |  Cursor / Claude  +----->+  (socket conn)     |
  |  (AI clients)     |      |  per-site DB       |
  +-------------------+      +-------------------+

  +-------------------+
  |  Ollama           |  (optional, user-managed)
  |  localhost:11434  |
  +-------------------+
```

### Data Flow: Indexing

```
Site starts (siteStarted hook)
       |
       v
[1] FileScanner.scan(site)
    - Reads wp-content/themes/*, wp-content/plugins/*
    - Produces: ThemeInfo[], PluginInfo[], SiteStructure
    - No services required (file system only)
       |
       v
[2] MySQLExtractor.extract(site)
    - Connects via socket: ~/Library/Application Support/Local/run/{siteId}/mysql/mysqld.sock
    - Queries: wp_posts (published), wp_postmeta, wp_options
    - Strips HTML, Gutenberg block comments
    - Produces: Document[] (id, title, content, type, metadata)
       |
       v
[3] EmbeddingService.embedBatch(documents)
    - ONNX Runtime session (loaded once, reused)
    - Tokenize + infer, 384-dim vectors
    - 5ms/doc, 184 docs/sec
       |
       v
[4] VectorStore.upsert(siteId, documents)
    - LanceDB table: site_{siteId}_content
    - Upsert by document ID (handles re-indexing)
    - Stores: embedding, content, metadata JSON
       |
       v
[5] IndexRegistry.update(siteId, stats)
    - Tracks: last indexed, doc count, duration
    - Persisted in userData
```

### Data Flow: MCP Search Query

```
AI Client sends MCP tools/call: search_site_content
  { site: "mysite", query: "WooCommerce payment gateway", limit: 5 }
       |
       v
[1] McpServer.handleToolCall()
    - Validates input
    - Resolves site by name or ID (fuzzy match)
       |
       v
[2] EmbeddingService.embed(query)
    - Single embedding, ~5ms
       |
       v
[3] VectorStore.search(siteId, queryVector, { limit: 5 })
    - LanceDB vector similarity search
    - Returns: scored documents with content + metadata
       |
       v
[4] Format response with context
    - Document titles, excerpts, relevance scores
    - Site structural context (themes, plugins)
    - Return as MCP tool result
```

### Component Dependency Graph

```
                    AddonEntry (src/main/index.ts)
                         |
          +--------------+--------------+
          |              |              |
    IpcHandlers    LifecycleHooks   McpServer
          |              |              |
          +---------+----+----+---------+
                    |         |
              ContentPipeline |
              |    |    |     |
     MySQLExtractor |  FileScanner
              |    |          |
        EmbeddingService  VectorStore
              |               |
        (onnxruntime-node)  (@lancedb/lancedb)
```

---

## Project Structure

```
local-addon-nexus-ai/
├── src/
│   ├── main/
│   │   ├── index.ts                    # Addon entry point, lifecycle
│   │   ├── ipc-handlers.ts             # Electron IPC handler registration
│   │   ├── lifecycle-hooks.ts          # Site start/stop/add/delete hooks
│   │   │
│   │   ├── vector-store/
│   │   │   ├── VectorStore.ts          # LanceDB wrapper, per-site tables
│   │   │   └── schema.ts              # Table schema definitions
│   │   │
│   │   ├── embeddings/
│   │   │   ├── EmbeddingService.ts     # ONNX Runtime session management
│   │   │   └── tokenizer.ts           # Text tokenization + chunking
│   │   │
│   │   ├── content/
│   │   │   ├── ContentPipeline.ts      # Orchestrates extraction + indexing
│   │   │   ├── MySQLExtractor.ts       # Direct MySQL content extraction
│   │   │   ├── FileScanner.ts          # Theme/plugin/config scanning
│   │   │   ├── html-cleaner.ts         # HTML/Gutenberg block stripping
│   │   │   └── IndexRegistry.ts        # Per-site index state tracking
│   │   │
│   │   ├── mcp/
│   │   │   ├── McpServer.ts            # HTTP server, MCP protocol handler
│   │   │   ├── McpAuth.ts              # Token-based authentication
│   │   │   ├── tools/                  # MCP tool implementations
│   │   │   │   ├── index.ts            # Tool registry
│   │   │   │   ├── search.ts           # search_site_content
│   │   │   │   ├── context.ts          # get_site_context
│   │   │   │   ├── indexing.ts         # reindex_site, get_index_status
│   │   │   │   ├── fleet.ts            # list_indexed_sites
│   │   │   │   └── ollama.ts           # ask_ollama, list_ollama_models
│   │   │   └── transport/
│   │   │       └── stdio-bridge.js     # stdio-to-HTTP bridge for Claude Code
│   │   │
│   │   └── ollama/
│   │       ├── OllamaClient.ts         # HTTP client for Ollama REST API
│   │       └── ModelRecommender.ts     # Hardware-aware model suggestions
│   │
│   ├── renderer/
│   │   ├── index.tsx                   # Renderer entry, hook registration
│   │   └── components/
│   │       ├── NexusPanel.tsx          # Main site panel (index status, actions)
│   │       ├── FleetOverview.tsx       # Fleet-wide AI status (preferences)
│   │       ├── OllamaStatus.tsx        # Tier 3 status + model recommendations
│   │       └── McpConnectionInfo.tsx   # MCP connection details for AI clients
│   │
│   └── common/
│       ├── types.ts                    # Shared TypeScript interfaces
│       ├── constants.ts                # IPC channels, MCP tool names, config keys
│       └── validation.ts              # Zod schemas for IPC + MCP inputs
│
├── models/
│   └── all-MiniLM-L6-v2-quantized/
│       └── model.onnx                 # 22 MB quantized embedding model
│
├── bin/
│   └── mcp-stdio.js                   # stdio bridge entry point
│
├── tests/
│   ├── main/
│   │   ├── vector-store.test.ts
│   │   ├── embedding-service.test.ts
│   │   ├── mysql-extractor.test.ts
│   │   ├── file-scanner.test.ts
│   │   ├── content-pipeline.test.ts
│   │   ├── mcp-server.test.ts
│   │   ├── mcp-tools.test.ts
│   │   ├── ollama-client.test.ts
│   │   ├── ipc-handlers.test.ts
│   │   └── lifecycle-hooks.test.ts
│   ├── integration/
│   │   ├── index-and-search.int.test.ts
│   │   └── mcp-protocol.int.test.ts
│   ├── __mocks__/
│   │   ├── local-main.ts
│   │   ├── electron.ts
│   │   ├── onnxruntime-node.ts
│   │   └── lancedb.ts
│   ├── fixtures/
│   │   ├── wordpress-posts.json        # Sample post content
│   │   ├── site-structure/             # Sample wp-content tree
│   │   └── embeddings.json             # Pre-computed test embeddings
│   └── setup.ts
│
├── scripts/
│   ├── create-entry-points.js          # Build: generate lib/main.js, lib/renderer.js
│   ├── strip-platforms.sh              # CI: remove non-target ONNX binaries
│   ├── package-addon.js                # CI: create platform-specific .tgz
│   └── verify-native-modules.js        # CI: verify .node files load
│
├── package.json
├── tsconfig.json
├── jest.config.js
├── .eslintrc.js
├── THIRD_PARTY_LICENSES.md
└── README.md
```

---

## Implementation Phases

### Overview

```
Phase 1: Foundation ✅       Phase 2: Content ✅     Phase 3: MCP ✅
(project setup, vector       (MySQL extraction,      (MCP server, tools,
store, embeddings)           file scan, indexing)     auth, stdio bridge)
  ~~~~~~~~~~~~~                ~~~~~~~~~~~~~            ~~~~~~~~~~~~~
  [  Complete  ] --------->  [  Complete  ] ------->  [  Complete  ]
                                                            |
                                                            v
Phase 4: Deep Content        Phase 5: Structure      Phase 6: Fleet
(WooCommerce, ACF,           (DB-backed detection,   (cross-site queries,
custom tables, media)        users, REST routes)     drift, comparison)
  ~~~~~~~~~~~~~                ~~~~~~~~~~~~~            ~~~~~~~~~~~~~
  [  Complete  ] --------->  [  Complete  ] ------->  [  Complete  ]
                                                            |
                                                            v
Phase 7: Search + MCP-CLI    Phase 8: Instructions   Phase 9: Ollama
(cosine similarity, score    (server instructions,   (detection, client,
normalization, 46 tools)     resources, composites)  model recs, chat)
  ~~~~~~~~~~~~~                ~~~~~~~~~~~~~            ~~~~~~~~~~~~~
  [  Complete  ] --------->  [  Complete  ] ------->  [  Planned   ]
                                                            |
                                                            v
                             Phase 10: Local UI      Phase 11: Polish
                             (site panel, fleet      (testing, CI/CD,
                             view, MCP info)         packaging, docs)
                               ~~~~~~~~~~~~~            ~~~~~~~~~~~~~
                             [  Deferred   ]         [  Deferred   ]
```

Each phase has:
- Specific deliverables (testable, demoable)
- Acceptance criteria
- Test requirements

---

## Phase 1: Foundation

### Objective
Project scaffolding, LanceDB integration in-process, ONNX embedding service loaded and working. By end of phase: you can embed a string and store/query vectors from a test harness.

### 1.1 Project Scaffolding

**Create the addon project following kitchen-sink patterns:**

```json
// package.json
{
  "name": "local-addon-nexus-ai",
  "productName": "Nexus AI",
  "version": "0.1.0",
  "main": "lib/main.js",
  "renderer": "lib/renderer.js",
  "localAddon": {
    "minimumLocalVersion": "9.0.0",
    "type": "addon",
    "category": "developer-tools"
  },
  "scripts": {
    "build": "npm run clean && npm run compile && npm run create-entry-points",
    "compile": "tsc -p .",
    "create-entry-points": "node scripts/create-entry-points.js",
    "clean": "rm -rf lib",
    "watch": "tsc -p . --watch",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@lancedb/lancedb": "^0.13.0",
    "onnxruntime-node": "^1.20.0",
    "mysql2": "^3.11.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@getflywheel/local": "^6.0.0",
    "@getflywheel/local-components": "^16.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.3.3",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "peerDependencies": {
    "@getflywheel/local": "*",
    "electron": "*",
    "react": "*",
    "react-dom": "*"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020", "DOM"],
    "jsx": "react",
    "outDir": "./lib",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "lib", "tests", "scripts"]
}
```

**Entry point stubs:**

```typescript
// src/main/index.ts
export default function main(context: LocalMain.AddonMainContext): void {
  const { localLogger } = LocalMain.getServiceContainer().cradle;
  localLogger.info('[NexusAI] Addon loading...');
  // Phase 1: Initialize foundation services
  // Phase 2: Register lifecycle hooks
  // Phase 3: Start MCP server
}
```

```typescript
// src/renderer/index.tsx
export default function renderer(context: any): void {
  // Phase 4: Register UI components
}
```

**Deliverables:**
- [x] Project compiles with `npm run build`
- [x] Addon loads in Local without errors (symlink to `~/.config/Local/addons/`)
- [x] `localLogger.info('[NexusAI] Addon loaded')` appears in Local logs

### 1.2 VectorStore (LanceDB)

**File:** `src/main/vector-store/VectorStore.ts`

```typescript
// Key interface
interface VectorStore {
  initialize(): Promise<void>;
  upsert(siteId: string, documents: VectorDocument[]): Promise<void>;
  search(siteId: string, queryVector: number[], options: SearchOptions): Promise<SearchResult[]>;
  delete(siteId: string, documentIds: string[]): Promise<void>;
  dropSite(siteId: string): Promise<void>;
  getSiteStats(siteId: string): Promise<SiteIndexStats>;
  listSites(): Promise<string[]>;
  close(): Promise<void>;
}

// Table naming: site_{siteId}_content
// One LanceDB connection, many tables
// DB path: {userData}/nexus-ai/vectors/
```

**Schema:**

```typescript
// src/main/vector-store/schema.ts
interface VectorDocument {
  id: string;               // wp_{siteId}_{postId}
  siteId: string;
  content: string;          // Cleaned text
  title: string;
  postType: string;         // post, page, custom
  postId: number;
  vector: Float32Array;     // 384 dimensions
  metadata: string;         // JSON: { excerpt, author, date, categories, tags, ... }
  indexedAt: number;        // Unix timestamp
}
```

**Design decisions:**
- One LanceDB database directory, one table per site (`site_{siteId}_content`)
- Upsert by document ID (delete + insert, since LanceDB doesn't have native upsert)
- Database path: `{Local userData}/nexus-ai/vectors/`
- Connection opened lazily on first use, closed on addon deactivate

**Tests:**
- Creates table, inserts documents, queries by vector similarity
- Multi-site isolation: site A's documents don't appear in site B's queries
- Upsert overwrites existing documents
- Drop site removes table
- Stats return correct counts

### 1.3 EmbeddingService (ONNX Runtime)

**File:** `src/main/embeddings/EmbeddingService.ts`

```typescript
interface EmbeddingService {
  initialize(modelPath: string): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  isReady(): boolean;
  close(): Promise<void>;
}
```

**Implementation details:**
- ONNX Runtime `InferenceSession` created once, reused for all embeddings
- Model path: `{addonPath}/models/all-MiniLM-L6-v2-quantized/model.onnx`
- Tokenization: simple whitespace + subword tokenizer (the model's tokenizer.json)
- Input: `input_ids`, `attention_mask`, `token_type_ids` (Int64 tensors)
- Output: mean pooling of last hidden state → L2 normalize → 384-dim vector
- Max sequence length: 256 tokens (truncate longer texts)

**Tokenizer approach:**
The all-MiniLM-L6-v2 model requires a WordPiece tokenizer. Two options:
1. **Bundle tokenizer.json** and implement WordPiece tokenization in TypeScript (~200 lines)
2. **Use a lightweight tokenizer library** (e.g., `tokenizers` via WASM or a minimal implementation)

Recommendation: implement a minimal WordPiece tokenizer. The vocabulary is fixed (30,522 tokens), and the tokenization algorithm is well-documented. This avoids adding another native dependency.

**Tests:**
- Model loads and produces 384-dim vectors
- Same text produces same embedding (deterministic)
- Different texts produce different embeddings
- Cosine similarity between related texts > unrelated texts
- Batch embedding produces same results as individual
- Handles edge cases: empty string, very long text (truncation), unicode

### Phase 1 Acceptance Criteria

- [x] `VectorStore` creates per-site tables, inserts, queries, deletes
- [x] `EmbeddingService` loads model, produces 384-dim embeddings in ~5ms
- [x] End-to-end: embed text → store in LanceDB → query by vector similarity → get ranked results
- [x] All unit tests pass
- [x] Addon loads in Local without errors

---

## Phase 2: Content Pipeline

### Objective
Extract WordPress content from running sites, generate embeddings, index in LanceDB. Automatic on site start.

### 2.1 MySQLExtractor

**File:** `src/main/content/MySQLExtractor.ts`

```typescript
interface MySQLExtractor {
  extract(site: LocalSite): Promise<ExtractedContent>;
  isAvailable(site: LocalSite): boolean;
}

interface ExtractedContent {
  posts: ExtractedPost[];
  siteInfo: { name: string; url: string; wpVersion: string };
  extractedAt: number;
}

interface ExtractedPost {
  id: number;
  title: string;
  content: string;          // Raw from DB
  cleanedContent: string;   // HTML/blocks stripped
  excerpt: string;
  postType: string;
  postStatus: string;
  author: string;
  date: string;
  categories: string[];
  tags: string[];
  customFields: Record<string, string>;
}
```

**Connection strategy:**
- Socket path: `~/Library/Application Support/Local/run/{siteId}/mysql/mysqld.sock`
- Credentials from `sites.json`: `site.services.mysql.database`, `.user`, `.password`
- Table prefix from `wp-config.php` or default `wp_`
- Use `mysql2` package with promise API
- Connection opened per extraction, closed after

**Queries:**
```sql
-- Posts and pages
SELECT ID, post_title, post_content, post_excerpt, post_type, post_status,
       post_date, post_author
FROM {prefix}posts
WHERE post_status = 'publish'
  AND post_type IN ('post', 'page', {custom_post_types})

-- Post metadata (ACF fields, custom fields)
SELECT post_id, meta_key, meta_value
FROM {prefix}postmeta
WHERE post_id IN (...)
  AND meta_key NOT LIKE '\_%'  -- skip internal meta

-- Categories and tags
SELECT t.name, tt.taxonomy, tr.object_id
FROM {prefix}terms t
JOIN {prefix}term_taxonomy tt ON t.term_id = tt.term_id
JOIN {prefix}term_relationships tr ON tt.term_taxonomy_id = tr.term_taxonomy_id
WHERE tr.object_id IN (...)

-- Site info
SELECT option_value FROM {prefix}options
WHERE option_name IN ('siteurl', 'blogname', 'blogdescription')
```

**Custom post type discovery:**
```sql
SELECT DISTINCT post_type FROM {prefix}posts
WHERE post_status = 'publish' AND post_type NOT IN ('revision', 'nav_menu_item', 'attachment', 'wp_template', 'wp_template_part', 'wp_global_styles', 'wp_navigation', 'wp_font_face', 'wp_font_family', 'oembed_cache', 'custom_css', 'customize_changeset')
```

### 2.2 HTML Cleaner

**File:** `src/main/content/html-cleaner.ts`

```typescript
function cleanWordPressContent(raw: string): string {
  // 1. Remove Gutenberg block comments: <!-- wp:paragraph --> ... <!-- /wp:paragraph -->
  // 2. Strip HTML tags
  // 3. Decode HTML entities (&amp; → &, etc.)
  // 4. Collapse whitespace
  // 5. Trim
}
```

This was validated in Spike 3 — the function from the benchmark produces clean text from Gutenberg block content. Port the working implementation directly.

### 2.3 FileScanner

**File:** `src/main/content/FileScanner.ts`

```typescript
interface FileScanner {
  scan(sitePath: string): Promise<SiteStructure>;
}

interface SiteStructure {
  themes: ThemeInfo[];          // active + installed
  plugins: PluginInfo[];        // active + installed
  phpVersion: string;
  wpVersion: string;
  isMultisite: boolean;
  hasWooCommerce: boolean;
  hasACF: boolean;
}

interface ThemeInfo {
  name: string;
  slug: string;
  version: string;
  isActive: boolean;
  isChildTheme: boolean;
  parentTheme?: string;
}

interface PluginInfo {
  name: string;
  slug: string;
  version: string;
  isActive: boolean;
  description: string;
}
```

**Implementation:**
- Read `wp-content/themes/*/style.css` for theme metadata
- Read `wp-content/plugins/*/` directory, parse main PHP file headers
- Read `wp-config.php` for multisite detection
- Active theme: read from `wp_options` table (if MySQL available) or from file heuristics
- Active plugins: read from `wp_options` table `active_plugins` option

This runs on all sites, regardless of running state (file system only). MySQL queries are optional enhancements when the DB is available.

### 2.4 ContentPipeline (Orchestrator)

**File:** `src/main/content/ContentPipeline.ts`

```typescript
interface ContentPipeline {
  indexSite(site: LocalSite): Promise<IndexResult>;
  reindexSite(site: LocalSite): Promise<IndexResult>;
  removeSite(siteId: string): Promise<void>;
  getStatus(siteId: string): IndexStatus;
}

interface IndexResult {
  siteId: string;
  documentsIndexed: number;
  durationMs: number;
  errors: string[];
}

type IndexStatus =
  | { state: 'idle' }
  | { state: 'indexing'; progress: number; message: string }
  | { state: 'indexed'; lastIndexed: number; documentCount: number }
  | { state: 'error'; error: string; lastAttempt: number };
```

**Orchestration flow:**
1. Check if site's MySQL is available (socket exists)
2. Run `FileScanner.scan()` — always succeeds (file system only)
3. If MySQL available: run `MySQLExtractor.extract()`
4. Chunk long content (split at ~500 words per chunk, preserve sentence boundaries)
5. Generate embeddings via `EmbeddingService.embedBatch()`
6. Upsert into `VectorStore` with site ID
7. Update `IndexRegistry` with stats
8. Emit IPC event to renderer with status update

**Chunking strategy:**
- Posts under 500 words: one document per post
- Posts over 500 words: split into chunks, each chunk gets the post's title prepended
- Each chunk is a separate vector document with metadata linking back to the parent post
- Chunk ID format: `wp_{siteId}_{postId}_chunk_{n}`

### 2.5 IndexRegistry

**File:** `src/main/content/IndexRegistry.ts`

```typescript
interface IndexRegistry {
  get(siteId: string): IndexEntry | null;
  update(siteId: string, entry: Partial<IndexEntry>): void;
  remove(siteId: string): void;
  listAll(): IndexEntry[];
}

interface IndexEntry {
  siteId: string;
  siteName: string;
  lastIndexed: number;
  documentCount: number;
  chunkCount: number;
  durationMs: number;
  structure: SiteStructure;
  state: 'indexed' | 'indexing' | 'error' | 'stale';
  error?: string;
}
```

**Persistence:** stored in `userData` via `userData.set('nexus-ai_index_registry', data)`.

### 2.6 Lifecycle Hooks

**File:** `src/main/lifecycle-hooks.ts`

```typescript
// siteStarted: trigger indexing
context.hooks.addAction('siteStarted', async (site: LocalSite) => {
  localLogger.info(`[NexusAI] Site started: ${site.name}, triggering index`);
  try {
    await contentPipeline.indexSite(site);
  } catch (error) {
    localLogger.error(`[NexusAI] Indexing failed for ${site.name}:`, error);
  }
});

// siteStopped: mark index as stale (but keep data)
context.hooks.addAction('siteStopped', async (site: LocalSite) => {
  indexRegistry.update(site.id, { state: 'stale' });
});

// siteDeleted: clean up all data
context.hooks.addAction('siteDeleted', async (site: LocalSite) => {
  await contentPipeline.removeSite(site.id);
});
```

### Phase 2 Acceptance Criteria

- [x] `MySQLExtractor` connects to running site's MySQL and extracts posts with metadata
- [x] `FileScanner` discovers themes and plugins from any site's directory
- [x] `ContentPipeline` orchestrates full extraction → embedding → indexing flow
- [x] Lifecycle hooks trigger indexing on site start, cleanup on site delete
- [x] A running site is automatically indexed when Local starts the addon
- [x] `IndexRegistry` persists state across addon restarts
- [x] Unit tests for each component, integration test for the full pipeline
- [x] Handles edge cases: empty site, site with 0 posts, large site (1000+ posts)

---

## Phase 3: MCP Server

### Objective

Expose site intelligence via MCP protocol with a modular tool architecture designed to
eventually subsume the existing MCP-CLI addon. AI clients (Claude Code, Cursor) get a
single MCP connection for both site management and content intelligence.

### Architecture: Three Intelligence Layers

The tools are organised around three layers of site intelligence:

| Layer | What It Answers | Data Shape | Query Style |
|-------|-----------------|------------|-------------|
| **Content** | What the site *says* | Vector embeddings | Semantic similarity |
| **Structure** | What the site *is* (inner + outer) | Structured metadata | Filter / exact match |
| **Fleet** | Patterns *across* sites | Aggregation over Structure | Predicates over all sites |

Phase 3 builds Content and Structure. Fleet is deferred until enough per-site
metadata exists to make cross-site queries valuable.

### Architecture: Modular Tool Registry

```
src/main/mcp/
  McpServer.ts              # HTTP/SSE transport, JSON-RPC dispatch
  McpAuth.ts                # Token generation + Bearer validation
  tool-registry.ts          # Register / list / call tools
  site-resolver.ts          # Fuzzy site name → site ID resolution
  types.ts                  # McpToolDefinition, McpToolResult, etc.

  modules/
    content/                # Content Layer — vector-based semantic search
      index.ts              # register(registry, services)
      search-content.ts     # search_site_content
      search-across-sites.ts # search_across_sites

    site-context/           # Structure Layer — per-site structural intelligence
      index.ts
      get-site-structure.ts # get_site_structure (enriched)
      get-index-status.ts   # get_index_status
      list-indexed-sites.ts # list_indexed_sites
      reindex-site.ts       # reindex_site

    ollama/                 # Tier 3 — local LLM detect-and-integrate
      index.ts
      ask-ollama.ts         # ask_ollama
      list-models.ts        # list_ollama_models

    # FUTURE: site-management/  — port MCP-CLI's 31 tools here
    # FUTURE: fleet/            — cross-site aggregation + drift detection
```

Each module exports `register(registry, services)`. Prerequisites are declared so
tools only appear in `tools/list` when their dependencies are available (e.g.,
Ollama tools only show when Ollama is detected).

### 3.1 McpServer

**File:** `src/main/mcp/McpServer.ts`

**Protocol:** MCP 2024-11-05 (same as existing Local MCP addon)

**Transport:** HTTP with SSE (same pattern as MCP-CLI addon)

**Server details:**
- Listens on `127.0.0.1` (localhost only)
- Port range: `10800-10899` (avoids collision with MCP-CLI at 10789)
- Bearer token authentication
- Connection info persisted to `{userData}/nexus-ai-mcp-connection-info.json`

**Endpoints:**
- `GET /mcp/sse` — SSE stream for MCP handshake
- `POST /mcp/messages` — JSON-RPC 2.0 for MCP requests
- `GET /health` — Health check (no auth)

**MCP Methods:**
- `initialize` — Return server capabilities (name, version, tools)
- `tools/list` — Return available tool definitions (filtered by prerequisites)
- `tools/call` — Execute a tool by name
- `ping` — Heartbeat

**stdio bridge:**
A Node.js script (`bin/mcp-stdio.js`) bridges stdio ↔ HTTP, allowing Claude Code
to connect via its standard stdio transport.

Claude Code config (`~/.claude.json`):
```json
{
  "mcpServers": {
    "local-nexus-ai": {
      "command": "node",
      "args": ["/path/to/local-addon-nexus-ai/bin/mcp-stdio.js"]
    }
  }
}
```

### 3.2 Tool Registry

**File:** `src/main/mcp/tool-registry.ts`

```typescript
interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Returns true when this tool's prerequisites are met */
  isAvailable?: (services: NexusServices) => boolean;
}

interface McpToolHandler {
  definition: McpToolDefinition;
  execute: (args: Record<string, unknown>, services: NexusServices) => Promise<McpToolResult>;
}

class ToolRegistry {
  register(handler: McpToolHandler): void;
  list(services: NexusServices): McpToolDefinition[];  // filtered by isAvailable
  call(name: string, args: Record<string, unknown>, services: NexusServices): Promise<McpToolResult>;
}
```

Modules call `registry.register()` during addon startup. The registry handles
`tools/list` filtering and `tools/call` dispatch.

### 3.3 V1 Tool Set (8 tools across 3 modules)

**Content module (2 tools):**

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `search_site_content` | Semantic search within one site | `{ site, query, limit?, postType? }` | Ranked results with titles, excerpts, scores |
| `search_across_sites` | Semantic search spanning all indexed sites | `{ query, limit? }` | Results grouped by site |

**Site-context module (4 tools):**

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `get_site_structure` | Deep structural context for a site | `{ site }` | Themes (active/installed), plugins, PHP/WP version, custom post types, multisite, WooCommerce, ACF |
| `get_index_status` | Detailed index status for one site | `{ site }` | Doc count, chunk count, last indexed, duration, state |
| `list_indexed_sites` | List all sites with index status | `{}` | Site names, IDs, doc counts, last indexed, states |
| `reindex_site` | Trigger re-indexing for a site | `{ site }` | Success/failure, doc count, duration |

**Ollama module (2 tools):**

| Tool | Description | Input | Output | Prerequisite |
|------|-------------|-------|--------|-------------|
| `ask_ollama` | Send prompt to local Ollama | `{ prompt, model?, system? }` | LLM response text | Ollama running |
| `list_ollama_models` | List available Ollama models | `{}` | Model names, sizes, recommendations | Ollama running |

### 3.4 MCP Authentication

**File:** `src/main/mcp/McpAuth.ts`

Same pattern as MCP-CLI addon:
- 128-byte random token generated on first start, persisted across restarts
- Bearer token validation on all endpoints except `/health`
- IP whitelist: localhost only (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`)
- Token stored in connection info file for Claude Code to read

### 3.5 Site Resolution

**File:** `src/main/mcp/site-resolver.ts`

AI clients refer to sites by name (natural language). Resolution order:

1. Exact site ID match
2. Exact name match (case-insensitive)
3. Partial name match (substring)
4. Domain match (e.g., `mysite.local`)

Shared across all modules that accept a `site` parameter.

### 3.6 Connection Info

**File written to:** `{userData}/nexus-ai-mcp-connection-info.json`

```json
{
  "url": "http://127.0.0.1:10800",
  "authToken": "<128-char-base64-token>",
  "port": 10800,
  "version": "0.1.0",
  "tools": ["search_site_content", "search_across_sites", ...]
}
```

Created on server start, deleted on server stop.

### 3.7 Future: Subsuming MCP-CLI

The modular registry is designed so MCP-CLI's 31 site-management tools can be
ported into a `site-management` module under `modules/`. When that happens:

- Users switch from two MCP connections to one
- The connection info file replaces MCP-CLI's `mcp-connection-info.json`
- MCP-CLI addon is deprecated in favour of Nexus AI

This is **not** Phase 3 work. The architecture supports it; the migration is a
separate project decision.

### Phase 3 Acceptance Criteria

- [x] MCP server starts on addon load, listens on localhost
- [x] Modular tool registry — modules register tools via `register()`
- [x] Token-based authentication works (Bearer header, localhost-only)
- [x] `tools/list` returns tools filtered by prerequisites (Ollama tools hidden when unavailable)
- [x] `search_site_content` returns semantically relevant results for an indexed site
- [x] `search_across_sites` returns results grouped by site
- [x] `get_site_structure` returns enriched structural context (themes, plugins, post types)
- [x] `list_indexed_sites` returns all indexed sites with stats
- [x] `reindex_site` triggers re-indexing and returns result
- [x] stdio bridge works with Claude Code
- [x] Connection info written to predictable file location
- [x] MCP protocol compliance tests pass (initialize, tools/list, tools/call, ping)
- [x] Graceful shutdown on addon deactivate
- [x] Unit tests for tool registry, site resolver, and each tool handler

---

## Phase 4: Deep Content Intelligence

### Objective

Extend content extraction beyond basic posts/pages to index WooCommerce products,
ACF custom fields, custom post type metadata, and media attachment metadata.
This makes semantic search dramatically more useful for real-world WordPress sites.

### 4.1 WooCommerce Content Extraction

**File:** `src/main/content/WooCommerceExtractor.ts`

WooCommerce stores product data across several tables. Sites with WooCommerce
(detected by `FileScanner.hasWooCommerce`) get enriched extraction.

**Product data sources:**

| Data | Table | Key Columns |
|------|-------|-------------|
| Product post | `wp_posts` | `post_type = 'product'`, `post_content`, `post_excerpt` |
| Product meta | `wp_postmeta` | `_price`, `_regular_price`, `_sale_price`, `_sku`, `_stock_status`, `_weight` |
| Product attributes | `wp_wc_product_attributes_lookup` | Attribute names and values |
| Product categories | `wp_term_relationships` + `wp_terms` | `taxonomy = 'product_cat'` |
| Product tags | `wp_term_relationships` + `wp_terms` | `taxonomy = 'product_tag'` |
| Product lookup | `wp_wc_product_meta_lookup` | Denormalized price/stock/rating data |

**Extracted product shape:**

```typescript
interface ExtractedProduct extends ExtractedPost {
  sku: string;
  price: string;
  regularPrice: string;
  salePrice: string;
  stockStatus: 'instock' | 'outofstock' | 'onbackorder';
  productType: 'simple' | 'variable' | 'grouped' | 'external';
  attributes: Array<{ name: string; value: string }>;
  productCategories: string[];
  productTags: string[];
  averageRating: number;
  reviewCount: number;
}
```

**Embedding text construction for products:**
```
{title}. {cleanedContent}. SKU: {sku}. Price: ${price}.
Categories: {productCategories.join(', ')}.
Attributes: {attributes.map(a => `${a.name}: ${a.value}`).join(', ')}.
```

This allows queries like "red wool sweater under $50" to match products semantically.

**Order summary extraction (non-indexed, structure only):**

Orders are not indexed into the vector store (privacy + relevance concerns), but
order statistics are extracted for the Structure Layer:

```typescript
interface OrderSummary {
  totalOrders: number;
  totalRevenue: number;
  ordersByStatus: Record<string, number>;  // completed, processing, etc.
  averageOrderValue: number;
  dateRange: { first: string; last: string };
}
```

Source: `wp_wc_order_stats` table (denormalized, fast).

### 4.2 ACF Field Extraction

**File:** `src/main/content/AcfExtractor.ts`

Advanced Custom Fields stores field data in `wp_postmeta` with keys that map to
field group definitions in `wp_posts` (post_type = `acf-field-group`).

**Detection:** `FileScanner.hasACF` already exists. When true, extract ACF data.

**Strategy:**
- Read ACF field group definitions from `wp_posts WHERE post_type = 'acf-field-group'`
- Parse the serialized `post_content` to get field configurations
- For each indexed post, read ACF meta values (keys without `_` prefix)
- Append ACF field values to the embedding text

**ACF field type handling:**

| ACF Type | Extraction Strategy |
|----------|-------------------|
| text, textarea, wysiwyg | Include raw text value |
| number, range | Include as "{label}: {value}" |
| select, checkbox, radio | Include selected value labels |
| image, file, gallery | Include attachment title/alt text |
| relationship, post_object | Include referenced post title |
| repeater, group, flexible_content | Flatten nested fields recursively |
| true_false | Include as "{label}: Yes/No" |
| date_picker, date_time_picker | Include formatted date |
| google_map | Include address string |

**Embedded text appendix:**
```
Custom Fields: {field_label}: {field_value}, {field_label}: {field_value}, ...
```

### 4.3 Custom Table Support

**File:** `src/main/content/CustomTableExtractor.ts`

Some plugins create custom tables (e.g., `wp_yoast_seo_meta`, `wp_redirection_items`,
`wp_wpforms_entries`). Rather than hardcoding each plugin's schema, provide a
discovery + extraction mechanism.

**Discovery:** Scan `SHOW TABLES` for tables not in the standard WordPress set.
Group by prefix pattern (e.g., `wp_wc_*` → WooCommerce, `wp_yoast_*` → Yoast).

**Extraction strategy:**
- For known plugin prefixes: use plugin-specific extractors (WooCommerce above)
- For unknown tables: extract table name, column names, and row count as structure metadata (not vector-indexed)
- Expose via `get_site_structure` tool: "This site has 12 custom tables from 3 plugins"

**MCP tool enhancement:**

`get_site_structure` output gains a `customTables` section:
```
### Custom Tables
- WooCommerce: 22 tables (wp_wc_orders, wp_wc_product_meta_lookup, ...)
- Action Scheduler: 4 tables
- Unknown: 2 tables (wp_custom_analytics, wp_form_entries)
```

### 4.4 Media Metadata Indexing

**File:** `src/main/content/MediaExtractor.ts`

WordPress stores media attachments as `post_type = 'attachment'` (currently in
our `EXCLUDED_POST_TYPES` list). We selectively index media metadata without
indexing the binary content.

**Extracted from `wp_posts`:**
- `post_title` (media title)
- `post_excerpt` (caption)
- `post_content` (description)
- `post_mime_type` (image/jpeg, application/pdf, etc.)

**Extracted from `wp_postmeta`:**
- `_wp_attachment_metadata` (serialized: width, height, file sizes, EXIF data)
- `_wp_attachment_image_alt` (alt text — critical for accessibility and search)

**Embedding text:**
```
[Image] {title}. Alt: {alt_text}. Caption: {caption}. {description}
```

This allows queries like "hero image of mountain landscape" to find relevant media.

**Filter:** Only index attachments that have alt text or a meaningful title
(skip auto-generated filenames like "IMG_4521").

### 4.5 Updated MySQLExtractor

Extend `MySQLExtractor.extract()` to orchestrate the sub-extractors:

```typescript
async extract(info: SiteConnectionInfo): Promise<ExtractedContent> {
  const posts = await this.extractPosts(conn, prefix);

  // Conditional extraction based on site capabilities
  if (hasWooCommerce) {
    const products = await wooExtractor.extractProducts(conn, prefix);
    posts.push(...products);  // Products are ExtractedPost-compatible
  }

  if (hasACF) {
    await acfExtractor.enrichPosts(conn, prefix, posts);  // Mutates posts in-place
  }

  const media = await mediaExtractor.extractMedia(conn, prefix);
  posts.push(...media);

  return { posts, siteInfo, extractedAt: Date.now() };
}
```

### Phase 4 Acceptance Criteria

- [x] WooCommerce products indexed with price, SKU, categories, attributes
- [x] Semantic search finds products by natural language ("cheap red shoes")
- [x] ACF field values included in post embeddings
- [x] ACF repeater/group fields flattened correctly
- [x] Media attachments indexed with alt text, caption, description
- [x] `get_site_structure` shows custom table summary
- [x] Order summary statistics available in structure layer
- [x] Sites without WooCommerce/ACF are unaffected (no errors, same behavior)
- [x] Unit tests for each sub-extractor with fixture data
- [x] Integration test: index The Curated Shelf, search for product by description

---

## Phase 5: Richer Structure Layer

### Objective

Upgrade `get_site_structure` from filesystem-only heuristics to DB-backed detection
for active theme, users, roles, REST API routes, rewrite rules, and integration
health. Structure becomes the authoritative "what is this site?" answer.

### 5.1 DB-Backed Theme/Plugin Detection

**Current limitation:** `FileScanner` reads `style.css` and plugin PHP headers from
disk but cannot determine which theme/plugin is *active* (requires DB access).

**Enhancement:** When the site is running (MySQL available), query `wp_options`:

```sql
-- Active theme
SELECT option_value FROM wp_options WHERE option_name = 'template';        -- parent theme slug
SELECT option_value FROM wp_options WHERE option_name = 'stylesheet';      -- active theme slug (child or parent)

-- Active plugins
SELECT option_value FROM wp_options WHERE option_name = 'active_plugins';  -- serialized array of plugin paths
```

Merge DB results with filesystem scan:
- FileScanner provides version numbers, descriptions, child theme detection
- DB provides active/inactive state
- Combined output marks each theme/plugin as active or inactive

### 5.2 User & Role Extraction

**File:** `src/main/content/UserExtractor.ts`

```sql
-- User summary (no PII — just roles and counts)
SELECT um.meta_value AS capabilities, COUNT(*) AS count
FROM wp_usermeta um
WHERE um.meta_key = 'wp_capabilities'
GROUP BY um.meta_value;
```

**Output:**
```typescript
interface UserSummary {
  totalUsers: number;
  roleBreakdown: Record<string, number>;  // { administrator: 2, editor: 3, subscriber: 45 }
  customRoles: string[];                   // Roles not in default WP set
}
```

Exposed in `get_site_structure`:
```
### Users
- Total: 50
- Administrators: 2, Editors: 3, Authors: 5, Subscribers: 40
- Custom roles: shop_manager, support_agent
```

### 5.3 REST API Route Discovery

**File:** `src/main/content/RestApiScanner.ts`

When a site is running, discover its REST API namespace and routes:

```typescript
async function discoverRestRoutes(siteDomain: string): Promise<RestApiInfo> {
  // GET http://{domain}/wp-json/ returns the REST API index
  const response = await httpGet(`http://${siteDomain}/wp-json/`);
  return {
    namespaces: response.namespaces,  // ['wp/v2', 'wc/v3', 'acf/v3', ...]
    routeCount: Object.keys(response.routes).length,
    customNamespaces: response.namespaces.filter(ns => !isStandardNamespace(ns)),
  };
}
```

**Standard namespaces** (filtered out): `wp/v2`, `oembed/1.0`, `wp-site-health/v1`

**Output in `get_site_structure`:**
```
### REST API
- Namespaces: wp/v2, wc/v3, acf/v3, jetpack/v4
- Custom namespaces: wc/v3 (WooCommerce), acf/v3 (ACF), jetpack/v4 (Jetpack)
- Total routes: 147
```

### 5.4 Rewrite Rules & Permalink Structure

```sql
SELECT option_value FROM wp_options WHERE option_name = 'permalink_structure';
SELECT option_value FROM wp_options WHERE option_name = 'rewrite_rules';
```

**Output:**
```typescript
interface PermalinkInfo {
  structure: string;          // e.g., '/%postname%/'
  totalRewriteRules: number;  // Number of rewrite rules registered
}
```

### 5.5 Site Health Summary

Aggregate key indicators from wp_options:

```sql
SELECT option_name, option_value FROM wp_options
WHERE option_name IN (
  'blog_public',          -- Search engine visibility
  'WPLANG',              -- Language
  'timezone_string',     -- Timezone
  'default_role',        -- Default user role
  'comment_registration' -- Comment registration required
);
```

Combined with existing data, produce a holistic health check:

```
### Site Health
- Search engines: Allowed / Blocked
- Language: en_US
- Timezone: America/New_York
- Default role: subscriber
- PHP: 8.2, WP: 6.9.1
- Multisite: No
```

### 5.6 Updated Tool Output

`get_site_structure` becomes significantly richer:

```
## The Curated Shelf
**Domain:** the-curated-shelf.local
**WordPress:** 6.9.1 | **PHP:** 8.2

### Themes
- Twenty Twenty-Four v1.3 [ACTIVE]
- Twenty Twenty-Five v1.3
- Twenty Twenty-Three v1.6

### Plugins (3 active / 0 inactive)
- Advanced Custom Fields v6.4.3 [ACTIVE]
- WooCommerce v10.0.4 [ACTIVE]
- Query Monitor v3.19.0 [ACTIVE]

### Users
- Total: 1 | Administrators: 1

### WooCommerce
- Products: 15 | Orders: 42 | Revenue: $3,847.50
- Average order value: $91.61

### REST API
- Custom namespaces: wc/v3, acf/v3
- Total routes: 147

### Custom Tables
- WooCommerce: 22 tables
- Action Scheduler: 4 tables

### Site Health
- Search engines: Allowed
- Permalinks: /%postname%/
- Language: en_US

### Index Status
- State: indexed | Documents: 51 | Chunks: 64
- Last indexed: 2026-02-28T19:56:05Z
```

### Phase 5 Acceptance Criteria

- [x] Active theme/plugin detection via DB when site is running
- [x] Falls back to filesystem-only detection when site is stopped
- [x] User role summary extracted (counts only, no PII)
- [x] REST API namespaces discovered from running site
- [x] Permalink structure extracted
- [x] Site health summary from wp_options
- [x] `get_site_structure` output includes all new sections
- [x] WooCommerce order summary (counts + revenue) in structure
- [x] Unit tests for each sub-extractor
- [x] No regressions on sites without WooCommerce/ACF

---

## Phase 6: Fleet Intelligence

### Objective

Build cross-site aggregation and comparison tools. This is the "Fleet Layer" from
the three intelligence layers architecture — answering questions about patterns
*across* sites rather than within a single site.

### 6.1 Fleet Query Tools

**Module:** `src/main/mcp/modules/fleet/`

**`find_sites_with_plugin`** — "Which sites use WooCommerce?"

```typescript
// Input: { plugin: string }
// Scans all indexed sites' structure for plugin match
// Returns: list of sites with the plugin, version, active status
```

**`find_sites_with_theme`** — "Which sites use Twenty Twenty-Four?"

```typescript
// Input: { theme: string }
// Same pattern as plugin search
```

**`find_outdated_sites`** — "Which sites have outdated WordPress?"

```typescript
// Input: { component?: 'wordpress' | 'php' | 'plugin' | 'theme' }
// Compares versions across sites, identifies oldest
// Returns: sites grouped by version, highlights outdated
```

**`compare_sites`** — "How do these two sites differ?"

```typescript
// Input: { site_a: string, site_b: string }
// Side-by-side comparison of:
//   - WordPress/PHP versions
//   - Theme (active, child theme status)
//   - Plugins (shared, unique to each)
//   - Users (role breakdown)
//   - WooCommerce presence and stats
//   - Content volume (post counts by type)
```

Output:
```
## Site Comparison: The Curated Shelf vs My Blog

### Shared
- WordPress 6.9.1
- ACF v6.4.3

### Only in The Curated Shelf
- WooCommerce v10.0.4
- Theme: Twenty Twenty-Four

### Only in My Blog
- Jetpack v13.2
- Theme: Flavor of the Month v2.1

### Content
- The Curated Shelf: 51 docs (15 products, 36 posts/pages)
- My Blog: 127 docs (all posts/pages)
```

**`fleet_summary`** — "Give me an overview of all my sites"

```typescript
// Input: {}
// Aggregates across all indexed sites:
//   - Total sites indexed / total sites in Local
//   - Most common plugins (top 10)
//   - WordPress version distribution
//   - PHP version distribution
//   - Total content indexed
//   - Sites with WooCommerce
//   - Sites with stale indexes
```

### 6.2 Configuration Drift Detection

**`detect_drift`** — "Are my staging and production configs aligned?"

```typescript
// Input: { baseline_site: string, compare_sites?: string[] }
// If compare_sites omitted, compare baseline against all indexed sites
// Detects:
//   - Plugin version mismatches
//   - Missing plugins (present in baseline, absent in target)
//   - Extra plugins (present in target, absent in baseline)
//   - WordPress/PHP version differences
//   - Theme differences
```

Output:
```
## Drift Report: baseline = "production-mirror"

### staging (2 drifts)
- WooCommerce: 10.0.4 (baseline) vs 9.8.2 (staging) ⚠️
- Missing plugin: WP Super Cache

### dev-site (3 drifts)
- WordPress: 6.9.1 (baseline) vs 6.8.0 (dev-site) ⚠️
- Extra plugin: Query Monitor (not in baseline)
- Theme mismatch: Twenty Twenty-Four vs Twenty Twenty-Five
```

### 6.3 Implementation Notes

Fleet tools operate on the IndexRegistry's structure data — they don't need the
vector store or embeddings. They work even when sites are stopped (structure is
persisted from the last index).

The existing `search_across_sites` tool (Phase 3) is already a fleet-level content
query. Phase 6 adds fleet-level *structure* queries.

**Module registration:**

```
modules/
  fleet/
    index.ts                  # registerFleetTools(registry)
    find-sites-with-plugin.ts
    find-sites-with-theme.ts
    find-outdated-sites.ts
    compare-sites.ts
    fleet-summary.ts
    detect-drift.ts
```

### Phase 6 Acceptance Criteria

- [x] `find_sites_with_plugin` returns correct site list
- [x] `find_sites_with_theme` returns correct site list
- [x] `find_outdated_sites` identifies version differences across sites
- [x] `compare_sites` produces accurate side-by-side diff
- [x] `fleet_summary` aggregates stats across all indexed sites
- [x] `detect_drift` identifies configuration mismatches against a baseline
- [x] Fleet tools work with stopped sites (uses persisted structure)
- [x] Unit tests for each fleet tool with multi-site fixture data
- [x] Performance: fleet queries complete in <100ms for 50 indexed sites

---

## Phase 7: Search Quality & MCP-CLI Subsumption

### Objective

Two parallel workstreams: (1) fix the scoring model so similarity scores are
meaningful and intuitive, and (2) port the MCP-CLI addon's site management
tools into Nexus AI's modular registry.

### 7.1 Search Quality: Cosine Similarity

**Problem:** LanceDB defaults to L2 (Euclidean) distance. For normalized vectors
(which our model produces), L2 distance ranges from 0 to 2. The current
`1 - distance` formula produces negative scores for dissimilar content, which
is confusing.

**Fix:** Switch to cosine distance in LanceDB, or compute cosine similarity
manually from the L2 distance.

**Option A — LanceDB metric override:**

```typescript
// In VectorStore.search():
const query = table.vectorSearch(vecArray)
  .distanceType('cosine')   // LanceDB supports 'l2', 'cosine', 'dot'
  .limit(options.limit);
```

Cosine distance ranges from 0 (identical) to 2 (opposite). Similarity = `1 - cosine_distance/2`
gives a 0-1 range.

**Option B — Mathematical conversion (no LanceDB change):**

For L2-normalized vectors: `cosine_similarity = 1 - (l2_distance² / 2)`

```typescript
// In VectorStore.search() result mapping:
const l2dist = row._distance as number;
const cosineSim = 1 - (l2dist * l2dist) / 2;
return { ...result, score: cosineSim };
```

**Preference:** Option A (cleaner, lets LanceDB optimise the index).

**Score display format:**
- Scores now range 0.0–1.0 (1.0 = perfect match)
- Display as percentage in tool output: "score: 0.847 (85%)"
- Set a relevance floor: don't return results below 0.3 similarity

### 7.2 Search Quality: Result Ranking Improvements

**Title boosting:** Posts whose title closely matches the query should rank higher.
Compute a lightweight title similarity bonus:

```typescript
const titleSim = await embed(query) · await embed(title);  // Already have both vectors
const boostedScore = 0.8 * contentScore + 0.2 * titleSim;
```

**Freshness signal:** For time-sensitive queries, more recent posts could get a
small boost. Deferred — not clear this adds value for Local dev sites.

**Deduplication:** When a long post is split into multiple chunks, all chunks
currently appear as separate results. Group by postId and return only the
highest-scoring chunk per post:

```typescript
// Post-process results to deduplicate
const bestPerPost = new Map<number, SearchResult>();
for (const result of rawResults) {
  const existing = bestPerPost.get(result.postId);
  if (!existing || result.score > existing.score) {
    bestPerPost.set(result.postId, result);
  }
}
return Array.from(bestPerPost.values()).sort((a, b) => b.score - a.score);
```

### 7.3 MCP-CLI Tool Subsumption

**Goal:** Port the MCP-CLI addon's site management tools into Nexus AI's modular
tool registry. When complete, users need only one MCP connection for both
intelligence *and* management.

**MCP-CLI tools to port (grouped by priority):**

**Priority 1 — Core site operations (7 tools):**

| MCP-CLI Tool | Nexus AI Tool | Notes |
|-------------|---------------|-------|
| `list_sites` | `list_sites` | Already partially covered by `list_indexed_sites` — merge into one richer tool |
| `get_site` | `get_site` | Complement `get_site_structure` with raw site config (ports, services, paths) |
| `start_site` | `start_site` | Requires `siteProcessManager` from service container |
| `stop_site` | `stop_site` | Same |
| `restart_site` | `restart_site` | Same |
| `wp_cli` | `wp_cli` | Execute WP-CLI commands on a site — extremely powerful |
| `get_site_logs` | `get_site_logs` | Read site error/access logs |

**Priority 2 — Site lifecycle (6 tools):**

| MCP-CLI Tool | Nexus AI Tool | Notes |
|-------------|---------------|-------|
| `create_site` | `create_site` | Full site provisioning |
| `delete_site` | `delete_site` | With confirmation guard |
| `clone_site` | `clone_site` | Deep copy |
| `rename_site` | `rename_site` | |
| `import_site` | `import_site` | From .zip export |
| `export_site` | `export_site` | To .zip |

**Priority 3 — Database & configuration (5 tools):**

| MCP-CLI Tool | Nexus AI Tool | Notes |
|-------------|---------------|-------|
| `export_database` | `export_database` | SQL dump |
| `import_database` | `import_database` | SQL import |
| `change_php_version` | `change_php_version` | |
| `trust_ssl` | `trust_ssl` | |
| `toggle_xdebug` | `toggle_xdebug` | |

**Priority 4 — Utilities (6 tools):**

| MCP-CLI Tool | Nexus AI Tool | Notes |
|-------------|---------------|-------|
| `get_local_info` | `get_local_info` | Local app version, platform, paths |
| `list_services` | `list_services` | Available PHP/MySQL/nginx versions |
| `list_blueprints` | `list_blueprints` | |
| `save_blueprint` | `save_blueprint` | |
| `open_site` | `open_site` | Open in browser |
| `open_adminer` | `open_adminer` | Open database UI |

**Priority 5 — WP Engine integration (5 tools, deferred):**

These require WPE OAuth and are better left in the WPE-specific addon:
`push_to_wpe`, `pull_from_wpe`, `get_sync_history`, `get_site_changes`, `remote_wp_cli`

**Implementation approach:**

Each tool is a thin adapter that calls Local's service container:

```typescript
// modules/site-management/start-site.ts
export const startSiteHandler: McpToolHandler = {
  definition: {
    name: 'start_site',
    description: 'Start a Local WordPress site',
    inputSchema: {
      type: 'object',
      properties: { site: { type: 'string', description: 'Site name, ID, or domain' } },
      required: ['site'],
    },
  },
  async execute(args, services) {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found`);

    // Access Local's process manager via extended services
    const { siteProcessManager } = services.localServices;
    await siteProcessManager.startSite(site.id);

    return ok(`Site "${site.name}" started`);
  },
};
```

**NexusServices extension:**

```typescript
interface NexusServices {
  // ... existing fields ...
  /** Local's full service container for site management tools */
  localServices: {
    siteProcessManager: any;
    wpCli: any;
    siteData: any;  // Full siteData (not just the accessor)
    lightningServices: any;
  };
}
```

The `localServices` field is populated from `LocalMain.getServiceContainer().cradle`
in `src/main/index.ts`. Intelligence tools don't need it; management tools do.

**Module structure:**

```
modules/
  site-management/
    index.ts                # registerSiteManagementTools(registry)
    list-sites.ts
    get-site.ts
    start-site.ts
    stop-site.ts
    restart-site.ts
    wp-cli.ts
    get-site-logs.ts
    create-site.ts
    delete-site.ts
    clone-site.ts
    rename-site.ts
    import-export.ts        # import_site, export_site, import_database, export_database
    configuration.ts        # change_php_version, trust_ssl, toggle_xdebug
    utilities.ts            # get_local_info, list_services, blueprints, open_site, open_adminer
```

### Phase 7 Acceptance Criteria

- [x] Cosine similarity scores range 0.0–1.0 (1.0 = perfect match)
- [x] No results returned below 0.3 relevance threshold
- [x] Chunk deduplication: one result per post (best chunk wins)
- [x] Priority 1 management tools (7) ported and working
- [x] Priority 2 lifecycle tools (6) ported and working
- [x] Priority 3 database tools (5) ported and working
- [x] Priority 4 utility tools (6) ported and working
- [x] `wp_cli` tool executes WP-CLI commands and returns output
- [x] Management tools use fuzzy site resolution (same as intelligence tools)
- [x] Unit tests for each ported tool
- [x] MCP-CLI addon can be disabled without losing functionality (except WPE tools)

---

## Phase 8: Instructions, Resources & Composite Tools

### Objective
Add server-level instructions, MCP resources, and composite tools that teach AI agents how to use the 48 tools together and provide multi-step workflow execution.

**Key decision:** MCP prompts were initially planned but dropped in favor of composite tools (following `local-wpe-mcp-addon` ADR-017 pattern). Composite tools actually execute multi-call workflows; prompts would have just returned instructional text that duplicated existing tool functionality.

### 8.1 Server Instructions

Server-level instructions returned in `initialize` response. Covers:
- **Discovery first** — always call `local_list_sites` or `nexus_list_sites` before other tools
- **Routing table** — intent → tool mapping for all 8 modules
- **Local vs remote** — when to use `site` vs `install_name` parameter
- **Safety** — dry-run defaults, Tier 3 confirmation flow
- **Presentation** — format as tables/lists, not raw JSON
- **Composite tool preference** — prefer `nexus_site_audit`/`nexus_plugin_audit` over individual calls

**File:** `src/main/mcp/instructions/server-instructions.ts`

### 8.2 MCP Resources

6 static guides served via `resources/list` and `resources/read`:

| URI | Content |
|-----|---------|
| `nexus://guide/getting-started` | Orientation, discovery-first, tool modules overview |
| `nexus://guide/safety` | 3-tier system, confirmation tokens, pre-checks |
| `nexus://guide/remote-wp-cli` | Local vs remote execution, SSH keys, blocked commands |
| `nexus://guide/workflows/site-setup` | Create → configure → start → verify |
| `nexus://guide/workflows/wpe-sync` | Push/pull between Local and WP Engine |
| `nexus://guide/workflows/content-search` | Index sites, semantic search, cross-site search |

**Files:** `src/main/mcp/instructions/resources/` (markdown files + `index.ts` loader)

### 8.3 Composite Tools

2 multi-step tools that execute parallel service calls:

| Tool | What it does |
|------|-------------|
| `nexus_site_audit` | Parallel: WP version + plugins + themes + health + plugin updates → unified markdown report |
| `nexus_plugin_audit` | Fans out across all running sites: plugins + updates per site → fleet-wide summary |

Both use `Promise.allSettled` for graceful partial-failure handling — if one service call fails, the rest still return data.

**Files:** `src/main/mcp/modules/composite/` (site-audit.ts, plugin-audit.ts, index.ts)

### 8.4 Eval Framework

42 deterministic tests for instruction/resource content quality. Zero LLM cost, <2 seconds.

- `tests/eval/instructions-quality.test.ts` — discovery-first, namespaces, routing, safety, composite tools
- `tests/eval/resource-quality.test.ts` — readability, URI format, markdown structure, content coverage

Separate Jest config (`jest.eval.config.js`), runs via `npm run test:eval`.

### 8.5 InstructionRegistry

Central aggregator that holds instructions text and resources. Exposes getters for McpServer dispatch and eval tests. Testable in isolation without booting an MCP server.

**File:** `src/main/mcp/instructions/index.ts`

### Phase 8 Acceptance Criteria

- [x] Server instructions included in `initialize` response
- [x] Instructions cover discovery-first, routing, safety, local-vs-remote
- [x] 6 MCP resources registered and readable via `resources/list` and `resources/read`
- [x] `nexus_site_audit` executes 5 parallel service calls and returns unified report
- [x] `nexus_plugin_audit` fans out across all running sites with per-site error handling
- [x] Composite tools reject unknown/halted sites with clear error messages
- [x] Eval framework: 42 deterministic tests pass in <2s
- [x] Unit tests: 13 composite tool tests pass
- [x] E2E tests: composite tools execute against real running site
- [x] Build copies markdown resource files to `lib/`
- [x] 429 unit tests + 42 eval tests, all passing

---

## Phase 11: Polish & Distribution

### Objective
Testing hardening, CI/CD pipeline, per-platform packaging, documentation.

### 11.1 Testing Hardening

- Integration tests that exercise the full pipeline (extract → embed → store → search)
- MCP protocol compliance tests
- Edge case coverage: empty sites, unicode content, very large posts, special characters in site names
- Error recovery: MySQL socket disappears mid-extraction, ONNX model file missing, LanceDB database corrupted
- Memory leak testing: index 50 sites, check RSS growth
- WooCommerce extraction tests with product fixtures
- ACF field extraction tests with repeater/group/flexible content fixtures
- Fleet intelligence tests with multi-site fixtures

### 11.2 Per-Platform Build Pipeline

```bash
# scripts/strip-platforms.sh
# Run in CI for each target platform

TARGET=$1  # e.g., "darwin-arm64"

# ONNX Runtime: keep only target platform binary
cd node_modules/onnxruntime-node/bin/napi-v6/
for dir in */; do
  platform_arch="${dir%/}"
  if [ "$platform_arch" != "$TARGET" ]; then
    rm -rf "$dir"
  fi
done

# LanceDB: handled by optionalDependencies (npm install only installs target)
```

```bash
# scripts/package-addon.js
# Creates: local-addon-nexus-ai-{version}-{platform}-{arch}.tgz
```

**Platform matrix:**
| Platform | Architecture | ONNX Binary | LanceDB Binary |
|----------|-------------|-------------|----------------|
| darwin | arm64 | ~34.5 MB | ~58 MB |
| darwin | x64 | ~34.5 MB | ~58 MB |
| win32 | x64 | ~34.5 MB | ~58 MB |
| linux | x64 | ~34.5 MB | ~58 MB |

### 11.3 Documentation

**README.md:**
- What Nexus AI does (one paragraph)
- Installation (addon marketplace or manual symlink)
- MCP setup for Claude Code / Cursor
- Available MCP tools with examples
- Fleet intelligence examples
- Troubleshooting

**THIRD_PARTY_LICENSES.md:**
- LanceDB: Apache 2.0
- ONNX Runtime: MIT
- all-MiniLM-L6-v2: Apache 2.0
- mysql2: MIT
- zod: MIT

### Phase 11 Acceptance Criteria

- [ ] All unit tests pass with >80% coverage
- [ ] Integration tests pass
- [ ] Per-platform packages build successfully for all 4 targets
- [ ] Package sizes within expected range (~115 MB per platform)
- [ ] Native modules load correctly on target platform
- [ ] README covers installation, MCP setup, and troubleshooting
- [ ] THIRD_PARTY_LICENSES.md is complete and accurate

---

## Phase 9: Ollama Integration (Tier 3)

### Objective
Detect Ollama, surface model information, expose chat via MCP tools.

### 9.1 OllamaClient

**File:** `src/main/ollama/OllamaClient.ts`

```typescript
interface OllamaClient {
  detect(): Promise<OllamaStatus>;
  listModels(): Promise<OllamaModel[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<string>;
  isAvailable(): boolean;
}

interface OllamaStatus {
  available: boolean;
  version?: string;
  models: OllamaModel[];
  recommended?: OllamaModel;
}
```

**Detection (validated in Spike 4):**
- Single HTTP GET to `http://localhost:11434/api/tags`
- If reachable: Ollama is available, parse model list
- If not: `{ available: false }`
- Poll every 30 seconds in background (user might start Ollama after Local)

### 9.2 ModelRecommender

**File:** `src/main/ollama/ModelRecommender.ts`

```typescript
function recommendModel(totalMemGB: number, models: OllamaModel[]): OllamaModel | null {
  const availableForModels = totalMemGB * 0.75;  // Reserve 25% for OS/Local
  const matrix = [
    { maxMem: 8,   model: 'llama3.2:3b' },
    { maxMem: 12,  model: 'llama3.1:8b' },
    { maxMem: 16,  model: 'gemma3:12b' },
    { maxMem: 32,  model: 'llama3.3:70b' },   // needs quantized
    { maxMem: 64,  model: 'llama3.3:70b' },
  ];
  // Find largest model that fits, prefer already-installed models
}
```

### 9.3 MCP Tools (Ollama)

The tool stubs already exist from Phase 3 with prerequisite gating. This phase
implements the actual client behind them.

**`ask_ollama`:**
- Input: `{ prompt, model?, system?, site? }`
- If `site` provided: inject site context (structure + recent content) as system prompt prefix
- Calls `OllamaClient.chat()` with the prompt
- Returns response text
- If Ollama not available: returns helpful error with install instructions

**`list_ollama_models`:**
- Returns installed models with sizes and recommendations
- Includes hardware info (total RAM, recommended model)

### Phase 9 Acceptance Criteria

- [x] `OllamaClient.detect()` correctly identifies running Ollama
- [x] `OllamaClient.detect()` returns `available: false` when Ollama not running
- [x] `listModels()` returns installed models with metadata
- [x] `chat()` sends prompt and returns response
- [x] `ModelRecommender` suggests appropriate model for hardware
- [x] MCP `ask_ollama` tool works end-to-end with site context injection
- [x] MCP `list_ollama_models` returns accurate info
- [x] Graceful degradation when Ollama unavailable (clear error messages)

---

## Phase 10: Local UI (Deferred)

### Objective
User-facing controls in Local's interface. Deferred because the addon is fully
functional headless — all capabilities are accessible via MCP tools.

### When to Build

Build the UI when:
- The addon is distributed to users who aren't using Claude Code / AI tools
- Status visibility becomes important (e.g., "why is my site slow? is indexing running?")
- A "Copy MCP Config" button provides meaningful onboarding value

### Planned Components

**NexusPanel (Per-Site)** — `SiteInfoOverview` hook:
- Index status badge, document count, last indexed timestamp
- Site structure summary, reindex button, MCP connection snippet

**FleetOverview (Preferences)** — `PreferencesGeneral` hook:
- Total indexed sites, MCP server status, connection info, copy config button

**Constraints:** Class components only, no React hooks. IPC via `ipcMain.handle()`.

### Phase 10 Acceptance Criteria

- [ ] NexusPanel appears on site info page for every site
- [ ] Shows correct index status (indexed, stale, not indexed)
- [ ] Reindex button triggers indexing and updates UI
- [ ] FleetOverview appears in preferences with accurate stats
- [ ] MCP connection info displayed with copy-to-clipboard
- [ ] Class components only, no React hooks used

---

## Build System

### Compilation

Pure TypeScript compilation (no webpack), following kitchen-sink pattern:

```
src/main/**/*.ts    → tsc →  lib/main/**/*.js
src/renderer/**/*.tsx → tsc → lib/renderer/**/*.js
src/common/**/*.ts   → tsc →  lib/common/**/*.js
```

### Entry Points

`scripts/create-entry-points.js`:
```javascript
// lib/main.js
module.exports = require('./main/index').default || require('./main/index');

// lib/renderer.js
module.exports = require('./renderer/index').default || require('./renderer/index');
```

### Imports: Relative Paths Only

All imports use relative paths (`../common/types`, `./VectorStore`). No path aliases (`@/*`). TypeScript compiles path aliases into the output unchanged, producing unresolvable `require('@/...')` calls at runtime. Relative paths work without any post-processing.

### Runtime Dependencies and node_modules

Without webpack bundling, all JS dependencies (`mysql2`, `zod`) and native modules (`@lancedb/lancedb`, `onnxruntime-node`) must be present in the addon's `node_modules/` directory at runtime. The packaging script handles this:

1. `npm ci --production` — install only production dependencies
2. `scripts/strip-platforms.sh` — remove non-target ONNX Runtime binaries
3. Package `lib/`, `models/`, `bin/`, `node_modules/`, and `package.json` into the `.tgz`

This is the same approach used by kitchen-sink, laravel, and ai-site-builder. Local's addon loader resolves modules from the addon's installed directory naturally.

### Model Distribution

The ONNX model file (`models/all-MiniLM-L6-v2-quantized/model.onnx`, 22 MB) is included in the addon package. It is loaded from `path.join(__dirname, '../../models/all-MiniLM-L6-v2-quantized/model.onnx')` relative to the compiled main entry point.

---

## Testing Strategy

### Test Pyramid (as of Phase 8)

```
         /  E2E (13 files) \    Automated: starts Local, MCP protocol,
        /   (automated)     \   tool execution against real sites
       /____________________\
      /  Eval (42 tests)     \  Deterministic: instruction/resource quality,
     /   (automated, <2s)     \ zero LLM cost, content structure validation
    /_________________________\
   /  Integration (73 tests)   \  Full pipeline: extract → embed → store → search
  /   (automated, real deps)    \ MCP protocol compliance
 /______________________________\
/    Unit Tests (429 tests)       \  VectorStore, EmbeddingService, MySQLExtractor,
/   (automated, fast, all mocked)  \ FileScanner, ContentPipeline, McpServer,
/___________________________________\ composite tools, safety, bridge, lifecycle
```

**Run commands:**
- `npm test` — unit tests (429)
- `npm run test:eval` — eval tests (42, <2s)
- `npm run test:e2e` — E2E tests (requires Local running)
- `npm run test:all` — unit + eval

### Unit Test Architecture

```javascript
// jest.config.js — unit tests (429 tests)
// testPathIgnorePatterns: ['/node_modules/', '/lib/', '/integration/', '/e2e/', '/eval/']

// jest.eval.config.js — eval tests (42 tests, no ONNX mapper, 30s timeout)
// Matches: tests/eval/**/*.test.ts only

// jest.e2e.config.js — E2E tests (separate, requires running Local)
```

### Mock Strategy

**Local APIs (tests/__mocks__/local-main.ts):**
```typescript
export const LocalMain = {
  getServiceContainer: () => ({
    cradle: {
      localLogger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      userData: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
      siteData: { getSite: jest.fn(), getSites: jest.fn() },
      siteProcessManager: { getSiteStatus: jest.fn() },
    }
  }),
  registerLightningService: jest.fn(),
};
```

**Native modules:**
- `onnxruntime-node`: mock `InferenceSession` that returns deterministic 384-dim vectors
- `@lancedb/lancedb`: mock connection that stores data in-memory (Map-based)
- `mysql2`: mock connection that returns fixture data

**Integration tests (separate config):**
- Use real LanceDB (temp directory)
- Use real ONNX Runtime (requires model file)
- Mock MySQL (fixture data)
- Test the full pipeline end-to-end

### Test Fixtures

**`tests/fixtures/wordpress-posts.json`:**
Sample of 20 WordPress posts with realistic content (Gutenberg blocks, shortcodes, HTML), metadata, categories, and tags. Copied from spike 3 test output.

**`tests/fixtures/site-structure/`:**
Minimal wp-content directory with a theme (style.css) and two plugins (header files).

**`tests/fixtures/embeddings.json`:**
Pre-computed embeddings for the fixture posts (for deterministic search tests without requiring ONNX Runtime).

---

## CI/CD Pipeline

### GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

  build:
    strategy:
      matrix:
        include:
          - os: macos-14       # ARM64 runner
            platform: darwin-arm64
          - os: macos-13       # x64 runner
            platform: darwin-x64
          - os: ubuntu-latest
            platform: linux-x64
          - os: windows-latest
            platform: win32-x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - run: bash scripts/strip-platforms.sh ${{ matrix.platform }}
      - run: node scripts/verify-native-modules.js
      - run: node scripts/package-addon.js ${{ matrix.platform }}
      - uses: actions/upload-artifact@v4
        with:
          name: addon-${{ matrix.platform }}
          path: dist/*.tgz

  integration-test:
    needs: build
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run test:integration
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ONNX Runtime doesn't load in Electron ^37 | Low | High | Spike 5 confirmed N-API compatibility. If fails: test with `electron-rebuild`, or fall back to `@xenova/transformers` (WASM-based, no native deps) |
| LanceDB native bindings fail in Electron | Low | High | Same as above. The vectordb addon already ships LanceDB in Local. Fall back to Vectra (pure JS) |
| MySQL socket path differs across platforms | Medium | Medium | macOS validated in spikes. Windows uses TCP (port from sites.json). Linux uses socket at similar path. Platform-specific socket resolution in MySQLExtractor |
| MCP port collision with existing MCP addon | Low | Low | Use different port range (10800-10899 vs 10789). Check port availability before binding |
| Embedding model tokenizer issues | Medium | Medium | The all-MiniLM-L6-v2 tokenizer is WordPiece (well-documented). If custom implementation has issues: bundle the `tokenizers` WASM package as fallback |
| Large sites (10,000+ posts) slow to index | Low | Medium | Batch processing with progress reporting. Index in chunks of 100 posts. Yield to event loop between batches via `setImmediate()` |
| Event loop blocking during bulk embedding | Low | Medium | Spike 2 showed 4ms P99 impact. If worse in Electron: move to `worker_threads`. Architecture supports this — `EmbeddingService` interface doesn't change |

---

## Out of Scope (V1)

These are explicitly deferred. They are not forgotten — they are sequenced for later:

- **Tier 2 (WP Engine Cloud AI Gateway):** Requires backend API development. Blocked on WPE platform decisions.
- **Tier 4 (BYOK API keys):** Depends on Gateway architecture. No value without routing layer.
- **WordPress plugin (WP Admin surface):** Nice-to-have but not needed for developer-facing V1.
- **Cross-site search:** Searching across all sites simultaneously. V1 searches one site at a time. The vector store supports this (query all tables), but the UX and relevance ranking need more thought.
- **Incremental indexing:** V1 re-indexes the full site each time. Incremental (index only changed posts) requires change detection — either MySQL triggers, WP-CLI `post meta`, or filesystem watching. Deferred to V2.
- **Content change webhooks:** WordPress notifying the addon when content changes. Requires the WordPress plugin (out of scope).
- **AI agents / autonomous workflows:** Vision items for later phases.
- **Observability dashboard:** Vision item. V1 has basic status display.
- **Multiple embedding models:** V1 ships one model. Supporting model selection (e.g., nomic-embed-text via Ollama) is Tier 3 enhancement.

---

## Progress Tracking

During implementation, this file will be updated with status markers:

```
- [ ] Not started
- [~] In progress
- [x] Complete
- [!] Blocked (see notes)
```

Each phase section above has acceptance criteria formatted as checkboxes. These serve as the progress tracker throughout implementation.

### Current Status (2026-03-01)

| Metric | Value |
|--------|-------|
| Phases complete | 1–8 |
| MCP tools | 48 across 8 modules |
| Unit tests | 429 |
| Eval tests | 42 |
| E2E test files | 13 |
| Integration tests | 73 |
| Next phase | 9 (Ollama Integration) |

**Modules:** content, site-context, ollama, fleet, site-management, wp-cli, wpe, composite

### Session Handoff Protocol

When starting a new session, read this file first. The acceptance criteria checkboxes show what's done and what's next. The architecture diagrams and interface definitions are the source of truth for implementation — do not deviate without updating this document.
