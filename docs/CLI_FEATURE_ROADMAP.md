# Nexus CLI - Feature Roadmap

**Date:** 2026-03-18
**Comparison:** Nexus CLI vs lwp (Local CLI reference)

---

## Philosophy Differences

### lwp (Local CLI)
- **Local-centric:** Local sites are primary, WPE is a sync destination
- **Implicit linking:** Site anchor required for remote operations
- **Command structure:** `lwp wp <local-site> [args]` assumes local context

### Nexus CLI
- **Environment-agnostic:** Local and WPE treated equally
- **Explicit targeting:** `@env` required everywhere
- **Unified operations:** Same commands work local + remote with different targets

---

## Feature Comparison Matrix

| Feature Category | lwp Status | Nexus Status | Implementation Priority |
|-----------------|------------|--------------|------------------------|
| **Site Management** |
| List sites | ✅ Local only | ✅ Local + WPE | DONE |
| Create local site | ✅ Full | ✅ Full | DONE |
| Start/stop/restart | ✅ Full | ⚠️ Stub | HIGH (Sprint 1) |
| Delete site | ✅ Full | ⚠️ Stub | HIGH (Sprint 1) |
| Clone site | ✅ Full | ❌ Not planned | MEDIUM |
| Site info/status | ✅ Full | ❌ Not started | MEDIUM |
| **WordPress Operations** |
| Plugin list | ✅ Local + Remote | ✅ Local + Remote | DONE |
| Plugin install | ✅ Local + Remote | ❌ Not started | HIGH (Sprint 1) |
| Plugin activate/deactivate | ✅ Local + Remote | ❌ Not started | HIGH (Sprint 1) |
| Plugin update | ✅ Local + Remote | ❌ Not started | HIGH (Sprint 1) |
| Plugin delete | ✅ Local + Remote | ❌ Not started | MEDIUM |
| Theme list | ✅ Local + Remote | ❌ Not started | MEDIUM |
| Theme activate | ✅ Local + Remote | ❌ Not started | MEDIUM |
| Core version | ✅ Local + Remote | ❌ Not started | MEDIUM |
| Core update | ✅ Local + Remote | ❌ Not started | LOW |
| User list | ✅ Local + Remote | ❌ Not started | LOW |
| User create | ✅ Local + Remote | ❌ Not started | LOW |
| DB export | ✅ Local only | ❌ Not started | MEDIUM |
| DB search-replace | ✅ Local only | ❌ Not started | LOW |
| Option get/update | ✅ Local + Remote | ❌ Not started | LOW |
| Generic WP-CLI passthrough | ✅ Full | ❌ Not started | HIGH (Sprint 1) |
| **Sync Operations** |
| Pull from WPE | ✅ Full | ⚠️ Stub | HIGH (Sprint 2) |
| Push to WPE | ✅ Full | ⚠️ Stub | HIGH (Sprint 2) |
| Async progress | ✅ Full | ❌ Not started | HIGH (Sprint 2) |
| Selective sync (db/files) | ✅ Full | ❌ Not started | HIGH (Sprint 2) |
| Link management | ✅ Implicit | ⚠️ Via hostConnections | DEFERRED |
| **WPE-Specific** |
| List WPE installs | ❌ N/A | ✅ Full | DONE |
| Create WPE install | ❌ N/A | ❌ Not started | MEDIUM |
| WPE domains | ❌ N/A | ❌ Not started | LOW |
| WPE SSL status | ❌ N/A | ❌ Not started | LOW |
| WPE backups | ❌ N/A | ❌ Not started | LOW |
| WPE cache purge | ❌ N/A | ❌ Not started | LOW |
| **Content/Search** |
| Content search | ❌ N/A | ❌ Not started | MEDIUM (Sprint 3) |
| Content index | ❌ N/A | ❌ Not started | MEDIUM (Sprint 3) |
| **Fleet/Intelligence** |
| Fleet summary | ❌ N/A | ❌ Not started | LOW (Sprint 4) |
| Fleet outdated | ❌ N/A | ❌ Not started | LOW (Sprint 4) |
| Fleet compare | ❌ N/A | ❌ Not started | LOW (Sprint 4) |
| Fleet drift | ❌ N/A | ❌ Not started | LOW (Sprint 4) |
| AI analysis | ❌ N/A | ❌ Not started | FUTURE |

---

## Sprint Breakdown

### Sprint 1: Core Site & WP Operations (1-2 weeks)

**Goal:** Match lwp's basic site + WP-CLI capabilities

**Features:**
1. ✅ `nexus sites start/stop/restart <target>`
   - Validate target is `@local`
   - Call `services.localServices.startSite()`
   - Error: "Only local sites can be started"

2. ✅ `nexus sites delete <target>`
   - Validate target is `@local`
   - Confirmation prompt
   - Call `services.localServices.deleteSite()`

3. ✅ `nexus wp <target> plugin install/activate/deactivate/update/delete`
   - Extract plugin slug from args
   - Local: Call `services.localServices.wpCliRun(siteId, ['plugin', 'install', slug])`
   - Remote: Call `services.localServices.remoteWpCliRun(installName, ['plugin', 'install', slug])`

4. ✅ `nexus wp <target> <any-wp-cli-command>`
   - Generic passthrough
   - Parse command + args
   - Route to local or remote based on target
   - Blocked commands on remote: `db query`, `eval`, `shell`

**Success Criteria:**
- [ ] Can manage full local site lifecycle
- [ ] Can run any wp-cli command local + remote
- [ ] Error messages guide users correctly
- [ ] Unit tests for all commands

---

### Sprint 2: Sync Operations (2-3 weeks)

**Goal:** Full sync parity with lwp

**Features:**
1. ✅ `nexus sync pull <local>@local --from=<wpe>`
   - Resolve WPE target (full or shorthand)
   - Check if site is running
   - Call MCP tool: `local_wpe_pull`
   - Handle async: tool returns immediately
   - Show "Check Local app for progress" message
   - Update link info in hostConnections (if applicable)

2. ✅ `nexus sync push <local>@local --to=<wpe>`
   - Resolve WPE target
   - Confirmation for `--db` flag
   - Extra confirmation for production
   - Call MCP tool: `local_wpe_push`
   - Handle async

3. ✅ Async progress indicators
   - Option A: Poll Local's GraphQL for job status
   - Option B: WebSocket subscription
   - Option C: Just show "in progress" message (POC approach)

4. ✅ Selective sync
   - `--db-only` flag
   - `--files-only` flag
   - Pass to MCP tool

**Success Criteria:**
- [ ] Can pull from any WPE install
- [ ] Can push to any WPE install
- [ ] Confirmation works for destructive ops
- [ ] Progress visible (even if just message)
- [ ] Async operations don't block CLI

**Challenges:**
- lwp handles sync synchronously (waits for completion)
- Local's pull/push are async (return immediately)
- Need to decide: wait or return?
- Recommendation: Return with message "Check Local app"

---

### Sprint 3: Content & Search (1-2 weeks)

**Goal:** Enable semantic search across sites

**Features:**
1. ✅ `nexus content search <query>`
   - Call MCP tool (already exists in addon)
   - Format results for CLI
   - Support `--limit` and `--json`

2. ✅ `nexus content index <target>`
   - Local: Call MCP tool
   - Remote: Error "Remote indexing not supported yet"
   - Show progress

3. ✅ `nexus content list`
   - Show all indexed sites
   - Document counts
   - Last indexed time

**Success Criteria:**
- [ ] Can search across all indexed sites
- [ ] Can index local sites
- [ ] Results formatted clearly
- [ ] JSON output works

**Notes:**
- MCP tools already exist for this
- Just need CLI wrappers
- Lower priority than core operations

---

### Sprint 4: Fleet Intelligence (2-3 weeks)

**Goal:** Multi-site analysis and AI-powered insights

**Features:**
1. ✅ `nexus fleet summary`
   - Aggregate stats across all sites
   - WordPress versions, PHP versions
   - Plugin counts, theme counts
   - Call existing MCP tools

2. ✅ `nexus fleet outdated`
   - Find sites with outdated software
   - Security updates flagged
   - Call existing health calculation tools

3. ✅ `nexus fleet compare <site1> <site2>`
   - Plugin/theme differences
   - Configuration drift
   - Version mismatches

4. ✅ `nexus fleet drift`
   - Detect configuration drift
   - Identify outliers
   - Recommend standardization

**Success Criteria:**
- [ ] Can analyze entire fleet
- [ ] Clear actionable recommendations
- [ ] AI insights where applicable
- [ ] JSON output for scripting

**Notes:**
- Some MCP tools exist (health calculator, etc.)
- Some need to be created (fleet comparison)
- AI integration via existing chat service

---

## Unique Nexus Features (Not in lwp)

### 1. WPE-Only Operations
lwp doesn't support WPE operations without a local site anchor.

**Nexus supports:**
```bash
# List all WPE installs
nexus sites list --wpe-only

# Operate on WPE install directly
nexus wp wpe:account/install@production plugin list

# WPE-specific operations
nexus wpe domains <install>@production
nexus wpe ssl-status <install>@production
nexus wpe backup create <install>@production
nexus wpe cache purge <install>@production
```

### 2. Unified Site View
```bash
nexus sites list  # Shows BOTH local + WPE in one view
```

lwp only shows local sites.

### 3. Content Search
```bash
nexus content search "homepage design"
# Searches across ALL sites (local + indexed WPE)
```

lwp has no content search.

### 4. Fleet Intelligence
```bash
nexus fleet summary
nexus fleet outdated
nexus fleet recommend-updates
nexus fleet health-score
```

lwp has no fleet-level operations.

### 5. AI-Powered Features
```bash
nexus fleet predict-issues
nexus fleet suggest-optimizations
nexus fleet security-scan
```

lwp has no AI integration.

---

## Command Structure Comparison

### Site Management

| Operation | lwp | Nexus |
|-----------|-----|-------|
| List | `lwp sites` | `nexus sites list` |
| Create | `lwp create <name>` | `nexus sites create <name>@local` |
| Start | `lwp start <name>` | `nexus sites start <name>@local` |
| Stop | `lwp stop <name>` | `nexus sites stop <name>@local` |
| Delete | `lwp delete <name>` | `nexus sites delete <name>@local` |

**Difference:** Nexus requires `@local` to be explicit.

### WP-CLI

| Operation | lwp | Nexus |
|-----------|-----|-------|
| Local | `lwp wp <site> plugin list` | `nexus wp <site>@local plugin list` |
| Remote | Requires local anchor | `nexus wp wpe:acct/install@env plugin list` |
| Linked remote | `lwp wp <site> plugin list` (if linked) | `nexus wp <site>@production plugin list` |

**Difference:** Nexus requires explicit environment, supports direct remote access.

### Sync

| Operation | lwp | Nexus |
|-----------|-----|-------|
| Pull | `lwp wpe pull <site>` | `nexus sync pull <site>@local --from=<wpe>` |
| Push | `lwp wpe push <site>` | `nexus sync push <site>@local --to=<wpe>` |
| Link | Automatic on first sync | Via hostConnections (implicit) |

**Difference:** Nexus requires explicit `--from`/`--to` flags.

---

## Implementation Approach

### Phase 1: Core Parity (Sprints 1-2)
**Goal:** Match lwp's site management + WP-CLI + sync capabilities

**Deliverables:**
- All site lifecycle commands
- Full WP-CLI passthrough
- Full sync operations
- 80% test coverage

**Timeline:** 3-5 weeks

### Phase 2: Nexus-Specific (Sprints 3-4)
**Goal:** Add features lwp doesn't have

**Deliverables:**
- Content search
- Fleet intelligence
- WPE-specific operations
- AI-powered insights

**Timeline:** 3-5 weeks

### Phase 3: Polish & Production
**Goal:** Production-ready release

**Deliverables:**
- Comprehensive testing
- Shell completions
- Man pages
- Error message polish
- Performance optimization

**Timeline:** 2-3 weeks

---

## Testing Strategy

### Unit Tests
```typescript
// Target parsing
describe('parseTarget', () => {
  it('parses local targets')
  it('parses WPE full syntax')
  it('parses WPE shorthand')
  it('throws on invalid syntax')
  it('throws on missing environment')
})

// Command validation
describe('sites start', () => {
  it('accepts local targets')
  it('rejects WPE targets')
  it('shows helpful error')
})
```

### Integration Tests
```typescript
// GraphQL mutations
describe('nexusSitesCreate', () => {
  it('creates local site')
  it('returns site info')
  it('handles errors')
})

// Service calls
describe('nexusWpPluginList', () => {
  it('lists local plugins')
  it('lists remote plugins via SSH')
  it('handles site not running')
})
```

### E2E Tests
```typescript
// Full workflows
describe('E2E: Site lifecycle', () => {
  it('create → start → install plugin → stop → delete')
})

describe('E2E: Sync workflow', () => {
  it('create local → push to WPE → pull changes')
})
```

---

## Success Metrics

### Coverage Goals
- [ ] 100% of lwp's core features
- [ ] 5+ unique Nexus features
- [ ] 90%+ test coverage
- [ ] <100ms command startup time
- [ ] Clear error messages (user testing)

### User Experience Goals
- [ ] Zero ambiguity in syntax
- [ ] Discoverable via `--help`
- [ ] Shell completion works
- [ ] JSON output for all list commands
- [ ] Consistent flag names

---

## Open Questions

1. **Async Operations:**
   Should `sync pull/push` wait for completion or return immediately?
   - lwp waits (synchronous)
   - Local's tools are async
   - Recommendation: Return with progress check instructions

2. **Link Management:**
   Do we need explicit `nexus sites link/unlink` commands?
   - lwp does it automatically
   - hostConnections already provides linkage
   - Recommendation: Defer until user feedback

3. **WPE Install Creation:**
   Should `nexus sites create --wpe` create WPE installs?
   - Useful for remote-first workflow
   - Requires CAPI integration
   - Recommendation: Add in Phase 2

4. **Progress Indicators:**
   How to show progress for async operations?
   - Option A: Poll GraphQL for status
   - Option B: WebSocket subscription
   - Option C: Just message "Check Local app"
   - Recommendation: Start with C, upgrade to A later

---

## Dependencies

### Required Services (Already Available)
- ✅ `services.localServices` - All Local operations
- ✅ `services.siteData` - Site information
- ✅ `services.indexRegistry` - Content indexing
- ✅ MCP tools - `local_wpe_pull`, `local_wpe_push`, etc.

### New Services Needed
- ⬜ Fleet analysis service (or use existing health calculator)
- ⬜ AI insights service (or use existing chat service)

### External Dependencies
- ✅ commander (CLI framework) - already added
- ✅ graphql-tag - already added
- ⬜ readline (for confirmations) - built-in
- ⬜ chalk (for colors) - optional
- ⬜ ora (for spinners) - optional

---

## Conclusion

**Nexus CLI aims to:**
1. Match lwp's core capabilities (Sprints 1-2)
2. Add unique WPE + fleet + AI features (Sprints 3-4)
3. Provide clearer, more explicit syntax
4. Enable remote-first workflows

**Timeline:** 8-13 weeks for full implementation
**POC Status:** ✅ Architecture validated, ready to build
**Next Step:** Sprint 1 implementation
