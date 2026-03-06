# Nexus AI - Current Status

**Last Updated:** 2026-03-05
**Phase:** 11 (Polish & Distribution)
**Build:** Clean, all tests passing

---

## 🎯 What This Addon Does

**Nexus AI** transforms Local into an intelligent AI host for your entire WordPress fleet:

- **Vector Search** - Semantic search across all sites using local ONNX embeddings (184 docs/sec)
- **MCP Server** - 58 tools exposing fleet operations to Claude, Cursor, ChatGPT
- **Event Tracking** - Real-time WordPress context (plugins, users, content changes)
- **Fleet Intelligence** - Cross-site queries, comparisons, and insights
- **Ollama Integration** - Optional local LLM with hardware-aware model recommendations

**Works with:** Claude Code, Cursor, Claude Desktop, any MCP-compatible client

---

## ✅ What Works

### Core Infrastructure
- ✅ LanceDB vector store (per-site table isolation)
- ✅ ONNX Runtime CPU embeddings (all-MiniLM-L6-v2, 384 dimensions)
- ✅ MCP HTTP server (port 13000, Bearer auth)
- ✅ WordPress connector plugin (auto-installs on site start)
- ✅ SQLite knowledge graph (sites, content, plugins, users, events)

### Event Tracking (10 Event Types)
- ✅ Content: post_created, post_updated, post_deleted
- ✅ Plugins: plugin_activated, plugin_deactivated, plugin_updated, plugin_deleted
- ✅ Users: user_created, user_updated, user_deleted
- ✅ Site: site_initialized

### MCP Tools (58 Tools, 8 Modules)
- ✅ **content** - search_content, get_content, list_indexed_sites
- ✅ **site-context** - get_site_context, get_site_structure
- ✅ **ollama** - ask_ollama (with site context injection), list_ollama_models, recommend_models
- ✅ **fleet** - search_fleet, compare_sites, get_fleet_stats
- ✅ **site-management** - get_site_info, list_sites, start_site, stop_site
- ✅ **wp-cli** - 9 tools (local + remote WPE execution)
- ✅ **wpe** - WP Engine hosting integration tools
- ✅ **composite** - nexus_site_audit, nexus_plugin_audit

### Composite Tools (Multi-Operation)
- ✅ `nexus_site_audit` - Parallel version+plugins+themes+health+updates
- ✅ `nexus_plugin_audit` - Fleet-wide plugin analysis with graceful partial failure

### MCP Resources (6 Workflow Guides)
- ✅ nexus://guide/getting-started
- ✅ nexus://guide/safety
- ✅ nexus://guide/remote-wp-cli
- ✅ nexus://workflow/go-live
- ✅ nexus://workflow/staging-workflow
- ✅ nexus://workflow/disaster-recovery

### Server-Level Instructions
- ✅ Embedded in MCP initialize response
- ✅ Discovery-first patterns (nexus_list_sites before operations)
- ✅ Routing guidance (local vs remote WP-CLI)
- ✅ Safety tier system (3 levels with confirmation tokens)

### Testing & Quality
- ✅ 489 unit tests
- ✅ 85 integration tests
- ✅ 44 eval tests (instruction/resource quality, deterministic)
- ✅ 90 E2E tests (auto-start Local environment)
- ✅ Per-platform packaging (macOS, Windows, Linux)
- ✅ Edge case coverage (Unicode, emoji, CJK, large posts, error recovery)

---

## 📊 Current Metrics

**From Latest Test Run:**
- Events processed: 43 (0 pending, 0 failed)
- Plugins tracked: 2 (AI Experiments, Hello Dolly)
- Content indexed: 32 documents
- Users tracked: 0 (ready for testing)
- Storage: graph.db ~96 KB, vectors/ per-site tables

**Performance:**
- Embedding generation: 5ms/doc, 184 docs/sec
- Vector search: <100ms for 500-doc site
- Event processing: <50ms (non-blocking)
- Full site index: <3 seconds for 500 posts

---

## 🚧 Active Development

**Status:** Awaiting direction on Phase 11 completion

**Pending Decision:**
- Ship as headless MCP-only addon (fully functional)?
- Build Phase 10 UI dashboard before shipping?
- Gather beta user feedback first?

---

## ⏸️ Phase 10 UI (Deferred)

**Original Plan:** Dashboard showing event stats, recent events, context search, storage health

**Why Deferred:** Addon is fully functional via MCP - UI would be nice-to-have, not blocker

**Detailed Plan Available:** `docs/phase1-ui-plan.md` (32 tests, 10-13 day timeline)

**If Needed:** Can be built post-V1 based on user feedback

---

## 🐛 Known Issues

**None blocking release.**

**Minor:**
- Better-sqlite3 Node version mismatch in some manual test scripts (workaround: use sqlite3 CLI directly)
- WordPress plugin must be reinstalled after code changes (automation: `scripts/manual-testing/manual-reinstall-plugin.js`)

---

## 📍 Where Things Are

### Key Files
```
/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/
├── MASTER_PLAN.md              ← Strategic roadmap (you are here's sibling)
├── STATUS.md                   ← Current state (this file)
├── README.md                   ← User-facing documentation
├── CLAUDE.md                   ← Claude Code guidance
├── src/
│   ├── main/                   ← Addon backend (Node.js in Electron main)
│   │   ├── events/             ← Event processor, graph service
│   │   ├── mcp/                ← MCP server and tools
│   │   ├── vector/             ← LanceDB, ONNX embeddings
│   │   └── services/           ← Core addon services
│   ├── renderer/               ← UI components (if Phase 10 built)
│   └── common/                 ← Shared types and constants
├── wp-plugins/
│   └── nexus-ai-connector/     ← WordPress plugin (event sender)
├── docs/
│   ├── user-guide.md
│   ├── developer-guide.md
│   ├── security.md
│   └── implementation-notes/   ← Phase completion notes
│       └── wordpress-events/
└── scripts/
    └── manual-testing/         ← Manual test scripts
```

### Data Storage
```
~/Library/Application Support/Local/nexus-ai/
├── graph.db                    ← SQLite knowledge graph
├── vectors/                    ← LanceDB per-site tables
│   ├── site_<id>_content/
│   └── ...
├── audit.log                   ← Event audit trail
└── nexus-ai-mcp-connection-info.json  ← MCP connection details
```

### Reference Projects
```
/Users/jeremy.pollock/development/wpengine/
├── flywheel-local/pm-work/     ← Strategic vision & master plan
├── wp-nexus/                   ← Architecture inspiration
│   ├── wp-event-nexus/         ← Event ingestion pattern
│   ├── wp-twin-nexus/          ← Digital twin state
│   └── wp-mcp-nexus/           ← MCP tools catalog
└── ai-native-wordpress-foundation/  ← Strategic vision
```

---

## 🚀 Quick Commands

### Build & Test
```bash
# Build addon
npm run build

# Run all tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:eval
npm run test:e2e
```

### Manual Testing
```bash
# Check event processing stats
node scripts/manual-testing/manual-test-check-stats.js

# List all sites with MCP connection
node scripts/manual-testing/manual-test-list-sites.js

# Test semantic search
node scripts/manual-testing/manual-test-search.js

# Demo fleet-wide queries
node scripts/manual-testing/manual-demo-fleet-queries.js

# Test plugin event tracking
node scripts/manual-testing/manual-test-plugin-event.js

# Reinstall WordPress plugin after changes
node scripts/manual-testing/manual-reinstall-plugin.js
```

### WordPress Event Testing
**Via Admin UI (Real Hooks):**
1. Go to http://nexus-e2e-test.local/wp-admin/plugins.php
2. Activate/deactivate any plugin
3. Check stats: `node scripts/manual-testing/manual-test-check-stats.js`

**Via wp_eval (Manual Hook Triggering):**
```bash
node scripts/manual-testing/manual-test-plugin-event.js
```

### Database Queries
```bash
# Event stats
sqlite3 ~/Library/Application\ Support/Local/nexus-ai/graph.db \
  "SELECT event_type, COUNT(*) FROM event_queue GROUP BY event_type;"

# Plugin tracking
sqlite3 ~/Library/Application\ Support/Local/nexus-ai/graph.db \
  "SELECT name, version, is_active FROM plugins;"

# Recent events
sqlite3 ~/Library/Application\ Support/Local/nexus-ai/graph.db \
  "SELECT event_type, datetime(created_at/1000, 'unixepoch'), status
   FROM event_queue
   ORDER BY created_at DESC
   LIMIT 10;"
```

---

## 📚 Documentation

**For Users:**
- Getting Started: `docs/user-guide.md`
- Security: `docs/security.md`

**For Developers:**
- Developer Guide: `docs/developer-guide.md`
- WordPress Plugin: `docs/wp-connector.md`
- Testing Strategy: `docs/testing-strategy.md`

**Implementation Notes:**
- WordPress Events: `docs/implementation-notes/wordpress-events/`
  - WORDPRESS_EVENTS_COMPLETE.md
  - PHASE_2_4_IMPLEMENTATION.md
  - WORDPRESS_EVENTS_STATUS.md
  - QUICK_TEST_GUIDE.md
  - MANUAL_TESTING.md

**Planning:**
- Master Plan: `MASTER_PLAN.md`
- Original Vision: `pm-work/local-ai-vision.md`
- Implementation Plan: `pm-work/nexus-ai-implementation-plan.md`

---

## 🎯 Next Steps

### Option A: Ship Phase 11 (Recommended)
**What:** Release as headless MCP-only addon
**Why:** Fully functional, tested, ready for beta users
**Timeline:** 1-2 weeks (beta feedback + marketplace prep)

### Option B: Build Phase 10 UI First
**What:** Dashboard showing event stats, context search, storage health
**Why:** Visual insights for users who prefer UI over MCP
**Timeline:** 2-3 weeks (32 tests + implementation per `docs/phase1-ui-plan.md`)

### Option C: Hybrid Approach
**What:** Ship Phase 11 now, build UI based on user feedback
**Why:** Get to market faster, validate demand for UI features
**Timeline:** Phase 11 ship in 2 weeks, UI in future sprint if needed

**Decision needed from stakeholder.**

---

## 💬 Feedback & Support

**Issues:** Report in Local addon feedback channels
**Questions:** See `docs/user-guide.md` FAQ section
**Contributing:** See `docs/developer-guide.md`

---

**Status:** ✅ Production-ready (headless MCP mode)
**Decision Point:** Ship now vs. build UI first
**Last Review:** 2026-03-05
