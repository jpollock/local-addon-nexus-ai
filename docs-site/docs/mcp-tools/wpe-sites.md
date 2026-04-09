---
title: WPE Sites Tools
description: MCP tools for WP Engine operations — authentication, installs, backups, usage metrics, and more
keywords: [mcp, wpe, wp engine, installs, accounts, backup, usage, auth]
---

# WPE Sites Tools

MCP tools for managing WP Engine sites, accounts, authentication, and usage metrics.

## Authentication

### `wpe_status`

Check WP Engine authentication status. Returns whether the CLI is currently authenticated and, if so, the authenticated user.

**Tier:** 1 (read-only)

**Parameters:** None

**Example response:**

```json
{
  "authenticated": true,
  "user": "you@example.com"
}
```

---

### `wpe_login`

Initiate WP Engine OAuth authentication via browser. Fire-and-forget — opens the browser and returns immediately. The user completes the flow in the browser; credentials are saved automatically.

**Tier:** 2 (initiates browser auth)

**Parameters:** None

**Notes:**
- Credentials persist across sessions in Local's secure storage.
- Use `wpe_status` to confirm authentication completed.

---

### `wpe_logout`

Clear stored WP Engine credentials.

**Tier:** 2 (mutates credentials)

**Parameters:** None

**Example response:**

```json
{
  "success": true,
  "message": "WP Engine credentials cleared."
}
```

---

## Accounts

### `wpe_get_accounts`

List all WP Engine accounts accessible to the authenticated user.

**Tier:** 1

**Parameters:** None

**Example response:**

```json
[
  { "id": "my-agency", "name": "My Agency", "plan": "Growth" },
  { "id": "client-one", "name": "Client One", "plan": "Startup" }
]
```

---

### `wpe_get_account`

Get details for a specific WP Engine account.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `account_id` | string | WP Engine account ID |

---

## Installs

### `wpe_get_installs`

List all WP Engine installs, optionally filtered by account.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `account_id` | string (optional) | Filter by account |

---

### `wpe_get_install`

Get details for a specific WP Engine install.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `install_id` | string | Install ID or name |

---

## Usage Metrics

### `wpe_get_install_usage`

Get bandwidth, storage, and visitor metrics for a WP Engine install for a given month.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `install_id` | string | Install ID or name | required |
| `month_offset` | integer | Months back from today (`0` = current, `1` = last month) | `0` |

**Example response:**

```json
{
  "install_id": "mysite-production",
  "period": "2026-03",
  "bandwidth_gb": 12.4,
  "storage_gb": 1.8,
  "visitors": 24531
}
```

**Caching:**

- Current month (`month_offset: 0`): 1-hour TTL
- Past months (`month_offset >= 1`): 24-hour TTL (data is immutable)

---

### `wpe_get_account_usage`

Get bandwidth, storage, and visitor metrics aggregated across all installs in a WP Engine account for a given month.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `account_id` | string | WP Engine account ID | required |
| `month_offset` | integer | Months back from today (`0` = current, `1` = last month) | `0` |

**Example response:**

```json
{
  "account_id": "my-agency",
  "period": "2026-03",
  "bandwidth_gb": 84.7,
  "storage_gb": 14.2,
  "visitors": 182045
}
```

**Caching:** Same TTL rules as `wpe_get_install_usage`.

---

## Backups

### `wpe_create_backup`

Create a backup of a WP Engine install.

**Tier:** 2

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `install_id` | string | Install ID |
| `description` | string (optional) | Backup description |
| `notification_emails` | string[] (optional) | Email addresses to notify on completion |

---

### `wpe_get_backup`

Get status and details of a specific backup.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `backup_id` | string | Backup ID |

---

## Site Operations

### `wpe_purge_cache`

Purge the CDN/page cache for a WP Engine install.

**Tier:** 2

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `install_id` | string | Install ID |

---

### `wpe_diagnose_site`

Run a comprehensive health check on a WP Engine install (SSL, backups, performance, bandwidth).

**Tier:** 1

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `install_id` | string | Install ID |

---

### `wpe_copy_install`

Copy (clone) a WP Engine install to another environment.

**Tier:** 3

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `source_install_id` | string | Source install ID |
| `target_install_id` | string | Target install ID |

---

### `wpe_promote_to_production`

Promote a staging install to production.

**Tier:** 3

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `install_id` | string | Staging install ID to promote |

---

## Domains

### `wpe_get_domains`

List all domains for a WP Engine install.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `install_id` | string | Install ID |

---

### `wpe_create_domain`

Add a domain to a WP Engine install.

**Tier:** 2

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `install_id` | string | Install ID |
| `domain` | string | Domain name to add |

---

### `wpe_delete_domain`

Remove a domain from a WP Engine install.

**Tier:** 3

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `install_id` | string | Install ID |
| `domain_id` | string | Domain ID |

---

## Fleet Intelligence

### `wpe_portfolio_usage`

Get fleet-wide traffic, bandwidth, and storage across all installs in all accessible WP Engine accounts. Makes one CAPI call per account and returns aggregated per-install metrics — useful for identifying the heaviest or most expensive sites in a portfolio.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `min_visits_per_day` | number (optional) | Only return installs averaging at least this many visits per day | — |

**Example:**

```json
// wpe_portfolio_usage({ min_visits_per_day: 1000 })
{
  "period": "2026-03",
  "installs": [
    {
      "install_id": "hightraffic-production",
      "account_id": "my-agency",
      "bandwidth_gb": 48.2,
      "storage_gb": 3.1,
      "visitors": 91400,
      "visits_per_day": 2948
    }
  ],
  "total_installs": 1,
  "accounts_queried": 2
}
```

**When to use:** Ask "which of my WPE sites is using the most bandwidth?" or "show me all high-traffic production installs."

---

### `wpe_fleet_versions`

Return WordPress and PHP version information for all indexed WP Engine installs, sourced entirely from the local site graph. Makes **zero API calls** — data comes from the most recent SSH sync.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `install_names` | string[] (optional) | Filter to specific install names |
| `min_wp_version` | string (optional) | Only return installs running at least this WP version (e.g. `"6.5"`) |

**Example:**

```json
// wpe_fleet_versions({ min_wp_version: "6.6" })
{
  "installs": [
    {
      "install_name": "mysite-production",
      "wp_version": "6.7.2",
      "php_version": "8.3",
      "last_synced": "2026-03-30T14:22:00Z"
    }
  ],
  "total": 1,
  "data_source": "local_graph"
}
```

**When to use:** "What WP versions are my production sites running?" or "which installs are still on PHP 8.1?"

---

### `wpe_detect_drift`

Compare local development sites against their linked WP Engine production installs to identify version mismatches and plugin differences. Surfaces cases where local and production have diverged.

**Tier:** 1

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `site` | string (optional) | Limit comparison to a specific local site name |
| `plugins_only` | boolean (optional) | When `true`, skip WP/PHP version comparison and only report plugin diffs |

**What it compares:**

- WordPress core version (local vs. WPE production)
- PHP version (local vs. WPE production)
- Active plugin list and versions (added, removed, version changed)

**Example:**

```json
// wpe_detect_drift({ site: "mysite" })
{
  "site": "mysite",
  "wpe_install": "mysite-production",
  "drift": {
    "wp_version": { "local": "6.7.2", "production": "6.6.1", "status": "local_ahead" },
    "php_version": { "local": "8.3", "production": "8.2", "status": "mismatch" },
    "plugins": [
      { "plugin": "woocommerce", "local": "9.4.0", "production": "9.3.3", "status": "local_ahead" },
      { "plugin": "yoast-seo", "local": null, "production": "21.9", "status": "missing_local" }
    ]
  },
  "has_drift": true
}
```

**When to use:** Before pushing local changes to staging, or to audit how far local dev has diverged from production.

---

## Tool Tiers

| Tier | Risk level | Examples |
|------|-----------|---------|
| 1 | Read-only | `wpe_status`, `wpe_get_installs`, `wpe_get_install_usage`, `wpe_portfolio_usage`, `wpe_fleet_versions`, `wpe_detect_drift` |
| 2 | Reversible writes | `wpe_login`, `wpe_logout`, `wpe_create_backup`, `wpe_purge_cache` |
| 3 | Irreversible / destructive | `wpe_promote_to_production`, `wpe_copy_install`, `wpe_delete_domain` |

## Next Steps

- [CLI `nexus wpe` commands](../reference/cli-command-reference.md#nexus-wpe)
- [WPE Account Tools](wpe-account.md)
- [Local Sites Tools](local-sites.md)
