# UI Reorganization Plan: Fleet Management & Nexus AI Separation

**Status:** Planning
**Created:** 2026-03-11
**Goal:** Separate power-user fleet management from Nexus AI addon features into distinct, purpose-built interfaces

---

## Current State

### Navigation Structure
- **Vertical Sidebar:** "Nexus AI" icon → routes to `/main/fleet-overview`
- **Route:** `/main/fleet-overview` → FleetOverview component
- **FleetOverview Tabs:**
  - Overview (dashboard stats)
  - Sites (site list with search)
  - Content (indexed content browser)
  - Operations (bulk operations, groups)
  - Chat (AI chat interface)

### Component Responsibilities
- `FleetOverview.tsx` - Multi-tab interface serving all Nexus AI features
- `NavItemInjector.ts` - Injects "Nexus AI" nav item into vertical sidebar

---

## Proposed State

### Two Distinct Interfaces

#### 1. **Fleet** (Power User Site Management)
**Purpose:** Holistic site browsing/management for users with many sites (local + WPE)

**Navigation:**
- **Vertical Sidebar:** New "Fleet" icon (dashboard/gauge design)
- **Route:** `/main/fleet`
- **Interface:** Full-width table optimized for large site counts

**Features:**
- Combined local + WPE site list in single table
- Columns: Site name | Source badge | Status | WP version | PHP version | Health | Index status | Actions
- AI-powered search
- Filters: All Sites / Local Only / WPE Only, status filters
- Sorting: by name, last used, WP version, status
- Expandable rows for additional details
- Click local site → navigate to Site Info view
- Click WPE site → lightweight modal with metadata + "Pull to Local" CTA
- Actions dropdown per site

**Target Users:** Power users managing 10+ sites across local and WPE

---

#### 2. **Nexus AI** (Addon Dashboard)
**Purpose:** Nexus AI addon features, settings, and operations

**Navigation:**
- **Vertical Sidebar:** "Nexus AI" icon (existing)
- **Route:** `/main/nexus` (changed from `/main/fleet-overview`)

**Simplified Tabs:**
1. **Overview** - Dashboard stats, health metrics
2. **Operations** - Bulk operations, site groups, automation

**Features Moved Elsewhere:**
- **Sites tab** → Removed (functionality in Fleet interface)
- **Content tab** → New top-level "Content" nav item (see below)
- **Chat panel** → Slide-out panel (accessible from anywhere via Cmd+J or icon)

**Target Users:** All addon users, regardless of site count

---

#### 3. **Content** (New Top-Level Nav)
**Purpose:** Indexed content discovery and search across all sites

**Navigation:**
- **Vertical Sidebar:** New "Content" icon (document/search design)
- **Route:** `/main/content`
- **Interface:** Dedicated content browser (current FleetOverview "Content" tab)

**Features:**
- Search indexed content across all sites
- Filter by site, post type, date
- Vector search results
- Content preview

---

#### 4. **Chat** (Slide-Out Panel)
**Purpose:** AI assistance accessible from anywhere in Local

**Navigation:**
- **Keyboard Shortcut:** Cmd+J (or Ctrl+J)
- **Icon:** Small chat bubble in top-right corner (or bottom-right)
- **Behavior:** Slides out from right side, overlays current view

**Features:**
- Context-aware AI chat
- Can be invoked from any screen in Local
- Remembers conversation history
- Access to MCP tools

---

## Route Mapping

| Interface | Current Route | New Route | Component |
|-----------|---------------|-----------|-----------|
| Fleet (NEW) | - | `/main/fleet` | Fleet.tsx (new) |
| Nexus AI | `/main/fleet-overview` | `/main/nexus` | NexusOverview.tsx (refactored from FleetOverview) |
| Content (NEW) | Tab in FleetOverview | `/main/content` | ContentBrowser.tsx (extracted from FleetOverview) |
| Chat (NEW) | Tab in FleetOverview | Slide-out panel | ChatPanel.tsx (extracted from FleetOverview) |

---

## Navigation Injection

### NavItemInjector Updates

**Current:**
```typescript
// Single nav item: "Nexus AI" → /main/fleet-overview
```

**Proposed:**
```typescript
// Three nav items:
// 1. "Fleet" → /main/fleet (gauge icon)
// 2. "Content" → /main/content (document icon)
// 3. "Nexus AI" → /main/nexus (existing brain icon)
```

### Vertical Sidebar Order
```
[Local's default items]
- Sites
- Blueprints
- ...

[Nexus AI items - injected]
- Fleet          ← NEW (power user site management)
- Content        ← NEW (indexed content browser)
- Nexus AI       ← EXISTING (addon dashboard)
- [DragRegion filler]
```

---

## Component Breakdown

### Components to Create

1. **Fleet.tsx** (DONE - created in previous work)
   - Full-width table interface
   - Combined local + WPE site list
   - AI-powered search, filters, sorting
   - Expandable rows, actions dropdown

2. **NexusOverview.tsx** (Refactor from FleetOverview)
   - Simplified to 2 tabs: Overview, Operations
   - Remove Sites, Content, Chat tabs
   - Keep dashboard stats and bulk operations

3. **ContentBrowser.tsx** (Extract from FleetOverview)
   - Extract "Content" tab from FleetOverview
   - Standalone indexed content browser
   - Full screen instead of tabbed view

4. **ChatPanel.tsx** (Extract from FleetOverview)
   - Extract "Chat" tab from FleetOverview
   - Convert to slide-out panel
   - Add keyboard shortcut handler (Cmd+J)
   - Overlay positioning (slides from right)

5. **NavItemInjector.ts** (Update)
   - Inject 3 nav items instead of 1
   - Update routes and icons

### Components to Update

1. **index.tsx**
   - Add routes for `/main/fleet`, `/main/content`, `/main/nexus`
   - Mount ChatPanel as global slide-out
   - Register Cmd+J keyboard shortcut for chat

2. **FleetOverview.tsx** → **NexusOverview.tsx**
   - Rename component
   - Remove Sites, Content, Chat tabs
   - Keep Overview and Operations only

---

## Implementation Phases

### Phase 1: Create Planning Document ✅
- [x] Document current state
- [x] Define proposed state
- [x] Map routes and components
- [x] Define implementation phases

### Phase 2: Revert Accidental Changes ✅
- [x] Restore FleetOverview in index.tsx
- [x] Ensure existing functionality intact

### Phase 3: Integrate Fleet Interface (New Power User View) ✅
- [x] Verify `Fleet.tsx` component is complete (already created)
- [x] Add Fleet route `/main/fleet` to index.tsx
- [x] Add Fleet nav item to NavItemInjector (second nav icon)
- [x] Fix all initial issues (versions, scrollbar, routes, WPE badges, actions)
- [x] Reduce whitespace for compact power-user layout
- [ ] **TEST:** Fleet interface with combined local + WPE sites
- [ ] **TODO:** Replace WPE site modal alert with proper component
- [ ] **TODO:** Integrate AI-powered search

### Phase 4: Extract Content Browser ✅
- [x] Create `ContentBrowser.tsx`
- [x] Extract "Content" tab logic from FleetOverview
- [x] Add route `/main/content` to index.tsx
- [x] Add Content nav item to NavItemInjector
- [ ] Test standalone content browsing

### Phase 5: Extract Chat Panel ✅
- [x] Create `ChatPanel.tsx`
- [x] Extract "Chat" tab logic from FleetOverview (wrapped ChatTab component)
- [x] Convert to slide-out panel with overlay positioning (slides from right)
- [x] Add global keyboard shortcut (Cmd+J / Ctrl+J)
- [x] Add chat icon button (bottom-right floating button)
- [ ] Test slide-out behavior and context awareness

### Phase 6: Simplify Nexus AI (Refactor) ✅
- [x] Rename `FleetOverview.tsx` → `NexusOverview.tsx`
- [x] Remove Sites, Content, Chat tabs (already extracted)
- [x] Keep Overview and Operations tabs
- [x] Update route from `/main/fleet-overview` → `/main/nexus`
- [ ] Test simplified addon dashboard

### Phase 7: Update Navigation (Multi-Item Injection) ✅
- [x] Update NavItemInjector to inject 3 items (Fleet, Content, Nexus AI)
- [x] Design and add icons:
  - Fleet: grid/table icon (power user view)
  - Content: document/search icon
  - Nexus AI: dashboard/gauge icon
- [x] Set correct routes for each nav item
- [ ] Test navigation between all interfaces

### Phase 7a: WPE Site Info Page (Bonus) ✅
- [x] Create `SiteInfoWPE.tsx` component
- [x] Use Local's native components (@getflywheel/local-components)
- [x] Add header with site name, WPE badge, and action buttons (WP Admin, Open site)
- [x] Add sections: General, Environment, Connection, Nexus AI
- [x] Add fixed footer with Pull to Local action (matches Local's native pattern)
- [x] Add fallback renderer when Local components unavailable
- [x] Add route `/main/site-info-wpe/:installId`
- [x] Add IPC handlers: WPE_GET_SITE_DETAILS, WPE_SYNC_SINGLE, WPE_DIAGNOSE_SITE
- [x] Match Local's native styling (header spacing, button styles, footer layout)
- [ ] Test with real WPE sites

### Phase 8: Preferences & Settings
- [ ] Add preference toggle: "Classic View" vs "Fleet View" (optional)
- [ ] Update NexusPreferences component if needed
- [ ] Test settings persistence

### Phase 9: Testing & Polish
- [ ] Test all navigation flows
- [ ] Test Chat panel from different screens
- [ ] Test Fleet interface with large site counts
- [ ] Test Content browser with indexed sites
- [ ] Verify AI-powered search in Fleet
- [ ] Check dark theme compatibility
- [ ] Performance testing with 50+ sites

### Phase 10: Documentation
- [ ] Update README with new interface descriptions
- [ ] Create user guide for Fleet interface
- [ ] Document keyboard shortcuts (Cmd+K for search, Cmd+J for chat)
- [ ] Update CHANGELOG

---

## Design Decisions

### Why Separate Fleet from Nexus AI?
1. **Different user needs:** Fleet is for power users managing many sites; Nexus AI is for all users
2. **Information density:** Fleet needs full-width table; Nexus AI needs dashboard cards
3. **Discoverability:** Fleet is a top-level feature, not buried in addon settings
4. **Performance:** Fleet can optimize for 100+ sites; Nexus AI can stay lightweight

### Why Extract Content to Top-Level?
1. **Cross-site content search is powerful** - deserves its own dedicated space
2. **Decouples from addon dashboard** - users can search content without entering Nexus AI
3. **Future expansion** - Content browser can grow independently (analytics, insights)

### Why Slide-Out Chat Panel?
1. **Contextual AI assistance** - Chat should be accessible from any screen in Local
2. **Non-disruptive** - Slides over current view, doesn't require navigation
3. **Modern UX pattern** - Similar to VS Code's panels, Slack's threads
4. **Keyboard-first** - Cmd+J is a common chat shortcut (GitHub, Linear, etc.)

---

## Open Questions

1. **Chat Panel Positioning:**
   - Slide from right side (like a sidebar)?
   - Slide from bottom (like a terminal)?
   - Float as draggable window?
   - **Decision:** Slide from right (most common for chat interfaces)

2. **Fleet vs Sites:**
   - Should Fleet eventually replace Local's default Sites page?
   - Or always remain separate power-user option?
   - **Decision:** Keep separate for now; may add preference toggle in future

3. **AI-Powered Search Integration:**
   - Should Fleet use existing SidebarSearchPanel logic?
   - Or build new search interface specific to Fleet?
   - **Decision:** Reuse search logic, but optimize for table filtering

4. **WPE Site Actions:**
   - What actions should be available for WPE-only sites?
   - Pull to Local, View in Portal, SSH access?
   - **Decision:** TBD based on user needs

---

## Success Metrics

- [ ] Fleet interface loads <500ms with 100+ sites
- [ ] Navigation between Fleet/Content/Nexus feels native to Local
- [ ] Chat panel opens <100ms on Cmd+J
- [ ] AI-powered search returns results <2s
- [ ] Zero regressions in existing Nexus AI functionality

---

## Rollback Plan

If reorganization causes issues:
1. Revert route changes in index.tsx
2. Restore original FleetOverview at `/main/fleet-overview`
3. Remove new nav items from NavItemInjector
4. Keep Fleet.tsx, ContentBrowser.tsx, ChatPanel.tsx for future use

---

## Notes

- All new interfaces should use class-based React components (Local uses React 16)
- Use `React.createElement()` instead of JSX
- Maintain dark theme compatibility
- Follow Local's UI patterns (TableList, TableListRow, TextButton)
- Test with both small (5 sites) and large (100+ sites) fleets
