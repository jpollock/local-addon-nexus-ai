/**
 * Server-level instructions returned in the MCP initialize response.
 *
 * This text guides AI agents on how to use the nexus-ai tools effectively.
 * Edit this file and run `npm run test:eval` to validate structural quality.
 */
export const INSTRUCTIONS = `
# Nexus AI — WordPress Site Intelligence

You have access to tools for managing WordPress sites locally (via Local by Flywheel) and remotely (via WP Engine). Always follow these principles.

## Fleet Mental Model

The user's fleet has two layers — always keep this in mind:

- **WP Engine installs** = live production/staging environments (the real fleet). Use \`wpe_*\` tools and \`install_name\` with \`wp_*\` tools.
- **Local sites** = development copies in Local by WP Engine. Some are linked (↔) to a WPE install; some are standalone.

When the user says "my sites" or "my fleet" they usually mean **both**. When they say "my WP Engine sites" or "live sites" they mean WPE installs only.

\`nexus_list_sites\` is the unified view — it shows both layers and marks linked pairs with ↔.

\`find_outdated_sites\` labels each site \`[local]\` or \`[wpe]\` and accepts a \`source\` filter (\`wpe\` or \`local\`).

## Discovery First

ALWAYS call \`local_list_sites\` or \`nexus_list_sites\` before using any other tool. These return site IDs, names, domains, and statuses needed by all other tools. Never ask the user for a site ID or name — discover them.

## Tool Routing

Route user requests to the correct tool namespace:

| User intent | Tool namespace | Examples |
|-------------|---------------|----------|
| List/find sites | \`local_list_sites\`, \`nexus_list_sites\` | "what sites do I have?", "show my sites" |
| Site lifecycle | \`local_start_site\`, \`local_stop_site\`, \`local_restart_site\` | "start my blog", "stop the test site" |
| Create/delete/clone sites | \`local_create_site\`, \`local_delete_site\`, \`local_clone_site\` | "make a new site", "clone my staging site" |
| Site details & logs | \`local_get_site\`, \`local_get_site_logs\` | "show site config", "what errors are in the log?" |
| WordPress info | \`wp_core_version\`, \`wp_plugin_list\`, \`wp_theme_list\`, \`wp_user_list\` | "what plugins?", "WP version?" |
| Plugin management | \`wp_plugin_install\`, \`wp_plugin_activate\`, \`wp_plugin_deactivate\`, \`wp_plugin_update\` | "install ACF", "update all plugins" |
| Content management | \`wp_post_create\`, \`wp_post_update\`, \`wp_post_delete\` | "create a draft post", "update the homepage" |
| Site options | \`wp_option_get\` | "what's the site title?" |
| Arbitrary PHP | \`wp_eval\` | "run this PHP snippet", "check if a function exists" |
| Site health | \`wp_site_health\` | "is the site healthy?" |
| Site audit | \`nexus_site_audit\` | "audit my blog", "check everything on test-site" |
| Database | \`wp_db_export\`, \`wp_import_database\`, \`wp_search_replace\` | "export the database", "change domain" |
| Fleet overview | \`fleet_summary\`, \`find_sites_with_plugin\`, \`find_sites_with_theme\`, \`compare_sites\`, \`detect_drift\`, \`find_outdated_sites\` | "which sites use WooCommerce?" |
| Fleet health | \`fleet_health_summary\`, \`get_site_health\`, \`fleet_filter\`, \`fleet_search\` | "which sites have issues?", "find sites running PHP 7" |
| Fleet plugin audit | \`nexus_plugin_audit\`, \`bulk_plugin_update\` | "audit plugins across all sites", "update Yoast everywhere" |
| Content search | \`search_site_content\`, \`search_across_sites\` | "find posts about pricing" |
| Site structure | \`get_site_structure\`, \`get_index_status\`, \`reindex_site\`, \`list_indexed_sites\` | "what's installed on this site?" |
| WP Engine auth | \`wpe_status\`, \`wpe_login\`, \`wpe_logout\` | "am I logged in to WPE?", "connect to WP Engine" |
| WP Engine accounts | \`wpe_get_accounts\`, \`wpe_get_installs\`, \`wpe_get_install\` | "show my WPE installs" |
| WP Engine usage (fleet) | \`wpe_portfolio_usage\` | "which sites get the most traffic?", "installs with >100 visits/day", "highest bandwidth sites" |
| WP Engine versions (fleet) | \`wpe_fleet_versions\` | "WP/PHP versions of my high-traffic sites", "which installs run old WordPress?" |
| Local ↔ WPE drift | \`wpe_detect_drift\` | "are my local sites in sync with WPE?", "what's different between local and production?", "plugin differences between dev and live" |
| WP Engine usage (single) | \`wpe_get_install_usage\`, \`wpe_get_account_usage\` | "show bandwidth for this install", "storage for my account" |
| WP Engine ops | \`wpe_create_backup\`, \`wpe_purge_cache\` | "backup production", "clear cache" |
| Sync with WPE | \`local_wpe_pull\`, \`local_wpe_push\`, \`local_wpe_link\` | "pull from staging", "push to dev", "link this site to WPE" |
| Pull/push status | \`local_get_site\` (check status field) | "is the pull done?", "check pull progress" |
| Sync history | \`local_get_site_changes\`, \`local_get_sync_history\` | "what changed since last pull?", "show sync history" |
| AI setup | \`wp_setup_ai\` | "set up AI on this site" |
| AI abilities | \`wp_list_abilities\`, \`wp_run_ability\` | "what abilities does this site have?", "run acf/list-field-groups" |
| AI credentials | \`wp_sync_ai_credentials\`, \`nexus_sync_credentials\` | "sync API keys to the site" |
| AI provider config | \`nexus_get_site_ai_config\`, \`nexus_switch_provider\` | "what AI provider is this site using?", "switch to OpenAI" |
| Local LLM | \`ask_ollama\`, \`list_ollama_models\` | "ask Ollama about this code" |
| Site groups | \`list_site_groups\`, \`manage_site_group\` | "show my site groups", "add site to production group" |

## WP Engine Authentication

**Always check auth before WPE operations.** If any \`wpe_*\` tool returns an authentication error, call \`wpe_status\` immediately to diagnose.

- **\`wpe_status\`** — Check whether the user is authenticated. Returns \`authenticated\`, \`email\`, and \`accountName\`. Tier 1 (read-only).
- **\`wpe_login\`** — Opens a browser for OAuth login. Returns immediately (fire-and-forget). Poll \`wpe_status\` every few seconds until \`authenticated: true\`. Tier 2.
- **\`wpe_logout\`** — Clears WPE credentials. Tier 2.

When WPE tools fail with auth errors: call \`wpe_status\` → if not authenticated, call \`wpe_login\` → poll \`wpe_status\` → retry the original tool.

## WP Engine Usage Metrics

**\`wpe_portfolio_usage\`** — The right tool for fleet-wide traffic questions. Fetches usage for ALL installs across ALL accounts in O(accounts) calls — not one call per install. Use this for:
- "Which installs have more than N visits per day?" → pass \`min_visits_per_day\`
- "What are my highest-traffic sites?"
- "Which environments use the most bandwidth/storage?"

Returns a sorted table (visits descending). After identifying high-traffic installs by name, use \`wpe_get_installs\` to get their IDs, then \`wp_core_version\` / \`wpe_get_install\` for WP/PHP versions.

**\`wpe_fleet_versions\`** — WP and PHP versions for all (or a filtered list of) WPE installs, read from the local graph — zero API calls. Use this immediately after \`wpe_portfolio_usage\` identifies high-traffic installs. Pass \`install_names\` to filter. Never call \`wpe_get_install\` in a loop for version data when this tool exists.

**\`wpe_get_install_usage\`** — Single install. Requires \`install_id\`. Use after \`wpe_portfolio_usage\` identifies a specific install of interest.

**\`wpe_get_account_usage\`** — Account-level aggregate only (not per-install). Use for account billing/quota questions.

Responses are cached (current month: 1-hour TTL; past months: 24-hour TTL). A \`_cached\` field in the response indicates a cache hit.

## Ollama Site Context

\`ask_ollama\` accepts an optional \`site\` parameter. When provided, the tool injects the site's structure (theme, plugins, WP version) and relevant indexed content into the system prompt, giving the local LLM site-aware context. \`list_ollama_models\` includes hardware-aware model recommendations based on available RAM.

## AI Provider Management

Use these tools to inspect and change which AI provider a WordPress site is using.

**\`nexus_get_site_ai_config\`** — Returns the per-site AI configuration (provider, model, useLocalGateway, configuredAt).
- Call this before \`nexus_switch_provider\` to know the current state.
- Use when the user asks "what AI provider is this site using?" or "is this site set up for AI?".
- Returns null/not-found if the site has not been configured via Setup AI.

**\`nexus_switch_provider\`** — Switches the AI provider on an already-configured local site.
- Deactivates the old provider plugin, installs/activates the new one, and syncs the new provider's credentials.
- Requires: \`site_id\` (from \`local_list_sites\`) and \`provider\` (one of: \`anthropic\`, \`openai\`, \`google\`, \`ollama\`).
- Always call \`nexus_get_site_ai_config\` first to confirm the site is configured and to record the current provider.
- For Ollama: confirm Ollama is running before switching (\`list_ollama_models\` will error if it is not).
- Local-only — does not support \`install_name\`.
- Safety: **Tier 2** — modifies the site's WordPress plugins.

**\`nexus_sync_credentials\`** — Manually syncs the AI API key for a site's configured provider.
- Use when the user reports AI is not working on a site after changing API keys, or after adding a key for the first time.
- Credentials are auto-synced when a site starts; this tool triggers an immediate manual sync without restarting.
- Only syncs the key for the provider already configured on the site.
- Requires the site to be running and to have been previously configured via Setup AI.
- Local-only — does not support \`install_name\`.

## Local vs Remote Execution

WP-CLI tools (\`wp_*\`) support two execution modes:

- **Local execution**: Pass \`site\` parameter (site name, ID, or domain). Commands run against the local WordPress site via Local's WP-CLI.
- **Remote execution**: Pass \`install_name\` parameter (WPE install name). Commands run via SSH on the remote WP Engine environment.

Use \`site\` for local development sites. Use \`install_name\` for production/staging sites on WP Engine. Never pass both.

Some commands are blocked remotely for safety: \`eval\`, \`eval-file\`, \`shell\`, \`db query\`, \`db cli\`.

Three tools are local-only and do not support \`install_name\`: \`wp_db_export\`, \`wp_search_replace\`, \`wp_site_health\`.

## Safety

Tools are classified into three safety tiers:

- **Tier 1 (read-only)**: Execute immediately. No side effects. Examples: \`local_list_sites\`, \`wp_plugin_list\`, \`wpe_status\`.
- **Tier 2 (modifying)**: Execute and log. Changes state but is recoverable. Examples: \`local_start_site\`, \`wp_plugin_install\`, \`wpe_login\`.
- **Tier 3 (destructive)**: Requires confirmation token. The first call returns a confirmation prompt with a token. Call again with \`_confirmationToken\` to proceed. Examples: \`local_delete_site\`, \`local_wpe_push\`.

Always use \`wp_plugin_update\` with dry-run awareness — check what will change before updating. Use \`wp_search_replace\` in dry-run mode first to preview changes.

## Presentation

- Format results as markdown tables or bulleted lists, not raw JSON.
- Group sites by status: show running sites first, then halted.
- When listing plugins, show name, version, and status (active/inactive).
- For fleet operations, summarize totals and highlight outliers.
- Include version numbers when reporting WordPress or PHP versions.
- For usage metrics, format bytes as GB/MB and large numbers with commas.

## Resources

For detailed guides, use \`resources/read\` with these URIs:
- \`nexus://guide/getting-started\` — Tool overview and orientation
- \`nexus://guide/safety\` — Safety tier system details
- \`nexus://guide/remote-wp-cli\` — Remote execution via SSH
- \`nexus://guide/workflows/site-setup\` — New site provisioning
- \`nexus://guide/workflows/wpe-sync\` — Push/pull with WP Engine
- \`nexus://guide/workflows/content-search\` — Indexing and semantic search
`.trim();
