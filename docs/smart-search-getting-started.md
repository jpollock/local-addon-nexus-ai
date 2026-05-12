# Smart Search Locally — Getting Started

Nexus AI makes WP Engine Smart Search work in Local, backed by LanceDB and ONNX embeddings on your machine instead of WPE's cloud.

## Prerequisites

- Nexus AI addon active in Local
- WP Engine AI Toolkit (`atlas-search`) plugin installed on the site

## Installing the Plugin

The plugin is free and publicly available on WordPress.org.

**From WP Admin:** Plugins → Add New → search "WP Engine AI Toolkit" → Install Now → Activate

**Via WP-CLI (via Nexus):**
```bash
nexus wp "plugin install atlas-search --activate" yoursite@local
```

**Direct download:** https://wordpress.org/plugins/atlas-search/

> **Note:** On production WPE, the plugin normally requires a Smart Search subscription and WPE-provisioned credentials. Locally, Nexus provides its own backend — no WPE subscription required for local development.

## Setup (automatic)

**There is nothing to configure.** When you start a site that has `atlas-search` installed:

1. Nexus detects the plugin files on disk
2. Adds a Smart Search endpoint override to the MU plugin (`wp-content/mu-plugins/nexus-ai-connector-config.php`)
3. `atlas-search` routes all requests to `http://127.0.0.1:13000/smart-search/graphql` instead of WPE cloud

You can verify it's working by visiting **WP Engine AI Toolkit → Settings** in the WordPress admin. The URL field should show `http://127.0.0.1:13000/smart-search/graphql`.

## Syncing Content

After activation, sync your content so the local index is populated:

**WP Admin:** WP Engine AI Toolkit → Smart Search → click **Sync** (or the equivalent index/re-index button).

**WP-CLI (via Nexus):**
```bash
nexus wp "wpe-smart-search sync-data" yoursite@local
```

After syncing, WordPress search will use the local Nexus index.

## What Works Locally

| Feature | Status |
|---------|--------|
| Full-text search | ✅ Full |
| Semantic / hybrid search | ✅ Full (requires ONNX model) |
| Typo tolerance | ✅ Full (semantic similarity handles misspellings) |
| Synonyms | ✅ Full |
| Recommendations (related posts) | ✅ Full |
| Recommendations (trending) | ✅ Full |
| Tracker (page views, clicks, searches) | ✅ Full |
| Insights analytics | ✅ Full |
| Promotions / custom search results | ✅ Full |
| ACF field indexing | ✅ Full |
| Facets / aggregations | ⚠️ Computed post-query (correct but slower than cloud) |
| Geographic search | ⚠️ Silently ignored |
| Fuzzy distance control | ⚠️ On/off only — per-word distance not supported |

## Pushing to WPE

Before pushing files or database to WP Engine:

1. **Exclude the MU plugin from file push.** The file `wp-content/mu-plugins/nexus-ai-connector-config.php` contains localhost URLs and must not go to WPE. Add it to `.wpe-push-ignore`:

   ```
   wp-content/mu-plugins/nexus-ai-connector-config.php
   ```

2. **The database option is safe.** Nexus uses a WordPress filter to override the option on-the-fly — nothing is written to the database. The WPE server will use its own provisioned credentials.

## Troubleshooting

**Settings page shows empty URL / "Missing URL" warning:**
The lifecycle hook ran before `atlas-search` was activated. Activate the plugin from WP Admin → Plugins, then restart the site in Local.

**"Failed to query capabilities: Unknown operation":**
Local is running an old compiled version of the addon. Restart Local completely.

**Search returns no results:**
The index may be empty. Run a sync from the Smart Search admin page.

**Typo queries return nothing:**
Ensure the ONNX model is present at `models/all-MiniLM-L6-v2-quantized/model.onnx`. Without it, only exact FTS matches are returned.
