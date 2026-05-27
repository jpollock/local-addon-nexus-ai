---
title: WPE Sync Architecture
description: How WP Engine metadata sync works — CAPI, SSH, environment filtering, content gating, progress tracking
keywords: [wpe, sync, architecture, ssh, capi, metadata, content, scheduler, progress, performance]
---

# WPE Sync Architecture

Nexus maintains a local copy of WP Engine fleet metadata — WordPress version, plugin list, PHP version, user count — via SSH. This page explains how the sync pipeline works end to end.

---

## Overview

```
On startup (or manual trigger)
      │
      ▼
[Tier 1] CAPI sync — fetch all installs from WPE REST API
      │  ~3 seconds, no SSH, runs every startup
      ▼
[Filter] Apply access control (account scope + environment permissions)
      │  removes excluded accounts and wpcli_read-blocked installs
      ▼
[Tier 2] SSH metadata sync — for stale installs only
      │  4 concurrent SSH connections
      │  per site: wp core version + wp plugin list + wp user list
      │  ~8-15 seconds per site
      ▼
[Usage] Sync usage/bandwidth data via CAPI
      │  ~30 seconds for 284 installs
      ▼
[Done] Push updated data to UI via emitNexusState
```

---

## Tier 1 — CAPI Sync (Always Runs)

`WPESyncService.syncFromCAPI()` runs on every Local startup and before every manual sync.

**What it fetches:**
- All installs across all accounts (environment, primary domain, PHP version from CAPI)
- Account list (IDs, names)
- Install count, account count

**Storage:** Results go into `graph.db` (SQLite, WAL mode) and the in-memory WPE install cache. The cache is used for fast environment lookups during permission checks.

**Why it's fast:** No SSH connection needed. One HTTP request per page of results from `GET /installs`. For 284 installs, typically 2-3 requests.

---

## Filter — Access Control

Before SSH sync begins, the install list is filtered by two gates:

### Gate 1: Account Scope

```ts
const wpeInstallsFiltered = wpeInstalls.filter(i =>
  !accountFilter || accountFilter.includes(i.account_id)
);
```

Installs from excluded accounts are dropped entirely. They won't be synced, updated, or returned in fleet queries.

### Gate 2: Environment Permissions (wpcli_read)

```ts
const inScope = wpeInstallsFiltered.filter(i =>
  isOperationAllowed('wpcli_read', i.environment, effectiveSettings, i.install_name)
);
```

By default, `wpcli_read` is allowed on all environments (development, staging, production). If a user has explicitly blocked `wpcli_read` on production, those production installs are excluded from the SSH sync loop.

**Log line:**
```
[WPESyncService] Operation filter: 96 of 284 installs in scope (wpcli_read blocked on 188 install(s))
```

This indicates 188 installs are excluded — either by account scope or by wpcli_read being turned off for their environment.

---

## Tier 2 — SSH Metadata Sync (Stale Installs Only)

### Staleness Check

Each install has a `last_sync_at` timestamp in graph.db. An install is "fresh" if it was synced within the threshold (default: 2 hours for startup sync, 0 hours for manual "force" sync).

```
[WPESyncService] 59 stale, 37 fresh (skipping) out of 96 total
```

### Concurrent SSH (4 connections)

```ts
const concurrencyLimit = pLimit(4);
const syncTasks = installsToSync.map((install, i) =>
  concurrencyLimit(async () => {
    // Progress update
    this.currentProgress.current = Math.max(current, i + 1);
    this.onSyncProgress?.({ active: true, current: ..., total: ..., currentSite: install.install_name });

    // SSH: core version, plugin list, user list
    await this.syncInstall(install);

    // Post-completion progress update
    completed++;
    this.onSyncProgress?.({ active: true, current: completed, ... });
  })
);
await Promise.all(syncTasks);
```

**Progress tracking:** The counter advances in two ways:
1. **On dispatch** — `Math.max(current, i+1)` advances immediately as tasks are queued (matches log "Syncing 4/63")
2. **On completion** — `completed++` fires after each SSH sync finishes

The UI banner receives these updates via `onSyncProgress` → `emitNexusState` → `nexusStore.update()`.

### `syncInstall()` — What Happens Per Site

```
SSH connection established (ControlMaster, ~13-30s cold start)
    │
    ├── wp core version          (~1-3s via reuse)
    ├── wp plugin list --json    (~2-5s)
    └── wp user list --json      (~2s)
    │
    ▼
Write to graph.db:
    ├── graphService.upsertSite(...)
    ├── graphService.deletePlugins(siteId)
    ├── graphService.upsertPlugin(...) × N
    └── graphService.upsertUser(...) × N
```

**No content indexing here.** `syncInstall()` is metadata-only. Content extraction (posts/pages → LanceDB) runs only via `indexAllWpeContent()`, which is triggered by the Operations tab button or the content index scheduler.

### SSH ControlMaster

Each SSH connection uses `ControlMaster=auto` and `ControlPersist=30s`. The first connection to a host takes 13-30 seconds (key exchange, WPE gateway handshake). Subsequent commands to the same host within 30 seconds reuse the socket and complete in 1-3 seconds.

With 4 concurrent connections, the first batch of 4 sites all establish connections simultaneously (~13-30s). Subsequent batches reuse ControlMaster sockets for much faster execution.

---

## Content Indexing — Separate Path

Content indexing (posts/pages/products → LanceDB embeddings) is **deliberately separate** from metadata sync.

```
Metadata sync (syncAllWPESites)    Content indexing (indexAllWpeContent)
─────────────────────────────────  ──────────────────────────────────────
Triggered on: startup, manual      Triggered on: button click, schedule
SSH commands: core, plugins, users SSH commands: wp post list, wp post get
Stores: graph.db                   Stores: LanceDB vector tables
Duration: 8-15s per site           Duration: 30s - 10min per site
Concurrency: 4                     Concurrency: 2
```

**Why separated:** Content extraction takes much longer than metadata sync (10-100x). Mixing them made metadata sync appear "stuck" — the counter would stay at 1/N for minutes while full content extraction ran per site.

### Content Index Scheduler

If `wpeContentIndexAutoEnabled` is `true` in settings, a `setInterval` scheduler triggers `indexAllWpeContent()` every `wpeContentIndexIntervalHours` hours (default: 24). The scheduler uses `setInterval` — it **does not fire on app startup**, only after the first interval elapses.

---

## Progress Tracking & UI

### `currentProgress` Object

`WPESyncService` maintains a `currentProgress` field that `WPE_SYNC_STATUS` IPC queries can read:

```ts
interface WPESyncProgress {
  total: number;
  current: number;
  skipped: number;
  currentSite: string;
  status: 'running' | 'completed' | 'failed';
}
```

### Push to UI

Progress is pushed to the renderer via two mechanisms:

1. **`onSyncProgress` callback** → `emitNexusState({ wpeSyncProgress: {...} })` → `nexusStore.update()` → component state update (immediate, real-time)
2. **`WPE_SYNC_STATUS` IPC poll** — `NexusOverview` polls every 2 seconds as a fallback when the component is already in sync state

Both mechanisms converge on the Operations tab banner:
```
WPE metadata sync                    59 / 63 sites
Syncing: ciantesterstg
```

---

## Usage Data Sync

After the SSH sync loop completes, `syncUsageData()` fetches bandwidth, visit, and storage metrics from CAPI for all 284 installs (not just the in-scope ones). This populates `wpe_installs.visits_mtd`, `bandwidth_mtd`, and `storage_bytes` in graph.db for fleet analytics.

Failures (HTTP 404 for deleted installs) are logged as warnings but don't fail the overall sync.

---

## Performance Benchmarks

| Fleet size | CAPI sync | SSH sync (all stale) | Total |
|---|---|---|---|
| 96 in-scope, 59 stale | ~3s | ~12-18 min (4 concurrent × 8-15s/site) | ~15-20 min |
| 284 total (after wpcli_read enabled) | ~3s | ~40-60 min (4 concurrent × 8-15s/site × 284) | ~45-65 min |
| 284 total, 200 fresh, 84 stale | ~3s | ~12-21 min | ~15-25 min |

**The 8-hour staleness threshold** means in practice most installs skip SSH sync on app restart (they were synced within 8 hours). Only genuinely stale installs hit SSH.

---

## Scheduler Settings

Configure in Settings tab → WPE Access & Permissions → Sync schedule:

| Setting | Key | Default | Effect |
|---|---|---|---|
| Auto metadata sync | `wpeSyncAutoEnabled` | `false` | Trigger SSH metadata sync on startup when stale |
| Sync interval | `wpeSyncIntervalHours` | `8` | Staleness threshold for "fresh" installs |
| Auto SSH refresh | `wpeRefreshAutoEnabled` | `false` | Background SSH refresh on timer |
| SSH refresh interval | `wpeRefreshIntervalHours` | `24` | Interval for background refresh |
| Content index auto-run | `wpeContentIndexAutoEnabled` | `false` | Enable scheduled content indexing |
| Content index interval | `wpeContentIndexIntervalHours` | `24` | Content index run interval |
