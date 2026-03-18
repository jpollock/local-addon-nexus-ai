# Nexus CLI - Project Summary

**Date:** 2026-03-18
**Status:** POC Complete, Ready for Full Implementation

---

## Quick Links

- **[Design Spec](./CLI_DESIGN_SPEC.md)** - Complete command reference and syntax
- **[POC Results](./CLI_POC_RESULTS.md)** - What we built, what works, lessons learned
- **[Feature Roadmap](./CLI_FEATURE_ROADMAP.md)** - Comparison with lwp + implementation plan
- **[POC Test Plan](./CLI_POC.md)** - Original test scenarios (historical)

---

## What Is Nexus CLI?

A unified command-line interface for managing WordPress sites across Local and WP Engine.

**Key Differentiators:**
- Works with BOTH local and remote sites equally
- Explicit `@env` targeting eliminates ambiguity
- AI-powered fleet intelligence
- Semantic content search
- WPE-specific operations without local site anchor

---

## Current Status

### ✅ What Works (POC)

1. **Site Listing**
   ```bash
   nexus sites list
   # Shows local sites + WPE installs with human-readable names
   ```

2. **Site Creation**
   ```bash
   nexus sites create test@local
   # Creates local WordPress sites
   ```

3. **WP-CLI Operations**
   ```bash
   nexus wp test@local plugin list        # Local site
   nexus wp wpe:account/install@prod plugin list  # Remote site via SSH
   ```

4. **Helpful Errors**
   ```bash
   nexus sites start test@production
   # Error: Only local sites can be started. Pull to local first.
   ```

### ⚠️ What's Stubbed

1. **Site Lifecycle**
   - `start/stop/delete` - Stubs with clear error messages
   - Implementation: HIGH priority (Sprint 1)

2. **Sync Operations**
   - `pull/push` - Returns "Use Local UI to link sites first"
   - Implementation: HIGH priority (Sprint 2)

3. **Extended WP-CLI**
   - Only `plugin list` implemented
   - Need: install, activate, update, delete, etc.
   - Implementation: HIGH priority (Sprint 1)

### ❌ What's Not Started

1. **Content Search** - Medium priority (Sprint 3)
2. **Fleet Intelligence** - Low priority (Sprint 4)
3. **WPE-Specific Operations** - Low priority (Phase 2)

---

## Architecture Decisions

### 1. @env Everywhere
**Decision:** Require `@env` on ALL commands

**Before:**
```bash
nexus sites start mysite     # ambiguous
nexus wp mysite plugin list  # missing environment
```

**After:**
```bash
nexus sites start mysite@local   # explicit
nexus wp mysite@local plugin list # clear
```

**Rationale:**
- Eliminates ambiguity
- Clear error messages
- Consistent with WPE's multi-environment model
- Discovered during POC testing

### 2. Services Direct > MCP Tools
**Decision:** GraphQL resolvers call `services.localServices` directly

**Why:**
- Cleaner code (no JSON parsing)
- Type-safe access to complex objects
- Avoid MCP tool overhead
- Direct access to hostConnections for linking

**Example:**
```typescript
// Before (via MCP tool)
const result = await registry.call('list_sites', {}, services);
const data = JSON.parse(result.content[0].text);

// After (direct service call)
const sites = Object.values(services.siteData.getSites());
const statuses = services.localServices.getAllSiteStatuses();
```

### 3. GraphQL Type Namespacing
**Decision:** Prefix all types with "Nexus"

**Why:**
- Avoid conflicts with reference implementation
- Local's GraphQL service merges schemas from multiple addons
- Reference implementation already defines `CreateSiteResult`, etc.

**Example:**
```graphql
type NexusSitesListResult { ... }  # Not SitesListResult
type NexusWpPluginListResult { ... }  # Not WpPluginListResult
```

### 4. Link Management via hostConnections
**Decision:** Use Local's native hostConnections instead of custom link storage

**Why:**
- Already exists in Local's site data
- Provides 1:1 linking automatically
- No need for separate database or userData storage
- Simplifies implementation

---

## Implementation Plan

### Sprint 1: Core Operations (1-2 weeks)
**Goal:** Match lwp's basic capabilities

- [ ] `sites start/stop/delete`
- [ ] Full WP-CLI passthrough
- [ ] Unit tests
- [ ] Error message polish

**Success:** Can manage full local site lifecycle + run any wp-cli command

### Sprint 2: Sync Operations (2-3 weeks)
**Goal:** Full push/pull parity

- [ ] `sync pull` (async handling)
- [ ] `sync push` (with confirmations)
- [ ] Progress indicators
- [ ] Selective sync (--db-only, --files-only)

**Success:** Can sync local ↔ WPE with proper safety checks

### Sprint 3: Content & Search (1-2 weeks)
**Goal:** Enable semantic search

- [ ] `content search`
- [ ] `content index`
- [ ] `content list`

**Success:** Can search across all indexed sites

### Sprint 4: Fleet Intelligence (2-3 weeks)
**Goal:** Multi-site analysis

- [ ] `fleet summary`
- [ ] `fleet outdated`
- [ ] `fleet compare`
- [ ] `fleet drift`

**Success:** Can analyze and get insights across entire fleet

**Total Timeline:** 8-13 weeks for full implementation

---

## Comparison: Nexus vs lwp

| Feature | lwp | Nexus | Notes |
|---------|-----|-------|-------|
| Local site management | ✅ Full | ✅ Full | Match |
| WP-CLI local | ✅ Full | ✅ Full | Match |
| WP-CLI remote | ✅ Via local anchor | ✅ Direct + anchor | Nexus advantage |
| Sync pull/push | ✅ Full | ⚠️ In progress | Sprint 2 |
| WPE site listing | ❌ N/A | ✅ Full | Nexus only |
| Content search | ❌ N/A | ⚠️ Planned | Nexus only |
| Fleet intelligence | ❌ N/A | ⚠️ Planned | Nexus only |
| WPE-specific ops | ❌ N/A | ⚠️ Planned | Nexus only |
| Explicit syntax | ⚠️ Sometimes | ✅ Always | Nexus advantage |

**Summary:** Nexus will match lwp's core + add unique features

---

## Technical Stack

### Dependencies
```json
{
  "commander": "^11.1.0",     // CLI framework
  "graphql-tag": "^2.12.6"    // GraphQL queries
}
```

### Architecture
```
CLI (commander)
  ↓
GraphQL Client
  ↓
Local's GraphQL Server
  ↓
GraphQL Resolvers (in addon)
  ↓
Services (siteData, localServices, etc.)
  ↓
Local's Core + WPE CAPI
```

### File Structure
```
src/
├── main/
│   ├── graphql/
│   │   ├── schema.ts       # Type definitions
│   │   └── resolvers.ts    # Service calls
│   └── index.ts            # GraphQL registration
├── cli/
│   ├── index.ts            # Commander setup
│   ├── commands/
│   │   ├── sites.ts        # Site management
│   │   ├── wp.ts           # WP-CLI passthrough
│   │   └── sync.ts         # Sync operations
│   └── utils/
│       ├── graphql.ts      # GraphQL client
│       └── target.ts       # Target parsing
└── bin/
    └── nexus.js            # Entry point
```

---

## Key Learnings

### 1. WPE CAPI Structure
- `install.account` is an object: `{ id, name }`
- Need to fetch accounts separately for display names
- Install name ≠ SSH hostname for all installs

### 2. Local's hostConnections
- Provides built-in linking
- No separate database needed
- Already 1:1 (one local ↔ one WPE install)

### 3. Remote WP-CLI
- SSH key: `~/Library/Application Support/Local/ssh/wpe-connect`
- Hostname: `{installName}.ssh.wpengine.net`
- Not all installs have SSH (plan dependent)

### 4. GraphQL Extension Pattern
- Multiple addons can extend GraphQL
- Must namespace types
- Works seamlessly with Local

---

## Next Steps

### Immediate
1. Review this summary + roadmap
2. Confirm Sprint 1 scope
3. Begin implementation

### This Week
1. Implement `sites start/stop/delete`
2. Implement full WP-CLI passthrough
3. Add unit tests
4. Error message polish

### This Month
1. Complete Sprint 1
2. Start Sprint 2 (sync operations)
3. Add integration tests

---

## Success Criteria

### MVP (End of Sprint 2)
- [ ] All lwp core features matched
- [ ] 90%+ test coverage
- [ ] Clear, helpful error messages
- [ ] Shell completion works
- [ ] User testing feedback positive

### Full Release (End of Sprint 4)
- [ ] All unique Nexus features working
- [ ] Comprehensive documentation
- [ ] Production-ready error handling
- [ ] Performance optimized (<100ms startup)
- [ ] Ready for broader rollout

---

## Resources

### Documentation
- [Design Spec](./CLI_DESIGN_SPEC.md) - 1,600 lines, complete reference
- [POC Results](./CLI_POC_RESULTS.md) - Implementation details + lessons
- [Feature Roadmap](./CLI_FEATURE_ROADMAP.md) - Sprint breakdown + comparison

### Code
- GraphQL Layer: `src/main/graphql/` (~400 lines)
- CLI Layer: `src/cli/` (~800 lines)
- Total: ~1,200 lines of new code

### Testing
- Manual testing: All POC commands verified
- Unit tests: TODO (Sprint 1)
- Integration tests: TODO (Sprint 2)
- E2E tests: TODO (Sprint 3)

---

## Questions?

1. **When can I use this?**
   - POC commands work now (sites list/create, wp plugin list)
   - Full feature set: 8-13 weeks

2. **How is this different from lwp?**
   - Explicit `@env` everywhere
   - Works with WPE sites directly (no local anchor needed)
   - AI-powered fleet intelligence
   - Content search

3. **Will it replace lwp?**
   - No, they can coexist
   - Nexus adds capabilities lwp doesn't have
   - Different philosophy (explicit vs implicit)

4. **Can I help?**
   - Yes! See Sprint 1 tasks in roadmap
   - Testing and feedback valuable
   - Documentation contributions welcome

---

## Contact

- **Project:** Nexus AI Local Addon
- **CLI Component:** `nexus` command
- **Branch:** `mvp-v1`
- **Docs:** `/docs/CLI_*.md`
