# Nexus AI - Current Status

**Last Updated:** 2026-03-06
**Phase:** Post-Sprint 4 — All sprints complete, pre-ship
**Build:** Clean, all tests passing
**Branch:** main

---

## What This Addon Does

**Nexus AI** transforms Local into an intelligent AI host for your entire WordPress fleet:

- **Vector Search** - Semantic search across all sites using local ONNX embeddings (184 docs/sec)
- **MCP Server** - 58+ tools exposing fleet operations to Claude, Cursor, ChatGPT
- **Event Tracking** - Real-time WordPress context (plugins, users, content changes)
- **Fleet Intelligence** - Cross-site queries, comparisons, health scores, smart filters
- **Ollama Integration** - Local LLM with hardware-aware model recommendations
- **AI Proxy Server** - OpenAI-compatible API backed by Ollama with tool injection and agentic mode
- **Bulk Operations** - Fleet-wide plugin updates, AI setup, with progress tracking and safety
- **WordPress 7 AI** - One-click AI setup, credential sync, ACF abilities

**Works with:** Claude Code, Cursor, Claude Desktop, any MCP-compatible client

---

## Sprint Completion Summary

### Sprint 1: Cross-Site Visibility (Complete)
- Event Timeline UI in FleetOverview (filterable by type, status indicators)
- Event Stats Cards (total, processed, by type, health indicators)
- Storage Health visualization (graph DB, vector DB, capacity)
- Top Issues dashboard (sites needing updates, failed events)

### Sprint 2: Easy Fleet Discovery (Complete)
- Unified Search UI in FleetOverview with SearchService backend
- Smart Filters (outdated PHP, security updates, inactive plugins)
- Saved Queries (pre-built + custom, pin to dashboard)
- Site Groups with tagging

### Sprint 3: Proactive Fleet Operations (Complete)
- Bulk Operations framework (plugin install/update/activate/deactivate across fleet)
- Progress Tracking UI (real-time per-site status, cancel, logs)
- Safety features (dry-run mode, tier-based confirmation)
- Activity log with filterable history

### Sprint 4: AI Everywhere (Complete)
- CredentialSyncBroadcaster (auto-sync API keys to all running WP 7.0+ sites)
- AI Proxy Server (OpenAI-compatible, passthrough/inject/agentic tool modes)
- Tool Converter (MCP tools to OpenAI format, Tier 3 filtering)
- Bulk setup-ai (fleet-wide AI configuration)
- Per-site AI readiness (native TableList rows matching Local's UI)
- NexusPreferences credential sync status + AI proxy status
- FleetOverview AI proxy card + fleet setup button
- Production deployment guide + AI proxy guide

---

## What Works

### Core Infrastructure
- LanceDB vector store (per-site table isolation)
- ONNX Runtime CPU embeddings (all-MiniLM-L6-v2, 384 dimensions)
- MCP HTTP server (port 13000, Bearer auth)
- WordPress connector plugin (auto-installs on site start)
- SQLite knowledge graph (sites, content, plugins, users, events)
- AI Proxy Server (127.0.0.1, auto-port, Bearer auth, rate limiting)

### Event Tracking (10 Event Types)
- Content: post_created, post_updated, post_deleted
- Plugins: plugin_activated, plugin_deactivated, plugin_updated, plugin_deleted
- Users: user_created, user_updated, user_deleted
- Site: site_initialized

### MCP Tools (58+ Tools, 9 Modules)
- **content** - search_content, get_content, list_indexed_sites
- **site-context** - get_site_context, get_site_structure
- **ollama** - ask_ollama (with site context injection), list_ollama_models, recommend_models
- **fleet** - search_fleet, compare_sites, get_fleet_stats
- **site-management** - get_site_info, list_sites, start_site, stop_site
- **wp-cli** - 9 tools (local + remote WPE execution)
- **wp-connector** - setup_ai, sync_credentials, list_abilities, run_ability
- **wpe** - WP Engine hosting integration tools
- **composite** - nexus_site_audit, nexus_plugin_audit

### AI Proxy Server
- OpenAI-compatible endpoints: /v1/models, /v1/chat/completions, /v1/embeddings, /health
- Streaming SSE support
- Tool modes via X-Nexus-Tools header: passthrough, inject, agentic
- Model tool-capability detection (cached)
- Rate limiting (60 req/min), 1MB body limit, Bearer auth

### Bulk Operations
- Operation types: plugin-install, plugin-update, plugin-activate, plugin-deactivate, setup-ai
- Per-site progress tracking with status (queued, running, completed, failed)
- Configurable concurrency, dry-run mode
- Safety tier system (3 levels)

### WordPress 7 AI Integration
- Auto-install AI Experiments plugin + provider plugins
- Enable all AI experiments via wp_options
- Credential sync (Local prefs to WordPress Connector Screen)
- ACF abilities mu-plugin (ACF PRO >= 6.8)
- Ollama provider plugin (bundled, file-copied)
- Health checks after plugin activation (auto-deactivate on crash)

### Frontend (10 Components)
1. **FleetOverview** - Dashboard with stats, MCP panel, sites, search, events, bulk ops, AI proxy
2. **SiteNexusSection** - Per-site index status + AI readiness (native TableList rows)
3. **ChatTab** - AI chat interface with Ollama
4. **NexusPreferences** - Settings, API keys, credential sync status, AI proxy status
5. **UnifiedSearchPanel** - Fleet-wide search with smart filters and saved queries
6. **BulkOperationsPanel** - Progress tracking for fleet operations
7. **EventTimeline** + **EventStatsCards** - Event visualization
8. **StorageHealthPanel** + **TopIssuesPanel** - System health
9. **SiteGroupsPanel** + **SmartFiltersPanel** + **SavedQueriesPanel**
10. **SiteHeaderBadge** + **WpeBadge** + NavItemInjector + SidebarBadgeManager

### Documentation
- User guide (AI setup, credential management, AI proxy, production deployment)
- AI proxy guide (endpoints, tool modes, model recommendations, troubleshooting)
- Production deployment guide (what transfers to WPE, local-only plugins, FAQ)
- Developer guide, security docs, sprint completion docs

### Testing
- Sprint 1-4 unit tests: 47+ new tests across credential sync, AI proxy, tool converter, bulk ops
- Pre-existing: unit, integration, eval, E2E test suites
- TypeScript clean, build clean

---

## Current Metrics

**Performance:**
- Embedding generation: 5ms/doc, 184 docs/sec
- Vector search: <100ms for 500-doc site
- Event processing: <50ms (non-blocking)
- Full site index: <3 seconds for 500 posts

---

## Known Issues

**None blocking release.**

**Minor:**
- better-sqlite3 Node version mismatch in some manual test scripts (workaround: use sqlite3 CLI directly)
- WordPress plugin must be reinstalled after code changes
- SiteNexusSection AI status depends on WP-CLI being responsive (graceful fallback to defaults)

---

## Where Things Are

### Key Files
```
local-addon-nexus-ai/
├── requirements/
│   ├── COMPREHENSIVE_ROADMAP.md  ← Full roadmap (all sprints complete)
│   ├── STATUS.md                 ← This file
│   ├── VISION.md                 ← One-page vision
│   └── AHA_MOMENTS.md            ← 6 user experiences
├── src/
│   ├── main/
│   │   ├── ai-proxy/             ← AI Proxy Server (Sprint 4)
│   │   ├── bulk/                 ← Bulk Operations (Sprint 3)
│   │   ├── chat/                 ← Chat service + IPC
│   │   ├── content/              ← MySQL extraction, file scanning, indexing
│   │   ├── credentials/          ← CredentialSyncBroadcaster (Sprint 4)
│   │   ├── embeddings/           ← ONNX embedding service
│   │   ├── events/               ← Event processor, graph, HTTP interface
│   │   ├── mcp/                  ← MCP server, 9 modules, 58+ tools
│   │   └── vector-store/         ← LanceDB
│   ├── renderer/components/      ← 10+ UI components
│   └── common/                   ← Shared types and constants
├── wp-plugins/
│   ├── ai/                       ← AI Experiments plugin (vendored)
│   ├── ai-provider-for-ollama/   ← Ollama provider (bundled)
│   └── nexus-ai-connector/       ← WordPress event sender
├── docs/                         ← Guides, sprint docs, implementation notes
└── tests/                        ← Unit, integration, eval, E2E
```

### Data Storage
```
~/Library/Application Support/Local/nexus-ai/
├── graph.db                      ← SQLite knowledge graph
├── vectors/                      ← LanceDB per-site tables
├── audit.log                     ← Event audit trail
├── ai_proxy_info                 ← AI proxy connection info
└── nexus-ai-mcp-connection-info.json
```

---

## Next Steps

### Phase 11 Testing Hardening (~1 week)
- [ ] WooCommerce extraction tests with product fixtures
- [ ] ACF field extraction tests (repeater, group, flexible content)
- [ ] Error recovery tests (MySQL socket disappears, ONNX missing, DB corrupted)
- [ ] Memory leak testing (index 50 sites, check RSS growth)

### Final Ship Prep (~1 week)
- [ ] Beta testing with 5-10 users
- [ ] Address critical feedback
- [ ] Update STATUS.md and COMPREHENSIVE_ROADMAP.md (stale sections)
- [ ] Marketplace submission
- [ ] V1 ships

---

**Status:** All 4 sprints complete. Ready for Phase 11 testing hardening and ship prep.
**Last Review:** 2026-03-06
