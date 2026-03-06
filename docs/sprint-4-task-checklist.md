# Sprint 4 Task Checklist: AI Everywhere

## Week 1: Backend

### Day 1: CredentialSyncBroadcaster [DONE]
- [x] `src/main/credentials/CredentialSyncBroadcaster.ts` — core class
- [x] `broadcastKeyChange(providerId)` — enumerate running sites via siteData + localServices, call autoSyncCredentials for each
- [x] `syncAllKeysToSite(siteId)` — sync all configured providers to one site
- [x] `getSyncStatus()` — return Map<string, SiteSyncStatus> from internal tracking
- [x] Track sync results per-site (lastSync timestamp, providers, success/error)
- [x] Wire into `SAVE_API_KEY` handler in `chat-ipc-handlers.ts`:
  - After `storeApiKey()`, call `credentialBroadcaster.broadcastKeyChange(providerId)`
  - Non-blocking (fire-and-forget with error logging)
- [x] Add IPC channels to `src/common/constants.ts`:
  - `SYNC_ALL_CREDENTIALS` — trigger full credential broadcast
  - `GET_CREDENTIAL_SYNC_STATUS` — return per-site sync state
- [x] Add IPC handlers in `chat-ipc-handlers.ts`:
  - `SYNC_ALL_CREDENTIALS` — calls broadcastKeyChange for all configured providers
  - `GET_CREDENTIAL_SYNC_STATUS` — calls getSyncStatus(), serializes Map to object
- [x] Add types to `src/common/types.ts`:
  - `SiteSyncStatus { lastSync: number | null; providers: string[]; success: boolean; error?: string }`
  - `CredentialSyncResult { siteId: string; siteName: string; success: boolean; providers: string[]; error?: string }`
- [x] `tests/unit/credentials/credential-sync-broadcaster.test.ts` (6 tests):
  - [x] broadcastKeyChange calls autoSyncCredentials for each running site
  - [x] broadcastKeyChange skips halted sites
  - [x] broadcastKeyChange handles per-site failures independently (one fails, others succeed)
  - [x] syncAllKeysToSite syncs all configured providers to one site
  - [x] getSyncStatus returns accurate per-site state after broadcast
  - [x] No-op when no API keys configured (returns empty results)

### Day 2: AI Proxy Server - Core + Passthrough Tool Calling [DONE]
- [x] `src/main/ai-proxy/AiProxyServer.ts` — HTTP server class
- [x] `src/main/ai-proxy/types.ts` — AiProxyConnectionInfo, OpenAI request/response types, tool call types
- [x] Constructor: port (default 0), authToken (auto-generated), logger, embeddingService
- [x] `start()` — create http.Server, bind to 127.0.0.1, return AiProxyConnectionInfo
- [x] `stop()` — close server (with closeAllConnections for clean shutdown), set running=false
- [x] `getConnectionInfo()` — return current connection info or null (includes `toolCapableModels`)
- [x] Auth middleware: validate `Authorization: Bearer <token>` header
- [x] Rate limiting: token bucket (60 requests/minute, refill 1/sec)
- [x] Return 503 when Ollama not reachable, 401 for bad auth, 429 for rate limit
- [x] Route: `GET /v1/models`:
  - Fetch from Ollama `/api/tags`
  - For each model, check tool support via `/api/show` (cache results)
  - Return OpenAI format with extra `toolCapable` flag per model
- [x] Route: `GET /health` — return `{ status, ollama, port }`
- [x] Route: `POST /v1/chat/completions` (no tools):
  - Parse OpenAI request format (model, messages, temperature, top_p)
  - Forward to Ollama `POST /api/chat` with `stream: false`
  - Transform Ollama response to OpenAI format
- [x] Route: `POST /v1/chat/completions` (passthrough tools):
  - Parse `tools` array from request body
  - Forward tools to Ollama in same format
  - Use `stream: false` when tools present
  - Translate response `tool_calls`: Ollama object → OpenAI JSON string
  - Set `finish_reason: "tool_calls"` when tool calls present
  - Pass through `role: "tool"` messages correctly
- [x] Route: `POST /v1/chat/completions` with `stream: true` (no tools):
  - Forward to Ollama with `stream: true`
  - Transform to OpenAI SSE format with `[DONE]`
- [x] Route: `POST /v1/embeddings`:
  - Parse input, use EmbeddingService, return OpenAI format
- [x] Request size validation: reject bodies > 1MB
- [x] `tests/unit/ai-proxy/ai-proxy-server.test.ts` (8 tests):
  - [x] Auth rejects requests without Bearer token (401)
  - [x] Auth rejects invalid token (401)
  - [x] Models endpoint returns OpenAI-format model list with `toolCapable` flag
  - [x] Health endpoint returns status with Ollama availability
  - [x] Rate limiter rejects requests over limit (429)
  - [x] Returns 503 when Ollama unavailable
  - [x] Passthrough: forwards `tools` to Ollama, returns `tool_calls` with stringified arguments
  - [x] Passthrough: `role: "tool"` messages pass through correctly

### Day 3: AI Proxy Server - Tool Injection, Agentic Mode, Streaming, Embeddings [DONE]
- [x] `src/main/ai-proxy/tool-converter.ts` — convert MCP tool definitions to OpenAI format:
  - `convertMcpToolsToOpenAI(registry, services)` — filter available tools, convert `inputSchema` to `parameters`
  - Filter: skip tools where `isAvailable(services)` returns false
  - Filter: skip Tier 3 destructive tools (for agentic mode safety)
  - Limit: cap at 20 tools (MAX_PROXY_TOOLS)
  - Priority order: fleet-intelligence > content > site-context > fleet > wp-cli > site-management > composite
- [x] Parse `X-Nexus-Tools` header: `passthrough` (default), `inject`, `agentic`
- [x] Inject mode (`X-Nexus-Tools: inject`):
  - Merge WordPress tools + converted MCP tools, cap at 20 total
  - Forward merged tools to Ollama
  - Return all tool_calls to caller
- [x] Agentic mode (`X-Nexus-Tools: agentic`):
  - Merge tools same as inject mode (Tier 1+2 only)
  - Execute MCP tool calls via `registry.call(toolName, args, services)`
  - 30-second timeout per tool execution
  - Truncate tool result to 4KB
  - Loop up to 5 rounds (MAX_AGENTIC_ROUNDS)
  - WordPress tool calls returned to caller without execution
  - Final text response when no more tool_calls
- [x] Model tool support detection:
  - Query `/api/show` for model template, check for `.Tools`/`.ToolCalls` markers
  - Cache results in Map<string, boolean>
- [x] Route: `POST /v1/chat/completions` with `stream: true` (no tools):
  - OpenAI SSE format with `[DONE]`
- [x] Route: `POST /v1/embeddings`:
  - Uses `EmbeddingService.embed()` for each input
  - Returns OpenAI format
- [x] Request size validation: reject bodies > 1MB (413)
- [x] Wire AiProxyServer into `src/main/index.ts`:
  - Instantiate with toolRegistry, nexusServices, embeddingService
  - Start after MCP server
  - Store connectionInfo in registryStorage (`ai_proxy_info` key)
- [x] `tests/unit/ai-proxy/ai-proxy-tools.test.ts` (8 tests):
  - [x] Inject mode: merges MCP tools with WordPress tools
  - [x] Inject mode: caps at 20 tools total
  - [x] Agentic mode: executes MCP tool call, feeds result back to Ollama, returns final text
  - [x] Agentic mode: max 5 rounds prevents infinite loop
  - [x] Agentic mode: WordPress tool calls returned without execution
  - [x] Streaming (no tools): SSE events in OpenAI delta format with [DONE]
  - [x] Embeddings: returns 384-dim vectors in OpenAI format
  - [x] Passthrough mode: does not merge MCP tools
- [x] `tests/unit/ai-proxy/tool-converter.test.ts` (5 tests):
  - [x] Converts MCP inputSchema to OpenAI parameters format
  - [x] Filters out unavailable tools (registry.list handles this)
  - [x] Filters out Tier 3 tools when excludeDestructive=true (default)
  - [x] Includes Tier 3 tools when excludeDestructive=false
  - [x] Limits output to MAX_PROXY_TOOLS (20)

### Day 4: Bulk Setup-AI + IPC Wiring [DONE]
NOTE: Local runs sites natively (no Docker). The `ai-provider-for-ollama`
plugin already talks directly to Ollama at localhost:11434. The AI proxy is a
separate service for enhanced clients (tool injection, agentic mode) — WordPress
AI features don't need the proxy. No new WP plugin or Docker detection needed.

- [x] Add `'setup-ai'` to `BulkOpType` in `src/main/bulk/types.ts`
- [x] Add `enableOllama` to `BulkOperationRequest.options`
- [x] Add `setupSiteForAI` dependency to `BulkOpDeps` interface
- [x] Add `executeSetupAI` executor in BulkOperationManager:
  - Checks site is running, calls `setupSiteForAI`, throws on failure
- [x] Wire `setupSiteForAI` into BulkOperationManager in `ipc-handlers.ts`
- [x] Add IPC handler: `GET_AI_STATUS` — per-site AI readiness (plugin status, credentials, Ollama provider)
- [x] Add IPC handler: `GET_AI_PROXY_INFO` — return proxy connection info from registryStorage
- [x] Add IPC handler: `SETUP_AI_FLEET` — create bulk `setup-ai` operation for all running sites
- [x] Tests added to `tests/unit/bulk/bulk-operation-manager.test.ts` (4 new tests):
  - [x] setup-ai calls setupSiteForAI for each site
  - [x] setup-ai fails for halted sites
  - [x] setup-ai isolates per-site failures
  - [x] setup-ai fails when setupSiteForAI dep not configured

### Day 5: IPC Wiring + Integration [DONE — merged into Days 1+4]
All IPC wiring completed as part of Day 1 (credential IPC in chat-ipc-handlers)
and Day 4 (AI status + proxy info + fleet setup in ipc-handlers).
- [x] IPC channels added to constants.ts (Day 1)
- [x] Types added to types.ts (Day 1)
- [x] GET_AI_STATUS handler (Day 4)
- [x] GET_AI_PROXY_INFO handler (Day 4)
- [x] SETUP_AI_FLEET handler (Day 4)
- [x] CredentialSyncBroadcaster wired in index.ts + chat-ipc-handlers (Day 1)
- [x] AiProxyServer wired in index.ts (Day 3)

## Week 2: Frontend

### Day 6: NexusPreferences Enhancements [DONE]
- [x] Add credential sync status section below API key input area:
  - "Credential Sync" header with per-site sync status (dot + name + timestamp)
  - "Sync All" button — calls SYNC_ALL_CREDENTIALS IPC, shows per-site results
  - Sync progress: "Syncing..." while in progress, results on complete
- [x] AI Proxy status section:
  - Running/stopped status dot, port number, model count
- [x] Fetch GET_CREDENTIAL_SYNC_STATUS and GET_AI_PROXY_INFO on mount

### Day 7: SiteNexusSection AI Readiness [DONE]
- [x] Add AI readiness card to per-site addon view:
  - AI Plugin: green/yellow/gray dot + status text (Active/Installed/Not installed)
  - Ollama Provider: same status indicators
  - Credentials: "Synced (providers)" or "Not synced"
- [x] "Setup AI" button (when plugin not active) with result feedback
- [x] "Sync Keys" button — calls SYNC_ALL_CREDENTIALS
- [x] Setup result banner (green success / red error)
- [x] Fetch GET_AI_STATUS for current site on mount

### Day 8: Fleet Dashboard AI Column [DONE]
- [x] Overview tab: AI Proxy card added to Nexus AI row (4-column grid)
  - Shows running/stopped, port, model count, tool-capable model count
- [x] Overview tab: "Setup AI for All Running Sites" button in Fleet Operations
  - Calls SETUP_AI_FLEET, shows progress link to Bulk Operations panel
- [x] Fetch GET_AI_PROXY_INFO on dashboard mount

### Day 9: Documentation + Polish [DONE]
- [x] Write `docs/production-deployment-guide.md`:
  - What transfers with push (plugins, mu-plugins, wp_options)
  - What needs WP Engine Connector Screen setup (API keys)
  - Ollama proxy: local-only, alternatives for production
  - Step-by-step: push, configure WPE, verify AI
  - FAQ section
- [x] Write `docs/ai-proxy-guide.md`:
  - How the proxy works (Local -> Ollama)
  - Supported endpoints with curl examples
  - Tool modes (passthrough, inject, agentic)
  - Model recommendations by RAM
  - Troubleshooting table
- [x] Update `docs/user-guide.md` with Sprint 4 sections:
  - "AI Setup" section
  - "Credential Management" section
  - "AI Proxy" section
  - "Production Deployment" section
- [ ] Manual testing checklist:
  - [ ] Save OpenAI key in preferences -> verify sync to running WP 7.0+ site
  - [ ] Save key -> verify WP Admin Connector Screen shows key
  - [ ] "Setup AI" on single site -> verify AI Experiments plugin active + experiments enabled
  - [ ] "Setup AI" bulk on 3+ sites -> verify progress and completion
  - [ ] AI Proxy: `curl /v1/models` -> verify Ollama models listed with `toolCapable` flags
  - [ ] AI Proxy: `curl /v1/chat/completions` (no tools) -> verify response
  - [ ] AI Proxy: `curl /v1/chat/completions` with tools (passthrough) -> verify tool_calls returned
  - [ ] AI Proxy: `curl -H "X-Nexus-Tools: inject"` -> verify MCP tools appear in Ollama's tool list
  - [ ] AI Proxy: `curl -H "X-Nexus-Tools: agentic"` with "what's the health of my fleet?" -> verify tool executed server-side
  - [ ] AI Proxy: verify tool_calls arguments are JSON strings (not objects) in OpenAI format
  - [ ] AI Proxy: verify non-tool model (e.g. gemma2) falls back to description injection
  - [ ] AI Proxy: WordPress AI feature uses Local's Ollama (e.g. excerpt generation)
  - [ ] Sites tab: AI column shows correct status per site
  - [ ] NexusPreferences: sync status shows correct counts
  - [ ] Re-sync button works after changing key

### Day 10: Testing & Release [DONE]
- [x] Run Sprint 4 unit tests: 47 passing across 5 suites
- [x] TypeScript check: `npx tsc --noEmit` — clean
- [x] Full build: `npm run build` — clean
- [x] Write `docs/sprint-4-completion.md`
- [ ] Merge sprint-4-ai-everywhere -> main (pending user approval)

## Completion Summary

| Layer | New Files | Tests |
|-------|-----------|-------|
| Backend: CredentialSyncBroadcaster | 2 | 6 |
| Backend: AI Proxy Server | 3 | 16 |
| Backend: AI Proxy Tool Converter | 1 | 5 |
| Backend: Enhanced Setup + Bulk | (modify 2) | 4 |
| Backend: IPC Wiring | (modify 3) | - |
| Frontend: NexusPreferences | (modify 1) | - |
| Frontend: SiteNexusSection | (modify 1) | - |
| Frontend: FleetOverview | (modify 1) | - |
| Docs | 3 | - |
| **Total** | **~6 new + ~8 modified + 3 docs** | **~31 unit** |

## Success Criteria

- [ ] Save API key -> all running WP 7.0+ sites synced within 5 seconds
- [ ] "Setup AI" installs plugin + syncs credentials + enables experiments + configures proxy
- [ ] Bulk "Setup AI" across 5+ sites with progress tracking
- [ ] AI proxy serves /v1/chat/completions from Ollama in OpenAI format
- [ ] AI proxy passthrough: forwards WordPress tools to Ollama, returns tool_calls with correct format
- [ ] AI proxy inject mode: merges MCP tools (fleet health, search, etc.) into WordPress requests
- [ ] AI proxy agentic mode: executes MCP tool calls server-side, returns enriched responses
- [ ] Tool-capable Ollama models (llama3.1, mistral, qwen2.5) use native tool calling through proxy
- [ ] Non-tool-capable models get tool descriptions injected as fallback
- [ ] AI proxy serves /v1/embeddings from bundled ONNX model
- [ ] WordPress AI features route through Local's proxy (no external keys needed)
- [ ] Sites tab shows AI status column
- [ ] NexusPreferences shows credential sync status
- [ ] Production deployment guide is complete and accurate
- [ ] All ~38 new tests passing
- [ ] Clean build (tsc + webpack)
