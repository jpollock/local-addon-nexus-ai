# WPE Authentication Investigation & Fix Plan

## Problem Statement

**Symptom**: WPE CAPI calls work inconsistently. `wpe_get_installs` succeeds, but `wpe_create_backup` fails with 401 Unauthorized, despite tokens being present.

**Current State**:
- CLI `sites list --wpe-only` works fine (uses GraphQL resolvers)
- CLI `wpe backup` fails with 401 (uses GraphQL resolvers)
- MCP `wpe_get_installs` works fine
- MCP `wpe_create_backup` fails with 401
- Debug logs show: token EXISTS in `_wpeOAuth._accessToken`, `getAccessToken()` returns token, but API still returns 401

## Phase 1: Deep Research of Local's WPE Auth Architecture

### 1.1 OAuth Flow Research

**Goal**: Understand the complete OAuth flow from start to finish

**Files to analyze**:
- `/Users/jeremy.pollock/development/wpengine/flywheel-local/app/main/wpeOAuth/WpeOAuthService.ts`
- `/Users/jeremy.pollock/development/wpengine/flywheel-local/app/main/oauth/OAuthService.ts`
- `/Users/jeremy.pollock/development/wpengine/flywheel-local/app/main/deepLink/DeepLinkService.ts`

**Questions to answer**:
1. What are the TWO authentication paths?
   - Express localhost callback flow (port 49054-49058)
   - Deep link flow (`flywheel-local://`)
2. For each path, trace EXACTLY where tokens are stored:
   - `_accessToken` (in-memory)
   - `_refreshToken` (in-memory)
   - `_tokenExpiration` (in-memory)
   - userData encrypted storage
3. Which methods call `_storeTokens()` vs `_loadFromUserData()`?
4. When does token refresh happen? (`getAccessToken()` checks expiry - what's the refresh logic?)
5. What scopes are requested? Do backup operations need additional scopes?

### 1.2 CAPI Service Research

**Goal**: Understand how CAPI gets and uses tokens

**Files to analyze**:
- `/Users/jeremy.pollock/development/wpengine/flywheel-local/app/main/capi/CAPIService.ts`
- `/Users/jeremy.pollock/development/wpengine/flywheel-local/app/main/capi/client/runtime.ts`
- `/Users/jeremy.pollock/development/wpengine/flywheel-local/app/main/capi/client/apis/BackupApi.ts`
- `/Users/jeremy.pollock/development/wpengine/flywheel-local/app/main/capi/client/apis/InstallApi.ts`

**Questions to answer**:
1. How does CAPI get its reference to `wpeOAuth`?
   - Constructor dependency injection at service container creation time
   - Does it hold a stale reference if wpeOAuth changes?
2. What does `_getBaseConfig()` do? Trace the full call path:
   ```typescript
   _getBaseConfig() →
   new Configuration({ accessToken: await this._wpeOAuth.getAccessToken() }) →
   Configuration stored in BackupApi/InstallApi client →
   client.createBackup() →
   What header is sent?
   ```
3. Are there any differences between how `BackupApi` and `InstallApi` handle auth?
4. Does CAPI have any caching of the Configuration object that could cause stale tokens?

### 1.3 Service Container Lifecycle

**Goal**: Understand when services are created and if references can go stale

**Files to analyze**:
- `/Users/jeremy.pollock/development/wpengine/flywheel-local/app/main/serviceContainer.ts`
- Any Awilix configuration files

**Questions to answer**:
1. When is `CAPIService` constructed? (Singleton? Per-request?)
2. When is `WpeOAuthService` constructed?
3. If user logs out and logs back in, does `wpeOAuth` get a new instance or reuse the same one?
4. Does CAPI's `this._wpeOAuth` reference become stale after re-authentication?

## Phase 2: Addon Code Audit & Simplification

### 2.1 Current Architecture Review

**Our code paths**:

1. **MCP Tools** (`wpe_create_backup`):
   ```
   MCP tool → createBackupHandler.execute() →
   services.localServices.capiCreateBackup() →
   local-services-bridge.capiCreateBackup() →
   svc('capi').createBackup()
   ```

2. **CLI/GraphQL** (`nexusWpeBackup` mutation):
   ```
   CLI → GraphQL mutation →
   resolvers.nexusWpeBackup →
   services.localServices.capiCreateBackup() →
   local-services-bridge.capiCreateBackup() →
   svc('capi').createBackup()
   ```

3. **Authentication** (`wpe_login` MCP tool):
   ```
   MCP tool → wpeLoginHandler.execute() →
   services.localServices.wpeAuthenticate() →
   local-services-bridge.wpeAuthenticate() →
   svc('wpeOAuth').authenticate()
   ```

**Identified issues**:
1. ❌ We have no visibility into whether auth flow was Express vs Deep Link
2. ❌ We don't explicitly call `_loadFromUserData()` after Deep Link auth
3. ❌ We removed all `_loadFromUserData()` calls to avoid userData decryption crashes
4. ❌ MCP `wpe_login` calls Local's GraphQL (different code path than our own auth)
5. ❌ We check `isWPEAuthenticated()` by only checking in-memory `_accessToken`, ignoring userData

### 2.2 Proposed Simplifications

**Option A: Always use Local's GraphQL for auth checks**
- Pro: One source of truth
- Con: Adds GraphQL dependency to MCP tools
- Con: Doesn't fix the root cause

**Option B: Fix token loading after Deep Link auth**
- Add hook to listen for `handleWpeAuthSuccess` IPC event
- When received, call `_loadFromUserData()` with proper error handling
- Pro: Fixes root cause
- Con: Requires understanding IPC event flow

**Option C: Use CAPI's own token refresh mechanism**
- Let CAPI handle token refresh via `getAccessToken()`
- Don't try to manage tokens ourselves
- Pro: Simplest - trust CAPI to work
- Con: Doesn't explain why it's currently failing

**Option D: Wrapper service that always syncs userData → memory**
- Create `WpeAuthBridge` service in our addon
- On every CAPI call, sync tokens from userData to memory
- Handle decryption errors gracefully
- Pro: Robust against all auth flows
- Con: Performance overhead, still touching userData

### 2.3 Recommended Approach

**Hybrid approach**:
1. Add IPC listener for `handleWpeAuthSuccess` event in addon initialization
2. When fired, call `_loadFromUserData()` with try/catch
3. If userData read fails, log warning but don't crash
4. Update `isWPEAuthenticated()` to check BOTH in-memory AND userData (with fallback)
5. Before any CAPI call, verify token is in memory (sync if needed)

## Phase 3: Test Cases

### 3.1 Unit Tests

**File**: `tests/unit/wpe-auth.test.ts`

Test scenarios:
1. ✅ Express callback flow stores tokens in memory
2. ✅ Deep link flow stores tokens in userData
3. ✅ `_loadFromUserData()` syncs userData → memory
4. ✅ `getAccessToken()` returns token if not expired
5. ✅ `getAccessToken()` refreshes token if within 120s of expiry
6. ✅ CAPI `_getBaseConfig()` uses current token
7. ❌ CAPI doesn't cache Configuration objects with stale tokens

### 3.2 Integration Tests

**File**: `tests/integration/wpe-capi.test.ts`

Test scenarios:
1. Auth via Express → immediately call `capiGetInstalls` → should succeed
2. Auth via Express → immediately call `capiCreateBackup` → should succeed
3. Auth via Deep Link → immediately call `capiGetInstalls` → should succeed
4. Auth via Deep Link → immediately call `capiCreateBackup` → should succeed
5. Auth via Express → logout → re-auth via Deep Link → CAPI calls should work
6. Auth → wait for token to near expiry → CAPI call should auto-refresh

### 3.3 E2E Tests

**File**: `tests/e2e/wpe-backup-flow.test.ts`

User flows:
1. Start Local → authenticate → run CLI backup command → verify success
2. Start Local → authenticate → run MCP backup tool → verify success
3. Authenticate in Local UI → run CLI backup without explicit login → verify success
4. CLI login → MCP backup (no separate login) → verify success

### 3.4 Manual Testing Checklist

Before considering this fixed, manually verify:
- [ ] Fresh Local install, CLI `wpe login`, immediate `wpe backup` → works
- [ ] Fresh Local install, authenticate in UI, CLI `wpe backup` (no login) → works
- [ ] Fresh Local install, MCP `wpe_login`, MCP `wpe_create_backup` → works
- [ ] Fresh Local install, authenticate in UI, MCP `wpe_create_backup` (no login) → works
- [ ] Logout, login again, repeat all above → still works
- [ ] Wait 30 minutes (token refresh window), repeat → still works

## Phase 4: Implementation Plan

### 4.1 Research Phase (2-3 hours)
1. Read through all files in Phase 1 systematically
2. Document findings in `WPE_AUTH_FINDINGS.md`
3. Draw architecture diagram of token flow
4. Identify exact point of failure

### 4.2 Test Development (1-2 hours)
1. Write failing tests for Phase 3.1 (unit)
2. Write failing tests for Phase 3.2 (integration)
3. Don't write E2E yet (too slow for TDD)

### 4.3 Fix Implementation (2-4 hours)
1. Implement chosen solution from Phase 2.3
2. Run tests until they pass
3. Add debug logging for troubleshooting

### 4.4 Verification (1 hour)
1. Run manual testing checklist
2. Test on fresh Local install
3. Document any remaining edge cases

## Success Criteria

This issue is RESOLVED when:
1. ✅ All unit tests pass
2. ✅ All integration tests pass
3. ✅ All manual testing checklist items pass
4. ✅ We can explain WHY it was failing before
5. ✅ We have debug logging to prevent future issues
6. ✅ Documentation updated with auth flow diagrams

## Next Steps

1. Start with Phase 1.1 - trace the Express callback flow completely
2. Then Phase 1.1 - trace the Deep Link flow completely
3. Compare the two paths and identify where they diverge
4. Move to Phase 1.2 - understand CAPI's token handling
5. Build mental model before writing any code
