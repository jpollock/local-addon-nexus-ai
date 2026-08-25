---
title: What's New — July 2026
description: Fleet analytics, WordPress settings indexing, and performance fixes in v0.5.0
keywords: [changelog, release notes, new features, july 2026, v0.5.0, fleet analytics, fleet_sql]
---

# What's New — July 2026 (v0.5.0)

Fleet analytics, SQL querying over your graph database, WordPress settings indexing, and two performance fixes that make `nexus reset` instant and global e2e test setup reliable. Branch: `feat/fleet-analytics` → main.

---

## Fleet Analytics

### `fleet_sql` — SQL Queries Over Your Fleet

Write SELECT queries directly against Nexus AI's graph database to answer fleet-wide questions that were previously impossible without custom scripts.

**Schema:**
- `sites` — WP version, PHP version, domain, post counts, user counts, settings, last activity
- `plugins` — slug, name, version, active status per site
- `content` — indexed posts/pages/products per site
- `users` — username, email, roles per site

**Example queries:**
```sql
-- What WordPress versions is my fleet running?
SELECT wp_version, COUNT(*) as sites FROM sites GROUP BY wp_version

-- Which sites have WooCommerce active?
SELECT s.name FROM sites s
JOIN plugins p ON p.site_id = s.id
WHERE p.slug = 'woocommerce' AND p.is_active = 1

-- Sites with no posts published in 90 days
SELECT name FROM sites WHERE last_post_at < date('now', '-90 days')

-- Admin counts per site
SELECT s.name,
  json_extract(s.user_count_by_role, '$.administrator') as admins
FROM sites s
ORDER BY admins DESC
```

Only SELECT is allowed — INSERT, UPDATE, DELETE, DROP, and other write operations are blocked.

### `fleet_overview` — Canonical Fleet Summary

A single tool that gives the right answer for any fleet type:
- **Local-only users** — summarizes your local sites (no WPE references)
- **WPE customers** — combines local + WPE data into one unified view

Use `fleet_overview` as the first answer to "tell me about my fleet" questions. It replaces manual calls to `nexus_fleet_summary` + `wpe_portfolio_overview`.

---

## WordPress Settings Indexing

Nexus AI now collects richer data on every site start and persists it to `graph.db`. Previously the graph database only stored WP version, PHP version, and install-level metadata.

**New data collected per site:**

| Field | Description |
|-------|-------------|
| `settings_json` | Key WordPress options: blogname, siteurl, admin email, timezone, active plugin list, active theme |
| `user_count_by_role` | Role distribution as JSON: `{"administrator": 2, "editor": 5, ...}` |
| `post_count_by_type` | Per-post-type publish counts: `{"post": 47, "page": 12, "product": 200, ...}` |
| `last_post_at` | Timestamp of the most recently published post |
| `last_active_session` | Most recent user login from `session_tokens` meta |
| `wpConfigMtime` | `wp-config.php` modification time (proxy for salt/secret rotation age) |

All fields are queryable via `fleet_sql`.

### WPE Deep Refresh — Native WP-CLI

The WPE metadata sync now uses direct WP-CLI commands instead of `wp eval` for each metric. WPE's SSH gateway blocks `wp eval`, so the previous implementation was silently returning empty data for all WPE installs. Each metric now uses the correct WP-CLI command:

- `wp post list --post_status=publish --format=count` per post type
- `wp user list --format=count`
- `wp option get blogname` etc.

If you've been running WPE syncs and seeing empty post/user counts, running a fresh sync will now populate correct data.

---

## Site Finder Enhancements

Four new filter categories are now recognized by the Site Finder natural language query engine:

- **PHP EOL detection** — "which sites are on end-of-life PHP?"
- **Plugin presence** — "which sites have Contact Form 7 installed?" (version-aware)
- **Activity recency** — "sites with no logins in the last 30 days"
- **Hidden settings** — "sites with WP_DEBUG enabled"

These complement the existing filters (WordPress version, plugin counts, health score).

---

## Bug Fixes

### `nexus reset --factory --confirm` No Longer Hangs

Previously, `nexus reset --factory --confirm` would time out and appear to freeze when the LanceDB vector store had grown large (1 million+ files, 5+ GB). The root cause was `fs.rmSync({ recursive: true })` — synchronous deletion blocked Node's event loop for the full operation, which could take several minutes.

**Fix:** The directory is now atomically renamed (O(1), instant) and then deleted in the background via a non-blocking `exec('rm -rf')`. The command returns within 2 seconds regardless of vector store size.

The dry-run and already-clean paths also had a related issue: they used `return` instead of `process.exit(0)`, leaving the bootstrap GraphQL connection open and hanging the process indefinitely. Both paths now call `process.exit(0)`.

### E2E Test Fixture Sites Now Found Correctly

The global e2e test setup was always reporting fixture sites as "not found," causing 90+ tests to be skipped. Root cause: `parseSiteList` searched for `[` first in the JSON output. Since `nexus sites list --json` returns `{"local": [...], "wpe": [...]}`, slicing from `[` mid-object produced invalid JSON that `JSON.parse` rejected silently.

Fixed by taking the minimum of `{` and `[` positions — `{` is always earlier for object output, ensuring the full JSON object is parsed correctly.
