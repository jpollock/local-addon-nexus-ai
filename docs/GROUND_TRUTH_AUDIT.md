# Ground Truth Audit — What We Actually Built

**Date:** 2026-03-25
**Purpose:** Verify actual implementation vs documentation claims

---

## Test Counts (Verified)

| Test Suite | Actual Count | README Claim | Status |
|------------|--------------|--------------|--------|
| Unit Tests | **1,235** | 1,226 | ❌ Off by 9 |
| E2E Tests | **347** | 90+ | ❌ Off by 257 |
| Integration Tests | ? | 187 | ⚠️ Need to verify |
| Eval Tests | ? | 52 | ⚠️ Need to verify |

**Action:** Update README with actual counts.

---

## MCP Tools (Verified)

### Tool Modules (11 total)

| Module | Estimated Tools | Description |
|--------|----------------|-------------|
| **wpe** | ~13 | WP Engine account/site/install management |
| **wp-cli** | ~31 | WordPress CLI operations (local + remote) |
| **test-tools** | 1 | Test/diagnostic tools |
| **content** | 2 | Semantic search (site and cross-site) |
| **wp-connector** | ~12 | AI credential sync, Abilities API |
| **composite** | 3 | Parallel operations (site audit, plugin audit) |
| **site-management** | ~24 | Local site CRUD operations |
| **fleet** | 6 | Fleet-wide analysis and comparisons |
| **ollama** | 4 | Local LLM queries with site context |
| **site-context** | 6 | Site structure, index status, reindexing |
| **fleet-intelligence** | 9 | Advanced fleet analytics |

**Estimated Total:** ~111 tools (need to verify actual registered count)

**README Claim:** 51 tools

**Status:** ❌ Significantly off

**Action:** Count actual registered tools via `allToolNames()` method.

---

## UI Components (Verified)

### ✅ Panels That EXIST in Code AND Are RENDERED:

1. **AIGatewayUsagePanel** ✅ - AI Gateway usage tracking
2. **AIGatewayByCallerPanel** ✅ - Usage breakdown by caller
3. **TopIssuesPanel** ✅ - Actionable alerts
4. **StorageHealthPanel** ✅ - Database size and cleanup
5. **BulkOperationsPanel** ✅ - Fleet operations with progress
6. **EventStatsCards** ✅ - Event metrics (rendered in Overview)
7. **EventTimeline** ✅ - Live event stream (rendered in Overview)

### ❌ Components That EXIST in Code But Are NOT RENDERED:

1. **ChatTab.tsx** ❌ - AI chat interface (not imported/used)
2. **SiteGroupsPanel.tsx** ❌ - Site organization (imported but not rendered)
3. **SmartFiltersPanel.tsx** ❌ - Quick filters (exists, not rendered)
4. **SavedQueriesPanel.tsx** ❌ - Saved searches (exists, not rendered)
5. **AISiteFinderPanel.tsx** ❌ - AI-powered site search (exists, not rendered)
6. **UnifiedSearchPanel.tsx** ❌ - Combined search (exists, not rendered)

### ✅ Components That ARE RENDERED:

1. **SidebarSearchPanel** ✅ - Search integration in Sites sidebar
2. **NexusOverview** ✅ - Main dashboard (FleetOverview)
3. **NexusPreferences** ✅ - Addon settings
4. **SiteInfoWPE** ✅ - WPE site info in site details

**Key Findings:**
- ❌ **AI Chat UI** - Code exists but NOT visible to users
- ❌ **Site Groups UI** - Code exists but NOT visible to users
- ❌ **Smart Filters UI** - Code exists but NOT visible to users
- ✅ **AI Gateway** - Fully implemented and visible
- ✅ **Event Tracking** - Fully implemented and visible
- ✅ **Bulk Operations** - Fully implemented and visible

---

## CLI Commands (Need Verification)

### Command Structure:
```
src/cli/commands/
├── sites/      # Local site management
├── wp/         # WordPress operations
├── sync/       # WPE sync operations
├── search/     # Content search
├── bulk/       # Bulk operations
└── ai/         # AI-related commands
```

**Status:** ⚠️ Need to enumerate actual commands

**Action:** Run `nexus --help` and document command tree.

---

## Features - Planned vs Built

| Feature | Planned? | Built? | Visible in UI? | Documented? |
|---------|----------|--------|----------------|-------------|
| **Semantic Search** | ✅ | ✅ | ✅ (Sidebar) | ✅ |
| **WPE Remote Management** | ✅ | ✅ | ✅ (Site Info) | ✅ |
| **AI Gateway** | ✅ | ✅ | ✅ (Panels) | ⚠️ Partial |
| **Event Tracking** | ✅ | ✅ | ✅ (Timeline) | ⚠️ Partial |
| **Bulk Operations** | ✅ | ✅ | ✅ (Panel) | ⚠️ Partial |
| **Site Groups** | ✅ | ⚠️ Partial | ❌ NO | ✅ (but wrong) |
| **Smart Filters** | ✅ | ⚠️ Partial | ❌ NO | ✅ (but wrong) |
| **Saved Queries** | ✅ | ⚠️ Partial | ❌ NO | ⚠️ Unknown |
| **AI Chat UI** | ✅ | ⚠️ Partial | ❌ NO | ✅ (but wrong) |
| **Cross-Site Search** | ✅ | ✅ | ✅ (MCP/CLI) | ⚠️ Partial |
| **Graph Database** | ✅ | ✅ | ⚠️ Backend | ⚠️ Unknown |
| **WP-CLI (Local + Remote)** | ✅ | ✅ | ✅ (MCP/CLI) | ✅ |
| **Virtual Scrolling** | ✅ | ✅ | ✅ (Panels) | ⚠️ Partial |
| **Input Validation** | ✅ | ✅ | N/A | ✅ |
| **Audit Logging** | ✅ | ✅ | N/A | ✅ |

---

## Architecture (Verified)

### Main Process:
```
src/main/
├── mcp/                    ✅ MCP server + 11 tool modules
├── content/                ✅ Extraction pipeline
├── embeddings/             ✅ ONNX inference
├── vector-store/           ✅ LanceDB wrapper
├── events/                 ✅ Event processing
├── graph/                  ✅ Graph database (SQLite)
├── ai-gateway/             ✅ Credential proxy
├── bulk/                   ✅ Bulk operations
├── audit/                  ✅ Audit logger
├── utils/                  ✅ Validators, parallel utils
├── telemetry/              ⚠️ Verify if active
└── cli/ (via bin/)         ✅ CLI bootstrap + commands
```

### Renderer:
```
src/renderer/
├── components/             ✅ UI components
│   ├── NexusOverview.tsx  ✅ Main dashboard
│   ├── (7 active panels)  ✅ Rendered
│   └── (6 inactive panels) ❌ Code exists, not rendered
└── index.tsx               ✅ Entry point
```

---

## Key Gaps in Documentation

### docs-site/ Issues:

1. **UI Addon Docs**
   - ❌ `ai-chat.md` - Documents removed feature
   - ❌ `site-groups.md` - Documents non-visible feature
   - ❌ `smart-filters.md` - Documents non-visible feature
   - ⚠️ `fleet-overview.md` - May not reflect actual panels
   - ⚠️ `bulk-operations.md` - May not reflect actual UI

2. **Feature Docs**
   - ⚠️ AI Gateway - exists but minimal documentation
   - ⚠️ Event Tracking - exists but minimal documentation
   - ⚠️ Graph Database - exists but not documented

3. **Reference Docs**
   - ❌ Tool count wrong (51 vs ~111)
   - ❌ Test counts wrong
   - ⚠️ CLI commands - needs verification

### README.md Issues:

1. ❌ Test counts outdated
2. ❌ Tool count wrong (51)
3. ❌ No CLI documentation
4. ❌ No AI Gateway mention
5. ❌ No Event Tracking mention
6. ❌ No Bulk Operations mention
7. ❌ No Graph Database mention
8. ⚠️ Architecture section incomplete

---

## Recommendations

### Immediate Actions:

1. **Delete from docs-site:**
   - `docs-site/docs/ui-addon/ai-chat.md`
   - `docs-site/docs/ui-addon/site-groups.md`
   - `docs-site/docs/ui-addon/smart-filters.md`

2. **Update README.md:**
   - Test counts: 1,235 unit, 347 E2E
   - Tool count: ~111 (verify exact count)
   - Add CLI section
   - Add AI Gateway section
   - Add Event Tracking section
   - Add Bulk Operations section

3. **Create missing docs-site pages:**
   - `docs-site/docs/features/ai-gateway.md`
   - `docs-site/docs/features/event-tracking.md`
   - `docs-site/docs/features/bulk-operations.md`
   - `docs-site/docs/features/graph-database.md`

4. **Verify and document:**
   - Actual MCP tool count (run tool registry)
   - CLI command tree (`nexus --help`)
   - Integration test count
   - Eval test count

---

## Next Steps

1. ✅ Cleanup complete (Phase 1)
2. ✅ Ground truth audit started (Phase 2)
3. ⏭️ Complete verification:
   - Run MCP server, count registered tools
   - Run CLI, document command tree
   - Count integration/eval tests
4. ⏭️ Create developer AI context (Phase 4a)
5. ⏭️ Update docs-site content (Phase 4b)
6. ⏭️ Create user AI context (Phase 5)
7. ⏭️ Update README (Phase 6)
