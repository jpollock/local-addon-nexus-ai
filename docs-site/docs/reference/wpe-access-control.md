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
- All `wp_*` MCP tools targeting a WPE install (plugin list/install/update, core version/update, user list, etc.)
- Content indexing and twin sync via `WPESyncService`
- `wpe_site_deep_refresh` SSH commands
- `wpe_wait_for_ssh` probing
- `nexusWpCommand` GraphQL resolver (CLI fallback)

**Not affected by this filter:**
- WPE CAPI (REST API) operations — `wpe_get_installs`, `wpe_create_backup`, `wpe_get_domains`, SSL/domain management, etc. These are read-only metadata calls, not code execution.
- `local_wpe_push` / `local_wpe_pull` — these are Local's own file sync, not WP-CLI
- Cached twin data — production sites already in the graph remain visible but won't refresh

## CLI / MCP Setting

The setting is currently configurable only via the Preferences UI. To check the current value programmatically, look for `wpeAllowedEnvironments` in the Nexus settings.
