---
title: Verified Features
description: What Nexus AI actually does (ground truth)
keywords: [features, capabilities, what works, verified]
---

# Verified Features

**Last Verified:** 2026-03-25

This document lists **only features that actually exist** in the current implementation.

## ✅ Core Features

### Semantic Search

**Status:** ✅ Fully implemented

**Capabilities:**
- Search within a single site's content
- Cross-site search (search all indexed sites)
- Vector-based similarity search (cosine distance)
- Relevance scoring and ranking
- Post-level deduplication

**Tools:**
- `search_site_content` - Search specific site
- `search_across_sites` - Search all sites

**Example:**
```
Search for "WooCommerce payment gateway" across all sites
→ Returns posts, pages, products mentioning payment gateways
```

---

### Content Indexing

**Status:** ✅ Fully implemented

**What gets indexed:**
- Posts (all post types)
- Pages
- WooCommerce products (price, SKU, stock, categories)
- ACF custom fields (text, repeater, group, flexible)
- Media attachments (title, alt text, captions)
- Users (name, email, role)
- Site structure (themes, plugins, PHP version)

**Process:**
1. FileScanner → Extract themes, plugins, PHP version
2. MySQLExtractor → Pull content from database
3. ContentPipeline → Chunk at sentence boundaries
4. EmbeddingService → Generate 384-dim vectors (ONNX)
5. VectorStore → Store in LanceDB

**Tools:**
- `index_site` - Trigger full reindex
- `get_index_status` - Check indexing progress

---

### WP Engine Integration

**Status:** ✅ Fully implemented

**Capabilities:**
- Sync WP Engine sites into fleet view
- Remote WP-CLI execution via SSH
- ControlMaster for 10x faster SSH connections
- Account/site/install management via CAPI
- Pull WPE sites to local for development
- Content extraction from remote sites

**Performance:**
- 251 sites in ~25 minutes (full content indexing)
- ~6 seconds per site average
- 10x concurrent operations

**Tools:**
- `wpe_get_sites` - List all WPE sites
- `wpe_sync_sites` - Pull WPE sites into fleet
- `wpe_get_installs` - List installs for an account
- `wpe_get_accounts` - List WPE accounts
- Remote WP-CLI tools work with `install_name` parameter

---

### WP-CLI Integration

**Status:** ✅ Fully implemented (local + remote)

**Supports:**
- **Local sites** - Execute via `wp` binary
- **Remote WPE sites** - Execute via SSH with ControlMaster

**31 WP-CLI tools available:**
- Plugin management (list, install, activate, deactivate, update)
- Theme management (list, activate)
- Core management (version check, update)
- User management (list, create, update roles)
- Database operations (export, import, search-replace)
- Option management (get, update)
- Post management (list, create, update)

**Example:**
```bash
# Local site
wp_plugin_list { site_id: "abc-123" }

# Remote WPE site
wp_plugin_list { install_name: "myinstprod" }
```

---

### Local Site Management

**Status:** ✅ Fully implemented

**Capabilities:**
- Create new WordPress sites
- Start/stop/restart sites
- Clone sites (duplicate)
- Delete sites
- Change PHP version
- Toggle Xdebug
- Trust SSL certificates
- Export/import sites
- Blueprint system (save/restore site configs)

**17 tools available:**
- `local_list_sites` - List all local sites
- `local_get_site` - Get site details
- `local_create_site` - Create new site
- `local_start_site` / `local_stop_site` / `local_restart_site`
- `local_clone_site` - Duplicate site
- `local_delete_site` - Remove site
- And more...

---

### Fleet Intelligence

**Status:** ✅ Fully implemented

**Capabilities:**
- Cross-site analysis and comparisons
- Drift detection (sites diverging from baseline)
- Plugin usage analytics
- Health monitoring
- Event tracking (WordPress actions/filters)
- Graph database for site relationships

**9 advanced tools:**
- `compare_sites` - Side-by-side comparison
- `detect_drift` - Find diverging sites
- `analyze_plugin_usage` - Fleet-wide plugin stats
- `get_fleet_health` - Overall health metrics
- `track_site_changes` - Monitor modifications
- And more...

---

### Bulk Operations

**Status:** ✅ Fully implemented

**UI Panel:** ✅ BulkOperationsPanel visible in Fleet Overview

**Capabilities:**
- Multi-site operations with progress tracking
- Operation queue management
- Cancel running operations
- Per-site success/failure tracking
- Expandable results view

**Tools:**
- `bulk_setup_ai` - Setup AI across multiple sites
- `bulk_plugin_update` - Update plugins fleet-wide
- `parallel_site_audit` - Audit multiple sites
- `parallel_plugin_audit` - Check plugins across sites

**Example:**
```
Setup AI on 10 sites:
→ Shows progress bar
→ Expandable per-site results
→ Cancel anytime
```

---

### AI Gateway

**Status:** ✅ Fully implemented

**UI Panels:**
- ✅ AIGatewayUsagePanel - Usage tracking
- ✅ AIGatewayByCallerPanel - Usage by plugin/theme

**Capabilities:**
- Proxy AI API calls (OpenAI, Anthropic, etc.)
- Credential management (sync to sites)
- Usage tracking and cost monitoring
- Per-plugin/theme analytics
- Redact credentials from logs

**Tools:**
- `sync_ai_credentials` - Push credentials to sites
- `get_ai_gateway_usage` - Usage stats
- `discover_abilities` - AI feature detection
- `execute_ability` - Run AI operations

---

### Event Tracking

**Status:** ✅ Fully implemented

**UI Components:**
- ✅ EventTimeline - Live event stream
- ✅ EventStatsCards - Event metrics

**Capabilities:**
- WordPress action/filter tracking
- Graph database for relationships
- Event processor with queue
- HTTP interface for WordPress plugin
- Real-time UI updates

**Events tracked:**
- post_created, post_updated, post_deleted
- plugin_activated, plugin_deactivated
- theme_switched
- user_created, user_updated
- And more...

---

### Storage & Health

**Status:** ✅ Fully implemented

**UI Panels:**
- ✅ StorageHealthPanel - Database size and cleanup
- ✅ TopIssuesPanel - Actionable alerts

**Capabilities:**
- Database size monitoring
- Disk usage tracking
- Health issue detection
- Automated cleanup recommendations
- Priority-sorted alerts

---

### Search Integration

**Status:** ✅ Fully implemented

**UI Components:**
- ✅ SidebarSearchPanel - Search from sidebar
- ✅ Keyboard shortcut (Cmd/Ctrl+K)

**Capabilities:**
- Quick site search from anywhere
- AI-powered search (if LLM configured)
- Keyboard-driven workflow
- Instant site navigation

---

### WPE Site Info

**Status:** ✅ Fully implemented

**UI Component:**
- ✅ SiteInfoWPE - Per-site WPE details

**Capabilities:**
- WP Engine install information
- Environment details (prod/staging/dev)
- Domain and SSL status
- Account and subscription info
- Quick actions (pull to local, etc.)

---

### Ollama Integration

**Status:** ✅ Fully implemented

**Capabilities:**
- Local LLM queries with site context injection
- Automatic prompt augmentation with site metadata
- Tool-capable model support
- No external API dependencies

**4 tools:**
- `ollama_query` - Query with automatic context
- `ollama_query_with_site` - Query specific site
- `ollama_list_models` - Available models
- `ollama_status` - Check if Ollama running

---

### Safety System

**Status:** ✅ Fully implemented

**3-tier system:**
- **Tier 1 (Safe):** No confirmation (read-only)
- **Tier 2 (Medium):** Soft confirmation (reversible writes)
- **Tier 3 (Destructive):** Hard confirmation token (delete, force-push)

**Features:**
- Audit logging for all operations
- Credential redaction in logs
- Input validation (Zod schemas)
- Safety wrapper for MCP tools
- CLI confirmation prompts

---

## ❌ Features NOT Implemented

### AI Chat UI

**Status:** ❌ Removed from UI

**Reality:**
- Code exists (ChatTab.tsx) but not rendered
- Not visible in any UI panel
- Removed from navigation

**What works instead:**
- MCP tools via external clients (Claude Desktop, Cursor)
- CLI commands for terminal workflows

---

### Site Groups

**Status:** ❌ Not implemented in UI

**Reality:**
- Code exists (SiteGroupsPanel.tsx) but not rendered
- Not visible in Fleet Overview
- Site grouping is a core Local feature, not ours

**What works instead:**
- Filter sites via MCP tools or CLI
- Use Local's built-in site grouping

---

### Smart Filters

**Status:** ❌ Not implemented in UI

**Reality:**
- Code exists (SmartFiltersPanel.tsx) but not rendered
- Not visible in Fleet Overview
- Advanced filtering not exposed in UI

**What works instead:**
- Search via SidebarSearchPanel
- Filter via MCP tools or CLI

---

## Summary

| Category | Implemented | Not Implemented |
|----------|-------------|-----------------|
| **Search** | Semantic search, cross-site search | Advanced filter UI |
| **Sites** | Local CRUD, WPE sync, remote WP-CLI | Site groups UI |
| **Fleet** | Analytics, drift, health monitoring | Smart filters UI |
| **AI** | MCP tools, Ollama, AI Gateway | Chat UI tab |
| **UI** | 7 active panels, sidebar search | Chat, groups, filters tabs |
| **Safety** | 3-tier system, audit logs, validation | N/A |

**Active UI Panels (7):**
1. AIGatewayUsagePanel
2. AIGatewayByCallerPanel
3. TopIssuesPanel
4. StorageHealthPanel
5. BulkOperationsPanel
6. EventStatsCards
7. EventTimeline

**Not Rendered (6):**
1. ChatTab
2. SiteGroupsPanel
3. SmartFiltersPanel
4. SavedQueriesPanel
5. AISiteFinderPanel
6. UnifiedSearchPanel

## Next Steps

- **See all tools:** [MCP Tools](../mcp-tools/index.md)
- **CLI usage:** [CLI Commands](../cli/commands.md)
- **Common workflows:** [Common Tasks](common-tasks.md)
- **Issues:** [Troubleshooting](troubleshooting.md)
