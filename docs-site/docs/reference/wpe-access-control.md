---
title: WP Engine Environment Access Control
description: Control which WP Engine accounts, operation types, and sites Nexus can access
keywords: [wpe, environment, production, staging, development, access control, security]
---

# WP Engine Access Control

Nexus uses a three-gate model to control what it can do across your WP Engine fleet. All settings live in **Local → Nexus Preferences → WP Engine → WP Engine Access**.

## Gate 1 — Account Scope

Controls which WP Engine accounts are visible in Nexus and included in operations. Excluded accounts are completely hidden — no metadata sync, no commands.

Click account chips in the header to quickly toggle individual accounts, or expand the full grid.

## Gate 2 — Operation Permissions

Four operation types, each independently configurable per environment:

| Operation | Dev default | Staging default | Production default |
|-----------|-------------|-----------------|-------------------|
| **Pull to local** | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| **WP-CLI over SSH** | ✅ Allowed | ✅ Allowed | ❌ Blocked |
| **Push to WPE** | ✅ Allowed | ✅ Allowed | ❌ Blocked |
| **Delete / Promote** | ❌ Blocked | ❌ Blocked | ❌ Blocked |

Click any operation card to expand it and toggle individual environment switches.

**Read metadata** (installs, domains, SSL, usage via CAPI) is always permitted and cannot be disabled.

## Gate 3 — Site Exceptions

Override the defaults for specific installs. Expand an operation card and view the "Site exceptions" column. Exceptions show whether the override relaxes (↑) or tightens (↓) the global default.

Site exceptions are manageable inline — click ✕ to remove one.

## What the Filter Controls

**WP-CLI blocked on excluded environments:**
All `wp_*` MCP tools using `install_name`, WPESyncService content indexing, `wpe_site_deep_refresh`, and `wpe_wait_for_ssh`.

**Push blocked on excluded environments:**
`local_wpe_push`

**Delete/Promote blocked on excluded environments:**
`wpe_promote_environment` (destination check), `wpe_delete_install`, `wpe_delete_site`, `wpe_update_install`, `wpe_purge_cache`

**Not affected by this filter:**
- WPE CAPI read operations (`wpe_get_installs`, `wpe_get_install`, `wpe_get_sites`, etc.)
- `wpe_create_backup` — protective operation, always allowed
- `local_wpe_pull` — always configurable (default: allowed on all environments)
- Cached twin data — existing data is not cleared when permissions change

## Migrating from v0.3.1

In v0.3.1, the setting was `wpeAllowedEnvironments: ['staging', 'development']`. On first load, Nexus automatically converts this to the equivalent `wpeOperationPermissions` values. No manual action required.
