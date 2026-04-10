# WPE Authentication Research Findings

> This document captures findings from deep research into Local's WPE auth system.
> Status: IN PROGRESS

## OAuth Flow #1: Express Callback (Localhost)

### Trigger
- User calls `wpeOAuth.authenticate()` directly
- Opens browser to OAuth provider
- Redirects to `http://localhost:49054/callback`

### Token Storage Path
```
1. Browser redirects to localhost callback
2. Express route handler receives OAuth code
3. Passport.js exchanges code for tokens via OAuth2Strategy callback (OAuthService.ts:343)
4. Callback at line 350 calls this._storeTokens(tokens, params.expires_in)
5. _storeTokens() does (WpeOAuthService.ts:128):
   - this._accessToken = tokens.accessToken (in-memory) ✅
   - this._refreshToken = tokens.refreshToken (in-memory) ✅
   - this._tokenExpiration = Date.now() + (expiresIn * 1000) (in-memory) ✅
   - userData.set('wpeOAuth', { encrypted tokens }) (disk) ✅
6. Callback at line 357 calls this._authenticated(tokens) hook
7. _authenticated() override in WpeOAuthService (line 61) sends IPC event WPE_OAUTH.SUCCESS
8. Success HTML page is served to browser (wpe-auth-success.html)
9. After 1.5s, HTML redirects to flywheel-local://?wpeOAuthSuccess=true (line 132)
10. Deep link handler _handleWpeOAuthSuccess() called (line 215)
11. Handler sends IPC 'handleWpeAuthSuccess' and focuses window
```

**Answered**:
- ✅ Passport callback calls `_storeTokens()` at line 350 of OAuthService.ts
- ✅ `_authenticated()` hook in WpeOAuthService sends IPC event (line 61-63)
- ✅ `_loadFromUserData()` is called during service initialization (line 105)
- ✅ **TOKENS ARE SET IN MEMORY** during Express callback, NOT deep link

### Code References
- Entry point: ???
- Token storage: ???
- Completion hook: ???

---

## OAuth Flow #2: Deep Link (flywheel-local://)

### Trigger
- Browser redirects to `flywheel-local://` instead of localhost
- macOS opens Local via deep link
- DeepLinkService routes to wpeOAuth handler

### Token Storage Path
```
1. Deep link URL received by Electron
2. DeepLinkService.handleUrl() called
3. Routes to 'wpeOAuthSuccess' handler
4. _handleWpeOAuthSuccess() called
5. _handleWpeOAuthSuccess() does:
   - Logs "Handling WPE OAuth success"
   - Sends IPC event 'handleWpeAuthSuccess'
   - Calls focusMainWindow()
6. ??? (who handles the actual token exchange?)
```

**Questions**:
- [ ] Where does token exchange happen in deep link flow?
- [ ] Does deep link flow call `_storeTokens()`?
- [ ] Does it set `_accessToken` in memory?
- [ ] Who listens to `handleWpeAuthSuccess` IPC event?

### Code References
- Entry point: ???
- Token handler: ???
- IPC event: ???

---

## CAPI Token Access

### Configuration Creation
```typescript
private async _getBaseConfig(): Promise<Configuration> {
    return new Configuration({
        accessToken: await this._wpeOAuth.getAccessToken(),
    });
}
```

### getAccessToken() Implementation
```typescript
public async getAccessToken() {
    try {
        if (isTokenExpired(this._tokenExpiration, 120)) {
            await this.refreshAccessToken();
        }
        return this._accessToken;
    } catch (e) {
        return undefined;  // ← RETURNS UNDEFINED ON ERROR
    }
}
```

**Questions**:
- [ ] What does `refreshAccessToken()` do?
- [ ] Can refresh fail if userData is corrupted?
- [ ] Is Configuration cached by BackupApi/InstallApi clients?
- [ ] Does each API call create a new Configuration?

### API Client Usage
```typescript
async createBackup(installId: string, description: string): Promise<void> {
    const client = new BackupApi(await this._getBaseConfig());
    const { id } = await client.createBackup({ installId, body: {...} });
}

async getInstallList() {
    const client = new InstallApi(await this._getBaseConfig());
    return this.getAllResults<Installation>(client.listInstalls.bind(client));
}
```

**Observations**:
- Both methods call `_getBaseConfig()` fresh on each call (no caching)
- Both create new API client instances
- Both should get the same token from `getAccessToken()`

**Questions**:
- [ ] Why would `getAccessToken()` return different values for list vs backup?
- [ ] Is there a timing issue? (Race condition?)
- [ ] Are there different scopes required?

---

## Service Container Lifecycle

### Container Registration
**File**: `/app/main/serviceContainer.ts`

```typescript
// Line 141
capi: asClass(CAPIService).singleton(),

// Line 202
wpeOAuth: asClass(WpeOAuthService).singleton(),
```

**Answered**:
- ✅ CAPIService is a **singleton** - one instance for entire app lifecycle
- ✅ WpeOAuthService is a **singleton** - one instance for entire app lifecycle
- ✅ CAPI's `this._wpeOAuth` reference points to the singleton (no stale reference possible)
- ✅ Both services persist across logout/login (same instances reused)

---

## Token Refresh Logic

### Refresh Trigger
```typescript
if (isTokenExpired(this._tokenExpiration, 120)) {
    await this.refreshAccessToken();
}
```

**Questions**:
- [ ] What is `refreshAccessToken()` implementation?
- [ ] Does it read from userData?
- [ ] Can it fail silently?
- [ ] Does it update `_accessToken` in memory?

---

## Current Hypotheses

### Hypothesis 1: Deep Link Auth Doesn't Set Memory Token
**Theory**: Deep link flow writes to userData but never sets `_accessToken` in memory.

**Evidence**:
- ✅ Deep link handler doesn't call `_storeTokens()`
- ✅ After deep link auth, `isWPEAuthenticated()` shows `hasToken = false`
- ❌ But `wpe_get_installs` works, suggesting token IS available somehow

**Status**: PARTIALLY DISPROVEN - list works, backup fails

### Hypothesis 2: Token Refresh Fails for Backup Endpoint
**Theory**: Backup call takes longer, triggering refresh, which fails.

**Evidence**:
- ✅ Token has 1743 seconds until expiry (not in refresh window)
- ❌ Doesn't explain why refresh would fail

**Status**: DISPROVEN - not in refresh window

### Hypothesis 3: Backup Endpoint Requires Different Scope
**Theory**: Backup creation requires a scope that wasn't granted.

**Evidence**:
- ❓ Current scopes: `urn:wpengine:installs:rw`, `urn:wpengine:accounts:rw`
- ❓ Does `:rw` cover backup creation?
- ❓ Backup API docs say "alpha feature not for programmatic use"

**Status**: NEEDS INVESTIGATION

### Hypothesis 4: Configuration Object Caching
**Theory**: BackupApi caches Configuration with stale token.

**Evidence**:
- ❌ Code shows `new BackupApi(await this._getBaseConfig())` each time
- ❌ No obvious caching

**Status**: DISPROVEN - no caching found

### Hypothesis 5: Token Format or Content Issue
**Theory**: Token is returned but malformed/invalid for backup endpoint.

**Evidence**:
- ✅ Same token works for `getInstallList`
- ❌ Doesn't explain endpoint-specific failure

**Status**: UNLIKELY - same token works elsewhere

---

## Key Findings Summary

### What We Know For Certain
1. ✅ Express OAuth callback DOES set tokens in memory (OAuthService.ts:350)
2. ✅ `wpeOAuth` and `capi` are both singletons (no stale references)
3. ✅ Deep link is just for cleanup/focus, NOT for token exchange
4. ✅ `getAccessToken()` successfully returns token before backup call
5. ✅ Token has 1743+ seconds until expiry (not in refresh window)
6. ✅ Both `getInstallList` and `createBackup` use same `_getBaseConfig()` method
7. ✅ 401 error happens on the FIRST backup API call, not during polling

### What This Rules Out
- ❌ Deep link auth not setting in-memory tokens (tokens ARE set)
- ❌ Stale service references (both are singletons)
- ❌ Token expiry triggering refresh (token has 29 minutes left)
- ❌ Different Configuration logic between endpoints (same method used)

### Critical Unanswered Question
**Why does the SAME token work for `listInstalls` but fail for `createBackup`?**

They both:
- Use the same `_getBaseConfig()` to get Configuration
- Call `_wpeOAuth.getAccessToken()` which returns the same token
- Create new API client instances (no caching)
- Set Authorization header: `Bearer ${accessToken}` (line 80 in BackupApi.ts)

## New Hypothesis

### Hypothesis 6: Account Permissions or Endpoint-Specific Requirements
**Theory**: The WP Engine account lacks permission for backup creation, OR the backup endpoint requires different authentication.

**Evidence to check**:
- ❓ Can user create backups manually in WP Engine portal?
- ❓ User's curl with basic auth worked - does OAuth token have same permissions?
- ❓ Does backup endpoint require additional headers beyond Authorization?
- ❓ Is there a difference in the API paths or versions used?

**Next steps**:
1. [ ] Compare HTTP request for `listInstalls` vs `createBackup` (headers, URL, method)
2. [ ] Check if backup endpoint uses different base URL or version
3. [ ] Test if the OAuth token itself is valid for backup by using curl with Bearer token
4. [ ] Check WP Engine API documentation for backup endpoint requirements

## Action Items

### Immediate Next Steps
1. [x] Trace Express callback flow from `authenticate()` to `_storeTokens()`
2. [x] Trace Deep link flow from URL to token storage
3. [x] Find `refreshAccessToken()` implementation
4. [ ] ~~Check if backup endpoint needs special permissions/scopes~~
5. [x] Add logging to capture actual HTTP request headers being sent (user to run curl test)
6. [ ] Compare successful `listInstalls` request vs failing `createBackup` request
7. [ ] Test OAuth token directly with curl to backup endpoint

### Code to Read
- [ ] `/app/main/oauth/OAuthService.ts` - lines 284-387 (authenticate method)
- [ ] `/app/main/wpeOAuth/WpeOAuthService.ts` - complete file
- [ ] `/app/main/deepLink/DeepLinkService.ts` - deep link routing
- [ ] `/app/main/capi/client/apis/BackupApi.ts` - line 79-81 (auth header)
- [ ] Service container registration file (need to find)

### Tests to Write
- [ ] Unit test: Express auth sets `_accessToken` in memory
- [ ] Unit test: Deep link auth sets `_accessToken` in memory
- [ ] Integration test: Auth → backup → verify 200 response
- [ ] Integration test: Auth → list → backup → both succeed

---

## Timeline

- **Started**: 2026-04-09
- **Research phase target**: Complete by EOD
- **Fix implementation target**: Next session
- **Full resolution target**: Within 2 days
