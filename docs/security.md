# Security and Safety

This document covers the Nexus AI addon's security architecture: the safety tier system, authentication, audit logging, threat model, and security notes for specific features.

## Authentication

The MCP server uses bearer token authentication:

- A random token is generated via `crypto.randomBytes` on first startup and persisted across restarts
- All MCP endpoints except `/health` require `Authorization: Bearer <token>`
- The token is written to `~/Library/Application Support/Local/nexus-ai-mcp-connection-info.json`
- The server binds to `127.0.0.1` only — not accessible from other machines

## Safety Tier System

Every MCP tool is classified into one of three safety tiers.

### Tier 1 — Read-Only

No side effects. Execute immediately without logging or confirmation.

| Tool | Module |
|------|--------|
| `local_list_sites` | Site Management |
| `local_get_site` | Site Management |
| `wp_plugin_list` | WP-CLI |
| `wp_theme_list` | WP-CLI |
| `wp_core_version` | WP-CLI |
| `wp_user_list` | WP-CLI |
| `wp_option_get` | WP-CLI |
| `wp_site_health` | WP-CLI |
| `wpe_get_accounts` | WPE |
| `wpe_get_installs` | WPE |
| `wpe_get_install` | WPE |
| `local_wpe_link` | WPE |
| `nexus_list_sites` | WPE |
| `wp_list_abilities` | WP Connector |
| `search_site_content` | Content |
| `search_across_sites` | Content |
| `get_site_structure` | Site Context |
| `get_index_status` | Site Context |
| `list_indexed_sites` | Site Context |
| `fleet_summary` | Fleet |
| `find_sites_with_plugin` | Fleet |
| `compare_sites` | Fleet |
| `detect_drift` | Fleet |
| `ask_ollama` | Ollama |
| `list_ollama_models` | Ollama |
| `nexus_site_audit` | Composite |
| `nexus_plugin_audit` | Composite |

### Tier 2 — Modifying

Changes state but is recoverable. Executes immediately and logged to the audit trail.

| Tool | Module | What it modifies |
|------|--------|-----------------|
| `local_start_site` | Site Management | Process state |
| `local_stop_site` | Site Management | Process state |
| `local_restart_site` | Site Management | Process state |
| `local_create_site` | Site Management | Creates new site on disk |
| `local_clone_site` | Site Management | Copies site to new location |
| `local_export_site` | Site Management | Writes .zip file |
| `local_change_php_version` | Site Management | Site configuration |
| `local_trust_ssl` | Site Management | System trust store |
| `wp_plugin_install` | WP-CLI | WordPress plugins directory |
| `wp_plugin_activate` | WP-CLI | WordPress options |
| `wp_plugin_deactivate` | WP-CLI | WordPress options |
| `wp_plugin_update` | WP-CLI | WordPress plugins directory |
| `wp_db_export` | WP-CLI | Writes .sql file |
| `wp_search_replace` | WP-CLI | Database content |
| `wpe_create_backup` | WPE | Creates remote backup |
| `wpe_purge_cache` | WPE | Clears remote cache |
| `local_wpe_pull` | WPE | Overwrites local site with remote data |
| `reindex_site` | Site Context | Vector database |
| `wp_run_ability` | WP Connector | Depends on the ability |
| `wp_sync_ai_credentials` | WP Connector | WordPress options |

### Tier 3 — Destructive

Potentially irreversible. Requires a two-phase confirmation flow.

| Tool | Warning |
|------|---------|
| `local_delete_site` | "This will permanently delete the site and all its files." |
| `local_wpe_push` | "This will overwrite the remote WP Engine environment with local site data." |

## Confirmation Token Flow

Tier 3 tools use a two-phase confirmation:

**Phase 1 — Request confirmation:**
Call the tool without `_confirmationToken`. Returns:
```json
{
  "requiresConfirmation": true,
  "action": "Delete site 'my-blog' and all its files",
  "warning": "This action may not be reversible.",
  "preChecks": [
    "Verify the site is not connected to a production environment",
    "Confirm you have a recent backup"
  ],
  "confirmationToken": "a1b2c3d4..."
}
```

**Phase 2 — Execute with token:**
Call the same tool again with `_confirmationToken: "a1b2c3d4..."`. The token is validated:
- Must match the tool name from Phase 1
- Must match the parameters from Phase 1 (order-independent)
- Single-use (consumed after one execution)
- Expires after 5 minutes

If validation passes, the operation executes.

## Audit Logging

All Tier 2 and Tier 3 tool calls are logged to:

```
~/Library/Application Support/Local/nexus-ai/audit.log
```

Each entry records:

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 timestamp |
| `toolName` | Name of the tool called |
| `tier` | Safety tier (1, 2, or 3) |
| `params` | Tool parameters (sensitive values redacted) |
| `confirmed` | Whether a confirmation token was provided (Tier 3 only) |
| `result` | `success`, `error`, or `confirmation_required` |
| `error` | Error message if result is `error` |
| `duration_ms` | Execution time in milliseconds |

## Dry-Run Best Practices

Two tools support dry-run mode to preview changes before committing:

- `wp_plugin_update` with `slug="--all"` — shows available updates without applying them
- `wp_search_replace` — defaults to dry-run mode. Pass `dry_run: false` to execute.

## Remote Execution Security

WP-CLI tools can execute on remote WP Engine installs via SSH. Security measures:

**Blocked commands:** The following WP-CLI commands are blocked on remote execution to prevent arbitrary code execution on production:
- `eval`, `eval-file`, `shell`, `db query`, `db cli`

**Default flags:** Remote commands always include `--skip-plugins --skip-themes` to prevent plugin/theme code from executing during WP-CLI operations.

**SSH configuration:**
- Connection pattern: `local+ssh+{installName}@{installName}.ssh.wpengine.net`
- Key path: `{userDataPath}/ssh/wpe-connect`
- Uses direct `spawn('ssh')` (not Local's bundled SSH binary)

**Local-only tools:** Three tools do not support remote execution:
- `wp_db_export` — database export
- `wp_search_replace` — database find/replace
- `wp_site_health` — WordPress Site Health check

## Setup for AI — Security Notes

The "Setup for AI" button performs two operations:

1. **Installs the AI Experiments plugin** via `wp plugin install ai --activate`. This is a standard WordPress plugin install — the same operation as `wp_plugin_install`.

2. **Writes a mu-plugin file** to `wp-content/mu-plugins/enable-acf-abilities.php` via `wp eval` with `file_put_contents()`. This only runs when ACF PRO >= 6.8 is active on the site.

### Why This Is IPC-Only

Setup for AI is triggered via Electron IPC from the Local UI, not exposed as an MCP tool. This means:

- **No remote execution** — it cannot be called by an external MCP client
- **No arbitrary file writes** — the content is hardcoded (a single `add_filter` call)
- **User-initiated only** — requires clicking a button in the Local dashboard

### The mu-plugin Surface

The mu-plugin contains one line of functional PHP:

```php
add_filter('acf/abilities/enabled', '__return_true');
```

This enables ACF's opt-in to the WordPress Abilities API. It does not:
- Expose any new REST API endpoints
- Modify existing ACF functionality
- Grant additional permissions beyond what ACF already has
- Execute any code itself — it only sets a filter that ACF checks

### Credential Handling

`wp_sync_ai_credentials` writes API keys to WordPress options. Security measures:

- Keys are read from Local's encrypted storage, not from the MCP request
- Output masks keys (shows only last 4 characters)
- The tool bypasses WP 7.0's validation filter (which would send keys to external APIs for verification) by removing the filter before writing
- Dry-run mode available to preview without writing

## Threat Model

### Attack Surface

| Surface | Mitigation |
|---------|------------|
| MCP server exposed on network | Binds to `127.0.0.1` only |
| Token in connection info file | File permissions, local-only access |
| Arbitrary tool execution via MCP | Safety tiers, confirmation tokens |
| Remote code execution via WP-CLI | Blocked command list, skip-plugins/themes |
| File writes via Setup for AI | IPC-only, hardcoded content |
| Credential exposure | Masked output, local storage |

### Trust Boundaries

1. **Local UI -> IPC -> Main Process** — Trusted. User-initiated actions through Electron IPC.
2. **MCP Client -> HTTP -> Main Process** — Semi-trusted. Authenticated via bearer token, constrained by safety tiers.
3. **Main Process -> WP-CLI -> WordPress** — Trusted locally. Remote execution restricted by blocked command list.
4. **Main Process -> SSH -> WP Engine** — Authenticated via SSH key. Commands constrained by WPE's SSH restrictions plus our blocked command list.
