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
  wp_user_list: 1,
  wp_option_get: 1,
  wp_site_health: 1,
  wpe_get_accounts: 1,
  wpe_get_installs: 1,
  wpe_get_install: 1,
  local_wpe_link: 1,
  nexus_list_sites: 1,
  wp_list_abilities: 1,

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

  // Tier 3 — Destructive
  local_delete_site: 3,
  local_wpe_push: 3,
  wp_eval: 3,
};

export const CONFIRMATION_MESSAGES: Record<string, string> = {
  local_delete_site: 'This will permanently delete the site and all its files.',
  local_wpe_push: 'This will overwrite the remote WP Engine environment with local site data.',
  wp_eval: 'This will execute arbitrary PHP code on the WordPress site.',
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
  wp_eval: [
    'Review the PHP code carefully before execution',
    'Ensure the code does not perform destructive database operations',
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
