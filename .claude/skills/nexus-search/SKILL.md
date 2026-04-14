---
name: nexus-search
description: Search across all indexed local WordPress sites by content, plugins, themes, PHP version, or WP version. Use when looking for sites that contain specific content or have specific characteristics.
argument-hint: <query>
allowed-tools: Bash(nexus *)
---

# Cross-Site Search

Query: `$ARGUMENTS`

```!
nexus search "$ARGUMENTS"
```

Present results clearly:

1. **Matching sites** — name, domain, why it matched
2. **Content matches** — relevant excerpts if it's a content search
3. **Metadata matches** — plugin/theme/version matches if filtering by those

If no query was provided, ask what to search for. Examples:
- Content: `nexus search "pricing plans"` — finds sites with that content
- Plugin: `nexus search --plugin woocommerce` — finds sites with WooCommerce
- PHP version: `nexus search --php 8.1` — finds sites on PHP 8.1
- WP version: `nexus search --wp 6.8` — finds sites on WP 6.8

After showing results, suggest what action makes sense (open a site, compare content, bulk update, etc.).
