# Sprint 4: AI Everywhere - Detailed Design & Plan

**Sprint Goal:** Seamless AI in all WordPress sites - configure once in Local, works everywhere.

**Timeline:** 3 weeks (tighter than roadmap's 6 weeks - most credential infrastructure already built)
**Current Date:** 2026-03-06
**Prerequisites:** Sprint 1 (Visibility) + Sprint 2 (Discovery) + Sprint 3 (Automation) complete

---

## Executive Summary

### What We're Building

Sprint 4 completes the Nexus AI vision by closing Aha Moment #6: "I configured AI once in Local, and now all my WordPress sites have AI capabilities." The infrastructure is 90% built - this sprint wires the remaining gaps and adds the production deployment story.

Users will be able to:

1. **Live Credential Sync** - Save an API key in Local preferences, all running WordPress sites get it immediately (not just on next restart)
2. **One-Click AI Setup** - "Setup AI" button in per-site view installs plugin, syncs keys, enables experiments, configures Ollama
3. **Fleet-Wide AI Setup** - Bulk operation to setup AI across all sites at once
4. **AI Proxy Endpoint** - WordPress sites call Local for AI inference via Ollama (no external API keys needed)
5. **Production Deployment Guide** - Document how AI config follows sites from Local to WP Engine

### Why This Matters

**After Sprint 1-3:** Users can see, search, and manage their fleet. AI chat works in the addon. WordPress sites are separate from AI.

**After Sprint 4:** WordPress sites ARE AI-capable. The developer configures AI once and every site benefits. Local becomes the AI infrastructure layer the vision document describes.

### Key "Aha Moments"

- "I saved my OpenAI key in Local and went to WordPress - AI features just worked"
- "I don't need to configure AI separately for each of my 12 sites"
- "My WordPress sites use my local Ollama for AI - no API keys, no cloud, fully private"
- "I pushed my site to WP Engine and the AI features transferred automatically"

---

## Architecture Overview

### Data Flow: Credential Propagation

```
NexusPreferences (UI)
    |
    v
SAVE_API_KEY IPC handler
    |
    v
storeApiKey() --> registryStorage
    |
    v (NEW: broadcast)
CredentialSyncBroadcaster
    |
    v
For each running site:
    autoSyncCredentials(siteId) --> wp eval PHP --> wp_options
```

### Data Flow: AI Proxy (Ollama Gateway)

```
WordPress Site (WP Admin)
    |
    v (HTTP POST)
Local AI Proxy (:13100/v1/chat/completions)
    |
    v
OllamaProvider (existing)
    |
    v
Ollama (:11434)
    |
    v (response)
WordPress Site
```

### What Exists Today

**Backend (built in prior sprints + phases):**
- `autoSyncCredentials()` - Syncs API keys to WP 7.0+ sites on start (lifecycle hook)
- `wp_sync_ai_credentials` MCP tool - Manual sync with dry-run, per-provider filtering
- `setupSiteForAI()` - Full setup: AI plugin install, provider plugins, experiments, credentials, ACF abilities
- `credential-helpers.ts` - PHP builder for dual-store credential writes (Connector Screen + AI plugin)
- `wp_list_abilities` / `wp_run_ability` MCP tools - WordPress Abilities API integration
- `HttpEventInterface` - HTTP server for WordPress events (port 13000, Bearer auth)
- `OllamaProvider` - Chat completion via Ollama with streaming support
- `NexusPreferences` - UI for API key management (save, validate, per-provider)
- `ChatService` - Tool-calling AI chat with Ollama/cloud provider support
- `SAVE_API_KEY` IPC handler - Stores key but does NOT re-sync running sites
- `ai-provider-for-ollama` - Bundled WordPress plugin for Ollama as WP AI provider
- `ai` experiments plugin - Bundled with MCP adapter, abilities, experiments

**Frontend (built in prior sprints):**
- `NexusPreferences` - Provider selection, API key input, save/validate
- `SiteNexusSection` - Per-site addon panel (has "Setup AI" button wired to IPC)
- `FleetOverview` - Dashboard with Overview, Search, Sites, Chat, Visibility, Bulk Ops tabs

### What We Need to Build

**Backend (New):**
1. `CredentialSyncBroadcaster` - Re-sync all running sites when credentials change
2. `AiProxyServer` - OpenAI-compatible HTTP endpoint backed by Ollama
3. AI Proxy config via wp_options - Routes WP AI requests to Local's proxy
4. `bulk_setup_ai` operation type - Setup AI across fleet via BulkOperationManager
5. Production credential export/documentation

**Frontend (Modifications):**
1. Enhance `NexusPreferences` - Show sync status, per-site credential state
2. Enhance `SiteNexusSection` - Show AI readiness status after setup
3. Add AI Status column to Sites tab in FleetOverview

---

## Detailed Design

### 1. CredentialSyncBroadcaster

**Purpose:** When a user saves or changes an API key in NexusPreferences, immediately sync to all running WordPress sites. Currently keys only sync on site start.

**Location:** `src/main/credentials/CredentialSyncBroadcaster.ts`

```typescript
interface CredentialSyncBroadcasterDeps {
  localServices: LocalServicesBridge;
  registryStorage: RegistryStorage;
  siteData: SiteDataAccessor;
  logger: Logger;
}

class CredentialSyncBroadcaster {
  // Sync a single provider's key to all running sites
  async broadcastKeyChange(providerId: string): Promise<SyncResult[]>;

  // Sync all configured keys to a single site (used by setup-ai)
  async syncAllKeysToSite(siteId: string): Promise<SyncResult>;

  // Get current sync status for all sites
  getSyncStatus(): Map<string, SiteSyncStatus>;
}

interface SyncResult {
  siteId: string;
  siteName: string;
  success: boolean;
  providers: string[];
  error?: string;
}

interface SiteSyncStatus {
  lastSync: number | null;
  providers: string[];
  success: boolean;
}
```

**Integration point:** The `SAVE_API_KEY` IPC handler in `chat-ipc-handlers.ts` currently does:
```typescript
storeApiKey(registryStorage, providerId, apiKey);
setKeyStatus(registryStorage, providerId, 'unchecked');
return { success: true };
```

After this sprint, it will also call:
```typescript
await credentialBroadcaster.broadcastKeyChange(providerId);
```

**Running site detection:** Uses `localServices` to enumerate sites, checks each site's status. Only syncs to sites with status `running`.

**Tests (6):**
- broadcastKeyChange syncs to all running sites
- broadcastKeyChange skips halted sites
- broadcastKeyChange handles per-site failures independently
- syncAllKeysToSite syncs all configured providers
- getSyncStatus returns accurate per-site state
- No-op when no API keys configured

---

### 2. AI Proxy Server (Ollama Gateway with Tool Calling)

**Purpose:** Provide an OpenAI-compatible HTTP endpoint that WordPress sites can call for AI inference **with full tool calling support**. Routes to Ollama locally. This means WordPress gets AI without any external API keys - just Local + Ollama. Critically, the proxy doesn't just forward — it can inject Local's MCP tools, execute tool calls server-side, and return results, giving WordPress fleet-aware AI capabilities.

**Location:** `src/main/ai-proxy/AiProxyServer.ts`

**Why OpenAI-compatible:** WordPress 7's `php-ai-client` and the AI Experiments plugin both support OpenAI-format APIs. By implementing the same interface, WordPress treats Local's proxy as an OpenAI endpoint, no WordPress code changes needed.

**Endpoints:**

```
POST /v1/chat/completions  - Chat completion with tool calling (streaming + non-streaming)
POST /v1/embeddings        - Embedding generation (via bundled ONNX)
GET  /v1/models            - List available models (from Ollama, with tool support metadata)
GET  /health               - Health check (Ollama status + tool count)
```

**Design:**

```typescript
interface AiProxyServerOptions {
  logger: Logger;
  port?: number;            // Default: 0 (auto-assign), stored for WP config
  authToken?: string;       // Auto-generated Bearer token
  toolRegistry: ToolRegistry;   // Local's MCP tool registry (58+ tools)
  nexusServices: NexusServices; // Services for tool execution
  embeddingService: EmbeddingService;
}

class AiProxyServer {
  async start(): Promise<AiProxyConnectionInfo>;
  async stop(): Promise<void>;
  getConnectionInfo(): AiProxyConnectionInfo | null;
}

interface AiProxyConnectionInfo {
  url: string;       // e.g., http://localhost:13100
  port: number;
  authToken: string;
  models: string[];           // Available Ollama models
  toolCapableModels: string[]; // Models that support native tool calling
}
```

#### Tool Calling Architecture

The proxy supports three tool calling modes, selected per-request via the `X-Nexus-Tools` header or request body:

**Mode 1: Passthrough (default)**
WordPress sends its own `tools` array. The proxy forwards them to Ollama and returns tool_calls in the response. WordPress handles execution.

```
WordPress --tools--> Proxy --tools--> Ollama
WordPress <--tool_calls-- Proxy <--tool_calls-- Ollama
WordPress executes tools itself, sends results in next request
```

**Mode 2: Inject Local Tools (`X-Nexus-Tools: inject`)**
The proxy appends Local's MCP tools to whatever tools WordPress sends. WordPress gets access to fleet intelligence, content search, site management — all through standard OpenAI tool calling.

```
WordPress --tools--> Proxy --[WP tools + MCP tools]--> Ollama
WordPress <--tool_calls-- Proxy <--tool_calls-- Ollama
WordPress sees tool_calls for both WP and MCP tools
```

**Mode 3: Agentic (`X-Nexus-Tools: agentic`)**
The proxy injects Local's MCP tools AND executes any MCP tool calls server-side, feeding results back to Ollama in a loop. WordPress only sees the final text response. This is the most powerful mode — WordPress asks a question and Local's AI agent resolves it autonomously.

```
WordPress --question--> Proxy --[+ MCP tools]--> Ollama
                        Proxy <--tool_call: fleet_health_summary--
                        Proxy executes tool, gets result
                        Proxy --[result as tool message]--> Ollama
                        Proxy <--final text response--
WordPress <--text-- Proxy
```

**Agentic loop limits:**
- Max 5 tool call rounds per request (prevents runaway loops)
- 30-second timeout per tool execution
- Only Tier 1 (read-only) and Tier 2 (safe write) tools — no Tier 3 destructive tools
- Tool results truncated to 4KB to fit in context

#### Ollama Tool Calling Format Translation

Ollama's native tool calling format (see https://ollama.com/blog/tool-support) is nearly identical to OpenAI's:

**Request (OpenAI format from WordPress):**
```json
{
  "model": "llama3.1",
  "messages": [{"role": "user", "content": "..."}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get weather for a location",
      "parameters": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] }
    }
  }]
}
```

**Ollama native format (sent to Ollama):**
```json
{
  "model": "llama3.1",
  "messages": [{"role": "user", "content": "..."}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get weather for a location",
      "parameters": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] }
    }
  }],
  "stream": false
}
```

The formats are identical for `tools`. Key differences:
- Ollama returns `message.tool_calls[].function.arguments` as an **object**, OpenAI returns it as a **JSON string**. The proxy must `JSON.stringify()` when translating Ollama → OpenAI.
- Tool results use `role: "tool"` in both formats — no translation needed.
- When tools are present, we use `stream: false` for reliable tool call parsing (same approach as our existing `OllamaProvider.nonStreamingChat`).

**Model tool support detection:** Reuse the same `checkToolSupport()` approach from `OllamaProvider` — query `/api/show`, check template for `.Tools`/`.ToolCalls` markers. Cache results. The `/v1/models` endpoint exposes which models support tools so WordPress can select appropriately.

**Fallback for non-tool-capable models:** If the selected Ollama model doesn't support native tool calling, the proxy injects tool descriptions into the system prompt (same approach as `OllamaProvider.injectToolDescriptions`). The model can describe what tools to call but can't invoke them programmatically. In agentic mode, the proxy parses the model's text output for structured tool invocations (best-effort).

#### MCP Tool Conversion to OpenAI Format

Local's MCP tools are already defined with JSON Schema input schemas, which map directly to OpenAI's `tools[].function.parameters`:

```typescript
// MCP tool definition (existing)
{
  name: 'fleet_health_summary',
  description: 'Get health scores for all indexed sites',
  inputSchema: { type: 'object', properties: { ... } }
}

// Converted to OpenAI tool format (automatic)
{
  type: 'function',
  function: {
    name: 'fleet_health_summary',
    description: 'Get health scores for all indexed sites',
    parameters: { type: 'object', properties: { ... } }
  }
}
```

The conversion is trivial — wrap in `{ type: 'function', function: { name, description, parameters: inputSchema } }`.

**Tool filtering for proxy:**
- Skip tools where `isAvailable(services)` returns false
- Skip Tier 3 (destructive) tools in agentic mode
- Limit to 20 tools max (same as `MAX_OLLAMA_TOOLS` — local models can't handle 58 tool definitions reliably)
- Prioritize: fleet intelligence > content > site management > wp-cli

**Chat completion handler (updated):**
1. Parse OpenAI-format request body (`model`, `messages`, `tools`, `stream`, `temperature`, etc.)
2. Detect tool mode from `X-Nexus-Tools` header (default: passthrough)
3. Check model tool support via `/api/show` (cached)
4. If inject/agentic mode: merge WordPress tools + MCP tools (up to 20 total)
5. If model lacks tool support: inject tool descriptions into system prompt instead
6. Transform to Ollama format, forward to Ollama `/api/chat` with `stream: false` when tools present
7. Parse response: if `tool_calls` present and agentic mode:
   a. Execute MCP tool calls via ToolRegistry (Tier 1+2 only)
   b. Append tool results as `role: "tool"` messages
   c. Re-send to Ollama (loop up to 5 rounds)
8. Transform final Ollama response to OpenAI format (`arguments` object → JSON string)
9. For streaming without tools: forward SSE events, translating Ollama chunks to OpenAI delta format

**Embedding handler:**
1. Parse OpenAI-format request (`model`, `input`)
2. Use bundled `EmbeddingService` (ONNX, no Ollama dependency)
3. Return OpenAI-format embedding response

**Security:**
- Bearer token auth (same pattern as HttpEventInterface)
- Binds to localhost only (127.0.0.1)
- Rate limiting: 60 requests/minute
- Request size limit: 1MB
- Agentic mode: only Tier 1+2 tools, max 5 rounds, 30s timeout per tool

**Tests (16):**
- Chat completion returns OpenAI-format response (no tools)
- Streaming chat completion returns SSE events (no tools)
- Passthrough: forwards WordPress tools to Ollama, returns tool_calls
- Passthrough: translates Ollama tool_calls arguments (object → JSON string)
- Inject mode: merges MCP tools with WordPress tools
- Inject mode: limits to 20 tools total
- Inject mode: skips unavailable tools
- Agentic mode: executes MCP tool call and feeds result back to Ollama
- Agentic mode: max 5 rounds prevents infinite loops
- Agentic mode: skips Tier 3 tools
- Agentic mode: tool execution timeout (30s)
- Non-tool-capable model: injects tool descriptions into system prompt
- Embedding endpoint returns 384-dim vectors
- Models endpoint includes toolCapable flag per model
- Auth: rejects requests without Bearer token
- Returns 503 when Ollama not available

---

### 3. AI Proxy Configuration via wp_options

**Purpose:** Configure WordPress sites to route AI requests through Local's proxy by writing connection info to `wp_options`. Uses the existing `wp eval` pattern from `setup-ai.ts`.

**How it works:**
- WordPress 7's `php-ai-client` uses a Provider Registry. The Ollama provider plugin (`ai-provider-for-ollama`) is already bundled and installed by `setupSiteForAI()`.
- The proxy config (URL + auth token) is written to `wp_options` via `wp eval`, which the Ollama provider reads at runtime.
- Local runs sites natively on the host (no Docker), so the proxy URL is simply `http://localhost:<port>`.

**Configuration written by setupSiteForAI (Step 6):**
```php
update_option('nexus_ai_proxy_url', 'http://localhost:13100');
update_option('nexus_ai_proxy_token', '<bearer-token>');
```

**No new mu-plugin needed:** The existing `ai-provider-for-ollama` plugin already handles routing. We just need to write the connection details to `wp_options` so it knows where to point.

---

### 4. Bulk AI Setup

**Purpose:** Add `setup-ai` as a bulk operation type so users can "Setup AI on all sites" from the dashboard.

**Location:** Extends existing `BulkOperationManager` in `src/main/bulk/`

**New operation type:**
```typescript
type BulkOpType = 'reindex' | 'plugin-update' | 'health-refresh' | 'start' | 'stop' | 'setup-ai';
```

**Executor:** For each site, calls `setupSiteForAI(siteId, ...)` which already handles the full flow (plugin install, experiments, credentials, ACF abilities, Ollama provider).

**UI:** Add "Setup AI" option to BulkOperationsPanel dropdown. Only shown when at least one API key is configured or Ollama is available.

**Tests (4):**
- Bulk setup-ai calls setupSiteForAI for each site
- Skips halted sites with appropriate error
- Per-site error isolation (one failure doesn't abort)
- Progress callback reports per-site status

---

### 5. Enhanced Setup Flow (setupSiteForAI v2)

**Purpose:** Extend `setupSiteForAI()` to write AI Proxy connection info to `wp_options`.

**Changes to `src/main/mcp/modules/wp-connector/setup-ai.ts`:**

Add Step 6 after existing Step 5 (ACF abilities):

```typescript
// Step 6: Write AI Proxy config to wp_options
if (options.aiProxyInfo) {
  const php = `update_option('nexus_ai_proxy_url', '${options.aiProxyInfo.url}');`
            + `update_option('nexus_ai_proxy_token', '${options.aiProxyInfo.authToken}');`
            + `echo 'ok';`;
  const result = await localServices.wpCliRun(siteId, ['eval', php]);
  // ...
}
```

**New fields in SetupAIResult:**
```typescript
aiProxy: 'configured' | 'skipped' | 'failed';
```

**Tests (3):**
- Setup writes proxy config to wp_options when proxy info provided
- Setup skips proxy config when no proxy info available
- Bulk setup-ai calls setupSiteForAI for each site

---

### 6. AI Status in Fleet UI

**Purpose:** Show which sites have AI configured and working.

**New IPC channel:** `NEXUS:get-ai-status` - Returns per-site AI readiness.

**AI Status data:**
```typescript
interface SiteAiStatus {
  siteId: string;
  aiPlugin: 'active' | 'inactive' | 'not_installed';
  credentialsSynced: boolean;
  lastSync: number | null;
  providers: string[];       // Which providers have keys
  proxyConfigured: boolean;  // AI proxy mu-plugin installed
  ollamaAvailable: boolean;  // Can reach Ollama
}
```

**UI changes:**

1. **Sites tab** - New "AI" column with status indicator:
   - Green circle: AI fully configured (plugin active + credentials synced)
   - Yellow circle: Partially configured (plugin installed but no keys)
   - Gray dash: Not configured
   - Click opens per-site AI detail

2. **SiteNexusSection** - AI readiness card:
   - Plugin status (installed/active/missing)
   - Credential sync status (last synced, which providers)
   - AI proxy status (configured/not configured)
   - "Setup AI" / "Re-sync" / "View AI Features" buttons

3. **NexusPreferences** - Sync status section:
   - "X of Y running sites have synced credentials"
   - "Sync All Now" button
   - Per-provider key status with last sync time

---

### 7. Production Deployment Guide

**Purpose:** Document how to take an AI-configured local site to WP Engine production.

**Location:** `docs/production-deployment-guide.md`

**Contents:**
1. What transfers automatically (plugins, mu-plugins, wp_options)
2. What needs manual configuration (API keys in WP Engine environment)
3. Credential management: WP Engine Connector Screen vs Local's auto-sync
4. Ollama proxy: local-only feature, won't work in production (document alternatives)
5. Migration checklist: pre-push verification, post-push validation
6. FAQ: "Will my AI features work on WP Engine?" → Yes, if you configure API keys in WP Engine's Connector Screen or use WP Engine's AI Gateway

---

## Implementation Plan

### Week 1: Backend Infrastructure

**Day 1: CredentialSyncBroadcaster**
- Create `src/main/credentials/CredentialSyncBroadcaster.ts`
- `broadcastKeyChange(providerId)` - enumerate running sites, call autoSyncCredentials each
- `syncAllKeysToSite(siteId)` - sync all configured providers to one site
- `getSyncStatus()` - return Map of site ID to sync state
- Integrate into `SAVE_API_KEY` IPC handler (after storeApiKey, trigger broadcast)
- Add `SYNC_ALL_CREDENTIALS` IPC channel for manual "Sync All" button
- Add `GET_CREDENTIAL_SYNC_STATUS` IPC channel
- Unit tests (6 tests)

**Day 2: AI Proxy Server - Core + Passthrough Tool Calling**
- Create `src/main/ai-proxy/AiProxyServer.ts`
- Create `src/main/ai-proxy/types.ts` - AiProxyConnectionInfo, OpenAI request/response types
- HTTP server on auto-assigned port, localhost-only binding
- Bearer token auth middleware
- Rate limiting middleware (token bucket, 60 req/min)
- `GET /v1/models` - list Ollama models with `toolCapable` flag (reuse `checkToolSupport` from OllamaProvider)
- `GET /health` - return proxy status + Ollama availability + tool count
- `POST /v1/chat/completions` (no tools) - forward to Ollama, transform response to OpenAI format
- `POST /v1/chat/completions` (passthrough tools) - forward WordPress `tools` array to Ollama, translate `tool_calls` response (arguments object → JSON string)
- Tool result messages (`role: "tool"`) pass through untranslated
- Use `stream: false` when tools present (same as OllamaProvider for reliable tool parsing)
- Unit tests (8 tests: auth, models+toolCapable, health, rate limit, no-Ollama 503, passthrough tools, tool_calls format translation, tool results passthrough)

**Day 3: AI Proxy Server - Tool Injection, Agentic Mode, Streaming, Embeddings**
- `X-Nexus-Tools` header parsing: `passthrough` (default), `inject`, `agentic`
- Create `src/main/ai-proxy/tool-converter.ts` - Convert MCP tool definitions to OpenAI format, filter by availability/tier, limit to 20
- Inject mode: merge MCP tools + WordPress tools, cap at 20, return tool_calls for all
- Agentic mode: execute MCP tool calls via ToolRegistry server-side, loop up to 5 rounds
- Agentic safety: Tier 1+2 only, 30s timeout per tool execution, 4KB result truncation
- Model tool support detection: query `/api/show`, cache results (reuse OllamaProvider pattern)
- Fallback: inject tool descriptions into system prompt for non-tool-capable models
- `POST /v1/chat/completions` with `stream: true` (no tools) - SSE streaming from Ollama with OpenAI delta format
- `POST /v1/embeddings` - use bundled EmbeddingService, return OpenAI-format response
- Request size validation (1MB limit)
- Integration with `index.ts` startup (start after Ollama polling, pass toolRegistry + nexusServices)
- Store connection info in registryStorage for WordPress configuration
- Unit tests (8 tests: inject merges tools, inject caps at 20, agentic executes tool + loops, agentic max 5 rounds, agentic skips Tier 3, streaming SSE format, embeddings 384-dim, non-tool model fallback)

**Day 4: Enhanced Setup — AI Proxy Config via wp_options**
- Extend `setupSiteForAI()` with Step 6: write proxy URL + token to wp_options via `wp eval`
- Local runs sites natively (no Docker) — proxy URL is `http://localhost:<port>`
- Add `aiProxy` field to `SetupAIResult`
- Add `setup-ai` bulk operation type to BulkOperationManager
- Add setup-ai executor calling setupSiteForAI
- Unit tests (3 tests: config write, skip when no proxy, bulk setup)

**Day 5: IPC + Integration Wiring**
- Add Sprint 4 IPC channels to `src/common/constants.ts`:
  - `SYNC_ALL_CREDENTIALS` - Trigger credential broadcast
  - `GET_CREDENTIAL_SYNC_STATUS` - Per-site sync state
  - `GET_AI_STATUS` - Per-site AI readiness
  - `GET_AI_PROXY_INFO` - Proxy server connection info
  - `SETUP_AI_FLEET` - Bulk AI setup (delegates to BulkOperationManager)
- Add Sprint 4 types to `src/common/types.ts` (SiteAiStatus, AiProxyInfo, CredentialSyncStatus)
- Register IPC handlers in `ipc-handlers.ts`
- Wire AiProxyServer into `index.ts` async startup (after Ollama polling)
- Wire CredentialSyncBroadcaster into `chat-ipc-handlers.ts`
- Integration test: save key -> verify broadcast called

### Week 2: Frontend + Documentation

**Day 6: NexusPreferences Enhancements**
- Add credential sync status section below API key input
- "X of Y running sites synced" indicator
- "Sync All Now" button -> calls SYNC_ALL_CREDENTIALS IPC
- Per-provider last sync timestamp
- Sync progress indicator (syncing... / done / X failed)
- AI Proxy status: "Ollama proxy running on :13100" or "Ollama not available"

**Day 7: SiteNexusSection AI Status**
- AI readiness card in per-site view:
  - AI plugin status badge (active/inactive/missing)
  - Credential sync status (synced/pending/no keys)
  - AI proxy status (configured/not configured)
  - Available AI features list (from experiments)
- "Setup AI" button (existing) - update to show result detail
- "Re-sync Credentials" button
- "Open AI Features" link -> opens WP Admin AI page

**Day 8: Fleet Dashboard AI Column + Bulk**
- Sites tab: Add "AI" column with status dot (green/yellow/gray)
- Sites tab: Tooltip on hover showing AI detail
- BulkOperationsPanel: Add "Setup AI" option to operation dropdown
- BulkOperationsPanel: Only show when keys configured or Ollama available
- Overview tab: "AI Fleet Status" card (X sites AI-ready, Y need setup)
- "Setup AI on All Sites" quick action button on overview

**Day 9: Production Deployment Guide + Polish**
- Write `docs/production-deployment-guide.md`
- Write `docs/ai-proxy-guide.md` (how Ollama proxy works, troubleshooting)
- Update `docs/user-guide.md` with Sprint 4 sections
- End-to-end manual testing:
  - Save API key -> verify sync to running site
  - Setup AI -> verify WP Admin AI features work
  - Ollama proxy -> verify WP uses local inference
  - Bulk setup -> verify fleet-wide
- Fix any issues found in testing

**Day 10: Testing & Release**
- Run all Sprint 4 tests: `npx jest tests/unit/credentials/ tests/unit/ai-proxy/`
- Run full test suite: `npx jest --no-coverage`
- TypeScript check: `npx tsc --noEmit`
- Full build: `npm run build`
- Write `docs/sprint-4-completion.md`
- Update `requirements/STATUS.md` and `requirements/COMPREHENSIVE_ROADMAP.md`
- Commit all Sprint 4 work
- Merge sprint-4-ai-everywhere -> main

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| WordPress 7 `php-ai-client` filter API changes | High | Medium | Abstract behind our mu-plugin; update filter names if needed |
| Local runtime environment changes | Low | Low | Sites run natively on localhost — proxy URL is always `http://localhost:<port>` |
| Ollama tool_calls format drift from OpenAI | Medium | Medium | Test with multiple models (llama3.1, mistral, qwen2.5); translate arguments object↔string |
| Agentic loop runaway / infinite tool calls | High | Low | Hard cap at 5 rounds, 30s per-tool timeout, Tier 1+2 only |
| Ollama model can't handle 20 tool definitions | Medium | Medium | Start with 12 tools, measure quality; fall back to fewer for smaller models |
| Tool call parsing unreliable with streaming | Medium | High | Use `stream: false` when tools present (proven pattern from OllamaProvider) |
| Rate limiting too aggressive for AI features | Low | Medium | Make configurable, start generous (60/min), tune based on feedback |
| Large model responses exceed proxy memory | Medium | Low | Streaming by default, cap non-streaming responses at 10MB |
| WP 6.x sites don't have Connector Screen | Low | High | Already handled: version check skips sites below 7.0 |

---

## Dependencies

**External:**
- Ollama running locally (for AI proxy - gracefully degrades if absent)
- WordPress 7.0+ for Connector Screen integration (older sites get credential sync to AI plugin only)
**Internal (all already built):**
- `autoSyncCredentials()` from wp-connector module
- `setupSiteForAI()` from wp-connector module
- `OllamaProvider` from chat/providers — tool calling, `checkToolSupport()`, `injectToolDescriptions()` patterns
- `ToolRegistry` from MCP server — 58+ tools with safety tiers, JSON Schema input schemas
- `EmbeddingService` from embeddings module
- `HttpEventInterface` pattern for HTTP server implementation
- `BulkOperationManager` from Sprint 3
- `LocalServicesBridge` for site enumeration and WP-CLI

---

## Success Criteria

- [ ] Save API key in Local -> all running WP 7.0+ sites get it within 5 seconds
- [ ] "Setup AI" on a site -> AI Experiments plugin active, credentials synced, experiments enabled
- [ ] Bulk "Setup AI" across 5+ sites with real-time progress
- [ ] AI proxy serves chat completions via Ollama in OpenAI format
- [ ] AI proxy passthrough: forwards WordPress tools to Ollama, returns tool_calls correctly
- [ ] AI proxy inject mode: WordPress AI gains access to Local's MCP tools (fleet health, search, etc.)
- [ ] AI proxy agentic mode: Ollama executes MCP tools server-side, WordPress gets enriched responses
- [ ] Tool-capable models (llama3.1, mistral, qwen2.5) use native tool calling through proxy
- [ ] Non-tool models get tool descriptions injected into system prompt as fallback
- [ ] WordPress site calls Local's AI proxy for inference (no external API key needed)
- [ ] Embedding endpoint returns 384-dim vectors via bundled ONNX
- [ ] Sites tab shows AI status column (green/yellow/gray)
- [ ] NexusPreferences shows credential sync status
- [ ] Production deployment guide documents Local -> WP Engine workflow
- [ ] All new tests passing (~46 tests)
- [ ] Clean build (tsc + webpack)
