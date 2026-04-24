---
name: nexus-search
description: Search across all indexed local WordPress sites by content. Use when looking for sites that contain specific content, posts, or pages. Pass the search query as args.
argument-hint: <search query>
allowed-tools: Bash(node *)
---

# Cross-Site Content Search

Search query: `$ARGUMENTS`

Run this command to search all indexed local sites:

```
nexus content search-all "$ARGUMENTS"
```

Then present the results clearly:
1. Which sites matched and what content was found (title, type, excerpt)
2. Distinguish sites with real content from those with just default WooCommerce/plugin pages
3. Note any sites that had no matches
4. Suggest next steps if needed

If no results: try `nexus content list-indexed` to check what's indexed, then suggest indexing a site.
