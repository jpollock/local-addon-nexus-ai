---
title: What's New — May 2026
description: Major features, fixes, and changes shipped in May 2026 (v0.3.x → v0.4)
keywords: [changelog, release notes, new features, may 2026, updates]
---

# What's New — May 2026

A summary of every significant capability added or changed during May 2026, organized by area. Branch: `feat/discover-tab` → main.

---

## CLI & Testing

### 310/310 CLI E2E Tests Passing

All 24 CLI end-to-end test suites now pass against production Local. Resolved bugs in this sprint:

- **Emoji/ANSI contaminating JSON stdout** — "💡 No AI provider" and update notifications now go to `stderr`, not `stdout`. Previously broke `JSON.parse()` in every test that used `--json`.
- **resolverQueue blocking "not found" responses** — `nexusSitesStart`/`nexusSitesStop` now validate the site ID outside the queue. Previously a running `createSite` (2+ minutes) blocked all subsequent mutations.
- **WP-CLI environment misclassified as production** — Resolvers now use `parsed.environment` from the target string (`@staging`, `@production`) instead of falling back to cache lookup which always defaulted to production.
- **`nexusWpPluginList` missing access control** — The GraphQL path (used when MCP server unavailable) now enforces `isOperationAllowed` just like the MCP path.

---

## WPE Metadata Sync

### Content Index Now Gated Correctly

`syncInstall()` (the metadata SSH path) no longer triggers content extraction. **Content indexing only runs via:**
1. Operations tab → "Index content" button
2. The `wpeContentIndexAutoEnabled` scheduled timer

Previously, any WPE metadata sync would also extract and embed posts/pages for every site, making syncs 10x slower and triggering unexpected vector indexing on every app start.

### Progress Counter Matches Logs

The sync progress banner in the Operations tab now shows the same numbers as the log output (`Syncing 4/63`). The counter uses `Math.max(current, i+1)` at dispatch time so the UI advances immediately as concurrent tasks are queued.

Previously the counter showed `1/N` until one of the 4 concurrent SSH syncs completed (~30-60 seconds).

### Progress Banner Wiring Fixed

**Two bugs** caused the banner to not appear or not update:
1. The `WPE_SYNC_ALL` IPC handler (used by the Operations tab button) never called `emitNexusState`, so the store never received start/end signals.
2. `NexusOverview`'s store subscription only activated on the first `wpeSyncing: false → true` transition — subsequent per-site pushes were silently dropped.

---

## Permission System

### New: WP-CLI Read vs Write Split

The single `WP-CLI over SSH` permission is now two separate permissions:

| Permission | Default on Production | Controls |
|---|---|---|
| `wpcli_read` | **Allowed** | plugin list, core version, user list, option get — read-only SSH |
| `wpcli` (write) | Blocked | plugin install/update, core update, post CRUD |

**Impact:** Metadata sync now works on production installs by default. Previously, 188 production installs were blocked from SSH entirely, showing as perpetually "stale" with no WP version, plugin, or user data.

See [Permissions Reference](./permissions-access-control-v2.md) for full details.

### Account Scope UI Improvements

The accounts section in Access & Permissions was redesigned:

- **All accounts visible** — previously truncated at 7 with "+N more", now shows all in a scrollable container
- **Clear toggle state** — each pill shows `✓` (green, solid border) = included or `✗` (grey, dashed) = excluded
- **Purpose label** — "Account scope — click to include / exclude accounts from the permissions below"

---

## NexusStateManager

### Reactive Store Architecture

Three components migrated from per-component `setInterval` polling to a shared reactive store:

| Component | What it subscribed to | Previous behavior |
|---|---|---|
| `FleetCompletenessWidget` | `fleetCompleteness` | 30-second poll |
| `SystemTab` | `wpeStatus`, `wpeSyncProgress` | 30-second poll |
| `NexusOverview` | `dashboardStats`, `wpeSyncProgress` | 10-second passive poll |

**Result:** UI updates now arrive within milliseconds of main process events instead of waiting for the next poll interval.

### Local L2 Data in graph.db

Site metadata (WP version, PHP version, plugins, post counts) collected via WP-CLI on `siteStarted` is now written to `graph.db` in addition to the in-memory `SiteMetadataCache`. This means:
- Metadata survives Local restarts
- Local and WPE sites are readable from the same store
- Fleet queries use one consistent data source

---

## Search Quality

### Search Fixture Sites Fixed

After multiple Local restarts, LanceDB tables for fixture sites (ACF Recipes, Newsroom Demo, AI Toolkit Demo) were being created but not persisting correctly due to concurrent indexing. Fixed by running `nexus content reindex <site>@local` sequentially rather than concurrently on app startup.

The `content search` command now returns results for all three fixture sites with scores above 0.3.

---

## UI — Operations Tab

### WPE Sync Operations Section

The Operations tab now shows:
- **"Sync metadata"** button — triggers `WPE_SYNC_ALL` with progress banner
- **"Index content"** button — triggers `indexAllWpeContent` (separate from metadata)
- Real-time progress banner: `WPE metadata sync · X / N sites · Syncing: sitename`
- Banner appears immediately on sync start (via store push) and clears on completion

### Settings Tab — New Permissions Rows

The Access & Permissions section now has 5 rows instead of 4:
- Pull to local
- **WP-CLI over SSH (Read)** ← new
- WP-CLI over SSH (Write) ← renamed
- Push to WPE
- Delete / Promote

---

## Playwright Tests — State Management Suite

New test file: `addons-nexus-ai-state-management.playwright.ts`

13 tests covering:
- **Suite A** — Store propagation (IPC round-trip, cold-start banner absent)
- **Suite B** — WPE sync progress banner (B2 = the key fix proof, requires WPE auth)
- **Suite C** — SSH metadata sync via real WPE staging install
- **Suite D** — FleetCompletenessWidget with real production fleet data (303 sites, 100% scanned)

Run with:
```bash
pkill -9 -f "Local.app"
NEXUS_USE_PRODUCTION_DATA=1 npx playwright test addons-nexus-ai-state-management
```

---

## Bug Fixes (Minor)

- **Settings schema** — `UpdateSettingsSchema` now includes `wpcli_read` and `wpeContentIndexAutoEnabled` fields. Previously `.strict()` silently stripped unlisted fields.
- **WAL checkpoint** — `GraphService.close()` now calls `wal_checkpoint(TRUNCATE)` before closing, so in-flight graph.db writes survive force-quit.
- **Resolver queue** — `nexusSitesStart`/`nexusSitesStop` "not found" validation moved outside `withQueue()`. Previously a long-running `createSite` would block `stop nonexistent-xyz` for 120 seconds.
- **`nexusWpeCache`** — Purge-cache resolver now enforces `isOperationAllowed('push', ...)` before touching the WPE API.
- **`nexusWpeDeleteInstall`** — Delete resolver checks access control before CAPI lookup using `confirmName` + cache, so "Operation blocked" fires immediately instead of after a 404.
