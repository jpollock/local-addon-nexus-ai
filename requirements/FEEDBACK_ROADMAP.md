# Feedback Roadmap

Based on requirements/FEEDBACK.md - organized by priority and effort.

## Phase 1: Quick Wins ✅ COMPLETE
**Goal**: Fix immediate UX issues and low-hanging fruit

- [x] **Bug #1**: Fix button styling to match Local's TextButton (SiteNexusSection)
- [x] **Bug #2**: Show active AI/model in FleetOverview MCP panel
- [x] **Improvement #1**: Add "Index All Running Sites" bulk button to FleetOverview

## Phase 2: Dashboard UX Consolidation
**Goal**: Reduce cognitive load by simplifying tab structure
**Effort**: Medium
**Impact**: High

**Current**: 10 tabs (Dashboard, Sites, Stats, Search, Groups, Saved Queries, Bulk Ops, Background Tasks, Chat, Settings)

**Proposed**: 4 core tabs
- **Overview**: Merge Dashboard + Stats (fleet health at a glance)
- **Sites**: Merge Sites + Groups + Saved Queries (all site management)
- **Operations**: Merge Bulk Ops + Background Tasks (all fleet operations)
- **Settings**: Unchanged

**Tasks**:
- [ ] Design consolidated Overview tab layout
- [ ] Merge Sites/Groups/Saved Queries into single Sites view
- [ ] Merge Bulk Ops/Background Tasks into Operations view
- [ ] Update navigation and routing
- [ ] Update tests

## Phase 3: Vector Search in Sites List
**Goal**: Aha Moment #1 - Find sites using semantic search
**Effort**: Low-Medium
**Impact**: High (key differentiator)

**Tasks**:
- [ ] Add search box to Sites tab
- [ ] Add toggle: Vector Search vs. Metadata-only
- [ ] Wire to existing SEARCH_UNIFIED IPC handler
- [ ] Show search results with relevance scores
- [ ] Highlight what vector search found vs metadata

**Design questions**:
- Search box placement (top of sites list? filter bar?)
- Results display (replace list? inline filter? separate panel?)
- Show "found in content: ..." preview?

## Phase 4: Auto-start/stop for Operations
**Goal**: Improvement #2 - Operations work on halted sites
**Effort**: Medium
**Impact**: Medium (convenience, but safety concerns)

**Behavior**:
- User triggers operation (index, setup-ai, etc.) on halted site
- System prompts: "Site is halted. Start site, run operation, then restore state?"
- On confirm: start site → run operation → stop site (if was stopped)
- Track original state to restore correctly

**Tasks**:
- [ ] Add pre-check to operations: detect halted sites
- [ ] Build confirmation UI with clear warnings
- [ ] Implement state restoration logic
- [ ] Add "restore original state" checkbox (default: on)
- [ ] Update bulk operations to support auto-start
- [ ] Add safety rails (max sites to auto-start at once)

**Safety concerns**:
- Clear user confirmation required
- Obvious visual feedback during auto-start/stop
- Failure recovery (what if start fails? what if operation fails mid-way?)

## Phase 5: Site Context (AGENTS.md / CLAUDE.md)
**Goal**: Aha Moment #2 - AI context injection
**Effort**: High
**Impact**: High (game-changer for AI quality)

**Concept**:
- Per-site markdown file (like AGENTS.md or CLAUDE.md) with AI context
- Describes site purpose, architecture, key patterns, gotchas
- Auto-injected into AI conversations via MCP resource
- Browsable/searchable in addon UI

**Tasks**:
- [ ] **Design decisions needed**:
  - File location (wp-content/nexus-ai/CONTEXT.md? root of site?)
  - Poll vs. on-demand loading?
  - Cache invalidation strategy?
  - What to include (plugins, theme, PHP/WP version, custom fields, constants)?
  - Auto-generate initial context or require manual creation?
- [ ] Implement MCP resource `site-context://{siteId}`
- [ ] Build context editor UI in addon
- [ ] Add context browser/search in addon
- [ ] Document best practices for writing site context

**Open questions**:
- Should context be version-controlled with site?
- Auto-generate from wp-cli introspection?
- Template library for common site types (ecommerce, blog, agency)?

## Phase 6: Browse & Search Site Contexts
**Goal**: Aha Moment #3 - Discover site context across fleet
**Effort**: Low (builds on Phase 5)
**Impact**: Medium

**Tasks**:
- [ ] Add "Contexts" tab to addon
- [ ] List all sites with context files
- [ ] Search across all context files (use existing vector search)
- [ ] Show context preview in list
- [ ] Click to open full context in editor

## Phase 7: Comprehensive State Management
**Goal**: Improvement #3 - Reliable, accurate site state
**Effort**: High
**Impact**: Medium (foundation for future features)

**Current issues**:
- State scattered across Local's siteData, our index registry, WPE status
- Reconciliation logic is reactive, not proactive
- No single source of truth
- Race conditions between polling and event-driven updates

**Tasks**:
- [ ] **Design state architecture**:
  - Single state store pattern (Redux-like?)
  - Event sourcing for audit trail?
  - Optimistic updates with rollback?
- [ ] Implement state reconciliation service
- [ ] Add state snapshots for debugging
- [ ] Build state inspector UI (dev tool)
- [ ] Document state model

**Design questions**:
- Poll vs. event-driven vs. hybrid?
- How to handle Local's siteData as source of truth?
- State persistence strategy?

---

## Current Status

**Completed**: Phase 1 (3/3 items)

**Next Recommended**: Phase 2 (Dashboard UX) - high impact, no new complexity

**Blocked**: Phase 5 (Site Context) - needs design decisions first

**Deferred**: Phase 7 (State Management) - foundational but not user-facing
