# Nexus AI User Guide

Nexus AI adds AI-powered WordPress site intelligence to [Local](https://localwp.com/). It indexes your sites, exposes them through the Model Context Protocol (MCP), and provides a built-in chat interface for managing WordPress with natural language.

## Installation

### From a Release

1. Download the tarball for your platform from the Releases page
2. Extract to Local's addon directory:
   ```
   ~/Library/Application Support/Local/addons/local-addon-nexus-ai/
   ```
3. Restart Local

### From Source

```bash
git clone <repo-url> local-addon-nexus-ai
cd local-addon-nexus-ai
npm install
npm run download-model
npm run build
```

Symlink or copy into Local's addon path, then restart Local.

### Requirements

- Local 9.0.0 or later
- Node.js 20+
- ~200 MB disk space (ONNX model + LanceDB binaries)
- Ollama (optional, for local AI chat)

## Dashboard

The Nexus AI dashboard appears as an addon view inside Local. It has five tabs (Dashboard is the default):

### Dashboard

Fleet-wide statistics and quick actions:

- **Ask Nexus AI** — Quick-send card at the top. Type a question and press Enter or →; it opens the Ask/Tell tab and submits the prompt automatically.
- **Fleet Intelligence** — Site counts (local + WPE), WordPress version distribution, PHP distribution.
- **Data Completeness** — Progress bars for Scanned / Configured / Searchable sites. ⚡ Index sites opens Operations; ⏱ Schedule opens Settings.
- **AI Integration** — MCP server status, AI gateway usage.

### Ask/Tell

An AI assistant that manages WordPress sites using natural language. Calls the same MCP tools that external clients use.

> **Tip:** For a richer experience with full tool support and conversation history, use the MCP server or CLI with Claude, Cursor, or another AI tool. Ask/Tell is a quick way to try the capabilities.

### Operations

Bulk actions and site status:

- **Keep data current** — Refresh metadata (WP-CLI: active plugins, WP version, PHP, themes), Index content, Sync WPE metadata.
- **Site Status** — Per-site data level (Scanned / Configured / Searchable) with expand-to-detail. Click ⚡ Index to index a running site.
- **Advanced** — Factory reset, content index reset, database health, SSH diagnostics.

Indexing a site: click **⚡ Index sites** from the Dashboard, or expand the Operations → Site Status row and click **⚡ Index** on a running site.

**Setup AI for a site:** Use the per-site Nexus section in Local's site info panel (not from the dashboard).

### Activity

Event timeline, event stats, storage health, and top issues panel.

### Settings

Operational configuration — auto-indexing, sync schedules, and WPE access controls.

**Sync schedule — WPE Installs:**
- **Metadata sync** — checkbox (enable) + interval in hours. When enabled, runs SSH WP-CLI every hour and syncs installs older than the threshold. Default: **disabled** (opt-in).
- **Site info updates** — checkbox (enable) + interval. URL, admin email, post count via SSH. Default: **disabled** (opt-in).

**Sync schedule — Local Sites:**
- **Content index interval** — checkbox + interval. Auto-starts halted sites, indexes content, then stops. 0 = manual only. Default: **disabled**.
- **Offline site scan** — interval only (always runs). Filesystem scan for halted sites. Default: 24h.

Changes to sync settings take effect immediately — no Local restart required.

**Supported providers:** Ollama (local, default), OpenAI, Anthropic, Google, WPE Gateway

**Setup for Ollama:**
```bash
ollama pull llama3.2
```

Configure other providers in Preferences > Nexus AI.

**How it works:**
1. You type a message
2. The agent decides which tools to call based on your request
3. Tool results feed back to the model for a natural language response
4. Destructive operations (deleting sites, pushing to WPE) require your approval before executing

## Connecting an External MCP Client

When the addon starts, it writes connection info to:

```
~/Library/Application Support/Local/nexus-ai-mcp-connection-info.json
```

This file contains the URL, auth token, and port. Any MCP-compatible client (Claude Code, Cursor, etc.) can connect using these credentials.

The server binds to `127.0.0.1` only — it is not accessible from other machines.

## Tool Catalog

Nexus AI provides 53 MCP tools organized into 9 modules.

### Content (2 tools)

| Tool | Description |
|------|-------------|
| `search_site_content` | Semantic search within a single site's indexed content |
| `search_across_sites` | Search across all indexed sites |

### Site Context (4 tools)

| Tool | Description |
|------|-------------|
| `get_site_structure` | Deep structural analysis: theme, plugins, custom tables, REST API |
| `get_index_status` | Check whether a site is indexed, indexing, or has errors |
| `reindex_site` | Trigger a full content reindex |
| `list_indexed_sites` | List all sites with vector indexes |

### Ollama (2 tools)

| Tool | Description |
|------|-------------|
| `ask_ollama` | Query a local Ollama model. Pass `site` to inject site context automatically |
| `list_ollama_models` | List installed models with hardware-aware recommendations |

### Fleet (8 tools)

| Tool | Description |
|------|-------------|
| `fleet_overview` | Adaptive fleet summary — auto-detects local-only vs WPE fleet. Start here for "tell me about my fleet" questions |
| `fleet_sql` | Read-only SQL query over graph.db (`sites`, `plugins`, `content`, `users` tables). Write SELECT queries for version distributions, plugin inventory, user counts, activity |
| `fleet_summary` | Aggregate stats across all sites |
| `find_sites_with_plugin` | Filter sites by plugin presence |
| `compare_sites` | Side-by-side comparison of two or more sites |
| `detect_drift` | Find configuration differences across sites |
| `nexus_site_audit` | Parallel audit of a single site (version, plugins, themes, health, updates) |
| `nexus_plugin_audit` | Fleet-wide plugin status with update availability |

### Site Management (11 tools)

| Tool | Description |
|------|-------------|
| `local_list_sites` | List all local sites with status |
| `local_get_site` | Get details for a single site |
| `local_start_site` | Start a halted site |
| `local_stop_site` | Stop a running site |
| `local_restart_site` | Restart a running site |
| `local_create_site` | Create a new WordPress site |
| `local_delete_site` | Delete a site (requires confirmation) |
| `local_clone_site` | Clone an existing site |
| `local_export_site` | Export a site as a .zip archive |
| `local_change_php_version` | Change a site's PHP version |
| `local_trust_ssl` | Add a site's SSL certificate to the system trust store |

### WP-CLI (12 tools)

These tools work on both local sites (pass `site`) and remote WP Engine installs (pass `install_name`).

| Tool | Description | Remote |
|------|-------------|--------|
| `wp_plugin_list` | List installed plugins | Yes |
| `wp_plugin_install` | Install a plugin by slug | Yes |
| `wp_plugin_activate` | Activate an installed plugin | Yes |
| `wp_plugin_deactivate` | Deactivate a plugin | Yes |
| `wp_plugin_update` | Update plugins (supports dry-run) | Yes |
| `wp_theme_list` | List installed themes | Yes |
| `wp_core_version` | Get WordPress version | Yes |
| `wp_user_list` | List WordPress users | Yes |
| `wp_option_get` | Read a WordPress option value | Yes |
| `wp_site_health` | Run the WordPress Site Health check | No |
| `wp_db_export` | Export the database to a .sql file | No |
| `wp_search_replace` | Search and replace in the database (dry-run by default) | No |

### WP Connector (3 tools)

| Tool | Description |
|------|-------------|
| `wp_list_abilities` | Discover WordPress Abilities API registrations (WP 6.9+) |
| `wp_run_ability` | Execute a registered ability (e.g., `acf/list-field-groups`) |
| `wp_sync_ai_credentials` | Sync AI provider API keys to WordPress 7.0+ Connector Screen |

See [WP Connector](wp-connector.md) for full details.

### WP Engine (9 core tools + full fleet management)

| Tool | Description |
|------|-------------|
| `wpe_get_accounts` | List WP Engine accounts |
| `wpe_get_installs` | List installs across accounts |
| `wpe_get_install` | Get details for a specific install |
| `wpe_create_backup` | Create a backup of a WPE install |
| `wpe_purge_cache` | Purge cache on a WPE install |
| `local_wpe_pull` | Pull a WPE environment into a local site |
| `local_wpe_push` | Push a local site to a WPE environment (requires confirmation) |
| `local_wpe_link` | Link a local site to a WPE install |
| `nexus_list_sites` | Unified view of local sites + WPE installs |

Additional WPE management tools cover domains, SSL certificates, user management, environment promotion, fleet health, and go-live checklists. See [WP Engine Management Guide](WPE_REMOTE_MANAGEMENT_USER_GUIDE.md) for the complete tool reference.

## Safety System

Tools are classified into three safety tiers:

- **Tier 1 (read-only)** — Execute immediately with no side effects.
- **Tier 2 (modifying)** — Execute and log. Changes state but is recoverable.
- **Tier 3 (destructive)** — Requires confirmation. The first call returns a token; call again with the token to proceed.

Only two tools are Tier 3: `local_delete_site` and `local_wpe_push`.

All Tier 2 and Tier 3 operations are logged to `~/Library/Application Support/Local/nexus-ai/audit.log`.

See [Security](security.md) for the full tier listing and threat model.

## Content Indexing

Nexus AI indexes WordPress content for semantic search:

1. **Scan** — Reads site structure from the filesystem
2. **Extract** — Pulls content from MySQL (posts, pages, products, ACF fields, media)
3. **Chunk** — Splits long content at sentence boundaries
4. **Embed** — Generates 384-dimensional vectors using all-MiniLM-L6-v2 (runs locally via ONNX)
5. **Index** — Stores vectors in LanceDB with cosine distance search

Indexing happens on-demand via Operations → ⚡ Index sites, or per-site via the Site Status panel, or programmatically via the `reindex_site` MCP tool. Content is automatically re-indexed when a site starts if auto-indexing is enabled (Settings → Content index interval).

Supported content types: posts, pages, custom post types, WooCommerce products (price, SKU, stock, attributes), ACF custom fields (text, repeater, group, flexible content), and media metadata.

## Fleet Analytics

In addition to the vector index, Nexus AI maintains a relational graph database (`graph.db`) with structured per-site data collected on every site start:

| Column | Description |
|--------|-------------|
| `wp_version`, `php_version` | WordPress and PHP versions |
| `post_count_by_type` | JSON — per-post-type publish counts |
| `user_count_by_role` | JSON — role distribution (administrator, editor, etc.) |
| `settings_json` | Key WordPress options (blogname, siteurl, active_plugins, etc.) |
| `last_post_at` | Timestamp of the most recently published post |
| `last_active_session` | Most recent user login from `session_tokens` meta |

Query this data directly using `fleet_sql`:

```
what WordPress versions is my fleet running?
```
```
which sites have woocommerce active?
```
```
show me sites with no posts published in the last 90 days
```
```
how many admins does each site have?
```

`fleet_sql` accepts any SELECT statement and returns results as a table. See the tool description for the full schema and example queries.

## AI Setup

Nexus AI can configure WordPress sites for AI features with one click. The "Setup AI" button (found in the per-site Nexus section in Local's site info panel) performs these steps:

1. Installs and activates the AI Experiments plugin
2. Installs the Ollama provider plugin (registers Ollama as a WordPress AI service provider)
3. Installs the Nexus AI Connector plugin (sends WordPress events to Local)
4. Enables WordPress AI experiment flags
5. Syncs configured API keys to WordPress
6. Enables ACF abilities (for sites using Advanced Custom Fields)

**Fleet-wide setup:** Click "Setup AI for All Running Sites" in Operations → Keep data current to configure all running sites at once. Progress is tracked in the Bulk Operations panel.

**Requirements:**
- Site must be running
- WordPress 6.8+ for AI plugin compatibility
- Ollama installed for local AI features (optional — cloud providers also work)

## Credential Management

API keys configured in Preferences (OpenAI, Anthropic, Google, etc.) can be synced to WordPress sites so their AI features use your configured providers.

- **Auto-sync:** When you save an API key in Preferences, it's automatically broadcast to all running WordPress 7.0+ sites
- **Manual sync:** Click "Sync All" in Preferences or "Sync Keys" on a per-site basis
- **Sync status:** The Preferences panel shows which sites have synced credentials and when

Keys are stored in WordPress as `nexus_ai_credentials` in wp_options, accessible through the Connector Screen API.

## AI Proxy

The AI Proxy is an OpenAI-compatible HTTP server backed by local Ollama. It's built into the addon and starts automatically.

**What it's for:** Enhanced AI clients that want tool injection or agentic mode. WordPress AI features don't need the proxy — they talk directly to Ollama via the provider plugin.

**Connection info:** Shown in Preferences under "AI Proxy Server" (port + status).

**Tool modes** (set via `X-Nexus-Tools` header):
- `passthrough` (default) — forwards tools as-is
- `inject` — merges Nexus MCP tools into requests
- `agentic` — executes MCP tools server-side

See [AI Proxy Guide](ai-proxy-guide.md) for full documentation.

## Database Health

Nexus AI can scan WordPress databases for bloat, stale data, and inefficiencies — and clean them up safely.

### When to Use It

- Sites feel slow and you suspect database bloat
- WooCommerce stores accumulating stale order data, orphaned carts, or expired transients
- Before pushing a local site to production
- Routine fleet maintenance to keep databases lean

### CLI

```bash
# Scan a site and print a health report
nexus wp db scan mysite

# Preview what would be cleaned (no changes made)
nexus wp db clean mysite --dry-run

# Apply cleanup after reviewing the dry-run output
nexus wp db clean mysite

# Print a saved report for a previously scanned site
nexus wp db report mysite
```

`clean` defaults to `--dry-run`, so running it without flags is always safe.

### MCP Tool Usage

```
scan the database health of mysite
```

```
show me database recommendations for mysite
```

```
clean up post revisions and transients on mysite (dry run first)
```

```
give me a database health summary across all my running sites
```

### What Each Cleanup Item Does

| Item | What It Is | Safe to Clean? |
|------|------------|----------------|
| Post revisions | Old autosave/revision copies of posts | Yes — keep a few, delete the rest |
| Transients | Temporary cached values stored in `wp_options` | Yes — expired ones are dead weight |
| Orphaned postmeta | Post meta rows for deleted posts | Yes |
| Spam/trash comments | Rejected or binned comments | Yes |
| Auto-draft posts | Abandoned autosaves with no parent | Yes |
| Orphaned termmeta | Term meta for deleted terms | Yes |

### WooCommerce-Specific Cleanup

WooCommerce sites accumulate additional data over time:

| Item | Description |
|------|-------------|
| Stale sessions | Abandoned shopping cart sessions |
| Orphaned order meta | Order meta for deleted orders |
| Orphaned variation meta | Product variation meta for removed variations |
| Failed/cancelled orders | Old orders in terminal states (configurable retention) |
| Expired coupons (meta) | Meta for coupons that no longer exist |

These items are surfaced separately in scan output so you can review them before cleaning.

## CLI

The `nexus` CLI provides terminal access to all major Nexus AI features. After installation, authenticate once and then manage local and remote WordPress sites from any terminal.

### Site Commands (`nexus sites`)

```bash
nexus sites list              # list all local sites
nexus sites start <name>      # start a site
nexus sites stop <name>       # stop a site
```

### WordPress Commands (`nexus wp`)

```bash
nexus wp plugins <site>       # list plugins
nexus wp db scan <site>       # scan database health
nexus wp db clean <site>      # clean database (dry-run by default)
nexus wp db report <site>     # print saved health report
```

### WP Engine Commands (`nexus wpe`)

```bash
# Authentication
nexus wpe status | login | logout

# Accounts & users
nexus wpe accounts | account <id> | limits <id>
nexus wpe users <accountId> | user-add | user-remove | user-audit

# Installs & sites
nexus wpe installs | install <id>
nexus wpe create-install | update-install | delete-install

# Domains & SSL
nexus wpe domains <installId> | domain-add | domain-remove | domain-check
nexus wpe ssl <installId> | ssl-request

# Backups
nexus wpe backup <target> | backup-verify <id> | backup-status <id> <backupId>

# Fleet
nexus wpe diagnose <id> | go-live-check <id> <domain>
nexus wpe fleet-health | portfolio | promote <src> <dest>
```

See the [WP Engine Management Guide](WPE_REMOTE_MANAGEMENT_USER_GUIDE.md) for the full reference.

## WP Engine Management

Nexus AI provides full WP Engine fleet management via AI agents and the `nexus wpe` CLI. You can manage accounts, installs, domains, SSL certificates, users, backups, and more — directly from an AI chat or the terminal.

**Quick start:**
```bash
nexus wpe status          # check auth
nexus wpe login           # authenticate
nexus wpe accounts        # list accounts
nexus wpe installs        # list installs
```

For the complete reference, see [WP Engine Remote Management Guide](WPE_REMOTE_MANAGEMENT_USER_GUIDE.md).

**Key capabilities:**
- Account & user management (add/remove portal users, audit access)
- Install lifecycle (create, update, delete installs and sites)
- Domain management (add domains, check DNS, set primary)
- SSL certificates (request Let's Encrypt, import custom, monitor expiry)
- Environment promotion (staging → production with backup checks)
- Fleet intelligence (health overview, diagnose installs, go-live checklist)
- Backup creation and verification

## Production Deployment

When pushing a Local site to WP Engine, AI plugins and settings transfer with the push. However, Ollama-based features only work locally — use cloud providers (OpenAI, Anthropic) for production AI.

See [Production Deployment Guide](production-deployment-guide.md) for step-by-step instructions.
