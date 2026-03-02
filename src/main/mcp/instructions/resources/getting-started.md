# Getting Started with Nexus AI

Nexus AI provides WordPress site intelligence through MCP tools. It connects to Local by Flywheel for local site management and optionally to WP Engine for cloud operations.

## Discovery First

Always start by discovering available sites:

- `local_list_sites` — List all local WordPress sites with their status (running/halted)
- `nexus_list_sites` — Unified view of local sites + WP Engine installs (if connected)

These tools return site IDs, names, and domains needed by all other tools. Never ask the user for identifiers — discover them.

## Tool Modules

### Site Management (`local_*`)
Start, stop, restart, create, delete, clone, and export local sites. Manage SSL certificates and PHP versions.

### WordPress CLI (`wp_*`)
Inspect and manage WordPress: plugins, themes, users, options, database, and site health. Works locally (via `site` parameter) or remotely on WP Engine (via `install_name` parameter).

### Content Intelligence
- `search_site_content` — Semantic search within a site's indexed content
- `search_across_sites` — Search across all indexed sites
- `get_site_structure` — Deep structural analysis (plugins, themes, custom tables, REST API)
- `reindex_site` — Trigger content re-indexing

### Fleet Tools (`fleet_*`)
Cross-site analysis: version distribution, plugin usage, configuration drift, side-by-side comparison.

### WP Engine (`wpe_*`)
Account and install management, backups, cache purging, push/pull sync between local and cloud.

### Ollama
Local LLM integration for AI-assisted development tasks.

## Quick Start

1. Call `local_list_sites` to see your sites
2. Pick a running site and call `wp_plugin_list` to see its plugins
3. Call `get_site_structure` for a deep structural overview
4. Use `search_site_content` to find specific content
