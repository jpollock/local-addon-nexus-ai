# Documentation Inventory & Cleanup Plan

**Date:** 2026-03-25
**Purpose:** Categorize all 173 documentation files and determine what to keep/delete

---

## Summary

| Location | Total Files | Keep | Delete | Action Needed |
|----------|-------------|------|--------|---------------|
| `docs/` | 77 | 15 | 62 | Review & clean |
| `docs-site/` | 96 | 96 | 0 | Update content |
| **TOTAL** | **173** | **111** | **62** | |

---

## docs/ Directory Breakdown

### ✅ KEEP - Reference & Architecture (15 files)

**Active Reference:**
- `IMPLEMENTATION_STATUS.md` - Current implementation status
- `PRODUCTIONALIZATION_SUMMARY.md` - Security & validation summary
- `ARCHITECTURE.md` - System architecture overview
- `NATIVE_MODULES.md` - better-sqlite3 workflow (critical!)

**Architecture & Design:**
- `docs/architecture/overview.md` - Architecture overview
- `docs/architecture/digital-twin.md` - Digital twin concept
- `docs/architecture/ai-gateway.md` - AI Gateway design

**Planning (Keep for Historical Context):**
- `docs/planning/ai-context-file.md` - AI context planning
- `docs/planning/ai-call-tracking.md` - AI tracking planning

**User Guides (Move to docs-site or Delete):**
- `user-guide.md` - **MOVE** to docs-site (if not duplicate)
- `WPE_REMOTE_MANAGEMENT_USER_GUIDE.md` - **KEEP** (referenced in README)
- `WPE_SYNC_PERFORMANCE.md` - **KEEP** (performance benchmarks)

**API Documentation:**
- `docs/api/ipc-channels.md` - IPC channel reference

**Developer Guides:**
- `developer-guide.md` - **MOVE** to docs-site/docs/developer/

**Deployment:**
- `production-deployment-guide.md` - **KEEP** (operational)

---

### 🗑️ DELETE - Completed Sprints & Implementation Notes (62 files)

**Sprint Planning (DELETE - Historical):**
- `sprint-1-detailed-plan.md`
- `sprint-1-task-checklist.md`
- `sprint-1-ui-mockup.md`
- `sprint-2-detailed-plan.md`
- `sprint-2-task-checklist.md`
- `sprint-2-completion.md`
- `sprint-3-detailed-plan.md`
- `sprint-3-task-checklist.md`
- `sprint-4-detailed-plan.md`
- `sprint-4-task-checklist.md`
- `sprint-4-completion.md`
- `SPRINT_1_README.md`
- `phase1-detailed-plan.md`
- `phase1-ui-plan.md`

**Implementation Notes (DELETE - Completed Work):**
- `docs/implementation-notes/sprint-1-backend-review.md`
- `docs/implementation-notes/sprint-1-completion.md`
- `docs/implementation-notes/wordpress-events/MANUAL_TESTING.md`
- `docs/implementation-notes/wordpress-events/PHASE_2_4_IMPLEMENTATION.md`
- `docs/implementation-notes/wordpress-events/QUICK_TEST_GUIDE.md`
- `docs/implementation-notes/wordpress-events/WORDPRESS_EVENTS_COMPLETE.md`
- `docs/implementation-notes/wordpress-events/WORDPRESS_EVENTS_STATUS.md`

**WordPress Plugin Plans (DELETE - If Not Implemented):**
- `wordpress-event-sender-design.md`
- `wordpress-plugin-implementation-plan.md`
- `wp-connector.md` (if superseded)

**CLI Implementation (DELETE - Superseded by docs-site):**
- `CLI_IMPLEMENTATION_PLAN.md`
- `CLI_POC.md`
- `CLI_POC_RESULTS.md`
- `CLI_FEATURE_ROADMAP.md`
- `CLI_SUMMARY.md`
- `CLI_MISSING_BEHAVIORS.md`
- `CLI_BOOTSTRAP_SYSTEM.md`
- `CLI_IMPLEMENTATION_SUMMARY.md`
- `CLI_DESIGN_SPEC.md`
- `CLI_TEST_COVERAGE.md`
- `CLI_PHASES_3-7_COMPLETE.md`
- `CLI_MCP_FEATURE_PARITY.md`
- `CLI_E2E_TEST_FIX.md`
- `MCP_CLI_AUDIT.md`

**E2E Test Plans (DELETE - Tests Are Working):**
- `E2E_TEST_FAILURES_ANALYSIS.md`
- `E2E_TEST_100_PERCENT_PLAN.md`
- `E2E_100_PERCENT_IMPLEMENTATION.md`
- `E2E_FULL_SETUP_PLAN.md`
- `BROWSER_TESTING_SETUP.md`
- `BROWSER_TESTING_IMPLEMENTATION.md`

**Telemetry (DELETE - If Not Shipped):**
- `CLOUDFLARE_TELEMETRY_PROPOSAL.md`
- `CLOUDFLARE_TELEMETRY_PHASE1_COMPLETE.md`
- `CLOUDFLARE_TELEMETRY_PHASE2_COMPLETE.md`
- `CLOUDFLARE_TELEMETRY_PHASE3_COMPLETE.md`

**Test Results (DELETE - Superseded):**
- `STRESS_TEST_RESULTS.md`
- `MEMORY_LEAK_TEST_RESULTS.md`
- `PRODUCTION_VALIDATION_SUMMARY.md`
- `PRODUCTION_HARDENING_COMPLETE.md`

**Archived Planning (DELETE - Already Archived):**
- `docs/archive/ACTUAL_STATUS.md`
- `docs/archive/DECISION_MATRIX.md`
- `docs/archive/NEXT_WORK_OPTIONS.md`
- `docs/archive/PLANNING_STRUCTURE.md`

**UI Planning (DELETE - Completed):**
- `UI_MINIMUM_SCOPE.md`
- `roadmap-short-term.md`

**AI Proxy (DELETE or CONSOLIDATE):**
- `ai-proxy-guide.md` (check if superseded by docs-site)

**Security (DELETE - Covered in PRODUCTIONALIZATION_SUMMARY):**
- `security.md` (check for unique content first)

---

## docs-site/ Directory - Content Updates Needed

### Priority 1: Critical Fixes (Remove Non-Existent Features)

**UI Addon Docs (Verify What Exists):**
- `docs-site/docs/ui-addon/ai-chat.md` - **DELETE** (AI Chat UI removed)
- `docs-site/docs/ui-addon/site-groups.md` - **VERIFY** (may not exist)
- `docs-site/docs/ui-addon/smart-filters.md` - **VERIFY** (may not exist)
- `docs-site/docs/ui-addon/fleet-overview.md` - **UPDATE** (verify panels)
- `docs-site/docs/ui-addon/bulk-operations.md` - **UPDATE** (verify UI)
- `docs-site/docs/ui-addon/site-finder.md` - **UPDATE** (verify features)
- `docs-site/docs/ui-addon/wpe-management.md` - **UPDATE** (verify features)
- `docs-site/docs/ui-addon/preferences.md` - **UPDATE** (verify settings)
- `docs-site/docs/ui-addon/keyboard-shortcuts.md` - **VERIFY** (if implemented)

### Priority 2: Update with Actual Counts

**Reference Docs:**
- `docs-site/docs/reference/tool-reference.md` - Update tool count (89, not 51)
- `docs-site/docs/reference/cli-command-reference.md` - Verify commands
- `docs-site/docs/reference/changelog.md` - Add recent releases
- `docs-site/docs/mcp-tools/tool-matrix.md` - Update tool counts
- `docs-site/docs/mcp-tools/tool-schemas.md` - Verify schemas

**CLI Docs:**
- `docs-site/docs/cli/commands.md` - Verify command tree
- `docs-site/docs/cli/examples.md` - Add real examples

### Priority 3: Verify Technical Accuracy

**Architecture:**
- `docs-site/docs/architecture/overview.md` - Update diagrams
- `docs-site/docs/architecture/cli-architecture.md` - Verify structure
- `docs-site/docs/architecture/ui-architecture.md` - Verify panels

**Features:**
- `docs-site/docs/features/semantic-search.md` - Verify accuracy
- `docs-site/docs/features/wp-cli-integration.md` - Verify local + remote
- `docs-site/docs/features/content-extraction.md` - Verify pipeline

**Integrations:**
- `docs-site/docs/integrations/claude-desktop.md` - Verify setup
- `docs-site/docs/integrations/cursor.md` - Verify setup
- `docs-site/docs/integrations/ollama.md` - Verify if used
- `docs-site/docs/integrations/wpe-account.md` - Verify setup

---

## Action Plan

### Step 1: Delete Sprint History (62 files)
```bash
# Delete sprint plans
rm docs/sprint-*-detailed-plan.md
rm docs/sprint-*-task-checklist.md
rm docs/sprint-*-completion.md
rm docs/SPRINT_1_README.md
rm docs/phase1-*.md

# Delete implementation notes
rm -rf docs/implementation-notes/

# Delete CLI planning docs (superseded by docs-site)
rm docs/CLI_*.md
rm docs/MCP_CLI_AUDIT.md

# Delete E2E test planning
rm docs/E2E_*.md
rm docs/BROWSER_TESTING_*.md

# Delete telemetry planning
rm docs/CLOUDFLARE_TELEMETRY_*.md

# Delete test results
rm docs/STRESS_TEST_RESULTS.md
rm docs/MEMORY_LEAK_TEST_RESULTS.md
rm docs/PRODUCTION_VALIDATION_SUMMARY.md
rm docs/PRODUCTION_HARDENING_COMPLETE.md

# Delete archived content
rm -rf docs/archive/

# Delete UI planning
rm docs/UI_MINIMUM_SCOPE.md
rm docs/roadmap-short-term.md

# Delete WordPress plugin plans (if not used)
rm docs/wordpress-event-sender-design.md
rm docs/wordpress-plugin-implementation-plan.md
```

### Step 2: Move User Docs to docs-site
```bash
# Move if not duplicate
mv docs/user-guide.md docs-site/docs/user-guide/ (if unique content)
mv docs/developer-guide.md docs-site/docs/developer/ (if unique content)
```

### Step 3: Keep Only Reference Docs in docs/
**Final docs/ structure:**
```
docs/
├── IMPLEMENTATION_STATUS.md        # Current status
├── PRODUCTIONALIZATION_SUMMARY.md  # Security summary
├── ARCHITECTURE.md                 # High-level architecture
├── NATIVE_MODULES.md               # Critical build info
├── WPE_REMOTE_MANAGEMENT_USER_GUIDE.md
├── WPE_SYNC_PERFORMANCE.md
├── production-deployment-guide.md
├── architecture/
│   ├── overview.md
│   ├── digital-twin.md
│   └── ai-gateway.md
├── planning/
│   ├── ai-context-file.md
│   └── ai-call-tracking.md
└── api/
    └── ipc-channels.md
```

### Step 4: Create Developer AI Context
```
.claude/project/
├── CODEBASE.md              # Architecture, file structure (NEW)
├── DEVELOPMENT.md           # Build, test, debug (NEW)
├── ADDING_MCP_TOOLS.md      # How to add tools (NEW)
├── ADDING_UI_PANELS.md      # How to add UI (NEW)
├── TESTING.md               # Test strategy (NEW)
├── COMMON_PATTERNS.md       # Code patterns (NEW)
└── TROUBLESHOOTING_DEV.md   # Dev issues (NEW)
```

### Step 5: Create User AI Context
```
docs-site/docs/ai-context/
├── index.md                 # Overview (NEW)
├── features.md              # Verified features (NEW)
├── mcp-tools.md            # All tools with examples (NEW)
├── cli-commands.md         # All commands with examples (NEW)
├── common-tasks.md         # Task workflows (NEW)
└── troubleshooting.md      # User issues (NEW)
```

---

## Next Steps

1. ✅ Review this inventory
2. Execute deletion script
3. Audit codebase for ground truth (Phase 2)
4. Create developer AI context (Phase 4a)
5. Update docs-site content (Phase 4b)
6. Create user AI context (Phase 5)
7. Update README.md (Phase 6)

---

## Questions to Resolve

1. **Telemetry:** Was Cloudflare telemetry shipped? If yes, keep proposal for reference
2. **AI Proxy:** Is `ai-proxy-guide.md` unique or superseded by docs-site?
3. **Security:** Does `security.md` have unique content vs PRODUCTIONALIZATION_SUMMARY?
4. **WP Connector:** Is `wp-connector.md` still relevant or superseded?

**Recommendation:** Delete all unless you specifically recall unique content worth preserving.
