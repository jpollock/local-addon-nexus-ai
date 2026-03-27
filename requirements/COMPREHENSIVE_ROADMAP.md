# Nexus AI - Comprehensive Roadmap

**Last Updated:** 2026-03-19
**Purpose:** Single source of truth for requirements, implementation status, and future work

---

## Table of Contents

1. [Vision & Requirements](#vision--requirements)
2. [What We've Built (Complete Inventory)](#what-weve-built-complete-inventory)
3. [Technical Architecture](#technical-architecture)
4. [Test Coverage](#test-coverage)
5. [Aha Moment Delivery Status](#aha-moment-delivery-status)
6. [Sprint Roadmap](#sprint-roadmap)
7. [Remaining Work](#remaining-work)
8. [Technical Requirements](#technical-requirements)

---

## Vision & Requirements

### Strategic Vision
> **"WordPress and AI development, effortlessly local"**

From `local-ai-vision.md`:
- Local as intelligent AI host for WordPress development
- Fleet-aware, not just site-aware
- Interface-agnostic (MCP as universal adapter)
- Local-first by default, cloud-connected by choice
- Complementary to WordPress 7 (for developers, not editors)

### User Value: 6 Aha Moments

From `AHA_MOMENTS.md`:

1. **Easy Fleet Discovery** - Find what needs attention across all sites instantly
2. **AI-Powered Fleet Management** - AI agents manage entire fleet via MCP
3. **Conversational Automation** - "Update all sites" -> it happens
4. **Unified Site Mental Model** - One view: hosting + WordPress together
5. **Cross-Site Visibility** - Patterns, trends, issues across fleet at a glance
6. **Effortless WordPress AI** - Configure AI once, works in all WP sites

### Technical Foundation
From `nexus-ai-implementation-plan.md` (Phases 1-11):
- Tier 1 capabilities (local vector DB, MCP server, ONNX embeddings)
- Fleet intelligence tools
- WordPress event tracking
- Ollama integration (Tier 3)
- Per-platform distribution

---

## What We've Built (Complete Inventory)

### Phase Status (From nexus-ai-implementation-plan.md)
- Phase 1: Foundation (addon structure, service container, lifecycle) -- **Complete**
- Phase 2: Content Pipeline (MySQL extraction, file scanning, indexing) -- **Complete**
- Phase 3: MCP Server (HTTP server, tools, authentication) -- **Complete**
- Phase 4: Deep Content Intelligence (vector search, semantic queries) -- **Complete**
- Phase 5: Richer Structure Layer (themes/plugins, ACF fields) -- **Complete**
- Phase 6: Fleet Intelligence (cross-site queries, comparisons) -- **Complete**
- Phase 7: Search Quality (deduplication, remote WP-CLI) -- **Complete**
- Phase 8: Instructions & Resources (server guidance, workflows) -- **Complete**
- Phase 9: Ollama Integration (local LLM support) -- **Complete**
- Phase 10: Local UI (FleetOverview, per-site sections, preferences) -- **Complete**
- Phase 11: Polish & Distribution -- **Core complete** (100% e2e pass rate, ship prep remaining)

### Main Process Modules (src/main/)

**1. ai-proxy/** - OpenAI-compatible AI proxy (Sprint 4)
- AiProxyServer - HTTP server backed by Ollama
- Tool modes: passthrough, inject, agentic (via X-Nexus-Tools header)
- tool-converter - MCP tools to OpenAI function format
- Streaming SSE, rate limiting, auth, model tool-capability detection

**2. bulk/** - Bulk operations framework (Sprint 3)
- BulkOperationManager - Fleet-wide operations with progress tracking
- Operations: plugin-install, plugin-update, plugin-activate, plugin-deactivate, setup-ai
- Configurable concurrency, per-site status, cancel support

**3. chat/** - Chat integration
- Chat service with Ollama backend
- Message handling and streaming
- IPC handlers for credential sync

**4. content/** - Content extraction and indexing
- MySQLExtractor - Extract posts/pages/products from WordPress DB
- FileScanner - Scan themes, plugins, site structure
- IndexRegistry - Track indexing status per site

**5. credentials/** - Credential management (Sprint 4)
- CredentialSyncBroadcaster - Auto-sync API keys to all running WP 7.0+ sites
- Per-site sync tracking with timestamps and error isolation

**6. embeddings/** - ONNX-based embedding generation
- EmbeddingService - Generate 384-dim vectors using all-MiniLM-L6-v2
- CPU-only, 5ms/doc, 184 docs/sec
- Quantized model (22MB on disk, ~90MB in memory)

**7. events/** - WordPress event tracking system
- EventProcessor - Background event processing
- GraphService - SQLite knowledge graph (sites, content, plugins, users, relationships)
- HttpEventInterface - HTTP endpoint (port 13000, Bearer auth)
- 10 event types: post CRUD, plugin lifecycle, user CRUD, site_initialized

**8. mcp/** - MCP server and tools (9 modules, 58+ tools)
- **composite/** - nexus_site_audit, nexus_plugin_audit
- **content/** - search_content, get_content, list_indexed_sites
- **fleet/** - search_fleet, compare_sites, get_fleet_stats
- **fleet-intelligence/** - Smart filters, saved queries, site health scores (Sprint 2)
- **ollama/** - ask_ollama (with context injection), list_ollama_models, recommend_models
- **site-context/** - get_site_context, get_site_structure
- **site-management/** - get_site_info, list_sites, start_site, stop_site
- **wp-cli/** - 9 tools (local + remote WPE): plugins, themes, core, users, options, health
- **wp-connector/** - setup_ai, sync_credentials, list_abilities, run_ability, auto_sync
- **wpe/** - WP Engine hosting integration tools

**9. vector-store/** - LanceDB vector database
- VectorStore - Per-site table isolation
- LanceDBService - Database lifecycle management
- Automatic optimization every 20 events

### Renderer Components (src/renderer/)

**10+ UI Components:**

| Component | Hook/Route | Sprint | Purpose |
|-----------|-----------|--------|---------|
| FleetOverview | `/main/fleet-overview` | 1-4 | Dashboard: stats, MCP, sites, search, events, bulk ops, AI proxy |
| SiteNexusSection | `SiteInfoOverview_Addon_Section` | 1, 4 | Per-site index + AI readiness (native TableList rows) |
| ChatTab | Embedded in FleetOverview | Pre-sprint | AI chat with Ollama |
| NexusPreferences | `preferencesMenuItems` | 4 | Settings, API keys, credential sync, AI proxy status |
| UnifiedSearchPanel | FleetOverview tab | 2 | Fleet search with smart filters |
| BulkOperationsPanel | FleetOverview tab | 3 | Bulk op progress tracking |
| EventTimeline | FleetOverview tab | 1 | Event stream with filters |
| EventStatsCards | FleetOverview overview | 1 | Event counts, health indicators |
| StorageHealthPanel | FleetOverview overview | 1 | Graph DB, vector DB, capacity |
| TopIssuesPanel | FleetOverview overview | 1 | Actionable site issues |
| SiteGroupsPanel | FleetOverview tab | 2 | Site tagging and grouping |
| SmartFiltersPanel | FleetOverview tab | 2 | Predefined + custom filters |
| SavedQueriesPanel | FleetOverview tab | 2 | Saved and pinned queries |

### WordPress Plugins (wp-plugins/)

| Plugin | Purpose | Install Method |
|--------|---------|---------------|
| `ai` (AI Experiments v0.3.1) | WordPress 7 AI features | `wp plugin install ai --activate` |
| `ai-provider-for-ollama` | Registers Ollama as WP AI provider | File copy from bundled source |
| `nexus-ai-connector` | Sends WordPress events to Local addon | Auto-installed on site start |

### Data Storage

```
~/Library/Application Support/Local/nexus-ai/
├── graph.db              (SQLite - events, plugins, users, content, relationships)
├── vectors/              (LanceDB - per-site content embeddings)
│   ├── site_{id}_content/
│   └── ...
├── audit.log             (Event audit trail)
├── ai_proxy_info         (AI proxy connection info)
└── nexus-ai-mcp-connection-info.json  (MCP connection details)
```

### MCP Server
- HTTP server on port 13000
- Bearer token authentication
- 58+ tools across 9 modules
- Server-level instructions (embedded in `initialize` response)
- 6 MCP resources (workflow guides via `nexus://` URIs)

---

## Technical Architecture

### Event Flow: WordPress -> Local
```
WordPress Admin UI (user activates plugin)
       |
WordPress Hook: activated_plugin
       |
nexus-ai-connector plugin (HTTP POST with Bearer token)
       |
HttpEventInterface (port 13000) -> 200 OK immediately
       |
EventProcessor (background, setImmediate)
       |
GraphService -> SQLite graph.db (plugins table updated)
       |
MCP Tools -> expose updated plugin state
       |
AI Clients (Claude, Cursor) see new plugin
```

### Content Indexing Flow
```
Site starts (siteStarted hook)
       |
FileScanner.scan(site) -> ThemeInfo[], PluginInfo[]
       |
MySQLExtractor.extract(site) -> Document[] (posts, pages)
       |
EmbeddingService.embedBatch(documents) -> 384-dim vectors
       |
VectorStore.upsert(siteId, documents) -> LanceDB site_{id}_content table
       |
IndexRegistry.update(siteId, stats) -> Track completion
```

### AI Proxy Flow (Sprint 4)
```
External Client (curl, custom app)
       |
POST /v1/chat/completions (Bearer auth)
       |
AiProxyServer (127.0.0.1, auto-port)
       |
X-Nexus-Tools header determines mode:
  passthrough -> forward tools as-is to Ollama
  inject      -> merge MCP tools + request tools, forward to Ollama
  agentic     -> execute MCP tool calls server-side (up to 5 rounds)
       |
Ollama /api/chat -> transform response to OpenAI format
       |
Response to client (SSE stream or JSON)
```

### Credential Sync Flow (Sprint 4)
```
User saves API key in NexusPreferences
       |
SAVE_API_KEY IPC handler
       |
CredentialSyncBroadcaster.broadcastKeyChange(providerId)
       |
For each running WP 7.0+ site:
  autoSyncCredentials(siteId) -> wp eval (write to wp_options)
       |
Per-site sync status tracked (timestamp, providers, success/error)
```

### Bulk Operation Flow (Sprint 3)
```
User triggers bulk op (UI or MCP)
       |
BulkOperationManager.create(type, siteIds, options)
       |
Queue sites -> execute with concurrency limit
       |
Per-site: run operation -> track status (queued/running/completed/failed)
       |
IPC broadcasts progress updates -> BulkOperationsPanel renders live
       |
Final summary: X succeeded, Y failed, Z skipped
```

---

## Test Coverage

### Sprint Test Summary

| Sprint | Suite | Tests |
|--------|-------|-------|
| 4 | CredentialSyncBroadcaster | 6 |
| 4 | AI Proxy Server | 8 |
| 4 | AI Proxy Tools | 8 |
| 4 | Tool Converter | 5 |
| 3+4 | BulkOperationManager | 20 |
| **Total new** | | **47** |

### E2E Test Suite (✅ 100% Pass Rate - 2026-03-19)

**25 test suites, 288 tests** covering all major workflows, edge cases, and performance:

| Area | Tests | Coverage |
|------|-------|----------|
| Core connectivity & MCP protocol | 8 | Health, handshake, tool discovery, resources |
| Site discovery & lifecycle | 15 | Enumeration, CRUD, start/stop, unified local+WPE view |
| WordPress inspection | 13 | Plugins, themes, users, options, version, health, DB tools |
| Plugin management | 17 | Install, activate, deactivate, update (local + remote WPE) |
| Content pipeline & embeddings | 23 | Indexing, search, cross-site, site context extraction |
| Fleet intelligence | 4 | Fleet summary, plugin discovery, outdated sites, themes |
| WP Engine integration | 21 | CAPI, backups, cache, pull/push, remote WP-CLI via SSH |
| AI & event processing | 51 | Ollama, setup-ai, event flow, graph queries, real-time updates |
| **Graph deletion & data integrity** | **8** | **Post/plugin/user deletion, vector cleanup, idempotency** |
| **WPE CAPI management** | **13** | **Account/install discovery, cache/backup ops, error handling** |
| **Negative tests & error handling** | **34** | **Invalid inputs, concurrent ops, state transitions, edge cases** |
| **Multisite edge cases** | **16** | **Multisite detection, network operations, sub-site handling** |
| **Database edge cases** | **23** | **Connection handling, engine compatibility, error recovery** |
| **Stress & concurrency** | **20** | **Load testing, concurrent operations, memory/timeout handling** |
| **Performance benchmarks** | **22** | **Fleet scale, search performance, throughput, latency under load** |

**Test Infrastructure:**
- Global setup ensures Local running, test site available
- Reusable MCP client and helpers
- Real Local app integration (no mocks)
- Fast feedback (~3 minutes for full suite)

### Pre-Existing Test Infrastructure
- Unit tests: Core services, utilities
- Integration tests: Service interactions, full pipeline
- Eval tests: Instruction/resource quality (<2s, deterministic)

### Testing Philosophy
1. Contracts -> Tests -> Implementation (TDD)
2. Real Local environment for E2E (not mocks)
3. Deterministic evals (no LLM calls, <2s per test)
4. Per-platform validation (macOS, Windows, Linux)
5. Safety-aware testing (Tier 3 confirmation flows validated)

---

## Aha Moment Delivery Status

### #1: Easy Fleet Discovery -- DELIVERED (Sprint 2)
- Unified search UI in FleetOverview
- Smart filters (outdated PHP, security updates, inactive plugins)
- Saved queries (pre-built + custom, pin to dashboard)
- Site groups with tagging
- Site health scoring via fleet-intelligence tools

### #2: AI-Powered Fleet Management -- DELIVERED (Pre-sprint + Sprints 1-4)
- 58+ MCP tools across 9 modules
- Remote WPE support (9 wp-cli tools)
- Composite tools (multi-operation workflows)
- Server-level instructions embedded
- Tool categorization by module with priority ordering

### #3: Conversational Automation -- DELIVERED (Sprint 3)
- Bulk operations framework (5 operation types)
- Progress tracking UI with per-site status
- Safety features (dry-run mode, tier-based confirmation)
- Activity log with filterable history

### #4: Unified Site Mental Model -- DELIVERED (Sprints 1-2)
- Events track both infrastructure + WordPress
- Graph database stores unified state
- SiteNexusSection shows index + AI readiness per site
- FleetOverview combines hosting + WordPress data
- Site health scores (infrastructure + WordPress + security)

### #5: Cross-Site Visibility -- DELIVERED (Sprint 1)
- Event Timeline UI (filterable by type, status indicators)
- Event Stats Cards (total, processed, by type, health indicators)
- Storage Health visualization (graph DB, vector DB, capacity)
- Top Issues dashboard (sites needing updates, failed events)

### #6: Effortless WordPress AI -- DELIVERED (Sprint 4)
- Automatic credential propagation (CredentialSyncBroadcaster)
- One-click "Setup AI" per site or fleet-wide
- AI Proxy Server for enhanced clients
- Production deployment guide (local to WPE)
- Per-site AI readiness indicators in Local UI

---

## Sprint Roadmap

### Sprint 1 (Complete): Cross-Site Visibility
**Branch:** `sprint-1-enhanced-visibility` -> merged to main
**Delivered:** Event Timeline, Event Stats, Storage Health, Top Issues
**Aha:** #5 (Cross-Site Visibility)

### Sprint 2 (Complete): Easy Fleet Discovery
**Branch:** `sprint-2-easy-fleet-discovery` -> merged to main
**Delivered:** Unified Search, Smart Filters, Saved Queries, Site Groups
**Aha:** #1 (Easy Fleet Discovery) + partial #4 (Unified Mental Model)

### Sprint 3 (Complete): Proactive Fleet Operations
**Branch:** `sprint-3-proactive-fleet-ops` -> merged to main
**Delivered:** Bulk Operations, Progress Tracking, Safety Features, Activity Log
**Aha:** #3 (Conversational Automation) + enhanced #2 (AI Fleet Management)

### Sprint 4 (Complete): AI Everywhere
**Branch:** `sprint-4-ai-everywhere` -> merged to main
**Delivered:** Credential Sync, AI Proxy, Bulk Setup-AI, Production Docs, Per-site AI readiness
**Aha:** #6 (Effortless WordPress AI)

---

## Remaining Work

### Phase 11 Testing Hardening - Core E2E ✅ COMPLETE (2026-03-19)

**Achievement:** 100% test pass rate (152/152 tests across 18 suites)

| Area | Coverage | Status |
|------|----------|--------|
| Core connectivity & MCP protocol | 8 tests | ✅ Complete |
| Site discovery & lifecycle | 15 tests | ✅ Complete |
| WordPress inspection tools | 13 tests | ✅ Complete |
| Plugin management (local + remote) | 17 tests | ✅ Complete |
| Content pipeline & embeddings | 23 tests | ✅ Complete |
| Fleet intelligence | 4 tests | ✅ Complete |
| WP Engine integration | 21 tests | ✅ Complete |
| AI & event processing | 51 tests | ✅ Complete |

### Option 1: Extended Test Coverage ⏳ IN PROGRESS

**Priority: HIGH** - Fills critical gaps in production readiness

| # | Task | Status | Tests | Time |
|---|------|--------|-------|------|
| 1 | Graph deletion events (post_deleted, plugin_deleted, user_deleted) | ✅ DONE | 8/8 passing | 0.5 days |
| 2 | WPE management tests (account/install discovery, cache/backup ops) | ✅ DONE | 13/13 passing | 0.5 days |
| 3 | Negative test expansion (invalid inputs, concurrent ops, edge cases) | ✅ DONE | 34/34 passing | 0.5 days |
| 4 | Edge case coverage (multisite, database, stress/concurrency) | ✅ DONE | 59/59 passing (16+23+20) | 1.5 days |
| 5 | Performance tests (fleet scale, search, throughput, latency) | ✅ DONE | 22/22 passing | 0.5 days |
| 6 | CLI e2e tests (sites, wp, sync commands with real execution) | ✅ DONE | 50/50 passing | 1.0 days |

**Progress:** 6/6 tasks complete (100%)
**Tests added:** 186 (8 + 13 + 34 + 59 + 22 + 50)
**Total test suites:** 26 passing
**Total tests:** 338 passing
**Time spent:** 4.5 days
**Total estimated:** 5 days (completed under budget!)

### Option 2: Production Hardening (~3-5 days)

**Priority: MEDIUM** - Polish for production deployment

| Task | Complexity | Value |
|------|-----------|-------|
| Remove debug logging (ToolRegistry, SafetyWrapper, event-tools) | Low | High - clean logs |
| Production monitoring/telemetry | Medium | High - observability |
| Stress testing (100+ sites, 1000+ posts) | Medium | Medium - capacity planning |
| Memory leak detection (long-running ops) | Medium | High - stability |
| Error recovery testing (network failures, disk full) | Medium | High - resilience |

**Estimated effort:** 3-5 days

### Option 3: Ship Prep (~1 week)

**Priority: HIGH** - Required for marketplace launch

| Task | Complexity | Value |
|------|-----------|-------|
| Update CHANGELOG.md with all features | Low | High - user communication |
| Update README.md with setup instructions | Low | High - onboarding |
| Create user documentation | Medium | High - adoption |
| Build release artifact | Low | High - distribution |
| Tag version (semantic versioning) | Low | High - release management |
| Write release notes | Low | High - marketing |
| Beta testing with 5-10 users | High | High - validation |
| Address critical feedback | Variable | High - quality |
| Marketplace submission | Medium | High - launch |

**Estimated effort:** 5-7 days (includes beta feedback cycle)

### Option 4: Clean Up & Documentation (~2-3 days)

**Priority: LOW** - Nice to have, not blocking

| Task | Complexity | Value |
|------|-----------|-------|
| Remove temporary debug code | Low | Medium - code quality |
| Update API documentation | Medium | Medium - maintainability |
| Create developer onboarding guide | Medium | Medium - contributor experience |
| Document test infrastructure | Low | Medium - knowledge transfer |

**Estimated effort:** 2-3 days

### Deferred Testing (Nice to have)

| Task | Why Deferred | Future Milestone |
|------|-------------|------------------|
| WooCommerce extraction tests with fixtures | Requires real product data | Post-V1 (if users request) |
| ACF field extraction tests (repeater, group, flexible) | Complex setup, low adoption | Post-V1 (if ACF users report issues) |
| MySQL socket disappears recovery | Rare edge case | V1.1 (if reported in wild) |
| ONNX missing recovery | Already handled gracefully | V1.1 (if needed) |
| DB corrupted recovery | Catastrophic failure, hard to test | V1.1 (if needed) |
| Memory leak testing (50 sites) | Requires infrastructure | V1.1 (performance tuning phase) |

### Recommended Path

**For "Do It Well" Philosophy:**
1. **Option 1** (Extended Test Coverage) - Fill critical gaps (~1 week)
2. **Option 3** (Ship Prep) - Prepare for launch (~1 week)
3. **Option 2** (Production Hardening) - Polish deployment (~3-5 days)

**Total:** ~3 weeks to production-ready V1

**For "Ship Fast" Philosophy:**
1. **Option 3** (Ship Prep) - Prepare for launch (~1 week)
2. **Option 2** (Production Hardening) - Critical issues only (~2 days)

**Total:** ~1.5 weeks to beta-ready V1

---

## Technical Requirements

### Architecture Principles
1. **Event-driven, non-blocking** - Events processed in background
2. **Per-site isolation** - Vector tables, graph records scoped by site_id
3. **Graceful degradation** - Works without Ollama, without WPE, without cloud
4. **Security-first** - Bearer auth, path validation, credential redaction
5. **MCP-native** - All features exposed via MCP tools
6. **Local runs sites natively** - No Docker. Sites and addon share localhost.
7. **Class-based React** - `React.Component` with `React.createElement()`, no JSX/hooks

### Performance Requirements
- Event processing: <50ms per event (non-blocking)
- Vector search: <100ms for 500-doc site
- UI responsiveness: <1s load time for dashboard
- Memory usage: <200MB RSS for 20-site fleet
- Embedding generation: 5ms/doc, 184 docs/sec

### Security Requirements
- All IPC handlers validated
- Path traversal prevention (validatePluginPath)
- Credential redaction in logs
- Bearer token auth for MCP and AI proxy
- No secrets in code
- Health checks after plugin activation (auto-deactivate on crash)

### Compatibility Requirements
- Local versions: Works with current Local release
- WordPress: 6.4+ (AI features require 7.0+)
- PHP: 7.4+
- MySQL: 5.7+
- Node.js: 18+ (for ONNX Runtime)

---

## Success Metrics

### For Each Aha Moment
1. **Fleet Discovery:** Time to find "sites needing work" < 10 seconds
2. **AI Management:** 80% of fleet operations via MCP (not manual)
3. **Automation:** Bulk operations complete in < 5 minutes for 20 sites
4. **Unified Model:** User can describe entire site state in 1 sentence
5. **Visibility:** User spots security issue within 1 hour of occurrence
6. **Effortless AI:** Zero per-site AI configuration required

### Overall Product Success
- **Adoption:** 1000+ active users within 3 months of marketplace launch
- **Engagement:** Users manage 10+ sites on average
- **Value:** 5+ hours saved per user per week
- **Quality:** <5% error rate on bulk operations
- **Performance:** P95 < 2s for all UI operations

---

## References

**Requirements:**
- `local-ai-vision.md` - Strategic vision
- `nexus-ai-implementation-plan.md` - Phases 1-11 technical plan
- `AHA_MOMENTS.md` - 6 user experiences
- `VISION.md` - One-page vision statement

**Implementation:**
- `../src/` - All source code
- `../tests/` - Test suites
- `../wp-plugins/` - WordPress plugins
- `../docs/` - Developer guides, sprint completion docs

**Sprint Docs:**
- `../docs/sprint-1-*` through `../docs/sprint-4-*` - Plans, checklists, completions

---

**Last Updated:** 2026-03-19
**Status:** Option 1 (Extended Test Coverage) COMPLETE ✅
**Next Phase:** Ready for Option 3 (Ship Prep) or Option 2 (Production Hardening)
