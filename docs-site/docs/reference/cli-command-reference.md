---
title: CLI Command Reference
description: Complete reference for all Nexus AI CLI commands
keywords: [cli, commands, reference, nexus, wordpress, local, wpe]
---

# CLI Command Reference

Complete reference for all Nexus AI CLI commands.

## Global Options

Available on all commands:

| Option | Alias | Description |
|--------|-------|-------------|
| `--help` | `-h` | Show help for command |
| `--version` | `-v` | Show version number |
| `--debug` | | Enable debug logging |
| `--quiet` | `-q` | Suppress non-essential output |
| `--json` | | Output results as JSON |

## Core Commands

### `nexus mcp`

Command group for MCP server management and agent configuration.

```bash
nexus mcp <subcommand> [options]
```

**Subcommands:**

| Subcommand | Description |
|-----------|-------------|
| `status` | Show MCP server status |
| `setup` | Generate or write agent config |

!!! note "Works without Local running"
    `nexus mcp status` and `nexus mcp setup` skip the Local bootstrap and work regardless of whether Local is open.

---

#### `nexus mcp status`

Show the current MCP server status (port, tool count, live connectivity check).

```bash
nexus mcp status
```

**Output:**

```
MCP server: running
Port:       50123
Tools:      88
```

---

#### `nexus mcp setup`

Generate or write the correct MCP configuration for a supported AI agent.

```bash
nexus mcp setup [--agent <name>] [--write]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--agent <name>` | Target agent | Interactive prompt |
| `--write` | Write config to disk (or register with CLI) | `false` (print only) |

**Supported agents:**

| Agent | `--agent` value | `--write` behavior |
|-------|----------------|-------------------|
| Claude Code | `claude-code` | Runs `claude mcp add` |
| Claude Desktop | `claude-desktop` | Writes to `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `cursor` | Writes to `~/.cursor/mcp.json` |
| Windsurf | `windsurf` | Writes to `~/.codeium/windsurf/mcp_config.json` |
| Cline (VS Code) | `cline` | Writes to `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Gemini CLI | `gemini` | Writes to `~/.gemini/settings.json` |

**Usage:**

```bash
# Print config for Claude Desktop (no changes made)
nexus mcp setup --agent claude-desktop

# Write config for Cursor automatically
nexus mcp setup --agent cursor --write

# Register with Claude Code CLI
nexus mcp setup --agent claude-code --write
```

**All agents use the stdio bridge** (`bin/mcp-stdio.js`), not an HTTP URL. The generated config always uses `"command": "node"` with the absolute path to the bridge.

**Environment Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXUS_DEBUG` | Enable debug logging | `false` |
| `NEXUS_DB_PATH` | Custom database path | `~/.nexus/nexus.db` |
| `NEXUS_TELEMETRY` | Enable telemetry | `true` |

---

### `nexus scan`

Scan WordPress sites and index content into vector database.

```bash
nexus scan [site] [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[site]` | Site ID or name (optional, scans all if omitted) |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force re-scan even if recently scanned | `false` |
| `--local-only` | Scan local sites only | `false` |
| `--wpe-only` | Scan WP Engine sites only | `false` |
| `--parallel <n>` | Number of parallel scans | `10` |

**Usage:**

```bash
# Scan all sites
nexus scan

# Scan specific site
nexus scan mysite

# Scan all local sites
nexus scan --local-only

# Force re-scan with custom parallelization
nexus scan --force --parallel 5
```

**Output:**

```
Scanning 25 sites...

✓ mysite (5,432 posts) - 12.3s
✓ blog (1,234 posts) - 4.2s
✓ shop (8,901 products) - 18.7s
...

Completed 25 sites in 2m 34s
Total indexed: 45,678 documents (123MB)
```

**What Gets Indexed:**

- ✅ Posts & pages (title, content, excerpt, meta)
- ✅ WooCommerce products (price, SKU, stock, attributes)
- ✅ ACF fields (text, textarea, repeater, group, flexible)
- ✅ Media attachments (alt text, captions)
- ✅ Themes & plugins (name, version, description)
- ✅ Users (username, roles — no PII)
- ✅ Site configuration (WP version, PHP version, permalink structure)

**Performance:**

| Site Size | Scan Time | Index Size |
|-----------|-----------|------------|
| Small (100 posts) | ~2 seconds | ~500KB |
| Medium (1,000 posts) | ~5 seconds | ~5MB |
| Large (10,000 posts) | ~20 seconds | ~50MB |
| E-commerce (5,000 products) | ~15 seconds | ~25MB |

---

### `nexus search`

Search indexed content using semantic vector search.

```bash
nexus search <query> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<query>` | Search query (required) |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--site <site>` | Limit to specific site | - |
| `--type <type>` | Filter by content type | `all` |
| `--limit <n>` | Max results to return | `10` |
| `--threshold <n>` | Similarity threshold (0-1) | `0.7` |

**Content Types:**

- `post` — Blog posts
- `page` — Pages
- `product` — WooCommerce products
- `attachment` — Media files
- `all` — All content types

**Usage:**

```bash
# Basic search
nexus search "how to optimize images"

# Search specific site
nexus search "shipping options" --site shop

# Search products only
nexus search "blue widgets" --type product

# Get top 20 results with lower threshold
nexus search "performance tips" --limit 20 --threshold 0.6
```

**Output:**

```json
{
  "query": "how to optimize images",
  "results": [
    {
      "site": "blog",
      "type": "post",
      "title": "WordPress Image Optimization Guide",
      "url": "https://blog.local/optimize-images",
      "excerpt": "Learn how to compress and lazy-load images...",
      "score": 0.92,
      "post_id": 123
    },
    {
      "site": "blog",
      "type": "post",
      "title": "WebP Conversion for WordPress",
      "url": "https://blog.local/webp-images",
      "excerpt": "Converting images to WebP format reduces...",
      "score": 0.88,
      "post_id": 456
    }
  ],
  "total": 2,
  "time_ms": 42
}
```

**Semantic Search vs Keyword Search:**

| Query | Keyword Search | Semantic Search |
|-------|----------------|-----------------|
| "optimize images" | Exact phrase match | Image compression, lazy loading, WebP, CDN |
| "speed up site" | "speed" or "site" | Performance, caching, optimization, minification |
| "sell products" | "sell" or "products" | E-commerce, WooCommerce, payment gateways, checkout |

---

### `nexus list`

List WordPress sites (local and WP Engine).

```bash
nexus list [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--local` | Show local sites only | `false` |
| `--wpe` | Show WP Engine sites only | `false` |
| `--running` | Show running sites only | `false` |
| `--halted` | Show halted sites only | `false` |
| `--format <fmt>` | Output format (`table`, `json`, `csv`) | `table` |

**Usage:**

```bash
# List all sites
nexus list

# List only running local sites
nexus list --local --running

# Export to JSON
nexus list --format json > sites.json

# Export to CSV
nexus list --format csv > sites.csv
```

**Output (table format):**

```
Local Sites (15)
┌─────────────┬────────────────────────┬──────────┬────────────┬──────────┐
│ Name        │ Domain                 │ Status   │ WP Version │ Host     │
├─────────────┼────────────────────────┼──────────┼────────────┼──────────┤
│ mysite      │ mysite.local           │ running  │ 6.4.3      │ wpe      │
│ blog        │ blog.local             │ running  │ 6.4.2      │ -        │
│ shop        │ shop.local             │ halted   │ 6.3.1      │ flywheel │
└─────────────┴────────────────────────┴──────────┴────────────┴──────────┘

WP Engine Sites (8)
┌─────────────┬─────────────┬─────────────────────────────┬──────────┐
│ Name        │ Environment │ Domain                      │ Status   │
├─────────────┼─────────────┼─────────────────────────────┼──────────┤
│ mysite      │ production  │ mysite.wpengine.com         │ active   │
│ mysite      │ staging     │ mysite.wpenginepowered.com  │ active   │
│ blog        │ production  │ blog.com                    │ active   │
└─────────────┴─────────────┴─────────────────────────────┴──────────┘
```

**Output (JSON format):**

```json
{
  "local": [
    {
      "id": "abc123",
      "name": "mysite",
      "domain": "mysite.local",
      "status": "running",
      "wp_version": "6.4.3",
      "host": "wpe",
      "path": "/Users/me/Local Sites/mysite"
    }
  ],
  "wpe": [
    {
      "name": "mysite",
      "environment": "production",
      "domain": "mysite.wpengine.com",
      "status": "active",
      "install_id": "abc123xyz"
    }
  ]
}
```

---

### `nexus plugin`

Manage WordPress plugins on local and remote sites.

```bash
nexus plugin <action> [options]
```

**Actions:**

| Action | Description |
|--------|-------------|
| `list` | List installed plugins |
| `activate` | Activate a plugin |
| `deactivate` | Deactivate a plugin |
| `install` | Install a plugin |
| `update` | Update plugins |
| `search` | Search WordPress.org plugins |

#### `nexus plugin list`

List installed plugins.

```bash
nexus plugin list <site> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--status <status>` | Filter by status (`active`, `inactive`, `all`) | `all` |
| `--updates` | Show only plugins with updates | `false` |

**Usage:**

```bash
# List all plugins
nexus plugin list mysite

# List active plugins only
nexus plugin list mysite --status active

# List plugins with updates
nexus plugin list mysite --updates
```

**Output:**

```
Plugins on mysite (15 total, 12 active)

Active Plugins:
✓ Akismet Anti-Spam 5.3 (update available: 5.3.1)
✓ Yoast SEO 21.9
✓ WooCommerce 8.5.2
...

Inactive Plugins:
○ Classic Editor 1.6.3
○ Hello Dolly 1.7.2
...

3 updates available (use --updates to see details)
```

#### `nexus plugin activate`

Activate a plugin.

```bash
nexus plugin activate <site> <plugin>
```

**Usage:**

```bash
# Activate by slug
nexus plugin activate mysite akismet

# Activate by path
nexus plugin activate mysite akismet/akismet.php
```

**Output:**

```
✓ Activated akismet on mysite
```

#### `nexus plugin deactivate`

Deactivate a plugin.

```bash
nexus plugin deactivate <site> <plugin>
```

**Usage:**

```bash
# Deactivate plugin
nexus plugin deactivate mysite akismet
```

**Output:**

```
✓ Deactivated akismet on mysite
```

#### `nexus plugin install`

Install a plugin from WordPress.org.

```bash
nexus plugin install <site> <plugin> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--activate` | Activate after install | `false` |
| `--version <ver>` | Install specific version | `latest` |

**Usage:**

```bash
# Install plugin
nexus plugin install mysite akismet

# Install and activate
nexus plugin install mysite akismet --activate

# Install specific version
nexus plugin install mysite akismet --version 5.3
```

**Output:**

```
Downloading akismet 5.3.1...
Installing...
✓ Installed akismet 5.3.1 on mysite
```

#### `nexus plugin update`

Update plugins.

```bash
nexus plugin update <site> [plugin] [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--all` | Update all plugins | `false` |
| `--dry-run` | Show what would be updated | `false` |

**Usage:**

```bash
# Update specific plugin
nexus plugin update mysite akismet

# Update all plugins
nexus plugin update mysite --all

# Dry run (check for updates)
nexus plugin update mysite --all --dry-run
```

**Output:**

```
Updating plugins on mysite...

✓ akismet 5.3 → 5.3.1
✓ yoast-seo 21.8 → 21.9
○ woocommerce (already latest)

Updated 2 plugins, 1 already latest
```

---

### `nexus wp`

Execute WP-CLI commands on local or remote sites.

```bash
nexus wp <site> <command> [args...]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<site>` | Site ID or install name |
| `<command>` | WP-CLI command |
| `[args...]` | Command arguments |

**Usage:**

```bash
# Get WordPress version
nexus wp mysite core version

# List users
nexus wp mysite user list

# Get option value
nexus wp mysite option get siteurl

# Export database
nexus wp mysite db export

# Run custom command
nexus wp mysite eval "echo wp_get_theme()->get('Version');"
```

**Remote Sites (WP Engine):**

```bash
# Works the same on WPE installs
nexus wp mysite-production core version

# SSH connection is automatic
nexus wp mysite-staging plugin list
```

**Output:**

```bash
$ nexus wp mysite core version
6.4.3

$ nexus wp mysite user list --format=table
+----+----------+------------------+
| ID | user_login | user_email     |
+----+----------+------------------+
| 1  | admin    | admin@mysite.local |
+----+----------+------------------+
```

**Blocked Commands (remote only):**

For security, these commands are blocked on remote WP Engine sites:

- `db query`
- `eval`
- `eval-file`
- `shell`

---

### `nexus wp db`

Scan and clean WordPress site databases. These are subcommands of `nexus wp` focused on database health.

```bash
nexus wp db <subcommand> <site> [options]
```

#### `nexus wp db scan`

Scan a site's database and print a health report.

```bash
nexus wp db scan <site>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<site>` | Site ID or name |

**Usage:**

```bash
# Scan a single site
nexus wp db scan mysite

# Output as JSON
nexus wp db scan mysite --json
```

**Output:**

```
Database Health — mysite
─────────────────────────────────────────────
  Post revisions:       1,204 rows  (~18 MB)
  Expired transients:     892 rows  (~4 MB)
  Orphaned postmeta:      341 rows  (~1 MB)
  Spam/trash comments:    120 rows
  Auto-draft posts:        14 rows

WooCommerce:
  Stale sessions:         567 rows  (~6 MB)
  Orphaned order meta:    203 rows

Estimated savings: ~29 MB
Run 'nexus wp db clean mysite --dry-run' for a cleanup preview.
```

---

#### `nexus wp db clean`

Clean database bloat on a site. **Defaults to `--dry-run`** — no changes are made until you remove that flag.

```bash
nexus wp db clean <site> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<site>` | Site ID or name |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--dry-run` | Preview changes without deleting | `true` |
| `--items <list>` | Comma-separated categories to clean | all detected |

**Valid categories for `--items`:**

| Category | What Gets Deleted |
|----------|-------------------|
| `revisions` | Excess post revisions |
| `transients` | Expired transients from `wp_options` |
| `orphaned_postmeta` | Post meta for deleted posts |
| `spam_comments` | Spam and trashed comments |
| `auto_drafts` | Abandoned autosave drafts |
| `orphaned_termmeta` | Term meta for deleted terms |
| `woo_sessions` | Stale WooCommerce cart sessions |
| `woo_order_meta` | Orphaned meta for deleted orders |
| `woo_variation_meta` | Meta for removed product variations |

**Usage:**

```bash
# Preview everything (default dry-run)
nexus wp db clean mysite --dry-run

# Clean specific categories (still dry-run by default)
nexus wp db clean mysite --items revisions,transients --dry-run

# Apply cleanup after reviewing
nexus wp db clean mysite --items revisions,transients

# Clean all detected items
nexus wp db clean mysite
```

**Output (dry run):**

```
Cleanup Preview — mysite (DRY RUN)

  revisions:    1,204 rows would be deleted (~18 MB)
  transients:     892 rows would be deleted (~4 MB)

Total: 2,096 rows, ~22 MB savings
Run without --dry-run to apply.
```

**Output (live):**

```
Cleanup complete — mysite

  revisions:    1,204 rows deleted (~18 MB freed)
  transients:     892 rows deleted (~4 MB freed)

Total: 2,096 rows deleted, ~22 MB freed
```

---

#### `nexus wp db report`

Print the saved health report from the most recent scan of a site.

```bash
nexus wp db report <site>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<site>` | Site ID or name |

**Usage:**

```bash
nexus wp db report mysite
```

**Output:** Same format as `nexus wp db scan`. If no scan has been run yet, you are prompted to run one.

---

### `nexus wpe`

Manage WP Engine sites and environments.

```bash
nexus wpe <action> [options]
```

**Actions:**

| Action | Description |
|--------|-------------|
| `status` | Check WPE authentication status |
| `accounts` | List WPE accounts |
| `installs` | List WPE installs |
| `diagnose` | Diagnose site health |
| `diff` | Compare environments |
| `backup` | Create backup |
| `promote` | Promote staging to production |
| `usage` | Show bandwidth/storage/visitor metrics for an install |
| `account-usage` | Show bandwidth/storage/visitor metrics for an account |

#### `nexus wpe status`

Check WP Engine authentication status.

```bash
nexus wpe status
```

**Output (authenticated):**

```
WP Engine: authenticated
User:      you@example.com
```

**Output (not authenticated):**

```
WP Engine: not authenticated
Run 'nexus wpe login' to authenticate.
```

#### `nexus wpe accounts`

List WP Engine accounts.

```bash
nexus wpe accounts [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--format <fmt>` | Output format (`table`, `json`) | `table` |

**Usage:**

```bash
# List accounts
nexus wpe accounts

# JSON output
nexus wpe accounts --format json
```

**Output:**

```
WP Engine Accounts (3)
┌─────────────┬────────────┬────────┬────────────────┐
│ Account     │ Plan       │ Installs │ Bandwidth/mo  │
├─────────────┼────────────┼────────┼────────────────┤
│ my-agency   │ Growth     │ 12     │ 200GB / 400GB │
│ client-one  │ Startup    │ 3      │ 45GB / 50GB   │
│ client-two  │ Professional │ 8    │ 120GB / 200GB │
└─────────────┴────────────┴────────┴────────────────┘
```

#### `nexus wpe installs`

List WP Engine installs.

```bash
nexus wpe installs [account] [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--environment <env>` | Filter by environment | `all` |
| `--format <fmt>` | Output format | `table` |

**Usage:**

```bash
# List all installs
nexus wpe installs

# List installs for account
nexus wpe installs my-agency

# List production only
nexus wpe installs --environment production
```

**Output:**

```
WP Engine Installs (8)
┌─────────────┬─────────────┬─────────────────────────────┬──────────┐
│ Name        │ Environment │ Domain                      │ Status   │
├─────────────┼─────────────┼─────────────────────────────┼──────────┤
│ mysite      │ production  │ mysite.wpengine.com         │ active   │
│ mysite      │ staging     │ mysite.wpenginepowered.com  │ active   │
│ blog        │ production  │ blog.com                    │ active   │
└─────────────┴─────────────┴─────────────────────────────┴──────────┘
```

#### `nexus wpe diagnose`

Run comprehensive site health check.

```bash
nexus wpe diagnose <install>
```

**Usage:**

```bash
nexus wpe diagnose mysite-production
```

**Output:**

```
Diagnosing mysite-production...

✓ SSL Certificate
  - Valid until: 2026-12-31
  - Issuer: Let's Encrypt
  - Grade: A+

✓ Backups
  - Last backup: 2 hours ago
  - Retention: 30 days
  - Next backup: in 22 hours

✓ Performance
  - Cache hit rate: 94.2%
  - Avg response time: 142ms
  - PHP version: 8.2

✓ Bandwidth
  - Used: 45GB / 200GB (22.5%)
  - Overage: No

⚠ Disk Usage
  - Used: 1.8GB / 2.0GB (90%)
  - Warning: Approaching limit

✓ PHP Errors
  - No recent errors

Overall: 1 warning, 0 errors
```

#### `nexus wpe diff`

Compare staging and production environments.

```bash
nexus wpe diff <site>
```

**Usage:**

```bash
nexus wpe diff mysite
```

**Output:**

```
Comparing mysite-staging → mysite-production

WordPress Core:
  staging:    6.4.3
  production: 6.4.2
  → Update available

Themes:
  ✓ twentytwentyfour: 1.0 (same)

Plugins:
  ⚠ akismet: 5.3.1 → 5.3 (staging ahead)
  ⚠ yoast-seo: 21.9 → 21.8 (staging ahead)
  ✓ woocommerce: 8.5.2 (same)

Database:
  staging:    125 posts, 8 pages
  production: 120 posts, 8 pages
  → 5 new posts on staging

Files:
  staging:    1,245 files (850MB)
  production: 1,240 files (845MB)
  → 5 new files on staging

Safe to promote: YES (no conflicts detected)
```

#### `nexus wpe backup`

Create backup of WP Engine install.

```bash
nexus wpe backup <install> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--description <desc>` | Backup description | - |
| `--notification-emails <emails>` | Comma-separated emails | - |

**Usage:**

```bash
# Create backup
nexus wpe backup mysite-production

# With description
nexus wpe backup mysite-production --description "Pre-deployment backup"

# With email notification
nexus wpe backup mysite-production --notification-emails admin@mysite.com
```

**Output:**

```
Creating backup of mysite-production...

✓ Backup created
  ID: backup_abc123
  Description: Pre-deployment backup
  Size: 1.2GB
  Created: 2026-03-20 10:30 PST

Backup will be available in ~5-10 minutes.
```

#### `nexus wpe promote`

Promote staging to production (with safety checks).

```bash
nexus wpe promote <site> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--skip-backup` | Skip pre-promotion backup | `false` |
| `--force` | Skip safety checks | `false` |

**Usage:**

```bash
# Promote with safety checks
nexus wpe promote mysite

# Skip pre-promotion backup
nexus wpe promote mysite --skip-backup

# Force promotion (skip checks)
nexus wpe promote mysite --force
```

**Output:**

```
Promoting mysite-staging → mysite-production

Pre-flight checks:
✓ Staging is active
✓ Production is active
✓ No ongoing maintenance
✓ Backup retention: 30 days
✓ Differences detected: 5 new posts, 2 plugin updates

Creating pre-promotion backup...
✓ Backup created (backup_xyz789)

Promoting environment...
✓ Files copied
✓ Database synced
✓ Cache cleared

Promotion complete!
  - Production is now running staging code
  - Rollback available: nexus wpe rollback mysite backup_xyz789
```

#### `nexus wpe usage`

Show bandwidth, storage, and visitor metrics for a WP Engine install.

```bash
nexus wpe usage <installId> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<installId>` | WP Engine install ID or name |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--month-offset <n>` | Months back from current (`0` = this month, `1` = last month) | `0` |
| `--json` | Output as JSON | `false` |

**Usage:**

```bash
# Current month usage
nexus wpe usage mysite-production

# Last month usage
nexus wpe usage mysite-production --month-offset 1

# JSON output
nexus wpe usage mysite-production --json
```

**Output:**

```
Usage — mysite-production (March 2026)

  Bandwidth:  12.4 GB
  Storage:    1.8 GB
  Visitors:   24,531
```

**Caching:** Current month is cached for 1 hour; past months are cached for 24 hours.

---

#### `nexus wpe account-usage`

Show bandwidth, storage, and visitor metrics aggregated for a WP Engine account.

```bash
nexus wpe account-usage <accountId> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<accountId>` | WP Engine account ID |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--month-offset <n>` | Months back from current (`0` = this month, `1` = last month) | `0` |
| `--json` | Output as JSON | `false` |

**Usage:**

```bash
# Current month account usage
nexus wpe account-usage my-agency

# Last month as JSON
nexus wpe account-usage my-agency --month-offset 1 --json
```

**Output:**

```
Account Usage — my-agency (March 2026)

  Bandwidth:  84.7 GB
  Storage:    14.2 GB
  Visitors:   182,045
```

---

### `nexus telemetry`

Manage telemetry and analytics.

```bash
nexus telemetry <action>
```

**Actions:**

| Action | Description |
|--------|-------------|
| `status` | Show telemetry status |
| `enable` | Enable telemetry |
| `disable` | Disable telemetry |
| `clear` | Clear all telemetry data |
| `reset` | Reset installation ID |

#### `nexus telemetry status`

Show current telemetry status.

```bash
nexus telemetry status
```

**Output:**

```
Telemetry Status:
  Enabled: Yes
  Installation ID: 12345678-1234-1234-1234-123456789abc
  Events collected: 1,234
  Last sync: 2 hours ago

What's collected:
  ✓ Tool usage counts
  ✓ Success/error rates
  ✓ System info (OS, Node version)

What's NOT collected:
  ✗ User identities
  ✗ Site names or domains
  ✗ WordPress content
  ✗ Command arguments
```

#### `nexus telemetry disable`

Disable telemetry collection.

```bash
nexus telemetry disable
```

**Output:**

```
✓ Telemetry disabled

  No more data will be collected.
  Existing data remains on device until cleared.
```

#### `nexus telemetry enable`

Enable telemetry collection.

```bash
nexus telemetry enable
```

**Output:**

```
✓ Telemetry enabled

  Anonymous usage data will be collected to improve Nexus AI.
  View what's collected: nexus telemetry status
```

#### `nexus telemetry clear`

Clear all collected telemetry data.

```bash
nexus telemetry clear
```

**Output:**

```
✓ Cleared 1,234 telemetry events

  All local telemetry data has been deleted.
  Installation ID preserved.
```

#### `nexus telemetry reset`

Reset installation ID (generates new anonymous ID).

```bash
nexus telemetry reset
```

**Output:**

```
✓ Installation ID reset

  Old ID: 12345678-1234-1234-1234-123456789abc
  New ID: 87654321-4321-4321-4321-cba987654321

  All telemetry events cleared.
```

---

## Bulk Operations

### `nexus bulk`

Execute operations across multiple sites in parallel.

```bash
nexus bulk <operation> [sites] [options]
```

**Operations:**

| Operation | Description |
|-----------|-------------|
| `scan` | Scan multiple sites |
| `update-plugins` | Update plugins on multiple sites |
| `update-core` | Update WordPress core |
| `activate-plugin` | Activate plugin on multiple sites |
| `deactivate-plugin` | Deactivate plugin on multiple sites |

**Site Targeting:**

| Option | Description |
|--------|-------------|
| `--all` | All sites |
| `--local` | All local sites |
| `--wpe` | All WP Engine sites |
| `--sites <list>` | Comma-separated site list |
| `--running` | Running sites only |

**Usage:**

```bash
# Update plugins on all running local sites
nexus bulk update-plugins --local --running

# Activate plugin on specific sites
nexus bulk activate-plugin --sites mysite,blog,shop -- akismet

# Update WordPress core on all sites
nexus bulk update-core --all

# Scan all WPE sites with custom parallelization
nexus bulk scan --wpe --parallel 5
```

**Output:**

```
Bulk operation: update-plugins
Sites: 15 local running sites
Parallelism: 10

Progress:
✓ mysite (3 updates)
✓ blog (1 update)
⚠ shop (2 updates, 1 failed)
...

Completed 15 sites in 1m 23s
Success: 14 sites
Failed: 1 site (shop: woocommerce update failed)
```

---

### `nexus ai`

AI provider configuration and WordPress AI connector management.

---

#### `nexus ai config`

View or configure the global AI provider used by Nexus AI's Nexus AI features, e.g. Site Finder.

```bash
nexus ai config [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--gateway <on\|off>` | Enable or disable Local AI Gateway globally |

**Interactive mode** (no flags): prompts to select provider, enter API key, and pick a model.

**Examples:**

```bash
# Interactive provider setup
nexus ai config

# Enable Local AI Gateway
nexus ai config --gateway on

# Disable Local AI Gateway
nexus ai config --gateway off
```

---

#### `nexus ai setup`

Set up AI on a WordPress site. Installs the AI plugin, configures the chosen provider, and syncs credentials.

```bash
nexus ai setup <site> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `site` | Site target (e.g. `mysite@local`) |

**Options:**

| Option | Description |
|--------|-------------|
| `--provider <id>` | Provider to configure (`anthropic`, `openai`, `google`, `ollama`). Skips interactive prompt. |
| `--force` | Force re-setup even if already configured |

**Examples:**

```bash
# Interactive — prompts for provider
nexus ai setup mysite@local

# Non-interactive
nexus ai setup mysite@local --provider anthropic

# Force re-setup with gateway enabled (set in Preferences first)
nexus ai setup mysite@local --force
```

---

#### `nexus ai switch-provider`

Switch the AI provider on an already-configured site. Deactivates the old provider plugin, installs and activates the new one, and syncs the appropriate credentials.

```bash
nexus ai switch-provider <site>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `site` | Site target (e.g. `mysite@local`) |

**Example:**

```bash
nexus ai switch-provider mysite@local
# Prompts: Current: Anthropic. Switch to: 1. OpenAI  2. Google  3. Ollama
```

---

#### `nexus ai site-config`

Show the current AI provider configuration for a site.

```bash
nexus ai site-config <site>
```

**Example output:**

```
mysite@local — AI Configuration
─────────────────────────────────────────────
  Provider:  Anthropic (Claude)
  Model:     claude-sonnet-4-6
  Set up:    3/27/2026
```

---

#### `nexus ai sync-credentials`

Manually sync AI credentials to a WordPress site. Normally this happens automatically on site start.

```bash
nexus ai sync-credentials <site>
```

---

#### `nexus ai models`

List available Ollama models.

```bash
nexus ai models [--json]
```

---

#### `nexus ai status`

Show AI connector status on a WordPress site.

```bash
nexus ai status <target>
```

---

#### `nexus ai ask`

Ask Ollama a question directly.

```bash
nexus ai ask <query> [--model <model>]
```

---

## Advanced Commands

### `nexus config`

Manage Nexus AI configuration.

```bash
nexus config <action> [key] [value]
```

**Actions:**

| Action | Description |
|--------|-------------|
| `get` | Get config value |
| `set` | Set config value |
| `list` | List all config |
| `reset` | Reset to defaults |

**Configuration Keys:**

| Key | Description | Default |
|-----|-------------|---------|
| `db.path` | Database file path | `~/.nexus/nexus.db` |
| `ai.provider` | AI provider for embeddings | `ollama` |
| `ai.model` | Embedding model | `nomic-embed-text` |
| `telemetry.enabled` | Enable telemetry | `true` |
| `scan.parallel` | Parallel scan limit | `10` |
| `wpe.ssh.control_master` | SSH ControlMaster | `true` |

**Usage:**

```bash
# Get config value
nexus config get ai.provider

# Set config value
nexus config set scan.parallel 5

# List all config
nexus config list

# Reset to defaults
nexus config reset
```

---

### `nexus db`

Manage local vector database.

```bash
nexus db <action> [options]
```

**Actions:**

| Action | Description |
|--------|-------------|
| `info` | Show database info |
| `optimize` | Optimize database |
| `export` | Export database |
| `import` | Import database |
| `reset` | Reset database |

#### `nexus db info`

Show database information.

```bash
nexus db info
```

**Output:**

```
Database: /Users/me/.nexus/nexus.db
Size: 245MB
Documents: 45,678
Vectors: 123,456
Tables:
  - documents (45,678 rows)
  - embeddings (123,456 rows)
  - sites (25 rows)
  - scans (157 rows)
Last optimized: 3 days ago
```

#### `nexus db optimize`

Optimize database (VACUUM, rebuild indices).

```bash
nexus db optimize
```

**Output:**

```
Optimizing database...
✓ VACUUM completed (freed 12MB)
✓ Rebuilt indices
✓ Analyzed query plans

Before: 245MB
After: 233MB
Saved: 12MB (4.9%)
```

#### `nexus db export`

Export database to portable format.

```bash
nexus db export <file> [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--compress` | Compress with gzip | `false` |

**Usage:**

```bash
# Export database
nexus db export nexus-backup.db

# Export and compress
nexus db export nexus-backup.db.gz --compress
```

**Output:**

```
Exporting database to nexus-backup.db.gz...
✓ Exported 45,678 documents
✓ Compressed 233MB → 45MB (80.6% reduction)

Backup saved: nexus-backup.db.gz
```

#### `nexus db import`

Import database from backup.

```bash
nexus db import <file>
```

**Usage:**

```bash
# Import database
nexus db import nexus-backup.db

# Import compressed backup
nexus db import nexus-backup.db.gz
```

**Output:**

```
Importing database from nexus-backup.db.gz...
⚠ This will overwrite existing database

Proceed? (y/N): y

✓ Decompressed 45MB → 233MB
✓ Imported 45,678 documents
✓ Verified integrity

Database restored successfully
```

#### `nexus db reset`

Reset database (delete all data).

```bash
nexus db reset [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--yes` | Skip confirmation | `false` |

**Usage:**

```bash
# Reset database
nexus db reset

# Skip confirmation
nexus db reset --yes
```

**Output:**

```
⚠ WARNING: This will delete ALL indexed data!

Sites: 25
Documents: 45,678
Size: 233MB

This action CANNOT be undone.

Type 'DELETE' to confirm: DELETE

Resetting database...
✓ Deleted all documents
✓ Dropped all tables
✓ Recreated schema

Database reset complete.
Run 'nexus scan' to re-index sites.
```

---

## Exit Codes

Nexus AI uses standard exit codes:

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments |
| `3` | Site not found |
| `4` | WP-CLI error |
| `5` | Network error |
| `6` | Authentication required |
| `7` | Permission denied |
| `8` | Database error |

**Usage in scripts:**

```bash
#!/bin/bash

nexus scan mysite
if [ $? -eq 0 ]; then
  echo "Scan successful"
else
  echo "Scan failed"
  exit 1
fi
```

---

## Shell Completion

Enable shell completion for faster command entry.

### Bash

```bash
# Add to ~/.bashrc
eval "$(nexus completion bash)"
```

### Zsh

```bash
# Add to ~/.zshrc
eval "$(nexus completion zsh)"
```

### Fish

```bash
# Add to ~/.config/fish/config.fish
nexus completion fish | source
```

**Features:**

- Command completion
- Option completion
- Site name completion
- Plugin slug completion

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXUS_DEBUG` | Enable debug logging | `false` |
| `NEXUS_DB_PATH` | Custom database path | `~/.nexus/nexus.db` |
| `NEXUS_TELEMETRY` | Enable telemetry | `true` |
| `NEXUS_AI_PROVIDER` | AI provider | `ollama` |
| `NEXUS_AI_MODEL` | Embedding model | `nomic-embed-text` |
| `NEXUS_PARALLEL` | Parallel operation limit | `10` |
| `NO_COLOR` | Disable color output | `false` |

**Usage:**

```bash
# Disable telemetry
NEXUS_TELEMETRY=false nexus scan

# Custom database path
NEXUS_DB_PATH=/tmp/nexus.db nexus mcp

# Debug mode
NEXUS_DEBUG=true nexus scan mysite
```

---

## Examples

### Daily Site Maintenance

```bash
#!/bin/bash
# daily-maintenance.sh

# Scan all sites
nexus scan --force

# Update plugins on all running sites
nexus bulk update-plugins --local --running

# Check for WP core updates
nexus bulk update-core --all --dry-run

# Generate report
nexus list --format json > sites-report.json
```

### Pre-Deployment Checklist

```bash
#!/bin/bash
# pre-deploy.sh

SITE=$1

# Create backup
nexus wpe backup ${SITE}-production

# Compare environments
nexus wpe diff $SITE

# Run diagnostics
nexus wpe diagnose ${SITE}-staging

# If all clear, promote
read -p "Promote to production? (y/N): " confirm
if [ "$confirm" = "y" ]; then
  nexus wpe promote $SITE
fi
```

### Fleet Health Check

```bash
#!/bin/bash
# health-check.sh

# Check all sites
for site in $(nexus list --format json | jq -r '.local[].name'); do
  echo "Checking $site..."
  nexus wp $site core verify-checksums
  nexus wp $site plugin verify-checksums --all
done

# Generate summary
echo "Health check complete"
```

---

## Next Steps

- [CLI Examples](../cli/examples.md) - Real-world usage patterns
- [MCP Setup](../cli/mcp-setup.md) - Connect to AI assistants
- [Tool Reference](../mcp-tools/index.md) - All 160+ MCP tools
- Error Codes - Troubleshooting guide
