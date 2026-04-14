---
title: Bulk Operations
description: Run operations across multiple sites at once using nexus fleet and nexus bulk commands
keywords: [bulk, fleet, groups, plugin update, reindex, health, parallel, scripting]
---

# Bulk Operations

The `nexus fleet` and `nexus bulk` commands let you discover, filter, and act on multiple sites at once. The recommended pattern is: discover with `fleet health` or `fleet filter`, then act with `bulk`.

## Prerequisites

- Local by WP Engine is installed and running
- The Nexus AI addon is active in Local
- Target sites must be running for most operations

---

## Fleet Health

### `nexus fleet health`

Get a summary of health status across all local sites.

```bash
nexus fleet health
```

**Output:**

```
Fleet Health Summary
──────────────────────────────────────────────────
Sites:         4 total (3 running, 1 halted)
Health:        2 healthy, 1 warnings, 0 critical
Plugins:       47 total (3 outdated)
Themes:        12 total (1 outdated)
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

Use `fleet health` to get a quick snapshot before deciding which sites need attention.

---

### `nexus fleet site-health <target>`

Get detailed health information for a single site, including individual issues.

```bash
nexus fleet site-health mysite@local
```

**Output:**

```
Site Health: mysite@local
──────────────────────────────────────────────────
Status:        ⚠️  warning (score: 72/100)
WordPress:     6.5.2
Plugins:       8/10 active (2 outdated)
Themes:        2/3 active (0 outdated)

Issues (2):
  ⚠️  [plugins] 2 plugins have available updates
  ℹ️  [security] Debug mode is enabled
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

---

## Fleet Search and Filter

### `nexus fleet search <query>`

Search content across all indexed sites.

```bash
nexus fleet search "checkout page"
```

**Output:**

```
Search Results: "checkout page"
──────────────────────────────────────────────────
  mystore (mystore@local)
    Type: post | Score: 0.92
    ...custom checkout page with address validation...

  myblog (myblog@local)
    Type: page | Score: 0.71
    ...link to the checkout page in the footer...
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--limit <n>` | `20` | Maximum results to return |
| `--json` | | Output as JSON |

---

### `nexus fleet filter`

Filter sites by status, plugin presence, or WordPress version.

```bash
# Sites with WooCommerce installed
nexus fleet filter --plugin woocommerce

# Running sites on an older WordPress version
nexus fleet filter --status running --wp-version 6.4

# Sites linked to WP Engine
nexus fleet filter --linked
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--status <running\|halted>` | Filter by site status |
| `--plugin <slug>` | Sites that have this plugin |
| `--wp-version <version>` | Sites on this WordPress version |
| `--linked` | Only sites linked to a WP Engine install |
| `--json` | Output as JSON |

**Output:**

```
Filtered Sites (2)
──────────────────────────────────────────────────
  🟢 mystore (mystore@local) - WP 6.4.3 → wpe:acmeco/mystore-prod@production
  🟢 wootest (wootest@local) - WP 6.5.2
```

---

### `nexus fleet compare <target1> <target2>`

Compare two sites side-by-side to identify configuration differences.

```bash
nexus fleet compare mysite@local mysite-staging@local
```

**Output:**

```
Site Comparison
──────────────────────────────────────────────────
Site 1: mysite@local
  WordPress: 6.5.2
  Plugins: 12, Themes: 3

Site 2: mysite-staging@local
  WordPress: 6.4.3
  Plugins: 10, Themes: 3

Differences (3):
  [wordpress] version
    Site 1: 6.5.2
    Site 2: 6.4.3

  [plugins] woocommerce
    Site 1: active (8.9.0)
    Site 2: inactive (8.7.1)

  [plugins] acf-pro
    Site 1: active
    Site 2: missing
```

---

## Site Groups

Site groups let you save named collections of sites and target them together in scripts.

### `nexus fleet groups list`

List all saved groups.

```bash
nexus fleet groups list
```

**Output:**

```
Site Groups (2)
──────────────────────────────────────────────────
  client-sites (3 sites)
    All active client WordPress sites
    Created: 4/10/2026

  woocommerce-sites (2 sites)
    Created: 4/1/2026
```

---

### `nexus fleet groups create <name>`

Create a new group.

```bash
nexus fleet groups create client-sites --description "All active client WordPress sites"
```

**Output:**

```
✅ Created group: client-sites
   ID: grp_abc123
```

---

### `nexus fleet groups add <group> <sites...>`

Add one or more sites to a group. Sites must use the `@local` suffix.

```bash
nexus fleet groups add client-sites mysite@local blog@local woostore@local
```

**Output:**

```
✅ Added 3 sites to group "client-sites"
```

---

### `nexus fleet groups remove <group> <sites...>`

Remove sites from a group.

```bash
nexus fleet groups remove client-sites blog@local
```

---

### `nexus fleet groups delete <group>`

Delete a group. This does not delete the sites themselves.

```bash
nexus fleet groups delete old-group
```

---

## Bulk Operations

### `nexus bulk plugin-update <targets...>`

Update plugins across multiple sites in one command. Requires at least one of `--plugin` or `--all`.

```bash
# Update a specific plugin on two sites
nexus bulk plugin-update mysite@local blog@local --plugin woocommerce

# Update all plugins on three sites (dry run first)
nexus bulk plugin-update mysite@local blog@local store@local --all --dry-run

# Apply the updates
nexus bulk plugin-update mysite@local blog@local store@local --all
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--plugin <slug>` | Specific plugin slug to update |
| `--all` | Update all plugins on each site |
| `--dry-run` | Show what would be updated without making changes |

**Output:**

```
Starting bulk plugin update for 3 sites...

Plugin Update Results:
──────────────────────────────────────────────────
  ✅ mysite@local
     woocommerce: 8.7.1 → 8.9.0
     contact-form-7: 5.9.0 → 5.9.3
  ✅ blog@local
     contact-form-7: 5.9.0 → 5.9.3
  ❌ store@local - Site is not running

Summary: 2 succeeded, 1 failed
```

One of `--plugin` or `--all` is required. The command exits `1` if the argument is missing.

---

### `nexus bulk reindex <targets...>`

Reindex content on multiple sites. Used to refresh the vector search index after content changes.

```bash
nexus bulk reindex mysite@local blog@local store@local
```

**Output:**

```
Starting bulk reindex of 3 sites...

Reindex Results:
──────────────────────────────────────────────────
  ✅ mysite@local - 5,432 documents indexed
  ✅ blog@local - 2,108 documents indexed
  ❌ store@local - Site is not running

Summary: 2 succeeded, 1 failed
```

Reindexing runs with a 10-minute timeout. Only running sites can be reindexed — halted sites will fail with a clear error message.

---

### `nexus bulk health-check <targets...>`

Run a health check on multiple sites and get a summary.

```bash
nexus bulk health-check mysite@local blog@local store@local
```

**Output:**

```
Running health check on 3 sites...

Health Check Results:
──────────────────────────────────────────────────
  ✅ mysite@local - healthy (score: 95/100, 0 issues)
  ⚠️  blog@local - warning (score: 72/100, 2 issues)
  ❌ store@local - critical (score: 38/100, 5 issues)
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

---

## Pattern: Discover, Filter, Act

The recommended workflow for fleet operations:

```bash
# 1. Discover — get the full picture
nexus fleet health

# 2. Filter — find sites that need action
nexus fleet filter --plugin woocommerce --status running --json \
  | jq -r '.[].target'

# 3. Act — run bulk operation on the filtered set
nexus bulk plugin-update mystore@local wootest@local --plugin woocommerce --dry-run

# 4. Apply after reviewing dry-run output
nexus bulk plugin-update mystore@local wootest@local --plugin woocommerce
```

---

## Scripting with `--json`

All fleet and bulk commands support `--json` for machine-readable output. Use `jq` to extract targets for chaining:

```bash
# Get all running sites linked to WP Engine as a space-separated list
targets=$(nexus fleet filter --linked --status running --json \
  | jq -r '.[].target' | tr '\n' ' ')

# Run health check on those sites
nexus bulk health-check $targets --json
```

Bulk operation results return an array with per-site success/failure:

```json
[
  { "target": "mysite@local", "status": "healthy", "score": 95, "issueCount": 0 },
  { "target": "blog@local",   "status": "warning",  "score": 72, "issueCount": 2 }
]
```

---

## Safe Defaults

- `nexus bulk plugin-update` requires explicit `--plugin` or `--all` — no implicit "update everything"
- `nexus wp db clean` defaults to `--dry-run` — see [WP-CLI Commands](./wp-cli.md#database)
- Site deletion always prompts for confirmation unless `--force` is passed

---

## Next Steps

- [WP-CLI Commands](./wp-cli.md) — per-site WordPress commands
- [Performance](./performance.md) — timing expectations for fleet operations
- [Command Reference](./commands.md) — full command tree
