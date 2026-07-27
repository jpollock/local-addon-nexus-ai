# Lifecycle Race Condition Fix

**Date:** 2026-07-27  
**Author:** Claude (Sonnet 4.5)  
**Issue:** [#51](https://github.com/jpollock/local-addon-nexus-ai/issues/51)  
**Target Release:** v0.5.2 (hotfix)

## Problem Statement

Nexus AI begins automatic MySQL extraction and indexing work while newly created Local sites are still provisioning, resulting in deterministic "Access denied" errors. Additionally, queued work continues after site deletion, causing "Site not found" errors.

### Bug Reproduction

**Environment:**
- Local: 10.1.1+6939
- Nexus AI: 0.5.1
- Platform: macOS Apple silicon

**Steps:**
1. Create fresh WordPress site in Local
2. Observe logs during provisioning

**Observed Timeline (from reproduction):**
```
18:40:47.076 - MySQL: "ready for connections"
18:40:52.068 - Nexus: "Access denied for user 'root'@'localhost'" ❌
18:41:18.750 - Local: "Setting up MySQL user..." (creates root user)
18:41:24.220 - MySQL: Connection successful ✅
```

**Gap:** 26-30 seconds between MySQL socket creation and user provisioning. Nexus attempts connection at 5 seconds and fails.

## Root Cause

1. **`siteStarted` fires too early** - Local emits this event when the MySQL socket file is created, not when the database is fully provisioned with users
2. **No centralized readiness check** - Each automatic entry point (indexing, metadata, plugins) assumes the site is ready
3. **No deletion handler** - Queued work has no cancellation mechanism when sites are deleted

## Design Solution

### Approach: Centralized Readiness Gate

A single fail-safe function that all automatic work calls before touching site resources. Unknown or transitional states are treated as "not ready" (fail-closed).

---

## Component 1: Core Readiness Check

**New module:** `src/main/content/site-readiness.ts`

### Function Signature

```typescript
export async function isSiteReady(
  siteId: string,
  localServices: LocalServicesBridge
): Promise<{ ready: boolean; reason?: string }>
```

### Validation Steps (fail-fast order)

1. **Site exists check**
   - Query Local's GraphQL API for site record
   - **Fail:** Site record not found → `{ ready: false, reason: 'Site not found in Local state' }`
   - **Pass:** Continue to step 2

2. **Status check**
   - Verify `site.status === 'running'`
   - **Accept:** `'running'` only
   - **Reject:** `'provisioning'`, `'starting'`, `'stopping'`, `'halted'`, or any unknown state
   - **Fail:** Status not running → `{ ready: false, reason: 'Site status: ${status}' }`
   - **Pass:** Continue to step 3

3. **Filesystem check**
   - Verify `site.path` exists via `fs.existsSync(site.path)`
   - **Fail:** Path missing → `{ ready: false, reason: 'Site path does not exist' }`
   - **Pass:** Continue to step 4

4. **MySQL connection test**
   - Check socket exists: `MySQLExtractor.isAvailable(siteId)`
   - Attempt actual connection: `SELECT 1` query with 5s timeout
   - Uses existing `connectWithRetry()` from MySQLExtractor (3 retries × 2s = 6s max)
   - **Fail:** Connection rejected → `{ ready: false, reason: 'MySQL not accepting connections' }`
   - **Pass:** Return `{ ready: true }`

### Timeouts

- GraphQL query: 5 seconds
- MySQL connection test: 6 seconds (3 retries × 2s via existing `connectWithRetry`)
- **Total worst-case:** ~11 seconds

### Error Handling

- Network/timeout errors treated as "not ready" (fail-closed)
- No exceptions thrown - always returns `{ ready: boolean, reason?: string }`
- Logs warnings for unexpected errors but never crashes

---

## Component 2: Lifecycle Hook Integration

**Modified file:** `src/main/content/lifecycle-hooks.ts`

### `siteStarted` Hook Changes

**Before (current):**
```typescript
context.hooks.addAction('siteStarted', async (site: LocalSiteRef) => {
  logger.info(`[NexusAI] Site started: ${site.name}, triggering index`);
  
  // Auto-index settings check
  // Wait for readyPromise
  // Metadata refresh with inline 30s DB poll
  // Content indexing
  // Credential sync
  // Gateway changes
  // Plugin install
  // Context file generation
});
```

**After (with readiness gate):**
```typescript
context.hooks.addAction('siteStarted', async (site: LocalSiteRef) => {
  // NEW: Readiness gate at the top
  if (!localServices) {
    logger.warn(`[NexusAI] LocalServices not available, skipping ${site.name}`);
    return;
  }
  
  const readiness = await isSiteReady(site.id, localServices);
  
  if (!readiness.ready) {
    logger.info(`[NexusAI] Site ${site.name} not ready: ${readiness.reason}. Skipping automatic work.`);
    return; // Exit early - no work happens
  }
  
  logger.info(`[NexusAI] Site started and ready: ${site.name}, triggering index`);
  
  // Existing auto-index settings check (unchanged)
  // Existing readyPromise wait (unchanged)
  // Wire status callback (unchanged)
  
  // REMOVED: 30-second DB poll (lines 196-204)
  // Reason: Redundant with isSiteReady() MySQL test
  
  // All automatic work proceeds (unchanged):
  // - Metadata refresh
  // - Content indexing
  // - Credential sync
  // - Gateway changes
  // - Plugin install
  // - Context file generation
});
```

### Key Changes

1. **Single guard at the top** - One `isSiteReady()` call gates all work
2. **Early exit on not ready** - Log reason and return, no errors emitted
3. **Remove redundant DB poll** - Current 30s polling loop (lines 196-204) becomes unnecessary
4. **No retry logic needed** - `siteStarted` will fire again if Local retries, or user can manually start site

---

## Component 3: Deletion Handler

**Modified file:** `src/main/content/lifecycle-hooks.ts`

### New `siteDeleted` Hook

```typescript
context.hooks.addAction('siteDeleted', async (site: LocalSiteRef) => {
  logger.info(`[NexusAI] Site being deleted: ${site.name}, canceling queued work`);
  
  try {
    // 1. Cancel any in-progress indexing
    await pipeline.cancelSite(site.id);
    
    // 2. Clear metadata cache
    if (metadataCache) {
      metadataCache.invalidate(site.id);
    }
    
    // 3. Remove from graph.db
    if (graphService) {
      await graphService.removeSite(site.id);
    }
    
    // 4. Remove from vector index
    await pipeline.removeSite(site.id);
    
    logger.info(`[NexusAI] Cleanup complete for deleted site: ${site.name}`);
  } catch (error) {
    logger.error(`[NexusAI] Deletion cleanup failed for ${site.name}:`, error);
    // Non-fatal - siteRemoved will run final cleanup
  }
});
```

### `ContentPipeline.cancelSite()` Method

**New method:** `src/main/content/ContentPipeline.ts`

```typescript
private activeSites = new Set<string>(); // Track sites being indexed

async cancelSite(siteId: string): Promise<void> {
  if (!this.activeSites.has(siteId)) {
    return; // Not currently indexing
  }
  
  this.activeSites.delete(siteId);
  logger.info(`[ContentPipeline] Canceled indexing for site: ${siteId}`);
}

async indexSite(info: SiteConnectionInfo): Promise<IndexResult> {
  // Add to active set at start
  this.activeSites.add(info.siteId);
  
  try {
    // Existing indexing logic
    // Check this.activeSites.has(siteId) before expensive operations
    
  } finally {
    // Remove from active set at end
    this.activeSites.delete(info.siteId);
  }
}
```

### Behavior

- **`siteDeleted` fires first** - During deletion, before filesystem removal
- **Cancels in-progress work** - Sets flag that indexing loop checks
- **Prevents "Site not found" errors** - Work stops before accessing deleted site
- **`siteRemoved` still runs** - Existing final cleanup hook unchanged

---

## Testing Strategy

### Unit Tests

**New file:** `tests/unit/content/site-readiness.test.ts`

Test cases:
1. Site not found in GraphQL → `ready: false`
2. Site status = 'provisioning' → `ready: false`
3. Site status = 'halted' → `ready: false`
4. Site path missing → `ready: false`
5. MySQL socket missing → `ready: false`
6. MySQL connection fails → `ready: false`
7. All checks pass → `ready: true`
8. Timeout handling (GraphQL, MySQL)

### Integration Tests

**Modified file:** `tests/e2e-cli/03-wp-cli.cli-e2e.test.ts`

New test case:
```typescript
test('siteStarted does not trigger work before site ready', async () => {
  // Mock site in provisioning state
  // Trigger siteStarted event
  // Verify no indexing started
  // Transition to running state
  // Verify indexing now starts
});
```

### Manual Verification (Acceptance Criteria)

From issue #51:

- [ ] Create fresh Local site, no MySQL errors in logs during provisioning
- [ ] No "MySQLExtractor: Access denied" message emitted
- [ ] Automatic indexing still starts after site reaches running state
- [ ] Running and halted ready sites continue to index normally
- [ ] Delete a site, no "Site not found" messages from queued work
- [ ] Repeat create/delete 3× times, no Nexus errors in logs

---

## Files Changed

### New Files
- `src/main/content/site-readiness.ts` - Core readiness check
- `tests/unit/content/site-readiness.test.ts` - Unit test coverage

### Modified Files
- `src/main/content/lifecycle-hooks.ts`
  - Add `isSiteReady()` call to `siteStarted` hook
  - Remove 30-second DB poll (lines 196-204)
  - Add `siteDeleted` hook handler
- `src/main/content/ContentPipeline.ts`
  - Add `cancelSite()` method
  - Add `activeSites` tracking set
  - Check cancellation flag in `indexSite()`

### Test Files Modified
- `tests/e2e-cli/03-wp-cli.cli-e2e.test.ts` - Add provisioning state test

---

## Migration & Rollout

### Release: v0.5.2 (Hotfix)

**Branch strategy:**
1. Create `hotfix/lifecycle-race-fix` from `v0.5.1` tag
2. Apply changes from this spec
3. Run full test suite
4. Manual verification per acceptance criteria
5. Tag as `v0.5.2`
6. Publish to npm + R2

**Breaking changes:** None

**Backward compatibility:** Full. Sites on v0.5.1 upgrade seamlessly.

**Rollback plan:** If critical regression found, users can downgrade to v0.5.1 via npm.

---

## Open Questions

None - design approved and ready for implementation.

---

## Success Criteria

1. **No MySQL errors during provisioning** - Fresh site creation produces zero "Access denied" errors
2. **No deletion errors** - Site deletion produces zero "Site not found" errors from queued work
3. **Performance unchanged** - Readiness check adds <1s latency (negligible vs 30s+ provisioning)
4. **All tests pass** - Unit + integration + manual verification
5. **Issue #51 resolved** - Reporter confirms fix addresses all observed issues
