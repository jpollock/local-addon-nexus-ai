/**
 * Server-level instructions returned in the MCP initialize response.
 *
 * This text guides AI agents on how to use the nexus-ai tools effectively.
 * Edit this file and run `npm run test:eval` to validate structural quality.
 */
export const INSTRUCTIONS = `
# Nexus AI — WordPress Site Intelligence

You have access to tools for managing WordPress sites locally (via Local by WP Engine) and remotely (via WP Engine). Always follow these principles.

## Fleet Mental Model

**Fleet = all WordPress sites the user manages through this Nexus AI instance.**

Fleet type is determined by what's in the data layer — not by current authentication state:

- **Local-only user:** No WP Engine installs in graph.db (\`source='wpe'\` count = 0). Local sites ARE the complete fleet. Do NOT mention WPE, suggest WPE tools, or imply their fleet is partial.
- **WPE customer:** WP Engine installs exist in graph.db (\`source='wpe'\` count > 0). Fleet = local sites + WPE installs. Always include both layers in fleet-wide answers.

**Canonical "tell me about my fleet" tool:** \`fleet_overview\` — it auto-detects fleet type and returns the right answer for both user types. Always use \`fleet_overview\` for open-ended fleet overview questions.

**Other fleet tools and their scope:**
- \`nexus_fleet_summary\` — local site twins only (correct for local-only users; partial for WPE customers)
- \`fleet_health_summary\`, \`fleet_search\` — local sites only
- \`fleet_sql\` — all sites in graph.db (local + WPE if synced)
- \`wpe_fleet_health\`, \`wpe_portfolio_overview\` — WPE installs only

## Discovery First

**Step 0 — read the fleet cache before any workflow:**
\`\`\`
resources/read nexus://fleet/state
\`\`\`
This returns the cached WPE install table (install_name, install_id, environment) and local site list (site_name, AI config). Use it to answer: does a local site exist for this WPE install? What is the install_id? This costs zero tool calls and prevents mid-workflow surprises.

**Step 1 — then call \`nexus_list_sites\`** for live running/halted status and WPE environment links.

**Step 2 — if unsure which tool to use for an operation, call \`search_tools(query)\`** before guessing. With 160+ tools available, searching is faster and more accurate than scanning descriptions mentally.

Examples:
- search_tools("backup wpe install")
- search_tools("update plugins remote site")
- search_tools("domain ssl certificate")

Never ask the user for a site ID or name — discover them from the cache or nexus_list_sites.

Before calling \`local_get_site_changes\`, \`local_wpe_pull\`, or \`local_wpe_push\`, confirm a local site exists by reading \`nexus://fleet/state\`. If no local site is found, tell the user and offer to create one with \`local_create_site\` before proceeding.

## Knowledge Cutoff — Always Verify Before Asserting

Your training data has a cutoff date. Software versions, plugin releases, and WordPress major versions may have shipped after it.

**Never contradict a user's assertion about a software version existing without first verifying with live data.**

Example — user says "myloop is running WP 7.0":
- WRONG: Asserting "WordPress 7.0 doesn't exist" based on training data
- RIGHT: Call fleet_sql with query "SELECT name, wp_version FROM sites WHERE wp_version LIKE '7.%'" → confirms sites on 7.0 → accept the user's claim

**Rule:** When a user claims a version exists or asks about a specific version number, run \`fleet_sql\` or \`wp_core_version\` to check the live data first. If the data confirms it, accept the user's claim. Never use training data to override live query results. WordPress, PHP, and plugin versions continue to release after your knowledge cutoff.

## Safety

Tools are classified into three safety tiers:

- **Tier 1 (read-only)**: Execute immediately. No side effects. Examples: \`local_list_sites\`, \`wp_plugin_list\`, \`wpe_status\`.
- **Tier 2 (modifying)**: Execute and log. Changes state but is recoverable. Examples: \`local_start_site\`, \`wp_plugin_install\`, \`wpe_login\`.
- **Tier 3 (destructive)**: Requires confirmation token. The first call returns a confirmation prompt with a token. Call again with \`_confirmationToken\` to proceed. Examples: \`local_delete_site\`, \`local_wpe_push\`.

Always use \`wp_plugin_update\` with dry-run awareness — check what will change before updating. Use \`wp_search_replace\` in dry-run mode first to preview changes.

**Plugin update blockers:** If \`wp_plugin_update\` skips plugins citing a WP version requirement, run \`wp_core_update\` to upgrade WordPress core first, then re-run \`wp_plugin_update\` with slug=--all.

**WPE destructive operations** (\`wpe_delete_install\`, \`wpe_delete_site\`, \`wpe_delete_domain\`, \`wpe_delete_account_user\`, \`wpe_delete_ssh_key\`, \`wpe_promote_environment\`) have additional guards beyond the standard token:
- \`wpe_delete_install\`: requires \`confirm_install_name\` matching the install name exactly, and warns if no backup within 7 days
- \`wpe_delete_site\`: requires \`confirm_site_name\` matching the site name exactly, shows all installs that will be deleted
- \`wpe_promote_environment\`: fetches both installs and checks destination backup recency before issuing token

## Long-Running Operations (Pull / Push / Export)

\`local_wpe_pull\`, \`local_wpe_push\`, and \`local_export_site\` are **async** — they return immediately with \`status: "in_progress"\` while the operation runs in the background (typically 1-5 minutes).

**Always poll \`local_operation_status\` after starting one. Proceed to the next step only when status=completed.**

  1. Start: \`local_wpe_pull\` / \`local_wpe_push\` / \`local_export_site\` — returns in_progress immediately
  2. Poll: \`local_operation_status({ site: "..." })\` every 15-30 seconds
  3. Done: status=completed — proceed to next step
  4. Info: last_message shows current phase, recent_files shows transfer progress

**Push/pull timeout:** For large sites (1+ GB), the MCP connection may time out — this does NOT mean the operation failed. The transfer continues in Local. Immediately poll \`local_operation_status\` to track real progress. Do not retry.

For pull/push/export progress, use \`local_operation_status\` — not \`local_get_site\` (which only shows running/halted, not operation progress).

## Tool Routing

Route user requests to the correct tool namespace:

| User intent | Tool namespace | Examples |
|-------------|---------------|----------|
| List/find sites | \`local_list_sites\`, \`nexus_list_sites\` | "what sites do I have?", "show all running sites", "how many local sites do I have?", "is my-blog running?" |
| Site lifecycle | \`local_start_site\`, \`local_stop_site\`, \`local_restart_site\` | "start my blog", "stop the test site", "restart the staging site", "bring nexus-e2e-test online" |
| Create/delete/clone sites | \`local_create_site\`, \`local_delete_site\`, \`local_clone_site\` | "make a new site", "clone my staging site", "delete the old demo site", "create a copy of myshop for testing" |
| Site details & logs | \`local_get_site\`, \`local_get_site_logs\` | "show site config", "what errors are in the log?", "show PHP errors for my-shop", "what's the local domain for this site?" |
| WordPress info | \`wp_core_version\`, \`wp_plugin_list\`, \`wp_theme_list\`, \`wp_user_list\` | "what plugins are installed?", "what's the WP version?", "who are the admins on this site?", "what's the active theme?", "is WooCommerce active?" |
| WordPress core update | \`wp_core_update\` | "update WordPress", "upgrade WP core to latest", "what version of WordPress is available?" |
| Plugin management | \`wp_plugin_install\`, \`wp_plugin_activate\`, \`wp_plugin_deactivate\`, \`wp_plugin_update\` | "install ACF", "update all plugins", "install woocommerce version 7.4.0", "deactivate WooCommerce", "check if there are plugin updates available", "activate the SEO plugin" |
| Theme activation / crash recovery | \`wp_theme_activate\` | "switch to twentytwentyone", "active theme crashes WP, switch to older theme", "reset to a default theme" — works even when active theme breaks bootstrap |
| Content management | \`wp_post_create\`, \`wp_post_update\`, \`wp_post_delete\` | "create a draft post", "update the homepage", "publish a new page titled 'About Us'", "delete the draft from last week" |
| Site options | \`wp_option_get\` | "what's the site title?", "what's the admin email?", "what's the site URL?", "is this a multisite install?" |
| Arbitrary PHP (last resort) | \`wp_eval\` | Only when NO dedicated tool exists. Check wp_post_create, wp_plugin_install, wp_option_get, wp_search_replace first. LOCAL ONLY. |
| Site health | \`wp_site_health\` | "is the site healthy?", "run a health check on my blog", "are there any site health warnings?" |
| Site audit (local only) | \`nexus_site_audit\` | "audit my blog", "check everything on test-site", "give me a full report on nexus-e2e-test" — local sites only; for remote WPE use \`wp_plugin_list\` + \`wp_core_version\` with install_name= |
| Database | \`wp_db_export\`, \`wp_import_database\`, \`wp_search_replace\` | "export the database", "change the domain in the database", "replace all references to old-domain.com", "import a SQL backup" |
| Fleet overview (local + WPE) | \`find_sites_with_plugin\`, \`find_sites_with_theme\`, \`compare_sites\`, \`detect_drift\`, \`find_outdated_sites\` | "which sites use WooCommerce?", "which sites share the Astra theme?", "which sites have ACF installed?", "find all sites with both WooCommerce and Stripe", "which sites are running outdated software?" |
| Full fleet overview ("tell me about my fleet") | \`fleet_overview\` | "tell me about my fleet", "give me a fleet summary", "what's the state of all my sites?", "how many total sites do I manage?", "fleet overview" — this tool auto-detects local-only vs WPE customer and returns the right answer for both |
| Fleet analytics — counts & activity | \`nexus_get_fleet_twins\`, \`nexus_get_site_twin\`, \`fleet_sql\` | "how many posts do I have across all sites?", "which site was edited most recently?", "which sites haven't been updated in months?", "total user count across my fleet?", "how many pages do I have fleet-wide?" — see Fleet Analytics section for aggregation pattern |
| Fleet health (local sites) | \`fleet_health_summary\`, \`get_site_health\`, \`fleet_filter\` | "which local sites have issues?", "show sites with health score below 50", "find sites on EOL PHP", "which sites have large databases?" — LOCAL ONLY; for WPE health use \`wpe_fleet_health\` |
| Fleet content search (local sites) | \`fleet_search\`, \`search_across_sites\` | "search my local sites for posts about pricing", "find content across indexed local sites" — LOCAL ONLY; for WPE content search use \`search_site_content\` with install_name= |
| Fleet plugin audit | \`nexus_plugin_audit\`, \`bulk_plugin_update\` | "audit plugins across all sites", "update Yoast everywhere", "which sites have outdated WooCommerce?", "what's the newest version of ACF running in my fleet?" |
| Content search | \`search_site_content\`, \`search_across_sites\` | "find posts about pricing", "which site has documentation on our checkout flow?", "search my entire fleet for 'subscription'", "where did I write about SMTP configuration?" |
| Site index & structure | \`get_site_structure\`, \`get_index_status\`, \`reindex_site\`, \`list_indexed_sites\` | "what's installed on this site?", "is this site indexed?", "when was this site last indexed?", "reindex my blog's content", "which sites are ready for content search?" |
| WP Engine auth | \`wpe_status\`, \`wpe_login\`, \`wpe_logout\` | "am I logged in to WPE?", "connect to WP Engine", "check my WPE authentication status", "log out of WP Engine" |
| WP Engine accounts | \`wpe_get_accounts\`, \`wpe_get_installs\`, \`wpe_get_install\` | "show my WPE installs", "what accounts do I have access to?", "list all my WP Engine environments", "show details for the jppwpeplugin install" |
| WP Engine account details | \`wpe_get_account\`, \`wpe_get_account_limits\` | "show account details", "am I near my plan limits?", "how many sites can I have on this plan?", "what's my storage limit?" |
| WP Engine account users | \`wpe_get_account_users\`, \`wpe_get_account_user\`, \`wpe_create_account_user\`, \`wpe_update_account_user\`, \`wpe_delete_account_user\` | "who has access to WP Engine?", "add a new user to the account", "remove portal access for someone", "change a user's role to billing-only" |
| WP Engine user audit | \`wpe_user_audit\`, \`wpe_add_user_to_accounts\` | "audit all users across accounts", "add a user to multiple accounts at once", "who has full admin access across all my accounts?" |
| WP Engine usage insights | \`wpe_get_account_usage_summary\`, \`wpe_get_account_usage_insights\` | "detailed usage breakdown", "usage by environment type", "how much bandwidth did production use vs staging?", "show storage split by environment" |
| WP Engine usage (fleet) | \`wpe_portfolio_usage\` | "which sites get the most traffic?", "installs with >100 visits/day", "highest bandwidth sites", "which of my WPE environments is using the most storage?", "show me last month's usage" |
| WP Engine versions (fleet) | \`wpe_fleet_versions\` | "WP/PHP versions of my high-traffic sites", "which installs run old WordPress?", "show me all WPE sites on PHP 8.1 or below" |
| Local ↔ WPE drift | \`wpe_detect_drift\` | "are my local sites in sync with WPE?", "what's different between local and production?", "plugin differences between dev and live", "has anything changed in production that I haven't pulled locally?" |
| WP Engine usage (single install) | \`wpe_get_install_usage\` | "show bandwidth for jppwpeplugin this month" — use \`wpe_portfolio_usage\` for fleet-wide questions |
| WP Engine sites | \`wpe_get_sites\`, \`wpe_get_site\`, \`wpe_create_site\`, \`wpe_update_site\`, \`wpe_delete_site\` | "list my WPE sites", "create a new WPE site", "rename this site", "delete the old demo site" |
| WP Engine install lifecycle | \`wpe_create_install\`, \`wpe_update_install\`, \`wpe_delete_install\`, \`wpe_get_backup\` | "create a staging environment", "delete the dev install", "check backup status", "change the PHP version for this install", "upgrade install to PHP 8.3" |
| WP Engine environment promotion | \`wpe_promote_environment\` | "promote staging to production", "copy the staging install to production", "push staging live" |
| WP Engine domain management | \`wpe_get_domains\`, \`wpe_create_domain\`, \`wpe_update_domain\`, \`wpe_delete_domain\`, \`wpe_check_domain_status\`, \`wpe_create_domains_bulk\` | "add a domain", "check DNS propagation", "set primary domain", "add multiple redirects at once", "remove an old domain" |
| WP Engine SSL management | \`wpe_get_ssl_certificates\`, \`wpe_request_ssl_certificate\`, \`wpe_import_ssl_certificate\`, \`wpe_account_ssl_status\` | "check SSL certs", "request a Let's Encrypt cert", "SSL status across the account", "which certs expire soon?", "import a custom wildcard cert" |
| WP Engine SSH keys | \`wpe_get_ssh_keys\`, \`wpe_create_ssh_key\`, \`wpe_delete_ssh_key\` | "add my SSH key to WPE", "list registered SSH keys", "remove an old key" |
| WP Engine offload/LargeFS | \`wpe_get_offload_settings\`, \`wpe_update_offload_settings\`, \`wpe_get_largefs_validation\` | "check media offload config", "validate LargeFS setup", "enable S3 offload" |
| WP Engine ops | \`wpe_create_backup\`, \`wpe_purge_cache\` | "backup production", "clear the cache", "flush the page cache after a deploy" |
| WP Engine backup (verified) | \`wpe_backup_and_verify\` | "create and confirm a backup", "back up and wait until it's done", "verified backup before promoting staging" |
| WP Engine go-live | \`wpe_go_live_checklist\`, \`wpe_prepare_go_live\` | "is this ready to go live?", "set up domain and SSL", "run pre-launch checks", "configure the production domain and provision HTTPS" |
| WP Engine fleet diagnosis | \`wpe_fleet_health\`, \`wpe_diagnose_site\`, \`wpe_portfolio_overview\` | "health of all installs", "diagnose this install", "fleet executive summary", "what's wrong with jppwpeplugin?" |
| WP Engine account overview | \`wpe_account_overview\`, \`wpe_installs_by_account\`, \`wpe_environment_diff\` | "account summary", "compare staging vs production", "show all installs grouped by account", "what's different between staging and prod?" |
| WP Engine disk usage | \`wpe_refresh_install_disk_usage\`, \`wpe_refresh_account_disk_usage\` | "refresh disk usage", "update storage numbers after a large upload" |
| Current WPE user | \`wpe_get_current_user\` | "who am I logged in as on WPE?", "confirm my WPE identity" |
| WPE API credentials | \`wpe_set_api_credentials\`, \`wpe_clear_api_credentials\`, \`wpe_credentials_status\` | "store WPE API credentials for backups", "backup creation failing with auth error", "check if backup credentials are configured" |
| Sync with WPE | \`local_wpe_pull\`, \`local_wpe_push\`, \`local_wpe_link\` | "pull from staging", "push to dev", "link this site to WPE", "pull production with database", "sync my local copy from WPE", "pull only the database from WPE" (use \`database_only: true\`) |
| Pull/push/export progress | \`local_operation_status\` | "is the pull done?", "check push progress", "how far along is the export?" — use this, NOT \`local_get_site\` which only shows running/halted |
| Sync history | \`local_get_site_changes\`, \`local_get_sync_history\` | "what changed since last pull?", "show sync history", "what files are different between my local and WPE?", "when did I last push?" |
| AI setup | \`wp_setup_ai\` | "set up AI on this site", "configure Claude on my blog", "enable AI experiments", "install the AI plugin on this site" |
| AI abilities | \`wp_list_abilities\`, \`wp_run_ability\` | "what AI abilities does this site have?", "generate a title for this post", "run the alt-text ability on my media", "list available AI writing tools" |
| AI credentials | \`wp_sync_ai_credentials\`, \`nexus_sync_credentials\` | "sync API keys to the site", "the AI plugin isn't connecting — sync credentials", "push my Anthropic key to the site" |
| AI provider config | \`nexus_get_site_ai_config\`, \`nexus_switch_provider\` | "what AI provider is this site using?", "switch to OpenAI", "is this site configured for AI?", "change the provider to Gemini" |
| Local LLM | \`ask_ollama\`, \`list_ollama_models\` | "ask Ollama about this site's plugins", "what Ollama models are available?", "query my site's content with a local model", "use llama3 to summarize this site" |
| Site groups | \`list_site_groups\`, \`manage_site_group\` | "show my site groups", "add site to production group", "create a group called 'client sites'", "which group is this site in?" |

## Fleet Analytics

For questions about **content counts, users, plugin inventory, versions, and site activity** across your fleet — use these patterns. Do not use \`fleet_summary\` for these questions.

### Available data (collected at L2, per site)

These fields are available on every indexed local site via \`nexus_get_site_twin\`:

| Field | Meaning | Caveat |
|-------|---------|--------|
| \`postCount\` | Published WordPress posts | WP post objects — NOT vector chunks |
| \`pageCount\` | Published WordPress pages | Same |
| \`userCount\` | Total WordPress users (all roles) | Combined, not broken down by role |
| \`lastPostAt\` | Unix timestamp of most recently modified post | Most recent published post modification |
| \`lastActiveSession\` | Timestamp of most recent session start still in \`session_tokens\` | See disambiguation below — NOT a true "last login" |
| \`phpVersion\` | PHP version from \`wp eval 'echo phpversion();'\` | Never use \`site.phpVersion\` from Local — it is stale |
| \`wpVersion\` | WordPress core version | |
| \`plugins[]\` | Installed plugins with \`is_active\`, \`version\`, \`slug\` | Active status from WP-CLI at last L2 scan |

### Analytics routing

| Question | Correct approach |
|----------|-----------------|
| "How many posts/pages across all sites?" | \`nexus_get_fleet_twins()\` → for each site \`nexus_get_site_twin(site)\` → sum \`postCount\` + \`pageCount\` |
| "Which site was most recently edited?" | \`nexus_get_fleet_twins()\` → sort by \`lastPostAt\` descending |
| "Which sites haven't been updated recently?" | Same → filter by \`lastPostAt\` older than threshold |
| "How many users across my fleet?" | \`nexus_get_fleet_twins()\` → sum \`userCount\` per site |
| "Which sites have plugin X?" | \`find_sites_with_plugin(plugin)\` — do NOT loop \`wp_plugin_list\` per site |
| "Which sites have X AND Y?" | \`find_sites_with_plugin(X)\` → intersect with \`find_sites_with_plugin(Y)\` |
| "Which plugins are outdated fleet-wide?" | \`nexus_plugin_audit()\` |
| "WP/PHP version distribution?" | \`nexus_get_fleet_twins()\` for local; \`wpe_fleet_versions()\` for WPE |
| "Which sites are on EOL PHP?" | \`fleet_filter("outdated-php")\` |
| "Which sites have database bloat?" | \`fleet_database_health()\` |
| "Which sites block search engines?" | \`fleet_sql\` with \`json_extract(settings_json, '$.blog_public') = '0'\` — add \`AND environment = 'production'\` to limit to WPE production |
| "Which sites are visible to search engines?" | \`fleet_sql\` with \`json_extract(settings_json, '$.blog_public') = '1'\` |
| "Which sites have comments disabled?" | \`fleet_sql\` with \`json_extract(settings_json, '$.default_comment_status') = 'closed'\` |
| "Which sites allow open registration?" | \`fleet_sql\` with \`json_extract(settings_json, '$.users_can_register') = '1'\` |
| "Which sites use a static front page?" | \`fleet_sql\` with \`json_extract(settings_json, '$.show_on_front') = 'page'\` |
| "Which sites use plain permalinks?" | \`fleet_sql\` with \`json_extract(settings_json, '$.permalink_structure') = ''\` |
| "Which sites have N+ admins?" | \`fleet_sql\` with \`CAST(json_extract(user_count_by_role, '$.administrator') AS INTEGER) >= N\` |

### WordPress settings via fleet_sql

**NEVER use \`wp_option_get\` in a loop to answer fleet-wide settings questions.** That approach is slow, requires sites to be running, and fails on halted sites. The \`settings_json\` column in graph.db already contains this data — one \`fleet_sql\` call answers the question instantly for all sites at once.

The \`sites\` table has a \`settings_json\` TEXT column (JSON) collected at L2 scan. Query it with \`json_extract\`:

\`\`\`sql
-- Sites blocking search engines
SELECT name FROM sites WHERE json_extract(settings_json, '$.blog_public') = '0'

-- Sites with open registration
SELECT name FROM sites WHERE json_extract(settings_json, '$.users_can_register') = '1'

-- Sites with plain permalinks (permalink_structure is empty string)
SELECT name FROM sites WHERE json_extract(settings_json, '$.permalink_structure') = ''

-- Sites with pretty permalinks
SELECT name FROM sites WHERE json_extract(settings_json, '$.permalink_structure') != '' AND settings_json IS NOT NULL

-- Sites with comments disabled by default
SELECT name FROM sites WHERE json_extract(settings_json, '$.default_comment_status') = 'closed'

-- Sites using a static front page
SELECT name FROM sites WHERE json_extract(settings_json, '$.show_on_front') = 'page'
\`\`\`

**Important:** Sites where \`settings_json IS NULL\` have not been scanned yet (site never started since settings indexing was enabled). Exclude them from both positive and negative queries — do NOT interpret NULL as "the setting is off."

### Admin counts via fleet_sql

\`user_count_by_role\` is a JSON TEXT column: \`{"administrator":2,"editor":1,...}\`

\`\`\`sql
-- Sites with 2+ admins
SELECT name, json_extract(user_count_by_role, '$.administrator') as admin_count
FROM sites
WHERE CAST(json_extract(user_count_by_role, '$.administrator') AS INTEGER) >= 2
ORDER BY admin_count DESC
\`\`\`

### Aggregation pattern

When you need a fleet-wide total, fan out across site twins:

1. \`nexus_get_fleet_twins()\` — get list of all indexed local sites
2. For each site: \`nexus_get_site_twin(site)\` — read \`postCount\`, \`userCount\`, etc.
3. Sum, sort, or filter as needed
4. Present as a table grouped by site

### Critical disambiguation

**"Indexed documents" ≠ "posts and pages"**
- \`fleet_summary\` reports *document count* = LanceDB vector chunks. A single post typically produces 3–6 chunks.
- WordPress post/page counts come from \`nexus_get_site_twin\` → \`postCount\` / \`pageCount\`.
- **Never cite document counts when the user asks about posts, pages, or content volume.**
- \`fleet_summary\` is for fleet infrastructure overview (indexed site count, chunk counts, integration presence) — not WordPress content metrics.

**"lastActiveSession" ≠ "last login"**
- \`lastActiveSession\` = timestamp of the login that started the most recent session still in the user's \`session_tokens\` meta.
- Sessions are pruned on expiry (48h default, 14d with "remember me") and on explicit logout.
- A null value means no active session data was found — not that the user has never logged in.
- **Always say "last seen" or "most recent active session" — never say "last logged in."**

## Named Workflows

Use these checklists before starting any multi-step workflow. Do not skip steps.

### Push Local Site to a NEW WPE environment (first-time deploy)

Use this when the local site has never been on WPE, or the user wants a fresh WPE environment.

**Naming rules — CRITICAL:**
- \`wpe_create_site\` name: can have spaces and caps (display name). E.g. "Faker Incorporated".
- \`wpe_create_install\` name: SSH slug — lowercase, numbers, hyphens ONLY, no spaces, max ~20 chars.
  Bad: "Faker Incorporated", "faker_inc". Good: "fakerinc", "faker-demo".
  If the user gives a display name, derive the slug automatically before calling the tool.

Steps:
1. \`wpe_get_accounts\` — get account_id (or ask user which account)
2. \`wpe_create_site\` (name=display name, account_id=) → save the returned site_id
3. \`wpe_create_install\` (site_id=, name=slug, environment="production", account_id=) → save install_id
4. \`local_export_site\` (site=local-site-name) → creates a zip backup **before** pushing (rollback point)
5. Wait ~2 minutes for WPE provisioning (inform user)
6. \`local_wpe_push\` (site=local-site-name, remote_install_id=install_id from step 3, include_database=true)
7. Poll \`local_get_site\` until status="running"
8. \`wpe_create_backup\` (install_id=, description="post-deploy baseline") — remote restore point on WPE

**Backup/restore note:** \`local_export_site\` produces a portable zip in ~/Downloads that can be restored via \`local_import_site\`. This is the preferred local backup method — more reliable than blueprints for programmatic use.

### Pull → Update → Push (WPE site update)

Pre-flight (run BEFORE proposing this workflow to the user):
1. Read \`nexus://fleet/state\` — confirm the WPE install name and whether a local site exists
2. If no local site: tell the user, offer to create one with \`local_create_site\`
3. Confirm with user: include database in pull? (recommend yes)
4. Warn: \`local_wpe_push\` overwrites the live WPE environment — no automatic rollback

Steps (in order):
1. \`local_wpe_pull\` (include_database=true) → poll \`local_operation_status\`
2. \`local_export_site\` (if user wants a backup of the pulled state) → poll \`local_operation_status\`
3. \`local_start_site\` (if site stopped after pull)
4. \`wp_plugin_update\` (slug="--all", site=local-name)
5. \`wp_site_health\` — confirm no regressions
6. \`local_wpe_push\` → poll \`local_operation_status\`

### Plugin Audit (fleet-wide)

1. \`nexus_plugin_audit\` — cross-site view of installed versions and available updates
2. For a specific install: \`wp_plugin_list\` (install_name=) to confirm current state
3. \`wp_plugin_update\` (install_name=, slug="--all") for remote updates via SSH
4. If plugins blocked by WP version: \`wp_core_update\` (install_name=) then retry

### Site Investigation (before any changes)

Always start with:
1. Read \`nexus://fleet/state\` — get site IDs, WPE links, AI config without a tool call
2. \`nexus_list_sites\` — get live running/halted status
3. \`wp_plugin_list\` — confirm current plugin state
4. \`wp_site_health\` (local) or \`nexus_site_audit\` — baseline health

## WP Engine Authentication

**Always check auth before WPE operations.** If any \`wpe_*\` tool returns an authentication error, call \`wpe_status\` immediately to diagnose.

- **\`wpe_status\`** — Check whether the user is authenticated. Returns \`authenticated\`, \`email\`, and \`accountName\`. Tier 1 (read-only).
- **\`wpe_login\`** — Opens a browser for OAuth login. Returns immediately (fire-and-forget). Poll \`wpe_status\` every few seconds until \`authenticated: true\`. Tier 2.
- **\`wpe_logout\`** — Clears WPE credentials. Tier 2.
- **\`wpe_get_current_user\`** — Returns the authenticated user's profile (name, email). Use to confirm which account you are operating as.

When WPE tools fail with auth errors: call \`wpe_status\` → if not authenticated, call \`wpe_login\` → poll \`wpe_status\` → retry the original tool.

## Install Lifecycle (Create / Update / Delete)

To create a new hosted environment on WP Engine:
1. \`wpe_create_site\` — create a site container (required first)
2. \`wpe_create_install\` — add an environment (production/staging/development) to the site
3. **WAIT for provisioning** — the install returns \`status: "pending"\` immediately. Poll \`wpe_get_install\` every 60 seconds until \`status === "active"\`. This takes 3–5 minutes.
4. **Verify SSH with \`wpe_wait_for_ssh\`** — pass the install slug (e.g. "nexusdemo24"). This probes SSH every 30s until it succeeds (typically 3–8 min after creation). Only proceed with push or WP-CLI after this returns success. Do NOT rely on CAPI's status="active" alone — SSH infrastructure needs additional warmup.

To update an install (PHP version, environment type): \`wpe_update_install\`

**\`wpe_delete_install\`** — **Tier 3**. Requires two confirmations:
- A confirmation token (from the first call without token)
- \`confirm_install_name\` must exactly match the install name
- First call fetches install details and backup recency — warns if no backup within 7 days
- Never delete without verifying a recent backup exists

**\`wpe_delete_site\`** — **Tier 3**. Deletes the site AND all its installs. Requires \`confirm_site_name\` matching the site name exactly.

## Domain Management

Add domains, verify DNS, and set primary domain before going live.

**Workflow for adding a new domain:**
1. \`wpe_create_domain\` — add the domain to the install
2. \`wpe_check_domain_status\` — verify DNS is resolving (poll until resolved)
3. \`wpe_update_domain\` with \`primary: true\` — set as primary domain
4. \`wpe_request_ssl_certificate\` — provision SSL (DNS must be resolving first)

**\`wpe_delete_domain\`** — **Tier 3**. Extra strong warning if deleting the primary domain.

**Bulk operations:**
- \`wpe_create_domains_bulk\` — add multiple domains at once
- \`wpe_account_domains\` — list all domains across all installs in an account
- \`wpe_account_ssl_status\` — SSL cert status across all installs

**Go-live tools:**
- \`wpe_go_live_checklist\` — read-only: checks domain added, DNS resolved, SSL valid (use this FIRST)
- \`wpe_prepare_go_live\` — action: adds domain + sets primary + requests SSL + purges cache in one call

Before \`wpe_prepare_go_live\`, run \`wpe_go_live_checklist\` to understand current domain, DNS, and SSL state.

## SSL Management

- \`wpe_get_ssl_certificates\` — list all certs for an install, with expiry dates
- \`wpe_get_domain_ssl_certificate\` — cert for a specific domain
- \`wpe_request_ssl_certificate\` — provision Let's Encrypt (DNS must resolve first, domain must be added)
- \`wpe_import_ssl_certificate\` — import custom cert (PEM format)

**Monitoring:** Use \`wpe_account_ssl_status\` to check SSL health across all installs in an account. It flags: ✅ valid, ⚠️ expiring ≤30 days, ❌ expired, ❌ no cert.

## Higher-Order Workflow Tools

Use these composite tools instead of chaining multiple atomic calls.

| Goal | Tool | Notes |
|------|------|-------|
| "copy staging to production" | \`wpe_promote_environment\` | Tier 3. Checks backup recency. |
| "create + confirm backup" | \`wpe_backup_and_verify\` | Polls until complete. Use before promote. |
| "executive fleet summary" | \`wpe_portfolio_overview\` | Traffic + installs + usage in one call |
| "what's wrong with this install?" | \`wpe_diagnose_site\` | Checks domains, SSL, backup, disk |
| "fleet health at a glance" | \`wpe_fleet_health\` | Per-install: WP, PHP, SSL, traffic |
| "compare staging vs production" | \`wpe_environment_diff\` | Side-by-side diff of two installs |
| "who has access to what?" | \`wpe_user_audit\` | All users across all accounts |
| "is this ready to go live?" | \`wpe_go_live_checklist\` | Read-only pre-launch checklist |
| "set up domain + SSL" | \`wpe_prepare_go_live\` | Action: domain + SSL + cache in one call |
| "all domains in an account" | \`wpe_account_domains\` | Domain inventory across installs |
| "SSL cert health across account" | \`wpe_account_ssl_status\` | Expiry + validity per install |
| "account + install summary" | \`wpe_account_overview\` | Install count, env breakdown, versions |
| "installs grouped by account" | \`wpe_installs_by_account\` | Fleet org chart |

**Key distinction:** \`wpe_go_live_checklist\` (read-only) vs \`wpe_prepare_go_live\` (modifying). Always check before acting.

**Key distinction:** \`wpe_promote_environment\` (guarded Tier 3, checks backup) vs \`wpe_copy_install\` (direct, power users only).

## WP Engine Usage Metrics

**\`wpe_portfolio_usage\`** — The right tool for fleet-wide traffic questions. Fetches usage for ALL installs across ALL accounts in O(accounts) calls — not one call per install. Use this for:
- "Which installs have more than N visits per day?" → pass \`min_visits_per_day\`
- "What are my highest-traffic sites?"
- "Which environments use the most bandwidth/storage?"

Returns a sorted table (visits descending). After identifying high-traffic installs by name, use \`wpe_get_installs\` to get their IDs, then \`wp_core_version\` / \`wpe_get_install\` for WP/PHP versions.

**\`wpe_fleet_versions\`** — WP and PHP versions for all (or a filtered list of) WPE installs, read from the local graph — zero API calls. Use this immediately after \`wpe_portfolio_usage\` identifies high-traffic installs. Pass \`install_names\` to filter. Never call \`wpe_get_install\` in a loop for version data when this tool exists.

**\`wpe_get_install_usage\`** — Single install. Requires \`install_id\`. Use after \`wpe_portfolio_usage\` identifies a specific install of interest.

**\`wpe_get_account_usage\`** — Account-level aggregate only (not per-install). Use for account billing/quota questions.

**\`wpe_get_account_usage_summary\`** and **\`wpe_get_account_usage_insights\`** — Detailed usage breakdowns and insights (e.g. by environment type). Use for in-depth quota or capacity analysis.

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

## WP Engine API Credentials (Backup Creation)

\`wpe_create_backup\` requires **WP Engine API credentials** (basic auth) — the backup endpoint does not support OAuth. If backup fails with an auth error, credentials are not configured.

- \`wpe_credentials_status\` — check if credentials are configured
- \`wpe_set_api_credentials({ username, password })\` — store credentials (encrypted, one-time setup)
- \`wpe_clear_api_credentials\` — remove stored credentials

Credentials are stored with OS-level encryption. Once set, all backup operations use them automatically.

## Presentation

- Format results as markdown tables or bulleted lists, not raw JSON.
- Group sites by status: show running sites first, then halted.
- When listing plugins, show name, version, and status (active/inactive).
- For fleet operations, summarize totals and highlight outliers.
- Include version numbers when reporting WordPress or PHP versions.
- For usage metrics, format bytes as GB/MB and large numbers with commas.

## Resources

For detailed guides, use \`resources/read\` with these URIs:
- \`nexus://fleet/state\` — Cached WPE installs + local sites (see Discovery First for usage)
- \`nexus://guide/getting-started\` — Tool overview and orientation
- \`nexus://guide/safety\` — Safety tier system details
- \`nexus://guide/remote-wp-cli\` — Remote execution via SSH
- \`nexus://guide/workflows/site-setup\` — New site provisioning
- \`nexus://guide/workflows/wpe-sync\` — Push/pull with WP Engine
- \`nexus://guide/workflows/content-search\` — Indexing and semantic search
`.trim();
