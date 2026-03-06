# Nexus AI - Comprehensive Roadmap

**Last Updated:** 2026-03-05
**Purpose:** Single source of truth for requirements, implementation status, and future work

---

## Table of Contents

1. [Vision & Requirements](#vision--requirements)
2. [What We've Built (Complete Inventory)](#what-weve-built-complete-inventory)
3. [Technical Architecture](#technical-architecture)
4. [Test Coverage](#test-coverage)
5. [Gap Analysis](#gap-analysis)
6. [Sprint Roadmap](#sprint-roadmap)
7. [Technical Requirements](#technical-requirements)

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
3. **Conversational Automation** - "Update all sites" → it happens
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
- ✅ Phase 1: Foundation (addon structure, service container, lifecycle)
- ✅ Phase 2: Content Pipeline (MySQL extraction, file scanning, indexing)
- ✅ Phase 3: MCP Server (HTTP server, tools, authentication)
- ✅ Phase 4: Deep Content Intelligence (vector search, semantic queries)
- ✅ Phase 5: Richer Structure Layer (themes/plugins, ACF fields)
- ✅ Phase 6: Fleet Intelligence (cross-site queries, comparisons)
- ✅ Phase 7: Search Quality (deduplication, remote WP-CLI)
- ✅ Phase 8: Instructions & Resources (server guidance, workflows)
- ✅ Phase 9: Ollama Integration (local LLM support)
- ✅ Phase 10: Local UI (FleetOverview, per-site sections, preferences)
- 🚧 Phase 11: Polish & Distribution (85% complete)

### Main Process Modules (src/main/)

**1. chat/** - Chat integration
- Chat service with Ollama backend
- Message handling and streaming

**2. content/** - Content extraction and indexing
- MySQLExtractor - Extract posts/pages/products from WordPress DB
- FileScanner - Scan themes, plugins, site structure
- IndexRegistry - Track indexing status per site

**3. embeddings/** - ONNX-based embedding generation
- EmbeddingService - Generate 384-dim vectors using all-MiniLM-L6-v2
- CPU-only, 5ms/doc, 184 docs/sec
- Quantized model (22MB on disk, ~90MB in memory)

**4. events/** - WordPress event tracking system
- EventProcessor - Background event processing
- GraphService - SQLite knowledge graph (sites, content, plugins, users, relationships)
- HttpEventInterface - HTTP endpoint (port 13000, Bearer auth)
- **10 event types tracked:**
  - Content: post_created, post_updated, post_deleted
  - Plugins: plugin_activated, plugin_deactivated, plugin_updated, plugin_deleted
  - Users: user_created, user_updated, user_deleted
  - Site: site_initialized

**5. mcp/** - MCP server and tools

**MCP Modules (9 modules, 75+ tool files):**
- **composite/** - Multi-operation workflows
  - nexus_site_audit - Parallel version+plugins+themes+health+updates
  - nexus_plugin_audit - Fleet-wide plugin analysis

- **content/** - Vector search and content operations
  - search_content, get_content, list_indexed_sites

- **fleet/** - Cross-site operations
  - search_fleet, compare_sites, get_fleet_stats

- **ollama/** - Local LLM integration
  - ask_ollama (with site context injection)
  - list_ollama_models, recommend_models

- **site-context/** - Site metadata and structure
  - get_site_context, get_site_structure

- **site-management/** - Site lifecycle
  - get_site_info, list_sites, start_site, stop_site

- **wp-cli/** - WordPress CLI operations (9 tools)
  - **Local + Remote execution** (use `site` for local, `install_name` for WPE)
  - wp_plugin_list, wp_plugin_activate, wp_plugin_deactivate, wp_plugin_update
  - wp_theme_list, wp_core_version, wp_user_list, wp_option_get
  - **Local-only:** wp_site_health

- **wp-connector/** - WordPress 7 AI integration ✨
  - **setup_ai** - Install AI Experiments plugin, enable all experiments
  - **sync_credentials** - Sync API keys from Local prefs to WordPress
  - **list_abilities** - Query WordPress Abilities API
  - **run_ability** - Execute WordPress AI abilities
  - **auto_sync** - Automatic credential synchronization
  - **ACF integration** - Enable ACF abilities for WP 7.0+

- **wpe/** - WP Engine hosting integration
  - Tools for managing WPE sites, domains, SSL, backups

**6. vector-store/** - LanceDB vector database
- VectorStore - Per-site table isolation
- LanceDBService - Database lifecycle management
- Automatic optimization every 20 events

### Renderer Components (src/renderer/)

**6 UI Components (2,698 lines):**

1. **FleetOverview.tsx** (35,926 chars)
   - Route: `/main/fleet-overview`
   - Dashboard with stats, MCP connection panel, site list, search
   - Embedded ChatTab for AI chat interface

2. **SiteNexusSection.tsx** (11,277 chars)
   - Hook: `SiteInfoOverview_Addon_Section`
   - Per-site index status, search UI, reindex controls
   - Auto-index toggle, context search

3. **ChatTab.tsx** (23,330 chars)
   - AI chat interface embedded in FleetOverview
   - Ollama integration for conversational queries

4. **NexusPreferences.tsx** (16,105 chars)
   - Hook: `preferencesMenuItems`
   - Settings and configuration UI
   - AI credential management

5. **SiteHeaderBadge.tsx** + **WpeBadge.tsx**
   - Visual indicators for WPE-connected sites

6. **NavItemInjector** + **SidebarBadgeManager**
   - DOM injection for fleet nav item and sidebar badges

### WordPress Plugins (wp-plugins/)

**1. ai/** - WordPress 7 AI Experiments plugin (vendored)
- Full AI Experiments plugin (v0.3.1)
- Provides WordPress Abilities API
- Image generation, text generation, chat interfaces
- **Auto-installed** by Nexus AI setup process

**2. ai-provider-for-ollama/** - Ollama provider for WordPress
- Connects WordPress 7 AI to Local's Ollama instance
- Enables local LLM usage in WordPress AI features
- **Auto-installed** when Ollama detected

**3. nexus-ai-connector/** - WordPress event sender
- Sends WordPress events to Local addon (HTTP POST)
- 10 event types via WordPress hooks
- **Auto-installed** on site start (MU plugin mode)

### Data Storage

**Locations:**
```
~/Library/Application Support/Local/nexus-ai/
├── graph.db              (SQLite - events, plugins, users, content, relationships)
├── vectors/              (LanceDB - per-site content embeddings)
│   ├── site_{id}_content/
│   └── ...
├── audit.log             (Event audit trail)
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

### Event Flow: WordPress → Local
```
WordPress Admin UI (user activates plugin)
       ↓
WordPress Hook: activated_plugin
       ↓
nexus-ai-connector plugin (HTTP POST with Bearer token)
       ↓
HttpEventInterface (port 13000) → 200 OK immediately
       ↓
EventProcessor (background, setImmediate)
       ↓
GraphService → SQLite graph.db (plugins table updated)
       ↓
MCP Tools → expose updated plugin state
       ↓
AI Clients (Claude, Cursor) see new plugin
```

### Content Indexing Flow
```
Site starts (siteStarted hook)
       ↓
FileScanner.scan(site) → ThemeInfo[], PluginInfo[]
       ↓
MySQLExtractor.extract(site) → Document[] (posts, pages)
       ↓
EmbeddingService.embedBatch(documents) → 384-dim vectors
       ↓
VectorStore.upsert(siteId, documents) → LanceDB site_{id}_content table
       ↓
IndexRegistry.update(siteId, stats) → Track completion
```

### MCP Search Flow
```
AI Client → MCP tools/call: search_site_content
       ↓
McpServer.handleToolCall() → Validate input, resolve site
       ↓
EmbeddingService.embed(query) → Single embedding (~5ms)
       ↓
VectorStore.search(siteId, queryVector) → LanceDB similarity search
       ↓
Format response with content + metadata → AI Client
```

### WordPress 7 AI Integration Flow
```
User clicks "Setup AI for Site" in FleetOverview
       ↓
IPC call to setup_ai (src/main/mcp/modules/wp-connector/setup-ai.ts)
       ↓
1. Install AI Experiments plugin (wp-plugins/ai/)
2. Install provider plugins (Ollama if available)
3. Enable all AI experiments (update_option for each experiment)
4. Sync credentials (OpenAI, Anthropic, etc. from Local prefs → WP options)
5. Enable ACF abilities (write MU plugin if ACF PRO >= 6.8)
       ↓
WordPress site now has AI features
       ↓
Users in WP Admin can use AI chat, image generation, content assistance
```

---

## Test Coverage

### Test Files Breakdown
- **Unit tests:** 6 files (core services, utilities)
- **Integration tests:** 12 files (service interactions, full pipeline)
- **E2E tests:** 22 files (MCP protocol, real Local environment)
- **Eval tests:** 3 files (instruction/resource quality, <2s, deterministic)

**Note:** Original plan mentioned 489 unit + 85 integration + 44 eval + 90 E2E.
**Gap:** Test inventory shows fewer files than expected. Need audit.

### Test Infrastructure
- E2E: Auto-start/stop Local via setup.ts/teardown.ts
- Connection: `~/Library/Application Support/Local/nexus-ai-mcp-connection-info.json`
- WPE tests: Use `nexus-test-site` linked to `nexustestsite1`
- Must `npm run build` before E2E tests

### Testing Philosophy
From `docs/testing-strategy.md`:
1. Contracts → Tests → Implementation (TDD)
2. Real Local environment for E2E (not mocks)
3. Deterministic evals (no LLM calls, <2s per test)
4. Per-platform validation (macOS, Windows, Linux)

---

## Gap Analysis

### What Works vs What's Missing

#### Aha Moment #1: Easy Fleet Discovery 🔍
**Current State:**
- ✅ Can search content via MCP (`search_site_content`)
- ✅ Can query site metadata (`get_site_info`)
- ✅ Can list plugins per site (`wp_plugin_list`)

**Missing:**
- ❌ No unified search UI in FleetOverview
- ❌ No "show me what needs work" dashboard
- ❌ No saved queries ("Sites needing attention", "Security issues")
- ❌ No cross-site aggregation ("all sites with outdated plugins")

#### Aha Moment #2: AI-Powered Fleet Management 🤖
**Current State:**
- ✅ 58+ MCP tools across 9 modules
- ✅ Remote WPE support (9 wp-cli tools)
- ✅ Composite tools (multi-operation workflows)
- ✅ Server-level instructions embedded

**Missing:**
- ❌ Better tool categorization for AI discovery
- ❌ More workflow templates (common operations)
- ❌ Activity log UI (see what AI did)
- ❌ Guardrails (dry-run mode for destructive operations)

#### Aha Moment #3: Conversational Automation 💬
**Current State:**
- ✅ MCP tools can execute actions
- ✅ Composite tools handle multi-step operations
- ✅ wp-cli tools work locally and remotely

**Missing:**
- ❌ No bulk operation engine ("apply to all sites")
- ❌ No progress tracking for long operations
- ❌ No rollback support
- ❌ No canary deployments (test on 1 site first)

#### Aha Moment #4: Unified Site Mental Model 🎯
**Current State:**
- ✅ Events track both infrastructure + WordPress
- ✅ Graph database stores unified state
- ✅ SiteNexusSection shows site info

**Missing:**
- ❌ No unified health score (0-100)
- ❌ No actionable recommendations
- ❌ UI still separates Local info vs WP info
- ❌ No context awareness (knows it's e-commerce, suggests relevant tools)

#### Aha Moment #5: Cross-Site Visibility 👁️
**Current State:**
- ✅ FleetOverview shows basic stats
- ✅ Event system tracks 10 event types (43 events processed)
- ✅ Graph database stores all data

**Missing:**
- ❌ **No event visualization in UI** (critical gap!)
- ❌ No event timeline showing what's happening
- ❌ No pattern detection (unusual spike in deactivations)
- ❌ No trend analysis (PHP version distribution over time)
- ❌ No anomaly alerts (3 sites need attention)

#### Aha Moment #6: Effortless WordPress AI ✨
**Current State:**
- ✅ WordPress 7 AI integration (`setup_ai` tool)
- ✅ Auto-install AI Experiments plugin
- ✅ Enable all experiments
- ✅ Sync credentials from Local prefs to WP
- ✅ ACF abilities integration
- ✅ Ollama provider plugin for local LLM

**Missing:**
- ❌ No automatic credential propagation (must click "Setup AI")
- ❌ No seamless local→production story
- ❌ No unified AI experience documentation

### Phase 11 Remaining Work

From `nexus-ai-implementation-plan.md` Phase 11 acceptance criteria:

**Testing Hardening (NOT DONE):**
- [ ] WooCommerce extraction tests with product fixtures
- [ ] ACF field extraction tests (repeater, group, flexible content)
- [ ] Error recovery tests (MySQL socket disappears, ONNX missing, DB corrupted)
- [ ] Memory leak testing (index 50 sites, check RSS growth)

**Already Done:**
- ✅ Integration tests for full pipeline
- ✅ MCP protocol compliance (E2E tests)
- ✅ Edge case coverage (Unicode, emoji, CJK, large posts)
- ✅ Per-platform packages build successfully
- ✅ Native modules load correctly
- ✅ README and THIRD_PARTY_LICENSES complete

---

## Sprint Roadmap

### Guiding Principles
1. Deliver aha moments in order of impact
2. Build on existing infrastructure (don't rebuild)
3. Test everything (unit, integration, E2E)
4. Ship incrementally (beta feedback after each sprint)

### Sprint 1 (Weeks 1-2): Cross-Site Visibility 👁️
**Goal:** Show users what's happening across their fleet

**Why First:**
- Highest impact / lowest effort
- Showcases event system we built
- Leverages existing data
- Visual proof of value

**Build:**
1. **Event Timeline UI** in FleetOverview
   - Visual stream of recent events (last 100)
   - Filter by type (content, plugins, users, site)
   - Status indicators (processed, pending, failed)

2. **Event Stats Cards**
   - Total events, processed today, by type
   - Comparison (today vs yesterday)
   - Health indicators (0 pending, 0 failed = green)

3. **Storage Health Visualization**
   - Graph DB size, vector DB size
   - Capacity used percentage
   - Oldest/newest event dates
   - Cleanup controls

4. **Top Issues Dashboard**
   - "3 sites have security updates pending"
   - "2 sites with failed events"
   - Actionable items with quick links

**Testing:**
- Unit tests: EventTimeline component, StatsCard component
- Integration tests: IPC handlers for event queries
- E2E tests: UI displays events after plugin activation

**Deliverable:** Dashboard showing "43 events processed, 3 sites need updates"

**Aha Delivered:** #5 (Cross-Site Visibility)

---

### Sprint 2 (Weeks 3-4): Easy Fleet Discovery 🔍
**Goal:** Help users find what needs attention

**Why Second:**
- Solves "I don't know what needs work" problem
- Complements visibility with actionable discovery
- Uses existing MCP tools + graph data

**Build:**
1. **Unified Search UI**
   - Search bar in FleetOverview
   - Query across: Local metadata + WordPress data + content
   - Results grouped by category (sites, plugins, content, issues)

2. **Smart Filters**
   - "Sites with outdated PHP" (< 8.0)
   - "Sites needing security updates"
   - "Sites with inactive plugins"
   - Custom query builder

3. **Saved Queries**
   - Pre-built: "Sites needing attention", "Security issues", "Performance problems"
   - Save custom queries
   - Pin to dashboard

4. **Site Health Scores**
   - 0-100 score per site (infrastructure + WordPress + security)
   - Visual indicator (green/yellow/red)
   - Top 3 recommendations per site

**Testing:**
- Unit tests: Search query parsing, filter logic
- Integration tests: Cross-domain queries (Local + WP)
- E2E tests: Search "outdated PHP" → see matching sites

**Deliverable:** Search for "sites needing updates" → instant answer with health scores

**Aha Delivered:** #1 (Easy Fleet Discovery) + Partial #4 (Unified Mental Model)

---

### Sprint 3 (Weeks 5-6): Conversational Automation 💬
**Goal:** Let AI do the work via bulk operations

**Why Third:**
- Enables "update all sites" workflows
- High user value (time savings)
- Requires testing infrastructure (canary, rollback)

**Build:**
1. **Bulk Operations Framework**
   - New MCP tool: `bulk_operation(sites[], operation, params)`
   - Site selectors: "all", "running", "php < 8.0", custom queries
   - Operations: plugin install/update, PHP version, user management

2. **Progress Tracking UI**
   - Real-time progress (5/20 sites updated)
   - Status per site (queued, in-progress, completed, failed)
   - Cancel operation
   - View logs

3. **Safety Features**
   - Dry-run mode (preview changes)
   - Canary deployments (test on 1 site first, wait, proceed)
   - Automatic rollback on first failure
   - Confirmation prompts for destructive operations

4. **Activity Log**
   - All bulk operations logged
   - Filterable by date, user, operation type
   - Replay/audit trail

**Testing:**
- Unit tests: Site selector parsing, operation validation
- Integration tests: Bulk operation execution, rollback
- E2E tests: Update 5 sites, one fails, rollback works

**Deliverable:** "Install Wordfence on all e-commerce sites" → progress tracking → done safely

**Aha Delivered:** #3 (Conversational Automation) + Enhanced #2 (AI Fleet Management)

---

### Sprint 4 (Weeks 7-12): AI Everywhere ✨
**Goal:** Seamless AI in all WordPress sites

**Why Last:**
- Most complex (credential propagation, WP plugin)
- Depends on proven infrastructure
- Completes the vision

**Build:**
1. **Automatic Credential Propagation** (Weeks 7-8)
   - Auto-sync on site start (not manual "Setup AI" button)
   - Watch for changes in NexusPreferences
   - Update all running sites when credentials change

2. **WordPress AI Plugin Enhancement** (Weeks 9-10)
   - Nexus AI companion plugin for WordPress
   - Calls back to Local for AI (no separate config)
   - WP Admin integration: chat, image gen, content assistance
   - Works seamlessly with WordPress 7 AI features

3. **Production Deployment Story** (Week 11)
   - Document local→WPE deployment
   - Credential management for production
   - Same AI experience in local dev and production
   - Migration guide

4. **Polish & Documentation** (Week 12)
   - User guides updated
   - Video tutorials
   - Beta testing refinement
   - Marketplace preparation

**Testing:**
- Unit tests: Credential sync logic, auto-propagation
- Integration tests: Local prefs → WordPress options
- E2E tests: Configure OpenAI key, start site, WP AI works

**Deliverable:** User configures AI once in Local, all WordPress sites have AI features

**Aha Delivered:** #6 (Effortless WordPress AI)

---

### Post-Sprint 4: Phase 11 Completion
**Remaining Testing Hardening (1 week):**
- WooCommerce extraction tests
- ACF field tests (repeater, group, flexible)
- Error recovery test suite
- Memory leak testing (50-site fixture)

**Final Ship Prep (1 week):**
- Beta testing with 5-10 users
- Address critical feedback
- Marketplace submission
- **V1 SHIPS!**

---

## Technical Requirements

### Architecture Principles
1. **Event-driven, non-blocking** - Events processed in background
2. **Per-site isolation** - Vector tables, graph records scoped by site_id
3. **Graceful degradation** - Works without Ollama, without WPE, without cloud
4. **Security-first** - Bearer auth, path validation, credential redaction
5. **MCP-native** - All features exposed via MCP tools

### Testing Requirements
For each sprint:
1. **Unit tests** - Component logic, pure functions
2. **Integration tests** - Service interactions, IPC handlers
3. **E2E tests** - Full workflows in real Local environment
4. **Manual testing** - QA in Local UI before ship

### Performance Requirements
- Event processing: <50ms per event (non-blocking)
- Vector search: <100ms for 500-doc site
- UI responsiveness: <1s load time for dashboard
- Memory usage: <200MB RSS for 20-site fleet

### Security Requirements
- All IPC handlers validated
- Path traversal prevention
- Credential redaction in logs
- Bearer token auth for MCP
- No secrets in code

### Compatibility Requirements
- Local versions: Works with current Local release
- WordPress: 6.4+
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
- `../docs/` - Developer guides

**Status:**
- This file (COMPREHENSIVE_ROADMAP.md) - Single source of truth
- Update after each sprint completion

---

**Last Updated:** 2026-03-05
**Next Review:** After Sprint 1 completion (Week 2)
