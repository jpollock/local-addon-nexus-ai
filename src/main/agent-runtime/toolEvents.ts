/**
 * Which agent tool calls count as a change to a site, and what they changed.
 *
 * `ctx.log.mutation()` shipped with zero callers: every agent forgot it, which is exactly why
 * the design makes `llm.call` and `tool.call` runtime-emitted rather than trusting agents to
 * report their own actions. `mutation` is now emitted from the same chokepoint
 * (`NexusToolProvider.invoke`), so an agent cannot fail to record that it changed something.
 *
 * **Why an explicit list rather than the safety tier.** `getToolSafety` returns
 * `TIER_OVERRIDES[name] ?? 2`, so tier 2 is the default for anything nobody has classified —
 * including reads. Deriving "mutates" from tier would label unclassified read-only calls as
 * changes, and the entire value of the word is that `grep mutation` answers "what changed".
 *
 * **Why under-labelling is the safe error.** `tool.call` is emitted for *every* call, so a
 * mutating tool missing from this list is still visible in the log — just not labelled a
 * mutation. A read wrongly labelled a mutation is not recoverable in the same way: it corrupts
 * the one query a user runs when they suspect an agent touched something. When in doubt, leave
 * a tool out and let its `tool.call` line carry it.
 *
 * Adding a tool that changes a site? Add it here. The list is checked against
 * `TIER_OVERRIDES` by eye, not by code — deliberately, per the paragraph above.
 */

/**
 * Tools that change a WordPress site or a WP Engine resource.
 *
 * Excluded on purpose: `wp_db_export`, `local_export_site` (produce an artifact, the source is
 * unchanged), `wpe_refresh_*_disk_usage` (re-read a number), `wpe_logout`, and every Tier 1 read.
 */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  // Tier 3 — destructive, all of them.
  'local_delete_site', 'local_wpe_push', 'clean_database_items', 'wpe_delete_account_user',
  'wpe_delete_site', 'wpe_delete_install', 'wpe_delete_domain', 'wpe_delete_ssh_key',
  'wpe_promote_environment',

  // WordPress content and configuration.
  'wp_core_update', 'wp_import_database', 'wp_search_replace', 'wp_eval', 'wp_run_ability',
  'wp_plugin_install', 'wp_plugin_activate', 'wp_plugin_deactivate', 'wp_plugin_update',
  'wp_theme_activate', 'wp_post_create', 'wp_post_update', 'wp_post_delete',
  'wp_setup_ai', 'wp_sync_ai_credentials', 'bulk_plugin_update',

  // Local site lifecycle and shape. Start/stop/restart are included: "an agent stopped my site"
  // is precisely the surprise this log exists to explain, even though no content changed.
  'local_create_site', 'local_clone_site', 'local_import_site', 'local_rename_site',
  'local_start_site', 'local_stop_site', 'local_restart_site',
  'local_change_php_version', 'local_toggle_xdebug', 'local_trust_ssl', 'local_wpe_pull',

  // WP Engine resources.
  'wpe_create_backup', 'wpe_backup_and_verify', 'wpe_purge_cache',
  'wpe_create_account_user', 'wpe_update_account_user', 'wpe_add_user_to_accounts',
  'wpe_create_site', 'wpe_update_site', 'wpe_create_install', 'wpe_update_install',
  'wpe_copy_install', 'wpe_create_domain', 'wpe_create_domains_bulk', 'wpe_update_domain',
  'wpe_request_ssl_certificate', 'wpe_import_ssl_certificate', 'wpe_create_ssh_key',
  'wpe_update_offload_settings', 'wpe_configure_offload_settings', 'wpe_prepare_go_live',
]);

/** True when this tool changes a site or a WP Engine resource. */
export function isMutatingTool(toolName: string): boolean {
  return MUTATING_TOOLS.has(toolName);
}

/**
 * Argument names that identify what a call is acting on, most specific first. A call carrying
 * both `siteId` and `site` is addressing the named install; the id is the coarser handle.
 */
const TARGET_KEYS = ['site', 'siteName', 'install_name', 'installName', 'install', 'target', 'siteId'];

/**
 * What the call is acting on, or undefined when the arguments do not say.
 *
 * Undefined must stay undefined: `target=unknown` is indistinguishable from a real install named
 * "unknown", and inventing a value is worse than omitting the key — `formatLine` drops undefined
 * fields, so an unidentified target simply does not appear.
 */
export function mutationTarget(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  for (const key of TARGET_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}
