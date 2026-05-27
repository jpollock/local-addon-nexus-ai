---
title: Search & Discover Tab
description: Unified search interface for your Local and WP Engine site fleet
keywords: [search, discover, fleet, site finder, keyword search, AI search]
---

# Search & Discover Tab

The **Search** tab (formerly Discover tab) is the primary search interface inside the Nexus AI panel in Local. It replaces the old DiscoverTab with a unified view that combines keyword search, semantic search, and fleet completeness in one place.

## Access

Open the Nexus AI panel in Local → click the **Search** tab (magnifying glass icon).

---

## Modes

### Keyword Search

Type any word or phrase to search all indexed local sites simultaneously.

- Searches post titles, content, and site metadata
- Results show site name, post title, and a relevance excerpt
- Works without an AI provider — runs entirely on-device using LanceDB FTS

**Example queries:**
- `WooCommerce shipping` — finds all pages mentioning WooCommerce shipping across your fleet
- `ACF repeater` — surfaces all posts using ACF repeater fields
- `checkout page` — finds checkout-related pages across sites

### Semantic / AI Search

When an AI provider is configured, queries are also interpreted semantically — finding content that *means* the same thing even if it doesn't use the same words.

The intent classifier routes queries automatically:
- **Fleet query** ("which sites have WooCommerce?") → metadata search via graph.db
- **Content query** ("where did I document the SMTP setup?") → vector search via LanceDB
- **Mixed** → both, merged and ranked

### Comparison Search

Two search boxes side-by-side. Run two queries simultaneously and compare results — useful for checking if a feature is implemented consistently across environments.

---

## Fleet Completeness Widget

Below the search results, the Fleet Completeness widget shows:

- How many sites are indexed (L1/L2/L3 depth)
- Which sites have stale or missing index data
- A **Schedule** button to trigger background indexing for all local sites

**Index levels:**
| Level | What it means |
|---|---|
| L1 | Site exists, filesystem scanned |
| L2 | WP version, plugins, PHP from WP-CLI |
| L3 | Content embedded in vector database |

Sites at L1 or L2 can answer metadata questions. Only L3 sites support semantic content search.

---

## Indexing

Content must be indexed before it appears in search results. Nexus AI indexes sites automatically when they start (opportunistic scheduler) or you can trigger manually:

```bash
# Index a specific site
nexus content index mysite@local

# Index all running sites
nexus content index-all
```

Or use the Operations tab → **"Index content"** button for fleet-wide indexing.

---

## Fixture Sites

The Search tab works best when your common sites (e.g. `nexus-e2e-test`, `nexus-e2e-cli-test-site`) are indexed. These are pre-existing sites you create once:

```bash
nexus sites create nexus-e2e-test@local
nexus sites start nexus-e2e-test@local
```

The test suite uses these as fixture sites — they persist across test runs and are not created automatically.

---

## Related

- [Fleet Overview](./fleet-overview.md) — Higher-level fleet health view
- [Site Finder](./site-finder.md) — Full-screen semantic search overlay (`Cmd+K`)
- [Preferences — Scheduler](./preferences.md#scheduler) — Configure background indexing interval
