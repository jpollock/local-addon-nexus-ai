---
title: WP-CLI Commands
description: Run WP-CLI commands on local and WP Engine sites using nexus wp
keywords: [wp-cli, plugin, theme, core, database, post, eval, option, search-replace]
---

# WP-CLI Commands

`nexus wp` runs WP-CLI commands on local sites and remote WP Engine installs through Local's addon layer. You do not need WP-CLI installed separately — the addon invokes it on the correct site automatically.

## Prerequisites

- Local by WP Engine is installed and running
- The Nexus AI addon is active in Local
- The target local site must be **running** for all `nexus wp` commands

---

## Target Syntax

Local sites use the `@local` suffix:

```bash
nexus wp plugin list mysite@local
```

Remote WP Engine installs use the `--install` flag with the install name (not yet implemented as a separate flag — use the WPE target string directly where supported):

```bash
nexus wp plugin list mysite-prod
```

For most commands, the target is the first positional argument. See each subcommand section for the exact form.

---

## Plugin Commands

### List plugins

```bash
nexus wp plugin list mysite@local
nexus wp plugin list mysite@local --status active
nexus wp plugin list mysite@local --json
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--status <status>` | Filter by `active`, `inactive`, or `all` |
| `--json` | Output as JSON |

**Output:**

```
Plugins on mysite@local:
  Name                          Status          Version      Update
  ──────────────────────────────────────────────────────────────────
  WooCommerce                   ✅ active        8.9.0        → 9.0.1
  Contact Form 7                ✅ active        5.9.3
  Hello Dolly                   ⚫ inactive      1.7.2
```

---

### Install plugins

```bash
# Install and activate
nexus wp plugin install mysite@local woocommerce --activate

# Install multiple plugins
nexus wp plugin install mysite@local contact-form-7 akismet
```

---

### Activate and deactivate

```bash
nexus wp plugin activate mysite@local woocommerce
nexus wp plugin deactivate mysite@local hello-dolly
```

Multiple slugs are accepted in a single command and processed in sequence.

---

### Update plugins

```bash
# Update a specific plugin
nexus wp plugin update mysite@local woocommerce

# Update all plugins (preview first)
nexus wp plugin update mysite@local --all --dry-run

# Apply the update
nexus wp plugin update mysite@local --all
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--all` | Update all plugins |
| `--dry-run` | Show what would be updated without making changes |

Specify one or more slugs, or use `--all`. The command exits `1` if neither is provided.

---

## Theme Commands

### List themes

```bash
nexus wp theme list mysite@local
nexus wp theme list mysite@local --json
```

Output is the raw WP-CLI theme list output.

### Activate a theme

```bash
nexus wp theme activate mysite@local twentytwentyfour
```

---

## Core Commands

### Check WordPress version

```bash
nexus wp core version mysite@local
```

**Output:**

```
WordPress 6.5.2
```

### Update WordPress core

```bash
# Update to latest
nexus wp core update mysite@local

# Update to a specific version
nexus wp core update mysite@local --version 6.4.3
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--version <version>` | Target WordPress version |

---

## Database Commands

### Export the database

```bash
# Export to a default filename in the current directory
nexus wp db export mysite@local

# Export to a specific file path
nexus wp db export mysite@local /Users/jane/Backups/mysite.sql
```

Database export has a 5-minute timeout.

### Import a database

```bash
nexus wp db import mysite@local /Users/jane/Backups/mysite.sql
```

Database import has a 5-minute timeout.

### Search and replace

```bash
# Preview replacements
nexus wp db search-replace mysite@local http://mysite.local https://mysite.local --dry-run

# Apply (searches WordPress post tables by default)
nexus wp db search-replace mysite@local http://mysite.local https://mysite.local

# Include all tables
nexus wp db search-replace mysite@local http://mysite.local https://mysite.local --all-tables
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be replaced without making changes |
| `--all-tables` | Search all database tables, not just post tables |

Search-replace has a 5-minute timeout. Use `--dry-run` first for any production database.

### Scan database health

```bash
nexus wp db scan mysite@local
nexus wp db scan mysite@local --json
```

Analyzes the database for bloat and health issues. Reports a health score (0–100), expired transients, post revisions, orphaned metadata, ghost plugin tables, and autoload size.

**Output:**

```
Database Health: mysite@local
  Health Score: 74/100
  WordPress:    6.5.2
  WooCommerce:  active
  Autoload:     1.4 MB

  Issues:
    - 12,450 expired transients (est. 45 MB)
    - 3,200 post revisions (est. 12 MB)
    - 2 ghost plugin tables: wp_redirection_items (Redirection)

  Scan completed in 4382ms
```

A health score of 80 or above is considered healthy. Below 50 is critical.

### Clean database bloat

```bash
# Dry run (default — shows what would be deleted)
nexus wp db clean mysite@local

# Apply — requires confirmation prompt
nexus wp db clean mysite@local --no-dry-run

# Clean specific item types only
nexus wp db clean mysite@local --items "transients,revisions" --no-dry-run
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--no-dry-run` | Actually delete rows (default is dry run) |
| `--items <list>` | Comma-separated item types to clean |
| `--json` | Output as JSON |

`--no-dry-run` requires interactive confirmation. The command prompts:

```
⚠️  This will permanently delete database rows from "mysite@local".
Are you sure? [y/N]
```

Clean is local-only. It does not run on WP Engine installs.

### Fleet database report

```bash
nexus wp db report
nexus wp db report --json
```

Scans all running sites and produces a combined health report. Has a 5-minute timeout.

**Output:**

```
Fleet Database Health Report
Sites scanned: 3

  Site            Score  WP Version   Top Issue
  ────────────────────────────────────────────────────────────
  mysite          95/100  6.5.2        —
  blog            74/100  6.5.2        12,450 expired transients
  store           51/100  6.4.3        3,200 post revisions
```

---

## Post Commands

### Create a post

```bash
nexus wp post create mysite@local --title "Hello World" --status publish
nexus wp post create mysite@local --title "Draft Post" --content "Post body here"
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--title <title>` | (required) | Post title |
| `--content <content>` | | Post content |
| `--status <status>` | `draft` | Post status: `publish`, `draft`, `private` |

### Update a post

```bash
nexus wp post update mysite@local 42 --title "Updated Title"
nexus wp post update mysite@local 42 --status publish
```

The second argument is the post ID.

### Delete a post

```bash
# Move to trash
nexus wp post delete mysite@local 42

# Permanently delete (bypass trash)
nexus wp post delete mysite@local 42 --force
```

---

## User and Option Commands

### List users

```bash
nexus wp user-list mysite@local
nexus wp user-list mysite@local --json
```

Output is the raw WP-CLI user list table.

### Get an option value

```bash
nexus wp option-get mysite@local siteurl
nexus wp option-get mysite@local blogname
```

---

## Site Health

```bash
nexus wp health mysite@local
nexus wp health mysite@local --json
```

Runs WP-CLI's `site health` command and returns the output. Useful for a quick WordPress-native health check without the full Nexus fleet scan.

---

## When WP-CLI Commands Fail

**"Site is not running"** — Start the site first:

```bash
nexus sites start mysite@local
nexus wp plugin list mysite@local
```

**"Site not found"** — Check the exact site name and add `@local`:

```bash
nexus sites list --local-only
nexus wp plugin list mysite@local   # not: nexus wp plugin list mysite
```

**WP-CLI itself fails** — The error from WP-CLI is passed through directly. For example:

```
❌ Error: No such file or directory.
```

This means WP-CLI ran but reported an error. Check the site's WordPress installation is intact.

---

## Chaining Commands

Get site details, run a WP-CLI command, then process the result:

```bash
# 1. Confirm the site is running
nexus sites get mysite@local --json | jq -r '.status'

# 2. List plugins with updates available
nexus wp plugin list mysite@local --json \
  | jq '[.[] | select(.update != null)] | map({name: .name, version: .version, update: .update})'

# 3. Update them
nexus wp plugin update mysite@local --all

# 4. Export a database backup after updating
nexus wp db export mysite@local ~/Backups/mysite-post-update.sql
```

---

## `nexus wp` vs Running WP-CLI Directly

| | `nexus wp` | `wp` (direct) |
|--|-----------|---------------|
| Requires WP-CLI installed | No | Yes |
| Works on any running local site | Yes — by site name | No — requires `cd` to site root |
| Works on remote WPE installs | Future | No |
| Supports `--skip-plugins` / `--skip-themes` | Pass-through via raw command | Yes |

To pass WP-CLI flags like `--skip-plugins`, use the underlying `nexus wp` subcommands that accept raw WP-CLI commands. For example, `plugin update` passes its argument list directly to `wp plugin update`, so WP-CLI flags that the Nexus CLI does not model explicitly are not available through `nexus wp` subcommands.

---

## Next Steps

- [Local Site Management](./local-sites.md) — start, stop, clone, and manage sites
- [Bulk Operations](./bulk-operations.md) — update plugins across multiple sites at once
- [Error Handling](./error-handling.md) — exit codes and recovery
- [Command Reference](./commands.md) — full command tree
