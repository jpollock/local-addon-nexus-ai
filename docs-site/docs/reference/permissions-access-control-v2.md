---
title: WPE Access & Permissions (v2)
description: Complete reference for the wpcli_read / wpcli write split, account scoping, operation defaults, and per-site exceptions
keywords: [wpe, permissions, access control, production, wpcli, ssh, read, write, accounts, scope, security]
---

# WPE Access & Permissions (v2)

Nexus controls WP Engine access through three independent gates: **account scope**, **operation permissions**, and **site exceptions**. Settings live in **Local → Nexus AI → Settings tab → WPE Access & Permissions**, and in Nexus Preferences → WP Engine.

---

## What Changed in v0.4 (May 2026)

The former single `WP-CLI over SSH` permission has been split into two:

| Before | After |
|--------|-------|
| `WP-CLI over SSH` — blocked production by default | `WP-CLI over SSH (Read)` — **allowed on all environments** |
| | `WP-CLI over SSH (Write)` — blocked production by default (unchanged) |

**Impact:** Metadata sync (plugin list, WP version, user count via SSH) now works on production installs by default. Write operations (plugin install, core update, etc.) remain blocked on production. Users who were previously seeing 188 installs as "stale" will now have those synced automatically.

---

## Gate 1 — Account Scope

Controls which WP Engine accounts are included in permissions and sync operations.

**How to use:**
1. Open Settings → WPE Access & Permissions
2. Find the **Account scope** section — all your accounts are shown as pills
3. Click any pill to toggle it: `✓` green = included, `✗` grey dashed = excluded
4. Excluded accounts are hidden from all operations — no metadata sync, no commands

**What "excluded" means:**
- No SSH metadata sync for installs in that account
- No MCP tool operations (`wpe_get_installs`, `wp_plugin_list install_name=...`, etc.)
- Installs from that account do not appear in fleet searches
- Existing cached data is preserved but not updated

**Default:** All accounts included.

---

## Gate 2 — Operation Permissions

Five operation types, each independently configurable per environment (development / staging / production).

### Default Permission Matrix

| Operation | Dev | Staging | Production |
|-----------|-----|---------|------------|
| **Pull to local** — download files + DB from WPE | ✅ | ✅ | ✅ |
| **WP-CLI over SSH (Read)** — plugin list, core version, user list, option get | ✅ | ✅ | **✅** |
| **WP-CLI over SSH (Write)** — plugin install/update, core update, post CRUD | ✅ | ✅ | ❌ |
| **Push to WPE** — overwrite remote with local files and DB | ✅ | ✅ | ❌ |
| **Delete / Promote** — irreversible CAPI operations | ❌ | ❌ | ❌ |

> **Read-only CAPI operations** (installs list, domains, SSL certificates, usage metadata) are always permitted and cannot be disabled via these toggles.

### Which Commands Are Read vs Write

The addon automatically classifies SSH commands when you run `wp_*` tools or CLI `nexus wp ...` commands:

**wpcli_read (Read — allowed on production by default):**
- `wp plugin list` / `get`
- `wp theme list` / `get`
- `wp core version`
- `wp user list` / `get`
- `wp option get`
- `wp site health`
- `wp post list` / `get`
- `wp post-type list`
- `wp db export`

**wpcli (Write — blocked on production by default):**
- `wp plugin install` / `update` / `activate` / `deactivate`
- `wp theme activate`
- `wp core update`
- `wp post create` / `update` / `delete`
- `wp search-replace`
- `wp option update`
- `wp eval` / `eval-file` / `shell` *(always blocked on remote regardless of setting)*
- `wp db query` / `db cli` *(always blocked on remote regardless of setting)*

### How to Change Defaults

1. Open the operation card (click to expand)
2. Toggle the environment switches (Dev / Stg / Prd)
3. Changes take effect immediately for subsequent operations

---

## Gate 3 — Site Exceptions

Override the global defaults for specific WP Engine installs and environments.

**When to use:**
- Allow a specific production install for SSH write access during a maintenance window
- Block a staging install that is actually production-equivalent (client-facing)

**How to add an exception:**
1. Expand an operation card
2. Click **+ Add site exception** in the card footer
3. Search for the install name
4. Select the environment and whether to allow or block

**Exception precedence:** Site exceptions win over global defaults. An "allow" exception on a production install overrides the default "block" for that operation.

---

## What Each Permission Controls (Enforcement Points)

### wpcli_read

Checked by:
- `WPESyncService.syncAllWPESites()` — metadata sync filter (determines which installs enter the SSH sync loop)
- `nexusWpPluginList` GraphQL resolver — the `wp plugin list` command via CLI
- `nexusWpRun` GraphQL resolver — read-classified commands via CLI
- MCP tools: `wp_plugin_list`, `wp_theme_list`, `wp_core_version`, `wp_user_list`, `wp_option_get`
- MCP tools: `wpe_site_deep_refresh`, `wpe_wait_for_ssh`

### wpcli (Write)

Checked by:
- `nexusWpRun` GraphQL resolver — write-classified commands via CLI
- MCP tools: `wp_plugin_install`, `wp_plugin_update`, `wp_plugin_activate`, `wp_plugin_deactivate`
- MCP tools: `wp_theme_activate`, `wp_core_update`, `wp_post_create/update/delete`
- MCP tools: `wp_search_replace`, `wp_db_export`, `wp_eval`

### push

Checked by:
- `local_wpe_push` MCP tool
- Push operation in Local's Connect UI (via wpe-sync IPC handler)

### delete

Checked by:
- `wpe_promote_environment` — destination environment check
- `wpe_delete_install` — before CAPI call (uses cached environment or confirmName lookup)
- `wpe_delete_site` — before CAPI call
- `wpe_update_install` — environment check
- `wpe_purge_cache` — environment check

---

## Settings Storage

Permissions are stored in the addon settings (SQLite registry) as:

```json
{
  "wpeOperationPermissions": {
    "pull":       { "development": true,  "staging": true,  "production": true  },
    "wpcli_read": { "development": true,  "staging": true,  "production": true  },
    "wpcli":      { "development": true,  "staging": true,  "production": false },
    "push":       { "development": true,  "staging": true,  "production": false },
    "delete":     { "development": false, "staging": false, "production": false }
  },
  "wpeSiteExceptions": [
    {
      "installName": "my-prod-install",
      "environment": "production",
      "overrides": { "wpcli_read": true, "wpcli": false }
    }
  ],
  "wpeAccountFilter": ["account-id-1", "account-id-2"]
}
```

`wpeAccountFilter: null` means all accounts included.

---

## Migrating from Earlier Versions

**From `wpeAllowedEnvironments` array (pre-0.3.2):**
Nexus automatically converts `wpeAllowedEnvironments: ['staging', 'development']` to the equivalent `wpeOperationPermissions` on first load. No manual action required. The new `wpcli_read` defaults to `production: true` regardless of the old setting — this is the correct new default.

**From single `wpcli` permission (0.3.x):**
If you had previously blocked WP-CLI on production and rely on that for safety, add a site exception or toggle `WP-CLI (Read)` production off in the UI. The old `wpcli` permission is now only the write path; the new `wpcli_read` controls read access separately.
