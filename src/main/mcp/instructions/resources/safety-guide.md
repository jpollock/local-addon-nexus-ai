# Safety System

Nexus AI uses a 3-tier safety system to protect against accidental destructive operations.

## Tier 1 — Read-Only

No side effects. Execute immediately without logging or confirmation.

**Examples:** `local_list_sites`, `wp_plugin_list`, `wp_core_version`, `wp_theme_list`, `wp_user_list`, `wp_option_get`, `wp_site_health`, `wpe_get_accounts`, `wpe_get_installs`, `fleet_summary`, `search_site_content`, `get_site_structure`

## Tier 2 — Modifying

Changes state but is recoverable. Executes immediately and logs to the audit trail.

**Examples:** `local_start_site`, `local_stop_site`, `local_restart_site`, `local_create_site`, `wp_plugin_install`, `wp_plugin_activate`, `wp_plugin_deactivate`, `wp_plugin_update`, `local_wpe_pull`, `reindex_site`

## Tier 3 — Destructive

Potentially irreversible. Requires a two-phase confirmation flow:

1. **First call** (no `_confirmationToken`): Returns a JSON response with:
   - `requiresConfirmation: true`
   - `action`: Description of what will happen
   - `warning`: "This action may not be reversible."
   - `preChecks`: List of things to verify before proceeding
   - `confirmationToken`: A single-use token (expires in 5 minutes)

2. **Second call** (with `_confirmationToken`): Include the token in the request to execute the operation.

**Examples:** `local_delete_site`, `local_wpe_push`

## Dry-Run Best Practices

- `wp_plugin_update` with `slug="--all"` shows available updates without applying them
- `wp_search_replace` defaults to dry-run mode — use it to preview changes before committing

## Audit Logging

All Tier 2 and Tier 3 operations are logged to `~/Library/Application Support/Local/nexus-ai/audit.log` with timestamps, tool names, parameters (sensitive values redacted), and results.
