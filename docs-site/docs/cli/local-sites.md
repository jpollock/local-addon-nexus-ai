---
title: Local Site Management
description: Create, start, stop, delete, and configure local WordPress sites via the Nexus CLI
keywords: [local sites, create, start, stop, restart, delete, export, clone, php, xdebug]
---

# Local Site Management

Manage all aspects of your local WordPress sites from the command line. Every command that operates on a local site requires the `@local` suffix on the site name.

## Prerequisites

- Local by WP Engine is installed and running
- The Nexus AI addon is active in Local

## Site Target Syntax

Local site commands use the `@local` suffix to identify local sites:

```
mysite@local
blog@local
woostore@local
```

The suffix is required — commands that accept only local sites will reject bare names and suggest the correct form.

---

## Listing and Inspecting Sites

### `nexus sites list`

List all local sites and any linked WP Engine installs.

```bash
nexus sites list
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--local-only` | Show only local sites |
| `--wpe-only` | Show only WP Engine installs |
| `--json` | Output as JSON |

**Output:**

```
Local Sites:
  🟢 mysite (running) → wpe:acmeco/mysite-prod@production
  🟢 blog (running) → not linked
  ⚫ woostore (halted) → not linked

WPE Sites:
  mysite-prod (production)
    Target: wpe:acmeco/mysite-prod@production
    Domain: mysite-prod.wpengine.com
```

---

### `nexus sites get <site>`

Get detailed information about a specific site.

```bash
nexus sites get mysite@local
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

**Output:**

```
mysite
────────────────────────────────────────
Status:       🟢 Running
Domain:       mysite.local
Path:         /Users/jane/Local Sites/mysite
WordPress:    6.5.2
PHP:          8.2
Indexed:      Yes (5,432 docs, 21,804 chunks)
Last indexed: 4/13/2026, 9:12:04 AM
WPE Link:     mysite-prod@production
```

The `target` argument also accepts a bare site name (without `@local`) for this command.

---

## Starting and Stopping Sites

All lifecycle commands require `@local` or a bare name — they operate on local sites only.

### `nexus sites start <site>`

Start a halted local site.

```bash
nexus sites start mysite@local
```

**Output:**

```
Starting site: mysite@local...

Site started: mysite
  Status: running
```

---

### `nexus sites stop <site>`

Stop a running local site.

```bash
nexus sites stop mysite@local
```

---

### `nexus sites restart <site>`

Stop and start a site in one step. Use this after changing PHP version or configuration.

```bash
nexus sites restart mysite@local
```

---

## Creating Sites

### `nexus sites create <name>@local`

Create a new local WordPress site.

```bash
nexus sites create myblog@local
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--blueprint <name>` | Create from a saved Local blueprint |
| `--php <version>` | PHP version (e.g., `8.2`, `8.1`, `7.4`) |
| `--wp <version>` | WordPress version (e.g., `6.5`, `6.4`) |

**Examples:**

```bash
# Create with default settings
nexus sites create myblog@local

# Create with specific PHP and WordPress versions
nexus sites create myblog@local --php 8.2 --wp 6.5

# Create from a blueprint
nexus sites create myblog@local --blueprint "WooCommerce Starter"
```

**Output:**

```
Creating site: myblog...

Site created: myblog
  Domain: myblog.local

Start the site: nexus sites start myblog@local
```

Site creation takes up to 2 minutes. The site is halted after creation — start it with `nexus sites start`.

---

## Deleting Sites

### `nexus sites delete <site>`

Delete a local site and all its files. This is permanent.

```bash
nexus sites delete mysite@local
```

Without `--force`, the command prompts for confirmation:

```
Delete site mysite@local? This cannot be undone. (y/N):
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--force` | Skip the confirmation prompt |

**Scripted deletion (no prompt):**

```bash
nexus sites delete mysite@local --force
```

---

## Cloning and Renaming

### `nexus sites clone <source>@local <newName>`

Clone a local site, including its database and files.

```bash
nexus sites clone mysite@local mysite-staging
```

**Output:**

```
Cloning mysite@local → mysite-staging...

Site cloned successfully
  Name: mysite-staging
  ID:   abc123def456

Start the cloned site:
   nexus sites start mysite-staging@local
```

Cloning can take up to 5 minutes depending on site size. The cloned site is halted after creation.

---

### `nexus sites rename <site>@local <newName>`

Rename a local site.

```bash
nexus sites rename mysite@local my-renamed-site
```

**Output:**

```
Renaming mysite@local → my-renamed-site...

Site renamed successfully
  mysite → my-renamed-site
```

---

## Exporting and Importing

### `nexus sites export <site>@local [outputPath]`

Export a local site to a `.zip` archive.

```bash
# Export to the current directory
nexus sites export mysite@local

# Export to a specific directory
nexus sites export mysite@local ~/Backups/
```

**Output:**

```
Exporting mysite...

Site exported successfully
  Archive: /Users/jane/Backups/mysite-2026-04-13.zip
```

Export can take up to 10 minutes for large sites. If `outputPath` is omitted, the archive is created in the current working directory.

---

### `nexus sites import <archivePath>`

Import a site from a `.zip` archive produced by Local's export or `nexus sites export`.

```bash
nexus sites import ~/Backups/mysite-2026-04-13.zip
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--name <name>` | Name to use for the imported site |

**Example:**

```bash
nexus sites import ~/Backups/mysite-2026-04-13.zip --name restored-site
```

**Output:**

```
Importing /Users/jane/Backups/mysite-2026-04-13.zip...

Site imported successfully
  Name: restored-site
  ID:   def789ghi012

Start the site:
   nexus sites start restored-site@local
```

---

## Configuration

### `nexus sites config-php <site>@local <version>`

Change the PHP version for a site. Requires a restart to take effect.

```bash
nexus sites config-php mysite@local 8.3
```

**Output:**

```
Changing PHP version for mysite@local...

PHP version changed
  8.2 → 8.3

Site restart required for changes to take effect
  nexus sites restart mysite@local
```

---

### `nexus sites config-ssl <site>@local`

Trust the site's SSL certificate. Run this once to enable HTTPS in your browser without certificate warnings.

```bash
nexus sites config-ssl mysite@local
```

---

### `nexus sites config-xdebug <site>@local`

Enable or disable Xdebug for PHP debugging.

```bash
# Enable
nexus sites config-xdebug mysite@local --enable

# Disable
nexus sites config-xdebug mysite@local --disable
```

One of `--enable` or `--disable` is required.

---

## Viewing Logs

### `nexus sites logs <site>@local`

View site logs (PHP error log, Nginx access log, etc.).

```bash
# Show last 100 lines (default)
nexus sites logs mysite@local

# Show last 50 lines
nexus sites logs mysite@local --tail 50

# Follow log output (like tail -f)
nexus sites logs mysite@local --follow
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--tail <lines>` | `100` | Number of lines to show |
| `--follow` | off | Stream log output continuously |

---

## Common Workflows

### Start all halted sites

```bash
# Get list of halted sites
nexus sites list --local-only --json | jq -r '.local[] | select(.status=="halted") | .name'

# Start each one
nexus sites start myblog@local
nexus sites start woostore@local
```

### Create a staging clone before making changes

```bash
# Clone production local site to staging
nexus sites clone mysite@local mysite-staging

# Start the clone
nexus sites start mysite-staging@local

# Make changes on staging, then delete when done
nexus sites delete mysite-staging@local --force
```

### Export a backup before a WordPress update

```bash
nexus sites export mysite@local ~/Backups/
nexus wp core update mysite@local
```

---

## Troubleshooting

**"Target site must be local"** — Add `@local` to the site name:
```bash
# Wrong
nexus sites start mysite

# Right
nexus sites start mysite@local
```

**Site creation fails** — Check that Local is running and not out of disk space. Large sites take longer; the create command allows up to 2 minutes.

**Export fails on large sites** — The export command allows up to 10 minutes. If it times out, try exporting from the Local app directly.

**PHP version does not change** — Restart the site after changing the version:
```bash
nexus sites restart mysite@local
```

---

## Next Steps

- [WP-CLI Commands](./wp-cli.md) — run WordPress commands on sites
- [WP Engine Sync](./wpe-sites.md) — pull and push to WP Engine installs
- [Command Reference](./commands.md) — full command tree
