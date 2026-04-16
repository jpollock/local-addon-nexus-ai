# Digital Twin — Data Reference

Complete reference for what data the digital twin system stores, when it is
updated, and how it is consumed by MCP tools and CLI commands.

---

## Data Stores

### 1. SiteMetadataCache (in-memory + persisted)

Per **local** site. Assembled by `StartupSiteScanner` and lifecycle hooks.

| Field | Type | Source | Requires running site? |
|---|---|---|---|
| `wpVersion` | string | Filesystem (`wp-includes/version.php`) | No |
| `phpVersion` | string | Local site object | No |
| `installedPlugins` | string[] | Filesystem (`wp-content/plugins/` dirs) | No |
| `installedThemes` | string[] | Filesystem (`wp-content/themes/` dirs) | No |
| `plugins` | Plugin[] (name, version, status, file) | WP-CLI `plugin list` | Yes |
| `themes` | Theme[] (name, version, status) | WP-CLI `theme list` | Yes |
| `activeTheme` | string | WP-CLI `option get stylesheet` | Yes |
| `siteUrl` | string | WP-CLI `option get siteurl` | Yes |
| `adminEmail` | string | WP-CLI `option get admin_email` | Yes |
| `postCount` | number | WP-CLI `post list --format=count` | Yes |
| `postCountByType` | Record\<string, number\> | WP-CLI `post list` per type | Yes |
| `lastPostAt` | timestamp | WP-CLI most recent post date | Yes |
| `mysqlVersion` | string | WP-CLI `eval echo $wpdb->db_version()` | Yes |
| `scanDepth` | `filesystem` \| `full` | Internal | — |
| `lastUpdated` | timestamp | Internal | — |

---

### 2. GraphService — `sites` table (SQLite)

Per **local and WPE** site. Populated from CAPI sync and SSH deep refresh.

| Column | Source |
|---|---|
| `id`, `name`, `domain` | Local site object / CAPI |
| `wp_version`, `php_version` | CAPI (WPE) or Local site object |
| `source` | `local` or `wpe` |
| `remote_install_id` | CAPI install UUID |
| `remote_domain` | CAPI primary domain |
| `account_id` | CAPI account UUID |
| `last_sync_at` | Updated on any sync |
| `site_url` | **SSH WP-CLI** `option get siteurl` |
| `admin_email` | **SSH WP-CLI** `option get admin_email` |
| `active_theme` | **SSH WP-CLI** `option get stylesheet` |
| `post_count` | **SSH WP-CLI** `post list --format=count` |

The four SSH-enriched columns are only populated after a deep refresh
(`nexus sites refresh <wpe-install>` or `nexus fleet refresh --deep`).

---

### 3. GraphService — `plugins` / `themes` tables (SQLite)

Per site. Columns: `site_id`, `slug`, `name`, `version`, `is_active`, `author`.

- **Local sites**: populated by WordPress event webhooks (plugin installed/activated events)
- **WPE sites**: populated by SSH deep refresh (`wp plugin list`, `wp theme list`)

---

### 4. GraphService — `site_usage` table (SQLite)

WPE bandwidth, visits, and storage. One row per `(site_id, period, source)`.

| Column | Notes |
|---|---|
| `period` | `YYYY-MM` string |
| `visits`, `bandwidth_bytes`, `storage_bytes` | From CAPI |
| `recorded_at` | When fetched |

---

## The Assembled Twin

`SiteDigitalTwinService` merges all four stores into a single `SiteDigitalTwin`
object on demand. Nothing writes to it directly — it is a pure read model.

Every field carries a **provenance record**:
```typescript
sources['plugins'] = { method: 'wp-cli', timestamp: 1713000000000, requiresRunning: true }
```

Two computed properties summarise overall data quality:

| Property | Values | Meaning |
|---|---|---|
| `completeness` | `none` / `filesystem` / `metadata` / `indexed` | How much we know |
| `asOf` | Unix ms | Age of the oldest populated field (weakest link) |

For WPE-only sites (not in Local), `getFromGraph()` assembles the twin entirely
from GraphService rows including the SSH-enriched columns.

---

## Update Triggers

| When | What runs | Scope |
|---|---|---|
| **Local addon loads** (+5s) | Filesystem scan all sites; WP-CLI for running sites (3 concurrent) | All local sites |
| **Site starts** | Full WP-CLI scan via lifecycle hook | That local site |
| **Every 24h (background)** | `HaltedSiteRefreshScheduler` — filesystem scan for halted sites with stale twins | Halted local sites |
| **CAPI sync (startup + hourly)** | `site_usage` rows upserted | All linked WPE installs |
| `nexus sites refresh <site>` | Local: WP-CLI scan. WPE: 7 SSH WP-CLI calls in parallel | One site |
| `nexus fleet refresh` | Filesystem scan + WP-CLI for running sites | All local sites |
| `nexus fleet refresh --deep` | Local: start→WP-CLI→stop. WPE: SSH WP-CLI (bounded concurrency) | All sites |
| `nexus fleet refresh --deep --local-only` | Local only | Local sites |
| `nexus fleet refresh --deep --wpe-only` | WPE SSH only | WPE installs |

`--deep` uses a worker pool (default concurrency 3, `--concurrency N` to
override) for both local and WPE to avoid overwhelming resources.

---

## Freshness Model

Three thresholds govern how staleness is surfaced:

| Age | Confidence | User sees |
|---|---|---|
| < 1 hour | `high` | Nothing (silent) |
| 1–24 hours | `medium` | `(from Xh ago)` inline |
| > 24 hours | `stale` | `⚠️ stale — run nexus_site_refresh` |
| > 7 days | `stale` | `❌ very stale` |

`canAnswer(twin, field)` returns `{ can, confidence, reason }` so tools can
branch on data quality rather than guess.

Every MCP tool response that serves from twin data appends:
```
_Data: WP-CLI scan · 27m ago · nexus sites refresh mysite to update_
```

---

## Consumers

### MCP Tools

| Tool | Twin data used |
|---|---|
| `nexus_get_site_twin` | Full twin — all fields + per-field provenance |
| `get_site_structure` | WP/PHP/MySQL versions, plugins, themes, post counts |
| `nexus_site_status` | Completeness report, field ages, staleness |
| `nexus_site_refresh` | Triggers rescan; returns updated report |
| `nexus_site_refresh` (WPE) | Triggers SSH deep refresh |
| `wp_plugin_list` | Falls back to `twin.plugins` when site is halted |
| `wp_theme_list` | Falls back to `twin.themes` when site is halted |
| `wp_core_version` | Falls back to `twin.wpVersion` when site is halted |
| `nexus_get_fleet_twins` | Fleet-wide completeness overview |

### CLI Commands

| Command | What it shows |
|---|---|
| `nexus sites get <site>` | WP/PHP/MySQL, plugins, posts, indexed state, twin age |
| `nexus sites status <site>` | Full per-field freshness report |
| `nexus sites refresh <site>` | Triggers rescan (local WP-CLI or WPE SSH, auto-detected) |
| `nexus fleet refresh` | Bulk filesystem + WP-CLI rescan |
| `nexus fleet refresh --deep` | Full WP-CLI for all sites (start/stop halted local; SSH for WPE) |

---

## What's Not in the Twin (yet)

- **WP-CLI data for WPE sites via scheduled refresh** — SSH scans are manual only; no background scheduler for WPE
- **Per-post content** — stored in the vector index, not the twin
- **User/role data** — in IndexRegistry structure, not twin fields
- **Custom tables, REST API namespaces** — IndexRegistry only
- **WPE PHP version from SSH** — currently from CAPI only
