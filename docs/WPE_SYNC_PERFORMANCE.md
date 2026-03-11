# WPE Sync Performance Optimization

## Problem Statement

Initial WPE site sync was taking **12-15 hours** for 252 sites (~3.5 minutes per site).

The bottleneck was identified as SSH connection overhead — each remote WP-CLI command spawns a new SSH session, and with multiple commands per site (version, plugins, users, content), the authentication handshake overhead accumulates significantly.

## Phase 1: SSH ControlMaster + Concurrency Control

**Branch:** `remote-management-perf-opt`
**Commit:** `d97b799`
**Implementation Date:** 2026-03-11

### Changes

1. **SSH ControlMaster** (`local-services-bridge.ts:403-413`)
   - Added `ControlMaster=auto` to reuse SSH connections
   - Set `ControlPath=/tmp/ssh-nexus-%C` for per-host connection sharing
   - Set `ControlPersist=10m` to keep socket open for 10 minutes
   - **Impact:** First SSH command creates a master connection; subsequent commands to the same host reuse it (no new authentication handshake)

2. **Concurrency Control** (`WPESyncService.ts:133-163`)
   - Installed `p-limit` package
   - Changed from sequential sync loop to parallel execution
   - Limited to **10 concurrent sites** to avoid overwhelming SSH or API rate limits
   - **Impact:** Instead of waiting for each site to complete before starting the next, we now sync 10 sites simultaneously

### Expected Performance Improvement

| Metric | Before | After Phase 1 | Reduction |
|--------|--------|---------------|-----------|
| Time per site | ~3.5 min | ~20-30 sec | 85-90% |
| Total time (252 sites) | 14 hours | 1-2 hours | 85-90% |
| SSH handshakes per site | 4-8 | 1 | 75-87% |

**Calculation:**
- ControlMaster reduces per-site time from 3.5min → 1min (eliminates 3-7 redundant SSH handshakes)
- 10x concurrency reduces wall-clock time by another ~90% (1 min × 252 sites ÷ 10 parallel = ~25 min)
- Combined: **~25-60 minutes total** (depending on network latency and site complexity)

### Testing

Run a fresh sync on a subset to validate:
```typescript
// Sync first 20 sites to test
ipc.invoke('nexus-ai:wpe:sync-sites', { limit: 20 })
```

Monitor logs for:
- ✓ No SSH connection errors
- ✓ Progress shows 10 sites syncing concurrently
- ✓ Per-site time drops from 3-4 min to under 1 min

## Phase 2: SSH Multiplexing (Optional)

**Status:** Not yet implemented
**Estimated additional improvement:** 5-10%

If Phase 1 results show per-site time is still too high, we can batch multiple WP-CLI commands into a single SSH session:

```typescript
// Instead of:
await remoteWpCliRun(install, ['core', 'version']);
await remoteWpCliRun(install, ['plugin', 'list', '--format=json']);
await remoteWpCliRun(install, ['user', 'list', '--format=json']);

// Do:
const results = await batchWpCli(install, [
  ['core', 'version'],
  ['plugin', 'list', '--format=json'],
  ['user', 'list', '--format=json'],
]);
```

This would eliminate the small overhead of spawning separate SSH processes (even with ControlMaster, each spawn still has a cost).

**Decision:** Defer Phase 2 until Phase 1 results are measured. If Phase 1 gets us to <30 min total sync time, Phase 2 may not be worth the added complexity.

## Monitoring

After deploying Phase 1, track:
1. **Total sync time** for 252 sites (target: <2 hours)
2. **Error rate** (ensure concurrency doesn't introduce race conditions)
3. **SSH socket creation** (`ls -la /tmp/ssh-nexus-*` during sync to verify ControlMaster is working)
4. **Per-site time** distribution (check logs for outliers)

## Rollback Plan

If Phase 1 causes issues:
```bash
git checkout remote-management  # back to sequential, no ControlMaster
```

No data migration needed — changes are purely runtime optimizations.

## Related Commits

- `3f0e0b1` - Initial WPE Remote Sites Sync implementation
- `d97b799` - Phase 1 performance optimizations (this document)
