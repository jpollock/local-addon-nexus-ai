# Phase 1 Research Complete - Summary

## What I Discovered

### OAuth Flow (FULLY TRACED)

**The Complete Authentication Path**:
1. User calls `wpeOAuth.authenticate()`
2. Express server starts on localhost:49054-49058
3. Browser opens OAuth provider
4. OAuth provider redirects to `http://localhost:PORT/callback`
5. **Passport.js exchanges code for tokens** (OAuthService.ts:343-363)
6. **`_storeTokens()` is called** (line 350) which:
   - Sets `_accessToken` in memory ✅
   - Sets `_refreshToken` in memory ✅
   - Sets `_tokenExpiration` in memory ✅
   - Writes encrypted tokens to userData ✅
7. Success HTML page is served to browser
8. HTML redirects to `flywheel-local://?wpeOAuthSuccess=true` after 1.5s
9. Deep link handler sends IPC event and focuses window

**KEY FINDING**: Tokens ARE set in memory during step 6. The deep link is just for cleanup.

### Service Architecture (CONFIRMED)

Both `wpeOAuth` and `capi` are **singletons** (serviceContainer.ts:141, 202):
- One instance per app lifecycle
- No stale reference issues possible
- CAPI's `this._wpeOAuth` always points to the same singleton

### What Works vs What Fails

**WORKS**: `wpe_get_installs` (via `capiGetInstalls` → `capi.getInstallList()`)
**FAILS**: `wpe_create_backup` (via `capiCreateBackup` → `capi.createBackup()`)

**Both use identical token retrieval**:
```typescript
private async _getBaseConfig(): Promise<Configuration> {
    return new Configuration({
        accessToken: await this._wpeOAuth.getAccessToken(),
    });
}
```

## What We Ruled Out

1. ❌ **Deep link doesn't set tokens** - WRONG, Express callback sets them
2. ❌ **Stale service references** - Both services are singletons
3. ❌ **Token expiry** - Token has 1743+ seconds remaining (29 minutes)
4. ❌ **Different auth logic** - Both endpoints use same `_getBaseConfig()`
5. ❌ **Configuration caching** - New client created on each call

## The Mystery

**Debug logs show**:
```
[NEXUS DEBUG] capiCreateBackup: getAccessToken() returned = TOKEN EXISTS
4/9/2026, 1:56:10 PM [info] [main] CAPIService: Creating backup...
4/9/2026, 1:56:12 PM [warn] [main] CAPIService: Error creating backup: 401 Unauthorized
```

Token exists, is returned successfully, but API returns 401 two seconds later.

## Current Best Hypothesis

**Hypothesis**: The issue is NOT in our addon code - it's either:
1. **Account permissions** - WP Engine account lacks backup creation permission
2. **Token scope mismatch** - OAuth token doesn't include required backup scope
3. **API endpoint requirement** - Backup endpoint needs additional headers/auth

**Supporting evidence**:
- User's basic auth curl worked (`-u $USER:$PASS`)
- Same OAuth token works for list endpoints
- Backup endpoint is marked "alpha feature not for programmatic use"

## Next Steps (Phase 2)

### 1. Test Token Validity (IMMEDIATE)
Run the curl command I added to debug logs:
```bash
curl -X POST "https://api.wpengineapi.com/v1/installs/{id}/backups" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"description":"test","notificationEmails":["test@example.com"]}'
```

This will tell us if the OAuth token itself is valid for backup creation.

### 2. Compare Working vs Failing Requests
- Capture HTTP request for `listInstalls` (works)
- Capture HTTP request for `createBackup` (fails)
- Compare headers, URLs, methods

### 3. Check WP Engine Documentation
- Verify backup endpoint requirements
- Check if backup needs special OAuth scopes
- Confirm endpoint is actually supported for OAuth (vs basic auth only)

### 4. Test Account Permissions
- Can you create backups manually in WP Engine portal?
- Does your account have backup creation rights?

## Recommendations

### If curl with Bearer token FAILS:
→ OAuth token doesn't have backup permission
→ Need to check scope requirements or use basic auth for backups

### If curl with Bearer token WORKS:
→ Issue is in how we're sending the request
→ Need to debug the actual HTTP call being made by CAPI

### Quick Win Option
If backups are critical and this is blocking, consider:
- Use basic auth API (v1) for backups only
- Keep OAuth for everything else
- File issue with WP Engine about OAuth backup support

## Files Updated

1. `/docs/WPE_AUTH_INVESTIGATION.md` - Master investigation plan
2. `/docs/WPE_AUTH_FINDINGS.md` - Detailed research findings with code references
3. `/docs/WPE_AUTH_PHASE1_SUMMARY.md` - This summary

## Time Spent

- Phase 1 Research: ~1.5 hours
- Status: OAuth flow fully understood, mystery identified, ready for Phase 2 testing
