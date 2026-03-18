# Nexus AI - Minimum UI Scope

**Date:** 2026-03-18
**Branch:** `main`
**Purpose:** Define the minimal UI surface needed to enable MCP/CLI value for initial users

---

## Problem Statement

The addon has grown **too much UI** solving navigation and management problems for power WPE users. This distracts from the core value proposition:

> **Aha Moment:** "Working in an AI session, managing my code or site data, the AI conversation is even more magical because of the context and capabilities provided by Nexus"

**Initial User:** Local users already using AI (or want to try) — not WPE power users managing 251 sites.

**Delivery Vehicle:** MCP server + CLI tools (100+ capabilities, vector DB, content pipeline, event tracking) — NOT Local UI.

---

## Current State Audit (main branch)

### ✅ Keep - Core Value Features

These directly support the "Aha Moment":

1. **NexusPreferences** (28KB) - ✅ KEEP
   - MCP server config (port, status, connection snippet)
   - API keys (Anthropic, OpenAI, Ollama)
   - WPE credentials (for sync)
   - Auto-index settings
   - **Why:** Setup friction is the #1 blocker to MCP adoption

2. **NexusOverview** (43KB) - ✅ KEEP (but simplify)
   - Stats dashboard: "X sites indexed, Y documents, Z events"
   - MCP server status
   - System health indicators
   - **Why:** User needs to "see" that the system is working

3. **SidebarSearchPanel** (20KB) - ✅ KEEP
   - AI Site Finder (Cmd+K)
   - Semantic search across all content
   - Jump to site/page from results
   - **Why:** This is the **"wow" demo** of vector DB value

4. **SiteNexusSection** - ✅ KEEP
   - Per-site section on Site Info page
   - Quick actions: "Setup AI", "Index Site", "View Events"
   - **Why:** Contextual actions where user already is

5. **NavItemInjector** - ✅ KEEP (but simplify)
   - "Nexus AI" nav item in vertical sidebar → Dashboard
   - **Why:** Discoverability

### ❌ Cut - Solving Wrong Problems

These solve navigation/management problems for power users, NOT MCP value:

1. **SidebarWPEInjector** (1318 lines!) - ❌ CUT
   - Tabbed sidebar (Local / WP Engine)
   - Grouped tree view (Account → Site → Install)
   - WPE auth empty states
   - Badges injection
   - **Why:** This is power-user site navigation. Not needed for MCP value.

2. **FleetOverview** (64KB) - ❌ CUT or MERGE
   - Duplicate dashboard with tabs (Sites, Chat, Operations)
   - Site table with filters, search, bulk operations
   - **Why:** Overlaps with NexusOverview. Power-user fleet management UI.

3. **ContentBrowser** (2.5KB) - ❌ CUT (for now)
   - Standalone indexed content browser at /main/content
   - **Why:** Redundant with SidebarSearchPanel (Cmd+K). If needed, can be tab in NexusOverview.

4. **SiteInfoWPE** (25KB) - ❌ CUT (for now)
   - Dedicated page for remote WPE sites
   - **Why:** Power-user feature. Can be added later if WPE users need it.

5. **ChatPanel** (3.7KB) - ❌ CUT (for now)
   - Chat interface in Local
   - **Why:** User has Claude Code for chat. In-app chat is redundant.

6. **SiteHeaderBadge** - ❌ CUT
   - WPE badge in site header
   - **Why:** Not needed for MCP value.

7. Extra nav items - ❌ CUT
   - "Content" nav item (no route/value without ContentBrowser)

### 🤔 Evaluate - May Be Useful

1. **BulkOperationsPanel** - Used by NexusOverview Operations tab
   - Bulk setup-ai, bulk index, bulk operations
   - **Verdict:** KEEP if in simplified NexusOverview. Otherwise CUT.

2. **SiteGroupsPanel** - Used by NexusOverview
   - Manage site groups
   - **Verdict:** KEEP if simple. Groups are useful for organizing sites.

3. **EventStatsCards**, **EventTimeline**, **StorageHealthPanel**, **TopIssuesPanel**
   - Dashboard widgets
   - **Verdict:** KEEP for NexusOverview. These show system value.

---

## Proposed Minimum UI

### 1. Preferences Panel ✅
**Route:** `/settings/nexus-ai` (via preferencesMenuItems hook)

**Sections:**
- **MCP Server**
  - Status: Running ✓ / Stopped ✗
  - Port: 3000
  - Connection snippet (copy button)
  - "How to connect Claude Code" link
- **API Keys**
  - Anthropic API Key
  - OpenAI API Key
  - Ollama settings
- **WPE Integration**
  - Credentials sync
  - Auto-sync toggle
- **Indexing**
  - Auto-index toggle
  - Excluded sites

**Why:** This is the setup UX. User needs to configure MCP connection.

---

### 2. Nexus Dashboard (Simplified) ✅
**Route:** `/main/nexus`
**Nav:** Single "Nexus AI" item in vertical sidebar

**Tabs:**
- **Overview** (default)
  - Stats cards: Sites, Documents, Events, MCP Tools
  - System health: MCP Server, Vector DB, Embedding Model
  - Recent activity feed (last 10 events)
  - Quick actions: "Sync WPE Sites", "Reindex All", "View Logs"

- **Operations** (optional - can be cut)
  - Bulk operations (setup-ai, index)
  - Site groups management

**Why:** User needs to see that the system is working and has value.

---

### 3. AI Site Finder (Cmd+K) ✅
**Trigger:** Keyboard shortcut (Cmd+K / Ctrl+K) or search icon in toolbar
**UI:** Modal overlay (like Cmd+K in VS Code)

**Features:**
- Semantic search across all indexed content
- Results show: title, snippet, site name, post type
- Click → jump to site or open in browser
- Shows "X sites indexed, Y documents" at bottom

**Why:** This is the **demo** of vector DB value. Tangible magic.

---

### 4. Per-Site Section ✅
**Location:** Site Info → "Nexus AI" section (via SiteInfoOverview_Addon_Section hook)

**Content:**
- AI Status: ✓ Setup / ⚠ Not Setup
- Index Status: ✓ Indexed (X docs) / ○ Not Indexed
- Actions:
  - "Setup AI" button (if not setup)
  - "Index Site" / "Reindex" button
  - "View Events" link → NexusOverview with site filter

**Why:** Contextual actions where user already is.

---

## What Gets Removed

### Files to Delete:
```
src/renderer/SidebarWPEInjector.ts           (1318 lines - tabbed sidebar, tree view, WPE sites)
src/renderer/components/FleetOverview.tsx    (64KB - duplicate dashboard)
src/renderer/components/ContentBrowser.tsx   (2.5KB - redundant with search)
src/renderer/components/SiteInfoWPE.tsx      (25KB - power-user WPE feature)
src/renderer/components/ChatPanel.tsx        (3.7KB - redundant with Claude Code)
src/renderer/components/SiteHeaderBadge.tsx  (2KB - not needed)
docs/SIDEBAR_WPE_INTEGRATION.md              (design doc for cut feature)
docs/UI_REORGANIZATION_PLAN.md               (design doc for cut feature)
```

### Code to Remove:
- All `SidebarWPEInjector` initialization in `src/renderer/index.tsx`
- `SiteHeaderBadge` hook registration
- "Content" nav item in `NavItemInjector`
- `/main/content` route
- `/main/site-info-wpe/:installId` route
- ChatPanel route (if exists)

### Keep But Simplify:
- **NavItemInjector** - Remove "Content" nav item, keep only "Nexus AI"
- **NexusOverview** - Keep Overview + Operations tabs, remove Sites/Chat tabs if they exist

---

## Golden Path (Post-Cleanup)

**User Journey:**
1. Install addon
2. Local → ⚙ Settings → Nexus AI
3. See "MCP Server: Running ✓ on port 3000"
4. Copy connection snippet
5. Claude Code → Settings → MCP Servers → Paste config
6. Ask Claude: "What WordPress sites do I have?"
7. Claude lists sites with rich context → **Aha!**
8. Try Cmd+K in Local → semantic search across all content → **Wow!**
9. Click "Nexus AI" nav item → see dashboard with stats → **Trust!**

**Friction Points to Fix:**
- [ ] Is MCP connection snippet clear/copy-able?
- [ ] Does first-time user understand what Nexus does?
- [ ] Is there a "Get Started" guide in Preferences?
- [ ] Does dashboard show zero-state "Index your first site" if nothing indexed?

---

## Success Metrics

**Before Cleanup:**
- 26 components
- 5,198 lines changed (from merge)
- 7 routes
- 3 nav items
- Complex tabbed sidebar with WPE tree view

**After Cleanup (Target):**
- ~12 components
- 1 nav item ("Nexus AI")
- 2 routes (dashboard, preferences)
- Simple, focused UX

**User Value:**
- User can connect Claude to MCP in < 2 minutes
- User sees semantic search "magic" via Cmd+K
- User understands system is working via dashboard
- 100+ MCP tools available to Claude

---

## Open Questions

1. **Do we need "Operations" tab in dashboard?**
   - Bulk operations are useful but may be too advanced for initial user
   - Could be hidden until user has >5 sites indexed

2. **Do we need site groups?**
   - Organizing sites is useful but maybe not for initial experience
   - Could be added later

3. **Should dashboard be single-page or tabs?**
   - Tabs (Overview / Operations) vs. single scrolling page
   - Recommendation: Single page for simplicity

4. **What's the zero-state UX?**
   - When no sites are indexed yet
   - When MCP server is stopped
   - When no API keys configured

---

## Next Steps

1. **Delete** files listed above
2. **Simplify** NavItemInjector (1 nav item)
3. **Audit** NexusOverview (remove Sites/Chat tabs if exist)
4. **Test** golden path end-to-end
5. **Write** Getting Started guide for Preferences
6. **Polish** zero-state UX (no sites indexed, etc.)

---

## Appendix: Infrastructure That Powers Everything

All of this UI is just a thin layer over the real value:

**Backend (All Working):**
- ✅ MCP Server (100+ tools)
- ✅ Vector DB (Weaviate)
- ✅ Embedding Service (nomic-embed-text)
- ✅ Content Pipeline (WordPress content → chunks → embeddings)
- ✅ Event Tracking (GraphService, EventProcessor)
- ✅ WPE Sync (251 sites, 97% faster with SSH ControlMaster)
- ✅ Remote WP-CLI (via SSH to WPE installs)
- ✅ Bulk Operations Framework
- ✅ Search Service (semantic + keyword)

**MCP Tools (Sample):**
- `nexus_list_sites` - List all sites (local + WPE)
- `wp_plugin_list` - List plugins on any site
- `wp_core_version` - Get WordPress version
- `wpe_get_install` - Get WPE install details
- `search_content` - Semantic search across all sites
- `get_site_events` - Get event timeline for site
- ...and 90+ more

**The UI should get out of the way and let the infrastructure shine.**
