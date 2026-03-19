/**
 * Server-level instructions returned in the MCP initialize response.
 *
 * This text guides AI agents on how to use the nexus-ai tools effectively.
 * Edit this file and run `npm run test:eval` to validate structural quality.
 */
export const INSTRUCTIONS = `
# Nexus AI — WordPress Site Intelligence

You have access to tools for managing WordPress sites locally (via Local by Flywheel) and remotely (via WP Engine). Always follow these principles.

## Discovery First

ALWAYS call \`local_list_sites\` or \`nexus_list_sites\` before using any other tool. These return site IDs, names, domains, and statuses needed by all other tools. Never ask the user for a site ID or name — discover them.

## Tool Routing

Route user requests to the correct tool namespace:

| User intent | Tool namespace | Examples |
|-------------|---------------|----------|
| List/find sites | \`local_list_sites\`, \`nexus_list_sites\` | "what sites do I have?", "show my sites" |
| Site lifecycle | \`local_start_site\`, \`local_stop_site\`, \`local_restart_site\` | "start my blog", "stop the test site" |
| Create/delete sites | \`local_create_site\`, \`local_delete_site\` | "make a new site", "remove old-project" |
| WordPress info | \`wp_core_version\`, \`wp_plugin_list\`, \`wp_theme_list\`, \`wp_user_list\` | "what plugins?", "WP version?" |
| Plugin management | \`wp_plugin_install\`, \`wp_plugin_activate\`, \`wp_plugin_deactivate\`, \`wp_plugin_update\` | "install ACF", "update all plugins" |
| Site options | \`wp_option_get\` | "what's the site title?" |
| Site health | \`wp_site_health\` | "is the site healthy?" |
| Site audit | \`nexus_site_audit\` | "audit my blog", "check everything on test-site" |
| Database | \`wp_db_export\`, \`wp_search_replace\` | "export the database", "change domain" |
| Fleet overview | \`fleet_summary\`, \`find_sites_with_plugin\`, \`compare_sites\`, \`detect_drift\` | "which sites use WooCommerce?" |
| Fleet plugin audit | \`nexus_plugin_audit\` | "audit plugins across all sites", "what needs updating?" |
| Content search | \`search_site_content\`, \`search_across_sites\` | "find posts about pricing" |
| Site structure | \`get_site_structure\`, \`get_index_status\`, \`reindex_site\` | "what's installed on this site?" |
| WP Engine accounts | \`wpe_get_accounts\`, \`wpe_get_installs\` | "show my WPE installs" |
| WP Engine ops | \`wpe_create_backup\`, \`wpe_purge_cache\` | "backup production", "clear cache" |
| Sync with WPE | \`local_wpe_pull\`, \`local_wpe_push\` | "pull from staging", "push to dev" |
| AI abilities | \`wp_list_abilities\`, \`wp_run_ability\` | "what abilities does this site have?", "run acf/list-field-groups" |
| AI credentials | \`wp_sync_ai_credentials\` | "sync API keys to the site" |
| Local LLM | \`ask_ollama\`, \`list_ollama_models\` | "ask Ollama about this code" |

### Ollama Site Context

\`ask_ollama\` accepts an optional \`site\` parameter. When provided, the tool injects the site's structure (theme, plugins, WP version) and relevant indexed content into the system prompt, giving the local LLM site-aware context. \`list_ollama_models\` includes hardware-aware model recommendations based on available RAM.

## Local vs Remote Execution

WP-CLI tools (\`wp_*\`) support two execution modes:

- **Local execution**: Pass \`site\` parameter (site name, ID, or domain). Commands run against the local WordPress site via Local's WP-CLI.
- **Remote execution**: Pass \`install_name\` parameter (WPE install name). Commands run via SSH on the remote WP Engine environment.

Use \`site\` for local development sites. Use \`install_name\` for production/staging sites on WP Engine. Never pass both.

Some commands are blocked remotely for safety: \`eval\`, \`eval-file\`, \`shell\`, \`db query\`, \`db cli\`.

Three tools are local-only and do not support \`install_name\`: \`wp_db_export\`, \`wp_search_replace\`, \`wp_site_health\`.

## Safety

Tools are classified into three safety tiers:

- **Tier 1 (read-only)**: Execute immediately. No side effects. Examples: \`local_list_sites\`, \`wp_plugin_list\`.
- **Tier 2 (modifying)**: Execute and log. Changes state but is recoverable. Examples: \`local_start_site\`, \`wp_plugin_install\`.
- **Tier 3 (destructive)**: Requires confirmation token. The first call returns a confirmation prompt with a token. Call again with \`_confirmationToken\` to proceed. Example: \`local_delete_site\`.

Always use \`wp_plugin_update\` with dry-run awareness — check what will change before updating. Use \`wp_search_replace\` in dry-run mode first to preview changes.

## Presentation

- Format results as markdown tables or bulleted lists, not raw JSON.
- Group sites by status: show running sites first, then halted.
- When listing plugins, show name, version, and status (active/inactive).
- For fleet operations, summarize totals and highlight outliers.
- Include version numbers when reporting WordPress or PHP versions.

## Resources

For detailed guides, use \`resources/read\` with these URIs:
- \`nexus://guide/getting-started\` — Tool overview and orientation
- \`nexus://guide/safety\` — Safety tier system details
- \`nexus://guide/remote-wp-cli\` — Remote execution via SSH
- \`nexus://guide/workflows/site-setup\` — New site provisioning
- \`nexus://guide/workflows/wpe-sync\` — Push/pull with WP Engine
- \`nexus://guide/workflows/content-search\` — Indexing and semantic search
`.trim();
