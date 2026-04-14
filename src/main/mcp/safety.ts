import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Safety Tiers
// ---------------------------------------------------------------------------

export type SafetyTier = 1 | 2 | 3;

export interface SafetyConfig {
  tier: SafetyTier;
  confirmationMessage?: string;
  preChecks?: string[];
}

/**
 * Explicit tier assignments for all tools.
 * Tier 1: Read-only, no confirmation needed.
 * Tier 2: Modifying, logged but no confirmation.
 * Tier 3: Destructive, requires confirmation token.
 */
export const TIER_OVERRIDES: Record<string, SafetyTier> = {
  // Tier 1 — Read
  local_list_sites: 1,
  local_get_site: 1,
  wp_plugin_list: 1,
  wp_theme_list: 1,
  wp_core_version: 1,
  wp_core_update: 2,
  wp_user_list: 1,
  wp_option_get: 1,
  wp_site_health: 1,
  wpe_status: 1,
  wpe_get_install_usage: 1,
  wpe_get_account_usage: 1,
  wpe_portfolio_usage: 1,
  wpe_fleet_versions: 1,
  wpe_detect_drift: 1,
  wpe_wait_for_ssh: 1,
  wpe_login: 1,
  wpe_logout: 2,
  wpe_get_accounts: 1,
  wpe_get_account_users: 1,
  wpe_get_installs: 1,
  wpe_get_install: 1,
  local_wpe_link: 1,
  nexus_list_sites: 1,
  wp_list_abilities: 1,

  // Tier 1 — New atomic reads (account)
  wpe_get_account: 1,
  wpe_get_account_limits: 1,
  wpe_get_account_usage_summary: 1,
  wpe_get_account_usage_insights: 1,
  wpe_get_account_user: 1,

  // Tier 1 — New atomic reads (sites + installs)
  wpe_get_sites: 1,
  wpe_get_site: 1,
  wpe_get_backup: 1,

  // Tier 1 — New atomic reads (domains)
  wpe_get_domains: 1,
  wpe_get_domain: 1,
  wpe_get_domain_status_report: 1,
  wpe_check_domain_status: 1,

  // Tier 1 — New atomic reads (SSL)
  wpe_get_ssl_certificates: 1,
  wpe_get_domain_ssl_certificate: 1,

  // Tier 1 — New atomic reads (misc)
  wpe_get_ssh_keys: 1,
  wpe_get_current_user: 1,
  wpe_get_offload_settings: 1,
  wpe_get_largefs_validation: 1,

  // Tier 1 — New composite reads
  wpe_account_overview: 1,
  wpe_account_domains: 1,
  wpe_account_ssl_status: 1,
  wpe_installs_by_account: 1,
  wpe_environment_diff: 1,
  wpe_go_live_checklist: 1,
  wpe_user_audit: 1,
  wpe_fleet_health: 1,
  wpe_diagnose_site: 1,
  wpe_portfolio_overview: 1,

  // Tier 2 — Modify
  local_start_site: 2,
  local_stop_site: 2,
  local_restart_site: 2,
  local_create_site: 2,
  local_clone_site: 2,
  local_export_site: 2,
  local_change_php_version: 2,
  local_trust_ssl: 2,
  wp_plugin_install: 2,
  wp_plugin_activate: 2,
  wp_plugin_deactivate: 2,
  wp_plugin_update: 2,
  wp_db_export: 2,
  wp_search_replace: 2,
  wpe_create_backup: 2,
  wpe_purge_cache: 2,
  local_wpe_pull: 2,
  wp_setup_ai: 2,
  wp_sync_ai_credentials: 2,
  wp_run_ability: 2,

  // Tier 2 — New writes (account + users)
  wpe_create_account_user: 2,
  wpe_update_account_user: 2,

  // Tier 2 — New writes (sites + installs)
  wpe_create_site: 2,
  wpe_update_site: 2,
  wpe_create_install: 2,
  wpe_update_install: 2,
  wpe_refresh_install_disk_usage: 2,
  wpe_refresh_account_disk_usage: 2,

  // Tier 2 — New writes (domains)
  wpe_create_domain: 2,
  wpe_create_domains_bulk: 2,
  wpe_update_domain: 2,

  // Tier 2 — New writes (SSL + SSH)
  wpe_request_ssl_certificate: 2,
  wpe_import_ssl_certificate: 2,
  wpe_create_ssh_key: 2,

  // Tier 2 — New writes (offload + composite actions)
  wpe_update_offload_settings: 2,
  wpe_configure_offload_settings: 2,
  wpe_backup_and_verify: 2,
  wpe_prepare_go_live: 2,
  wpe_copy_install: 2,
  wpe_add_user_to_accounts: 2,

  // Tier 3 — Destructive (existing)
  local_delete_site: 3,
  local_wpe_push: 3,
  wp_eval: 2,
  clean_database_items: 3,

  // Tier 3 — Destructive (new WPE ops)
  wpe_delete_account_user: 3,
  wpe_delete_site: 3,
  wpe_delete_install: 3,
  wpe_delete_domain: 3,
  wpe_delete_ssh_key: 3,
  wpe_promote_environment: 3,

  // DB Scanner — Tier 1 (read-only)
  scan_database_health: 1,
  get_database_recommendations: 1,
  fleet_database_health: 1,
};

export const CONFIRMATION_MESSAGES: Record<string, string> = {
  local_delete_site: 'This will permanently delete the site and all its files.',
  local_wpe_push: 'This will overwrite the remote WP Engine environment with local site data.',
  // wp_eval is Tier 2 — logged but no confirmation required on local sites
  clean_database_items: 'This will permanently delete database rows. Always run with dry_run=true first.',
  wpe_delete_account_user: 'This will revoke WP Engine portal access for this user.',
  wpe_delete_site: 'This will delete the WP Engine site and ALL its installs (production, staging, development).',
  wpe_delete_install: 'This will permanently delete this WP Engine environment and all its content. This cannot be undone.',
  wpe_delete_domain: 'This will remove the domain from this install. Live traffic to this domain will break.',
  wpe_delete_ssh_key: 'This will remove the SSH key. Any automation using it will stop working.',
  wpe_promote_environment: 'This will overwrite the destination environment with content from the source. Destination content will be lost.',
};

export const PRE_CHECKS: Record<string, string[]> = {
  local_delete_site: [
    'Verify the site is not connected to a production environment',
    'Confirm you have a backup if needed',
  ],
  local_wpe_push: [
    'Verify the target environment is correct',
    'Confirm the remote environment has a recent backup',
  ],
  // wp_eval pre-checks removed — Tier 2 (local only, no confirmation needed)
  clean_database_items: [
    'Run scan_database_health first',
    'Run clean_database_items with dry_run=true to preview',
    'Ensure a database backup exists',
  ],
  wpe_delete_account_user: [
    'Verify this user should lose portal access',
    'Confirm they are not the only owner on the account',
  ],
  wpe_delete_site: [
    'Run wpe_get_site to confirm the site ID is correct',
    'Verify all installs (production, staging, development) can be safely deleted',
    'Ensure all content has been exported or backed up',
  ],
  wpe_delete_install: [
    'Run wpe_create_backup or wpe_backup_and_verify first if no recent backup exists',
    'Verify this is not a production environment in active use',
    'Confirm you have local copies of any important content',
  ],
  wpe_delete_domain: [
    'Verify DNS has been updated to point away from this install',
    'Confirm no active traffic is routed through this domain',
  ],
  wpe_delete_ssh_key: [
    'Check if any CI/CD pipelines or scripts use this key',
    'Confirm you have an alternative SSH key configured if needed',
  ],
  wpe_promote_environment: [
    'Run wpe_create_backup or wpe_backup_and_verify on the destination first',
    'Confirm the destination environment is not serving live traffic you want to preserve',
    'Verify the source environment is in the desired state',
  ],
};

/**
 * Returns the safety configuration for a tool.
 * Tools not in TIER_OVERRIDES default to Tier 2 (modify).
 */
export function getToolSafety(toolName: string): SafetyConfig {
  const tier = TIER_OVERRIDES[toolName] ?? 2;

  if (tier < 3) {
    return { tier };
  }

  return {
    tier,
    confirmationMessage: CONFIRMATION_MESSAGES[toolName] ?? 'This action may have significant consequences.',
    preChecks: PRE_CHECKS[toolName],
  };
}

// ---------------------------------------------------------------------------
// Confirmation Tokens
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface PendingToken {
  toolName: string;
  params: Record<string, unknown>;
  createdAt: number;
}

export class ConfirmationManager {
  private pending = new Map<string, PendingToken>();

  /**
   * Generate a new confirmation token for a Tier 3 operation.
   */
  generate(toolName: string, params: Record<string, unknown>): string {
    this.purgeExpired();
    const token = crypto.randomBytes(16).toString('hex');
    const boundParams = { ...params };
    delete boundParams._confirmationToken;
    this.pending.set(token, { toolName, params: boundParams, createdAt: Date.now() });
    return token;
  }

  /**
   * Validate a confirmation token. Returns null on success, or an error message on failure.
   * Consumes the token on success (single-use).
   */
  validate(token: string, toolName: string, params: Record<string, unknown>): string | null {
    this.purgeExpired();

    const pending = this.pending.get(token);
    if (!pending) {
      return 'Invalid or expired confirmation token.';
    }

    if (Date.now() - pending.createdAt > TOKEN_TTL_MS) {
      this.pending.delete(token);
      return 'Confirmation token expired (5-minute TTL). Please request a new confirmation.';
    }

    if (pending.toolName !== toolName) {
      return 'Confirmation token was issued for a different tool.';
    }

    // Compare params (order-independent)
    const submittedParams = { ...params };
    delete submittedParams._confirmationToken;
    const submittedSorted = JSON.stringify(submittedParams, Object.keys(submittedParams).sort());
    const pendingSorted = JSON.stringify(pending.params, Object.keys(pending.params).sort());

    if (submittedSorted !== pendingSorted) {
      return 'Parameters changed since confirmation was requested. Please request a new confirmation.';
    }

    // Consume token (single-use)
    this.pending.delete(token);
    return null;
  }

  /** Visible for testing */
  get pendingCount(): number {
    return this.pending.size;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (now - v.createdAt > TOKEN_TTL_MS) {
        this.pending.delete(k);
      }
    }
  }
}
