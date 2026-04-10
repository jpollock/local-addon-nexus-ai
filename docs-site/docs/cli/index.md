---
title: CLI/MCP Server Overview
description: Command-line interface and MCP server for AI-powered WordPress management
keywords: [cli, mcp, model context protocol, ai, claude, cursor]
---

# CLI/MCP Server

The Nexus AI CLI provides a **command-line interface** and **MCP server** for AI-powered WordPress management.

## Two Modes

### 1. Interactive CLI
Direct command execution from your terminal.

```bash
# List all sites
nexus sites

# Search across all sites
nexus search "woocommerce setup"

# List plugins on a site
nexus wp plugin list --site mysite

# Pull WPE site to local
nexus wpe pull mysite-prod
```

### 2. MCP Server
Exposes 160+ tools to AI assistants via the Model Context Protocol.

```bash
# Auto-configure your AI client (Local by WP Engine must be running)
nexus mcp setup --agent claude-desktop --write
# or: cursor, windsurf, cline, gemini, claude-code
```

## Installation

=== "npm (Global)"

    ```bash
    npm install -g @local-labs-jpollock/local-addon-nexus-ai
    ```

=== "npx (No Install)"

    ```bash
    npx @local-labs-jpollock/local-addon-nexus-ai sites
    npx @local-labs-jpollock/local-addon-nexus-ai search "query"
    ```

=== "From Source"

    ```bash
    git clone https://github.com/jpollock/local-addon-nexus-ai
    cd local-addon-nexus-ai
    npm install
    npm run build:cli
    npm link
    ```

[Installation Guide →](installation.md)

## Quick Start

### 1. List Sites

```bash
nexus sites
```

Output:
```
Local Sites (3 running, 1 halted):
  ✓ mysite (mysite.local) - WordPress 6.4.2
  ✓ testsite (testsite.local) - WordPress 6.3.1
  ✓ devsite (devsite.local) - WordPress 6.4.1
  ○ oldsite (oldsite.local) - HALTED

WP Engine Sites (12 installs):
  → mysite-prod (mysite.com) - production
  → mysite-staging (staging.mysite.com) - staging
  ...
```

### 2. Search Content

```bash
nexus search "optimize database" --limit 5
```

Output:
```
Found 5 results across 3 sites:

1. mysite (0.92 relevance)
   Title: How to Optimize Your WordPress Database
   Type: post
   Match: "...regular database optimization improves performance..."

2. testsite (0.87 relevance)
   Title: Database Maintenance Tips
   Type: page
   Match: "...use tools like WP-Optimize to clean up..."
```

### 3. Execute WP-CLI

```bash
# Local site
nexus wp plugin list --site mysite

# Remote WPE site
nexus wp plugin list --install mysite-prod
```

### 4. Pull WPE Site

```bash
nexus wpe pull mysite-prod
```

Creates local site and pulls files + database from WP Engine.

## Command Structure

```
nexus <command> [subcommand] [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `sites` | List all local and WPE sites |
| `search` | Semantic search across all sites |
| `scan` | Index a site into vector database |
| `wp` | Execute WP-CLI commands |
| `wpe` | WP Engine operations (pull, push, sync) |
| `local` | Local site operations (create, start, stop) |
| `mcp` | Configure MCP clients (`nexus mcp setup`) — server runs inside the Local addon |
| `telemetry` | View/control telemetry settings |

[Command Reference →](commands.md)

## MCP Tools

When running as an MCP server, Nexus AI exposes 160+ tools to AI assistants.

### Tool Categories

<div class="tool-grid" markdown>

<div class="tool-card" markdown>

**Local Sites** (10 tools)

- `local_list_sites`
- `local_create_site`
- `local_start_site`
- `local_stop_site`
- `local_wpe_pull`
- `local_wpe_push`
- And more...

[Local Tools →](../mcp-tools/local-sites.md)

</div>

<div class="tool-card" markdown>

**WPE Sites** (40+ tools)

- `wpe_get_installs`
- `wpe_diagnose_site`
- `wpe_environment_diff`
- `wpe_promote_to_production`
- `wpe_create_backup`
- And more...

[WPE Tools →](../mcp-tools/wpe-sites.md)

</div>

<div class="tool-card" markdown>

**WordPress** (12 tools)

- `wp_plugin_list`
- `wp_plugin_activate`
- `wp_core_version`
- `wp_user_list`
- `wp_site_health`
- And more...

[WordPress Tools →](../mcp-tools/wordpress.md)

</div>

<div class="tool-card" markdown>

**Search** (4 tools)

- `search_site_content`
- `search_posts`
- `search_products`
- `semantic_search`

[Search Tools →](../mcp-tools/search.md)

</div>

<div class="tool-card" markdown>

**Fleet** (8 tools)

- `nexus_list_sites`
- `nexus_get_site_info`
- `nexus_fleet_health`
- `nexus_bulk_update`
- And more...

[Fleet Tools →](../mcp-tools/fleet.md)

</div>

<div class="tool-card" markdown>

**Telemetry** (4 tools)

- `get_telemetry_status`
- `set_telemetry_enabled`
- `clear_telemetry_events`
- `reset_telemetry`

[Telemetry Tools →](../mcp-tools/telemetry.md)

</div>

</div>

[Complete Tool Reference →](../mcp-tools/index.md)

## Authentication

### WP Engine Account

Link your WP Engine account for remote operations.

```bash
# Authenticate (opens browser)
nexus wpe auth

# Check status
nexus wpe status

# Logout
nexus wpe logout
```

Authentication uses Local's saved WPE credentials (same as the UI addon).

[Authentication Guide →](authentication.md)

## Configuration

### Config File

`~/Library/Application Support/nexus-ai/config.json`

```json
{
  "installationId": "uuid",
  "telemetry": {
    "enabled": true
  },
  "wpe": {
    "authenticated": true
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXUS_TELEMETRY` | `0` to disable, `1` to enable |
| `NEXUS_ANALYTICS_ENDPOINT` | Custom telemetry endpoint |
| `DEBUG` | Set to `nexus:*` for debug logs |

## Performance

### SSH ControlMaster

For WPE remote operations, Nexus AI uses SSH ControlMaster to reuse connections.

```bash
# First WP-CLI call: establish connection (~2s)
nexus wp plugin list --install mysite-prod

# Subsequent calls: reuse connection (~200ms)
nexus wp core version --install mysite-prod
nexus wp user list --install mysite-prod
```

**10x faster** than establishing new SSH connections each time.

[Performance Guide →](performance.md)

### Parallel Execution

Bulk operations run in parallel (10 concurrent by default).

```bash
# Update plugins on 50 sites
# Sequential: 50 × 5s = 250s (4min 10s)
# Parallel (10x): 5 × 5s = 25s
nexus wp plugin update --all --bulk
```

## Error Handling

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Authentication error |
| `3` | Not found (site, tool, etc.) |
| `4` | Permission denied |
| `5` | Validation error |

### Error Messages

```bash
# Site not found
$ nexus wp plugin list --site nonexistent
Error: Site not found: nonexistent
Use 'nexus sites' to list available sites.

# Authentication required
$ nexus wpe list
Error: Not authenticated with WP Engine
Run 'nexus wpe auth' to connect your account.
```

[Error Handling →](error-handling.md)

## Examples

### Content Research

```bash
# Find all WooCommerce product content
nexus search "woocommerce products" --type product

# Find posts about a topic
nexus search "wordpress security" --type post --limit 10
```

### Site Management

```bash
# List all WordPress versions across fleet
nexus sites --format json | jq '.[] | {name, wp_version}'

# Check plugin status
nexus wp plugin list --site mysite --status active

# Update specific plugin
nexus wp plugin update akismet --site mysite
```

### WPE Operations

```bash
# List all WPE environments
nexus wpe list

# Diagnose a site
nexus wpe diagnose mysite-prod

# Compare staging vs production
nexus wpe diff mysite-staging mysite-prod

# Promote staging to production
nexus wpe promote mysite-staging
```

### Bulk Operations

```bash
# Get WordPress version on all sites
nexus sites --format json | \
  jq -r '.[].name' | \
  xargs -I {} nexus wp core version --site {}

# Update plugins on all local sites
for site in $(nexus sites --local --format json | jq -r '.[].name'); do
  nexus wp plugin update --all --site $site
done
```

[More Examples →](examples.md)

## MCP Client Setup

Use `nexus mcp setup` to auto-configure any supported client (Local by WP Engine must be running):

### Claude Desktop

```bash
nexus mcp setup --agent claude-desktop --write
```

Then restart Claude Desktop.

[Claude Desktop Setup →](../integrations/claude-desktop.md)

### Cursor IDE

```bash
nexus mcp setup --agent cursor --write
```

Then restart Cursor.

[Cursor Setup →](../integrations/cursor.md)

### Other Clients

```bash
nexus mcp setup --agent windsurf --write    # Windsurf
nexus mcp setup --agent cline --write       # Cline (VS Code)
nexus mcp setup --agent gemini --write      # Gemini CLI
nexus mcp setup --agent claude-code --write # Claude Code
```

[Other Clients →](../integrations/other-mcp-clients.md)

## Troubleshooting

### Common Issues

**1. Command not found**

```bash
# Check installation
which nexus

# Reinstall globally
npm install -g @local-labs-jpollock/local-addon-nexus-ai

# Check PATH
echo $PATH
```

**2. Site not found**

```bash
# List available sites
nexus sites

# Use exact site name
nexus wp plugin list --site "My Site" # Wrong (has spaces)
nexus wp plugin list --site my-site   # Correct (slug)
```

**3. WPE authentication failed**

```bash
# Re-authenticate
nexus wpe logout
nexus wpe auth

# Check Local connection
# Local → Connect → WP Engine
```

[Full Troubleshooting →](troubleshooting.md)

## Next Steps

- [Installation Guide](installation.md) - Install and configure the CLI
- [MCP Setup](mcp-setup.md) - Connect to AI assistants
- [Command Reference](commands.md) - Complete command list
- [Tool Reference](../mcp-tools/index.md) - All 160+ MCP tools
- [Examples](examples.md) - Real-world usage examples
