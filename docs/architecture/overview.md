# Architecture Overview

Nexus AI is a Local by Flywheel addon that adds AI capabilities, usage tracking, and fleet management for WordPress sites.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Local by Flywheel (Electron App)                                │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Renderer Process (React UI)                               │ │
│  │  - Nexus Overview Dashboard                                │ │
│  │  - Fleet Management                                        │ │
│  │  - Content Browser                                         │ │
│  │  - AI Gateway Usage Panels                                │ │
│  └─────────────────┬──────────────────────────────────────────┘ │
│                    │ IPC                                         │
│  ┌─────────────────▼──────────────────────────────────────────┐ │
│  │ Main Process (Node.js)                                     │ │
│  │                                                             │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │ IPC Handlers (src/main/ipc-handlers.ts)            │  │ │
│  │  │  - WordPress management                             │  │ │
│  │  │  - Bulk operations                                  │  │ │
│  │  │  - WPE CAPI operations                             │  │ │
│  │  │  - Content indexing                                 │  │ │
│  │  │  - Settings management                              │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │                                                             │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │ AI Gateway (src/main/ai-gateway/)                  │  │ │
│  │  │  - HTTP server (localhost:13000)                    │  │ │
│  │  │  - Routes AI requests from WordPress                │  │ │
│  │  │  - Tracks usage, tokens, cost                       │  │ │
│  │  │  - Caller detection (plugin/theme/feature)         │  │ │
│  │  │  - Rate limiting                                    │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │                                                             │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │ Content Indexer (src/main/content/)                │  │ │
│  │  │  - Reads WordPress files/database                   │  │ │
│  │  │  - Generates embeddings                             │  │ │
│  │  │  - Semantic search                                  │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │                                                             │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │ MCP Server (src/main/mcp/)                         │  │ │
│  │  │  - wp_* tools (WordPress management)                │  │ │
│  │  │  - wpe_* tools (WPE hosting management)            │  │ │
│  │  │  - local_* tools (Local app integration)           │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │                                                             │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │ Storage (src/main/storage/)                        │  │ │
│  │  │  - SQLite database (graph-storage.db)              │  │ │
│  │  │  - Events, chunks, documents, issues                │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────────────────┘

External Integrations:
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ WordPress Sites│    │ WP Engine CAPI │    │ AI APIs        │
│ (localhost)    │←──│ (api.wpengine) │    │ (Anthropic,    │
│                │    │                │    │  OpenAI, etc.) │
└────────────────┘    └────────────────┘    └────────────────┘
```

## Component Details

### Renderer Process (React UI)

**Technology:**
- React (class-based, no hooks - Local constraint)
- No JSX (uses `React.createElement()`)
- TypeScript

**Key Components:**
- `NexusOverview.tsx` - Main dashboard with Overview/Operations tabs
- `FleetOverview.tsx` - Local + remote sites management
- `ContentBrowser.tsx` - Semantic search across sites
- `AIGatewayUsagePanel.tsx` - AI usage tracking table
- `AIGatewayByCallerPanel.tsx` - Aggregated usage by plugin/theme/feature
- `BulkOperationsPanel.tsx` - Multi-site operations
- `SiteGroupsPanel.tsx` - Site organization and filtering

**Communication:**
- Uses `electron.ipcRenderer.invoke()` to call main process
- Receives updates via IPC events

### Main Process (Node.js)

#### IPC Handlers

**File:** `src/main/ipc-handlers.ts`

**Responsibilities:**
- Handle all renderer requests
- Validate inputs (Zod schemas)
- Execute operations
- Return responses

**Pattern:**
```typescript
ipcMain.handle(IPC_CHANNELS.OPERATION, async (event, params) => {
  try {
    const validated = validateInput(Schema, params);
    const result = await performOperation(validated);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});
```

#### AI Gateway

**Directory:** `src/main/ai-gateway/`

**Files:**
- `AIGatewayRoutes.ts` - HTTP route handlers
- `anthropic-client.ts` - Anthropic API wrapper
- `format-translator.ts` - OpenAI ↔ Anthropic format conversion
- `rate-limiter.ts` - Rate limiting logic
- `token-manager.ts` - Per-site authentication tokens
- `mu-plugin-template.ts` - Auto-deployed MU plugin for caller tracking

**Flow:**
1. WordPress site makes AI request
2. LocalGatewayProvider sends to `http://localhost:13000/ai-gateway/v1/chat/completions`
3. Gateway validates token, checks rate limits
4. Translates OpenAI format → Anthropic Messages API
5. Calls Anthropic API
6. Translates response back to OpenAI format
7. Logs usage (tokens, cost, caller info)
8. Returns to WordPress

**Caller Tracking:**
- MU plugin auto-deployed to all sites
- Uses `debug_backtrace()` to detect plugin/theme
- Detects WordPress core features via REST API paths
- Injects headers: `X-WP-Caller-Plugin`, `X-WP-Caller-Feature`, etc.

#### Content Indexer

**Directory:** `src/main/content/`

**Files:**
- `ContentIndexer.ts` - Main indexing logic
- `EmbeddingGenerator.ts` - Generate embeddings via transformers.js
- `DocumentChunker.ts` - Split documents into chunks
- `IndexRegistry.ts` - Storage interface

**Process:**
1. Scan WordPress files (posts, pages, plugins, themes)
2. Extract text content
3. Chunk into manageable pieces (512 tokens)
4. Generate embeddings (384-dimensional vectors)
5. Store in SQLite with metadata
6. Build search index

**Search:**
1. User enters query
2. Generate query embedding
3. Cosine similarity search against indexed chunks
4. Return top K results with context

#### MCP Server

**Directory:** `src/main/mcp/`

**Structure:**
```
mcp/
├── server.ts              # MCP server setup
├── modules/
│   ├── wp-connector/     # WordPress tools
│   │   ├── wp-cli.ts
│   │   ├── setup-ai.ts
│   │   └── credential-sync.ts
│   ├── wpe-connector/    # WP Engine tools
│   │   ├── CAPIClient.ts
│   │   └── fleet-tools.ts
│   └── local-connector/  # Local app tools
└── types/
```

**Tool Categories:**
1. **WordPress management** (`wp_*`)
   - Plugin install/activate/list
   - Core version
   - Database operations
   - Theme management

2. **WP Engine hosting** (`wpe_*`)
   - Account/site/install CRUD
   - Domain management
   - SSL certificate requests
   - Backup operations
   - Usage analytics

3. **Local app** (`local_*`)
   - Site creation/management
   - WPE link/pull/push
   - Backup operations

**Used by:**
- Claude Code (via MCP protocol)
- Internal addon operations

#### Storage Layer

**File:** `src/main/storage/GraphStorage.ts`

**Database:** SQLite (`graph-storage.db`)

**Tables:**
```sql
-- Site events (webhook data)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  siteId TEXT,
  eventType TEXT,
  timestamp INTEGER,
  data TEXT
);

-- Indexed document chunks
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  siteId TEXT,
  documentId TEXT,
  content TEXT,
  embedding BLOB,  -- 384-dimensional vector
  metadata TEXT    -- JSON
);

-- Issue tracking
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  siteId TEXT,
  severity TEXT,
  message TEXT,
  timestamp INTEGER
);
```

**Indexes:**
```sql
CREATE INDEX idx_events_site_time ON events(siteId, timestamp);
CREATE INDEX idx_chunks_site ON chunks(siteId);
CREATE INDEX idx_issues_site ON issues(siteId, severity);
```

**Storage Keys** (Local's storage):
```typescript
nexus_ai_gateway_usage        # AI usage records
nexus_ai_gateway_tokens       # Per-site auth tokens
nexus_site_groups             # User-defined site groups
nexus_saved_queries           # Saved search queries
nexus_audit_logs              # Operation audit trail
api_keys                      # API credentials (encrypted)
wpe_auth                      # WPE CAPI credentials
ai_proxy_info                 # Gateway configuration
```

## Data Flow Examples

### AI Request Flow

```
WordPress Site
  │ wp_ai_generate_text(['prompt' => 'Write...', 'model' => 'claude-haiku'])
  ▼
LocalGatewayProvider (WordPress AI plugin)
  │ POST http://localhost:13000/ai-gateway/v1/chat/completions
  │ Headers: X-Auth-Token, X-WP-Caller-Plugin, X-WP-Caller-Feature
  │ Body: { model: 'claude-haiku-4-5', messages: [{role: 'user', content: 'Write...'}] }
  ▼
AI Gateway Routes (AIGatewayRoutes.ts)
  │ 1. Validate token → get siteId
  │ 2. Check rate limits
  │ 3. Translate OpenAI → Anthropic format
  │ 4. Get API key from storage
  ▼
Anthropic API
  │ POST https://api.anthropic.com/v1/messages
  │ x-api-key: sk-ant-...
  │ { model: 'claude-haiku-20250304', messages: [...] }
  ▼
Anthropic API Response
  │ { id: '...', content: [{type: 'text', text: '...'}], usage: {...} }
  ▼
AI Gateway Routes
  │ 1. Translate Anthropic → OpenAI format
  │ 2. Calculate cost
  │ 3. Extract caller info from headers
  │ 4. Store usage record
  │ 5. Emit event (updates UI)
  ▼
WordPress Site
  │ wp_ai_generate_text() returns text
  ▼
Nexus AI UI
  │ Usage panel updates with new request
  │ By Caller panel shows attribution
```

### Bulk Setup AI Flow

```
User clicks "Bulk Setup AI" on 50 sites
  ▼
BulkOperationsPanel.tsx
  │ electron.ipcRenderer.invoke(IPC_CHANNELS.BULK_SETUP_AI, {
  │   siteIds: [...50 UUIDs...],
  │   confirmProduction: true
  │ })
  ▼
IPC Handler (ipc-handlers.ts)
  │ 1. Validate inputs (BulkSetupAISchema)
  │ 2. Check production safeguards
  │ 3. Call pMap() with concurrency: 5
  ▼
Parallel Execution (parallel.ts)
  │ Process in batches of 5:
  │   [Site 1, 2, 3, 4, 5] → Promise.all()
  │   [Site 6, 7, 8, 9, 10] → Promise.all()
  │   ...
  │   [Site 46, 47, 48, 49, 50] → Promise.all()
  │
  │ For each site:
  ▼
Setup AI (setup-ai.ts)
  │ 1. Install WordPress AI plugin
  │ 2. Install Nexus AI Connector
  │ 3. Install Local Gateway Provider
  │ 4. Deploy MU plugin (webhook + gateway config)
  │ 5. Sync credentials
  │ 6. Return result
  ▼
Progress Events
  │ event.sender.send('bulk-operation-progress', {
  │   completed: 23,
  │   total: 50,
  │   siteId: 'current-site-id',
  │   result: { success: true }
  │ })
  ▼
BulkOperationsPanel.tsx
  │ Updates progress bar: "23/50 sites complete"
  ▼
Final Result
  │ { success: true, stats: { total: 50, successful: 48, failed: 2 } }
  │ Shows failed sites with error messages
```

## Security Architecture

### Trust Boundaries

**Trusted:**
- Main process (our code)
- Local's storage (encrypted)
- Localhost network

**Untrusted:**
- Renderer process (could be compromised)
- WordPress sites (user might install malicious plugin)
- User inputs (from UI)
- External APIs (could return unexpected data)

### Defense Mechanisms

1. **Input Validation**
   - All IPC inputs validated with Zod schemas
   - WP-CLI arguments sanitized
   - Path traversal prevention

2. **Credential Protection**
   - API keys never logged
   - Redaction on all log outputs
   - Masked in UI (show last 4 chars only)

3. **Production Safeguards**
   - Destructive operations require explicit confirmation
   - `confirmProduction` flag for bulk ops on production sites

4. **Audit Logging**
   - All remote operations logged
   - Track: operation, target, params, result, timestamp

5. **Rate Limiting**
   - Per-site request limits
   - Per-site cost limits
   - Prevents API overspending

## Performance Characteristics

### Scalability Targets

- **500 local sites** - Tested with virtual scrolling in UI
- **300 remote sites** - CAPI pagination handles this
- **50 concurrent bulk ops** - Parallel execution with concurrency: 5
- **100K indexed chunks** - SQLite with indexes handles well
- **100 AI req/sec** - Gateway throughput (unlikely but supported)

### Optimization Strategies

1. **Virtual Scrolling** - Fleet Overview, usage tables
2. **Parallel Execution** - Bulk operations with concurrency control
3. **Pagination** - CAPI results, search results
4. **Indexes** - SQLite indexes on common queries
5. **Memoization** - React component calculations cached
6. **Background Processing** - Content indexing async with progress

## Technology Stack

- **Electron** - Desktop app framework
- **React** - UI (class-based, no JSX)
- **TypeScript** - Type safety
- **SQLite** (better-sqlite3) - Local database
- **Transformers.js** - Embeddings generation
- **Zod** - Schema validation
- **Anthropic SDK** - AI API client

## See Also

- [Data Flow Diagrams](./data-flow.md)
- [Security Model](./security-model.md)
- [Performance Guide](./performance.md)
