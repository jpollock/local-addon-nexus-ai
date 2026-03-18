# Nexus CLI - POC Results

**Date:** 2026-03-18
**Branch:** `mvp-v1`
**Status:** ✅ POC Complete

---

## Executive Summary

The POC successfully validated the CLI architecture:
- ✅ GraphQL extension pattern works with Local
- ✅ Services-based approach is cleaner than calling MCP tools
- ✅ @env everywhere model provides clarity and consistency
- ✅ 3/5 commands fully working, 2/5 show clear path forward

**Key Decision:** Enforced `@env` syntax everywhere after POC testing revealed ambiguity issues.

---

## What Was Actually Built

### GraphQL Layer

**Files:**
- `src/main/graphql/schema.ts` - Type definitions with "Nexus" prefix to avoid conflicts
- `src/main/graphql/resolvers.ts` - Direct service calls (not MCP tools)
- `src/main/index.ts` - GraphQL registration

**Changes from Design:**
- All types prefixed with "Nexus" to avoid conflicts with reference implementation
- Resolvers call `services.localServices` directly instead of MCP tools
- WPE installs fetched via `capiGetInstalls()` + `capiGetAccounts()` for display names
- Link management simplified (not implemented in POC)

### CLI Layer

**Commands Implemented:**
1. ✅ `nexus sites list` - Shows both local + WPE with names
2. ✅ `nexus sites create <name>@local` - Creates local sites
3. ✅ `nexus wp <target> plugin list` - Works local + remote via SSH
4. ⚠️ `nexus sites start/stop/delete <target>` - Stubs with helpful errors
5. ⚠️ `nexus sync pull/push` - Not implemented (requires Local UI linking)

**Syntax Enforcement:**
- `@env` REQUIRED everywhere after initial testing
- Clear error messages guide users to correct syntax
- Local-only operations validated at CLI level

---

## Actual Test Results

### ✅ Test 1: List Sites
```bash
nexus sites list
```

**Result:** PASS
- Shows local sites with status + linked WPE info
- Shows WPE installs with account name + install name (not UUIDs)
- Link resolution works via hostConnections

### ✅ Test 2: Create Site
```bash
nexus sites create test-cli-poc@local
```

**Result:** PASS
- Site created successfully
- GraphQL mutation works
- Services integration clean

### ✅ Test 3: WP-CLI Local
```bash
nexus wp test-cli-poc@local plugin list
```

**Result:** PASS
- Plugin list displayed correctly
- Services-based approach works
- Target parsing validated

### ✅ Test 4: WP-CLI Remote
```bash
nexus wp wpe:getflywheel/getflywheel@production plugin list
```

**Result:** PASS (with caveats)
- SSH connection works for installs with SSH enabled
- Install name extracted correctly from `account/install` format
- Some WPE installs don't have SSH (expected)

### ⚠️ Test 5: Sync Operations
```bash
nexus sync pull <site>@local --from=<wpe>
```

**Result:** NOT IMPLEMENTED
- Resolvers return clear error: "requires linking via Local UI first"
- This is correct - sync operations are complex and require more work

---

## Issues Encountered & Fixed

### 1. GraphQL Schema Conflicts
**Problem:** `CreateSiteResult` already defined by reference implementation
**Fix:** Prefixed all types with "Nexus"
**Impact:** Required CLI query updates

### 2. Account/Install Display Names
**Problem:** UUIDs shown instead of human-readable names
**Fix:** Fetch accounts separately, build lookup map
**Learning:** WPE CAPI structure requires understanding both installs + accounts

### 3. SSH Hostname Resolution
**Problem:** `account/install` format confused SSH connection
**Fix:** Extract just install name for SSH
**Learning:** Different contexts need different parts of the target

### 4. Missing @env Errors
**Problem:** Users confused about syntax requirements
**Fix:** Enforce `@env` everywhere, clear error messages
**Decision:** This became the new model

---

## Architecture Decisions Made

### 1. Services Direct > MCP Tools
**Decision:** Resolvers call `services.localServices` directly
**Rationale:**
- Cleaner code
- Avoid JSON parsing overhead
- Direct access to complex objects (hostConnections, etc.)
- MCP tools return markdown, services return structured data

### 2. @env Everywhere
**Decision:** Require `@env` on ALL commands
**Rationale:**
- Eliminates ambiguity
- Clear error messages
- Supports environment-specific operations naturally
- Consistent with WPE's multi-environment model

**Before:**
```bash
nexus sites start test         # ambiguous
nexus wp test plugin list      # missing env
```

**After:**
```bash
nexus sites start test@local   # clear
nexus wp test@local plugin list # explicit
```

### 3. Link Management Deferred
**Decision:** Don't implement link creation/storage in POC
**Rationale:**
- Complex (requires DB or userData storage)
- hostConnections already provide linking info
- Can be added later without changing CLI syntax

---

## What Works Well

### GraphQL Integration
- Addon registration seamless
- Type merging works with namespace prefix
- Bearer token auth automatic

### Services-Based Resolvers
- Clean and readable
- Type-safe
- No JSON parsing
- Direct access to all Local capabilities

### Error Handling
- Clear, actionable messages
- Guide users to correct syntax
- Show available options

### Target Parsing
- Robust regex matching
- Helpful error messages
- Supports all three formats

---

## What Needs Work

### 1. Sync Operations
**Status:** Stub only
**Required:**
- Use existing `local_wpe_pull` / `local_wpe_push` tools
- Handle async operations (returns immediately, poll status)
- Progress indicators

### 2. Confirmation Prompts
**Status:** Not implemented
**Required:**
- Readline integration for --db pushes
- Production environment warnings
- Clear escape hatches

### 3. Progress Indicators
**Status:** Not implemented
**Required:**
- Progress bars for long operations
- Status polling for async jobs
- Time estimates

### 4. Full WP-CLI Passthrough
**Status:** Only `plugin list` implemented
**Required:**
- Generic wp command wrapper
- All plugin/theme/core/user/db/option commands
- Proper argument forwarding

---

## Learnings for Full Implementation

### 1. WPE CAPI Structure
- `install.account` is an object: `{ id, name }`
- `install.site` is also an object: `{ id }`
- Need to fetch accounts separately for names
- Install name ≠ SSH hostname for all installs

### 2. Local's hostConnections
- Provides site → WPE linkage
- Structure: `{ hostId, accountId, remoteSiteId, remoteSiteEnv }`
- Can resolve without separate link storage
- Already supports 1:1 linking

### 3. Remote WP-CLI via SSH
- SSH key at `~/Library/Application Support/Local/ssh/wpe-connect`
- Hostname format: `{installName}.ssh.wpengine.net`
- Not all installs have SSH (plan dependent)
- Need `isSSHKeyAvailable()` check

### 4. GraphQL Type Conflicts
- Multiple addons can extend GraphQL
- Must namespace types to avoid conflicts
- Reference implementation (`@local-labs-local-addon-cli`) already exists
- Prefix or suffix required

---

## POC Success Criteria

| Criterion | Status | Notes |
|-----------|--------|-------|
| GraphQL integration works | ✅ PASS | With namespace prefix |
| CLI → GraphQL communication | ✅ PASS | Connection info + Bearer auth |
| Services execution | ✅ PASS | Cleaner than MCP tools |
| Target resolution | ✅ PASS | All three formats work |
| Link management | ⚠️ DEFERRED | hostConnections sufficient for now |
| Result transformation | ✅ PASS | Services return structured data |
| Error handling | ✅ PASS | Clear, actionable messages |

---

## Recommendations for Full Implementation

### 1. Keep Services-Based Approach
Don't use MCP tools for GraphQL resolvers. Direct service access is cleaner.

### 2. Implement Remaining Commands Incrementally
Priority order:
1. `sites start/stop/delete` (local lifecycle)
2. Full `wp` passthrough (any wp-cli command)
3. `sync pull/push` (most complex)
4. `content` commands (search/index)
5. `fleet` commands (AI-powered)

### 3. Add Comprehensive Testing
- Unit tests for target parsing
- Integration tests for GraphQL mutations
- E2E tests with real Local instance
- Mock WPE CAPI for offline testing

### 4. Better Error Messages
Use the pattern:
```
Error: <what went wrong>

<why it happened>

<how to fix it>:
  Option 1: <command>
  Option 2: <command>
```

### 5. Add Shell Completion
Generate completions for:
- bash
- zsh
- fish

Auto-complete:
- Site names (from `nexus sites list`)
- Environments (production, staging, development)
- WP-CLI subcommands

---

## Next Steps

### Immediate (Post-POC)
1. ✅ Update docs to reflect @env everywhere model
2. ⬜ Create feature roadmap (compare with lwp capabilities)
3. ⬜ Decide on full implementation scope

### Short-Term (Next Sprint)
1. ⬜ Implement `sites start/stop/delete`
2. ⬜ Implement full `wp` passthrough
3. ⬜ Add unit tests
4. ⬜ Add shell completion

### Medium-Term
1. ⬜ Implement `sync pull/push`
2. ⬜ Add progress indicators
3. ⬜ Add confirmation prompts
4. ⬜ Integration tests

### Long-Term
1. ⬜ Implement `content` commands
2. ⬜ Implement `fleet` commands
3. ⬜ E2E tests
4. ⬜ Production deployment

---

## Files Changed

**New Files:**
- `src/main/graphql/schema.ts` (163 lines)
- `src/main/graphql/resolvers.ts` (220 lines after refactor)
- `src/cli/index.ts` (35 lines)
- `src/cli/commands/sites.ts` (200 lines with stubs)
- `src/cli/commands/wp.ts` (110 lines)
- `src/cli/commands/sync.ts` (210 lines with stubs)
- `src/cli/utils/graphql.ts` (125 lines)
- `src/cli/utils/target.ts` (111 lines)
- `bin/nexus.js` (10 lines)

**Modified Files:**
- `src/main/index.ts` (16 lines added)
- `package.json` (bin entry + 2 dependencies)

**Total:** ~1,200 lines of new code

---

## Conclusion

**The POC is a success.** We've proven:
1. GraphQL extension works
2. Services-based approach is superior
3. @env everywhere provides clarity
4. Architecture is sound for full implementation

**Ready to proceed** with full implementation using these patterns.

**Not ready for production** - needs remaining commands, tests, confirmations, progress indicators.
