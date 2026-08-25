# WP Engine Authentication Investigation - COMPLETE

**Date**: 2026-04-09
**Time Invested**: ~6 hours
**Outcome**: Root cause identified, limitation documented

## Summary

WP Engine's backup endpoint does not accept OAuth authentication. This is a WP Engine API limitation, not a bug in the Nexus AI addon.

## Investigation Process

### Phase 1: Deep Research (2.5 hours)
- Traced complete OAuth flow through Local's codebase
- Confirmed tokens are properly set in memory during Express callback
- Verified both `wpeOAuth` and `capi` are singletons (no stale references)
- Documented service container lifecycle
- Confirmed both working and failing endpoints use identical auth logic

**Key Finding**: Code is working correctly. Both endpoints get the same OAuth token.

### Phase 2: Direct Testing (1 hour)
- Added debug logging to capture actual Bearer token
- Tested token directly with curl against backup endpoint
- Confirmed: OAuth token returns 401 "Bad Credentials" for backup endpoint
- Same token works perfectly for list endpoints

**Proof**: The backup endpoint rejects OAuth tokens entirely.

### Phase 3: Documentation & Cleanup (30 minutes)
- Documented limitation in user-facing docs
- Updated error message to explain the issue
- Updated tool description with warning
- Removed all debug code
- Created workaround documentation

## Root Cause

WP Engine's `POST /installs/{id}/backups` endpoint:
- ❌ Does NOT accept OAuth Bearer tokens
- ✅ Only accepts basic authentication (API username/password)
- Is marked "alpha feature not for programmatic use"

## What Works

All other WP Engine operations work perfectly with OAuth:
- ✅ List installs
- ✅ List accounts
- ✅ Get install details
- ✅ Purge cache
- ✅ All other CAPI operations

Only backup creation fails due to endpoint restriction.

## Solution Implemented

**Documented the limitation** (Option 2 from analysis)

Users have three workarounds:
1. Create backups manually at https://my.wpengine.com ← **Recommended**
2. Use curl with basic auth if they have API credentials
3. Request WP Engine add OAuth support to the endpoint

## Files Created/Updated

### Documentation
- `docs/WPE_AUTH_INVESTIGATION.md` - Master investigation plan
- `docs/WPE_AUTH_FINDINGS.md` - Detailed research with code references
- `docs/WPE_AUTH_PHASE1_SUMMARY.md` - Phase 1 research summary
- `docs/WPE_AUTH_ROOT_CAUSE.md` - Technical analysis with solution options
- `docs/WPE_BACKUP_LIMITATION.md` - User-facing documentation
- `docs/WPE_AUTH_COMPLETE.md` - This summary

### Code Changes
- `src/main/mcp/local-services-bridge.ts` - Better error message for backup failures
- `src/main/mcp/modules/wpe/create-backup.ts` - Updated tool description with warning
- Removed all debug logging added during investigation

### Memory
- `.claude/memory/wpe-backup-limitation.md` - Quick reference for future sessions

## Future Enhancement Option

If needed, could implement basic auth fallback for backups:
- Estimated effort: ~4 hours
- Would require storing WP Engine API credentials
- See `docs/WPE_AUTH_ROOT_CAUSE.md` Section "Option 1" for implementation details

## Lessons Learned

### What Worked Well
1. **Systematic approach** - Research first, then test, then document
2. **Hypothesis tracking** - Kept a living document of theories
3. **Direct testing** - curl with actual token gave definitive proof
4. **Complete code tracing** - Fully understanding OAuth flow helped rule out our bugs

### What Could Be Better
1. **Could have tested with curl sooner** - Would have identified API limitation faster
2. **Assumed it was our bug initially** - Could have questioned the endpoint earlier

### Key Insight
When debugging auth issues across services:
- Don't assume your code is wrong
- Test the actual API endpoint directly
- External service limitations are just as likely as internal bugs

## Status: RESOLVED

This issue is **closed as documented**. No further action needed unless WP Engine adds OAuth support to the backup endpoint.

---

**Investigation led by**: Claude (Anthropic AI)
**Collaboration with**: Jeremy Pollock
**Methodology**: Research → Test → Document
