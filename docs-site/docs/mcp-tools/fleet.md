---
title: Fleet Tools
description: Fleet-wide operation tools — site listing, health, SQL analytics, and bulk operations
keywords: [fleet, mcp, tools, fleet_sql, fleet_overview, fleet_summary, nexus_list_sites]
---

# Fleet Tools

Tools for answering fleet-wide questions and managing your entire WordPress portfolio.

## `fleet_overview`

**Adaptive fleet summary.** Auto-detects whether you have WP Engine installs and returns the right answer for your fleet type — no parameters needed.

- **Local-only users** — summarizes local sites: count, PHP/WP distribution, health, recent activity
- **WPE customers** — combines local + WPE data into one unified view

Use `fleet_overview` first for "tell me about my fleet" questions before any other fleet tool.

**Parameters:** None

**Example response:**
```
Fleet: 8 local sites, 0 WPE installs

Local sites: 8 total (6 running, 2 halted)
WordPress: 6.8 (5 sites), 6.7.2 (2 sites), 6.6 (1 site)
PHP: 8.3 (6 sites), 8.2 (2 sites)
Plugins: 127 total across fleet, 14 unique — WooCommerce on 3 sites

Last activity: nexus-e2e-test (2 hours ago)
```

---

## `fleet_sql`

**Read-only SQL queries over the graph database.** Write SELECT statements against four tables to answer fleet-wide questions that no other tool covers.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | Yes | A SELECT SQL statement. No semicolons. No DML/DDL. |

### Schema

#### `sites`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Internal site ID |
| `name` | text | Site display name |
| `source` | text | `'local'` or `'wpe'` |
| `wp_version` | text | WordPress version |
| `php_version` | text | PHP version |
| `post_count` | integer | Total published posts |
| `post_count_by_type` | text | JSON: `{"post":47,"page":12,"product":200}` |
| `user_count` | integer | Total users |
| `user_count_by_role` | text | JSON: `{"administrator":2,"editor":5}` |
| `site_url` | text | WordPress site URL |
| `admin_email` | text | WordPress admin email |
| `active_theme` | text | Active theme slug |
| `settings_json` | text | JSON of key WordPress options |
| `last_post_at` | integer | Unix timestamp of most recent published post |
| `last_active_session` | integer | Unix timestamp of most recent user login |
| `environment` | text | WPE environment type (`production`, `staging`, `development`) |
| `ssh_last_sync_at` | integer | Unix timestamp of last WPE SSH sync |
| `is_active` | integer | 1 = running / synced, 0 = halted |

#### `plugins`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Internal plugin ID |
| `site_id` | text | References `sites.id` |
| `slug` | text | Plugin slug (e.g. `woocommerce`) |
| `name` | text | Plugin display name |
| `version` | text | Installed version |
| `is_active` | integer | 1 = active, 0 = inactive |

#### `content`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Internal content ID |
| `site_id` | text | References `sites.id` |
| `post_id` | integer | WordPress post ID |
| `post_type` | text | Post type (post, page, product, etc.) |
| `title` | text | Post title |
| `status` | text | Post status |
| `updated_at` | text | Last update timestamp |

#### `users`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | Internal user ID |
| `site_id` | text | References `sites.id` |
| `user_id` | integer | WordPress user ID |
| `username` | text | WordPress login name |
| `email` | text | User email |
| `roles` | text | JSON array: `["administrator"]` |
| `created_at` | text | User registration timestamp |

### Example Queries

**WordPress version distribution:**
```sql
SELECT wp_version, COUNT(*) as sites FROM sites GROUP BY wp_version ORDER BY sites DESC
```

**Sites with WooCommerce active:**
```sql
SELECT s.name FROM sites s
JOIN plugins p ON p.site_id = s.id
WHERE p.slug = 'woocommerce' AND p.is_active = 1
```

**Sites with no posts published in 90 days:**
```sql
SELECT name FROM sites WHERE last_post_at < strftime('%s', 'now', '-90 days')
```

**Admin count per site (from role JSON):**
```sql
SELECT s.name,
  json_extract(s.user_count_by_role, '$.administrator') as admins
FROM sites s ORDER BY admins DESC
```

**Find admins on multiple sites (same email):**
```sql
SELECT email, COUNT(DISTINCT site_id) as site_count
FROM users WHERE roles LIKE '%administrator%'
GROUP BY email HAVING site_count > 1 ORDER BY site_count DESC
```

**Plugin version distribution across fleet:**
```sql
SELECT slug, version, COUNT(*) as installs
FROM plugins WHERE is_active = 1
GROUP BY slug, version ORDER BY installs DESC LIMIT 20
```

---

## `fleet_summary`

Aggregate stats across all sites: WordPress version distribution, PHP version distribution, most common plugins, and integration presence (WooCommerce, ACF). Reads from the local index registry and graph.db.

**Note:** The "Content" section shows LanceDB vector index chunk counts — these are NOT WordPress post counts. A single post produces 3–6 chunks. For actual post counts, use `fleet_sql`.

---

## `fleet_health_summary`

Health scores for all indexed local sites — per-site score (0–100), top issues, and fleet average. Scores computed from database health, index freshness, and plugin/core currency. Local sites only.

---

## `fleet_filter`

Filter the fleet by a preset criterion. Returns matching sites with details.

**Available filters:**
- `security-updates` — sites with plugins needing security updates
- `outdated-php` — sites on PHP < 8.0
- `no-ssl` — sites without SSL
- `not-indexed` — sites with no content index
- `large-db` — sites with large databases
- `low-disk` — sites with low disk space
- `no-events` — sites with no recent WordPress events
- `low-health` — sites with health score below threshold

---

## `fleet_search`

Semantic search across all indexed local sites simultaneously. Returns results ranked by relevance with site name, post title, and excerpt.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `query` | string | Natural language search query |
| `content_types` | array | Filter: `post`, `plugin`, `theme`, `user` |
| `site_ids` | array | Limit to specific site IDs |
| `limit` | number | Max results per site (default 20) |

---

## `nexus_fleet_plugins`

Aggregated plugin inventory across all indexed sites (local + WPE). Shows how many sites each plugin is active on. Filter by name (`search=`) or minimum site count (`min_sites=`).

---

## `fleet_database_health`

Scan all running local sites for database health issues. Returns a ranked list sorted by health score (worst first). Identifies sites that need the most attention.

---

## `nexus_plugin_audit`

Fleet-wide plugin audit across all local sites — installed plugins with current and latest versions, update availability. Works on halted sites using cached metadata + WordPress.org API. Running sites get real-time WP-CLI data.
