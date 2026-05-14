---
title: WP Engine Environment Access Control
description: Control which WP Engine environment types Nexus can access for WP-CLI and content sync
keywords: [wpe, environment, production, staging, development, access control, security]
---

# WP Engine Environment Access Control

Nexus can interact with WP Engine installs across three environment types: **production**, **staging**, and **development**. By default, production is excluded to prevent accidental changes to live sites.

## Default Behaviour

| Environment | Default | What's affected |
|-------------|---------|-----------------|
| Development | Allowed | WP-CLI, content sync, twin refresh |
| Staging | Allowed | WP-CLI, content sync, twin refresh |
| Production | Blocked | WP-CLI, content sync, twin refresh |

## Enabling Production Access

Go to **Local → Nexus Preferences → WP Engine → WP Engine Environment Access** and check **Production**.

!!! warning "Production access"
    Enabling production access allows Nexus to run WP-CLI commands and index content on live sites. Review any AI-suggested operations carefully before confirming them.

## What the Filter Controls

**Blocked on excluded environments:**
- All `wp_*` MCP tools targeting a WPE install (WP-CLI over SSH)
- Content indexing and twin sync via `WPESyncService`
- `wpe_site_deep_refresh` SSH commands
- `wpe_promote_environment` — when the **destination** install is production
- `wpe_delete_install` — when the install being deleted is production
- `wpe_delete_site` — when any install on the site is production
- `wpe_update_install` — when the install being modified is production
- `wpe_purge_cache` — when the install being purged is production

**Not affected by this filter:**
- WPE CAPI read operations — `wpe_get_installs`, `wpe_get_install`, `wpe_get_sites`, etc.
- `wpe_create_backup` — protective operation, always allowed
- `wpe_create_install`, `wpe_create_site` — creates new resources
- `local_wpe_push` / `local_wpe_pull` — Local's file sync, not WP-CLI
- Cached twin data — existing data is not cleared when environments are excluded

## CLI / MCP Setting

The setting is currently configurable only via the Preferences UI. To check the current value programmatically, look for `wpeAllowedEnvironments` in the Nexus settings.
