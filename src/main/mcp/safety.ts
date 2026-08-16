import * as crypto from 'crypto';
import { McpToolResult } from './types';

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
  // Byte-level read of a stopped site: no PHP, no mutation, no site start. Tier 2 (the
  // default for anything absent) would write a line per site per sweep to operation-audit.log.
  scan_site_files: 1,
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
  nexus_fleet_list: 1,
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
  nexus_link_site: 2,
  nexus_unlink_site: 2,

  // Tier 3 — Privilege-granting (P0-6): creating/altering an account user grants persistent
  // production portal access. Promoted from Tier 2 so it requires human confirmation, and (with
  // P0-1) so an agent cannot perform it at all.
  wpe_create_account_user: 3,
  wpe_update_account_user: 3,

  // Tier 3 — Provisioning billed production infrastructure (P1-1): creating an install or site
  // stands up a new billable environment. Their delete siblings are already Tier 3; promoted so
  // an agent cannot provision unattended (refused by NexusToolProvider) and interactive/MCP
  // callers must confirm. Creates have no existing environment for the isOperationAllowed env-gate
  // to key on, which is why Tier 3 rather than the gate. Updates to EXISTING resources stay Tier 2
  // (update-install already routes through isOperationAllowed).
  wpe_create_site: 3,
  wpe_create_install: 3,
  wpe_update_site: 2,
  wpe_update_install: 2,
  wpe_refresh_install_disk_usage: 2,
  wpe_refresh_account_disk_usage: 2,

  // Tier 3 — Adding/altering a domain reroutes production traffic (P1-1). Bulk is strictly more
  // powerful than single, so both are gated — gating one but not the other is a trivial bypass.
  wpe_create_domain: 3,
  wpe_create_domains_bulk: 3,
  wpe_update_domain: 2,

  // Tier 3 — SSL provisioning/import alters the certificate a production domain serves (P1-1).
  wpe_request_ssl_certificate: 3,
  wpe_import_ssl_certificate: 3,
  // Tier 3 — Privilege-granting (P0-6): an SSH key grants persistent shell access to the
  // account's installs. Confirmation required; refused for agents by P0-1.
  wpe_create_ssh_key: 3,

  // Tier 3 — Changing media offload flips where a production site serves its assets (P1-1).
  wpe_update_offload_settings: 3,
  // Tier 2 — Backups are additive and safe; an agent may need to snapshot before risky work, so
  // they are NOT promoted (deliberate carve-out, P1-1). prepare_go_live stays a Tier-2 composite.
  wpe_backup_and_verify: 2,
  wpe_prepare_go_live: 2,
  // Tier 3 — Privilege-granting (P0-6): adds a user to WP Engine accounts (persistent access).
  wpe_add_user_to_accounts: 3,

  // Tier 3 — Destructive (existing)
  local_delete_site: 3,
  local_wpe_push: 3,
  wp_eval: 2,
  clean_database_items: 3,
  wp_import_database: 3,

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

  // Tier 1 — Read (backfilled, F4): genuinely read-only tools that were
  // missing an entry and therefore silently defaulting to Tier 2, writing a
  // durable operation-audit.log line on every call. See the 2026-08-08
  // external-host-defects review, F4.
  describe_site_fields: 1,
  detect_drift: 1,
  compare_sites: 1,
  nexus_pairing_proposals: 1, // read-only: proposals are information, linking stays in nexus_link_site (Tier 2)
  find_outdated_sites: 1,
  find_sites_with_plugin: 1,
  find_sites_with_theme: 1,
  fleet_filter: 1,
  fleet_health_summary: 1,
  fleet_overview: 1,
  fleet_search: 1,
  fleet_sql: 1,
  fleet_summary: 1,
  get_all_site_documents: 1,
  get_graph_content: 1,
  get_graph_plugin: 1,
  get_graph_stats: 1,
  list_graph_content: 1,
  list_graph_plugins: 1,
  get_index_status: 1,
  get_site_health: 1,
  get_site_structure: 1,
  list_indexed_sites: 1,
  search_across_sites: 1,
  search_site_content: 1,
  local_get_site_logs: 1,
  local_get_sync_history: 1,
  local_list_blueprints: 1,
  local_operation_status: 1,
  nexus_fleet_plugins: 1,
  nexus_fleet_summary: 1,
  nexus_get_fleet_twins: 1,
  nexus_get_settings: 1,
  nexus_get_site_ai_config: 1,
  nexus_get_site_twin: 1,
  nexus_plugin_audit: 1,
  nexus_site_status: 1,
  iw_fleet_status: 1,
  iw_get_connection_status: 1,
  iw_get_kb_collection: 1,
  iw_list_kb_collections: 1,
  iw_search_kb: 1,
  list_site_groups: 1,
  get_event_endpoint_info: 1,
  get_event_processor_stats: 1,
  get_gateway_usage: 1,
  get_metrics: 1,
  get_system_health: 1,
  get_telemetry_status: 1,
  get_tool_metrics: 1,
  search_tools: 1,
  ask_ollama: 1,
  list_ollama_models: 1,
};

export const CONFIRMATION_MESSAGES: Record<string, string> = {
  local_delete_site: 'This will permanently delete the site and all its files.',
  local_wpe_push: 'This will overwrite the remote WP Engine environment with local site data.',
  // wp_eval is Tier 2 — logged but no confirmation required on local sites
  clean_database_items: 'This will permanently delete database rows. Always run with dry_run=true first.',
  wp_import_database: "This will completely overwrite the site's existing database. This cannot be undone.",
  // T-INJECTION: freeform/overwrite Tier-2 tools require approval because a prompt-injected model
  // (fed untrusted WordPress content) could be steered into calling them.
  wp_eval: 'This runs arbitrary PHP on the site. Approve only if you asked for this — untrusted site content can try to trigger it.',
  wp_search_replace: 'This rewrites values across the database in bulk and can be hard to undo. Approve only if you asked for this.',
  wpe_delete_account_user: 'This will revoke WP Engine portal access for this user.',
  wpe_delete_site: 'This will delete the WP Engine site and ALL its installs (production, staging, development).',
  wpe_delete_install: 'This will permanently delete this WP Engine environment and all its content. This cannot be undone.',
  wpe_delete_domain: 'This will remove the domain from this install. Live traffic to this domain will break.',
  wpe_delete_ssh_key: 'This will remove the SSH key. Any automation using it will stop working.',
  wpe_promote_environment: 'This will overwrite the destination environment with content from the source. Destination content will be lost.',
  wpe_create_account_user: 'This will grant a new user access to your production WP Engine account and email them an invitation.',
  wpe_update_account_user: "This will change a user's roles/access on your production WP Engine account.",
  wpe_add_user_to_accounts: 'This will grant an existing user access to additional production WP Engine accounts.',
  wpe_create_ssh_key: 'This will authorize a new SSH key for shell access to this account\'s installs.',
  // P1-1 — provisioning billed production infrastructure.
  wpe_create_install: 'This will create a new, billable WP Engine install on your production account.',
  wpe_create_site: 'This will create a new, billable WP Engine site (with its installs) on your production account.',
  wpe_create_domain: 'This will add a domain to this production install and can reroute live traffic to it.',
  wpe_create_domains_bulk: 'This will add multiple domains to production installs and can reroute live traffic.',
  wpe_request_ssl_certificate: 'This will request/provision an SSL certificate for a production domain.',
  wpe_import_ssl_certificate: 'This will import an SSL certificate that a production domain will then serve.',
  wpe_update_offload_settings: 'This will change where this production site serves its media assets from.',
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
 * Freeform/overwrite Tier-2 tools that must get explicit human approval before running from the
 * chat assistant (T-INJECTION). These execute caller-composed syntax (arbitrary PHP) or overwrite
 * data in bulk, so a prompt-injected model — fed untrusted WordPress content — could be steered
 * into calling them. They stay Tier 2 (no confirmation TOKEN gate), but the chat surface routes
 * them through the same approval UI as Tier 3; agents refuse them unless sandbox-scoped.
 */
export const APPROVAL_REQUIRED_TOOLS = new Set<string>(['wp_eval', 'wp_search_replace']);

/**
 * Returns the safety configuration for a tool.
 * Tools not in TIER_OVERRIDES default to Tier 2 (modify).
 */
export function getToolSafety(toolName: string): SafetyConfig {
  const tier = TIER_OVERRIDES[toolName] ?? 2;

  if (tier < 3) {
    // Freeform/overwrite Tier-2 tools carry a confirmation message so the chat approval card can
    // explain the risk, even though they are not Tier 3 (T-INJECTION).
    if (APPROVAL_REQUIRED_TOOLS.has(toolName)) {
      return {
        tier,
        confirmationMessage: CONFIRMATION_MESSAGES[toolName] ?? 'This action may have significant consequences.',
      };
    }
    return { tier };
  }

  return {
    tier,
    confirmationMessage: CONFIRMATION_MESSAGES[toolName] ?? 'This action may have significant consequences.',
    preChecks: PRE_CHECKS[toolName],
  };
}

/**
 * True if a tool must get explicit human approval before running from the chat assistant: every
 * Tier-3 tool, plus the freeform/overwrite Tier-2 tools in APPROVAL_REQUIRED_TOOLS.
 */
export function requiresHumanApproval(toolName: string): boolean {
  return getToolSafety(toolName).tier === 3 || APPROVAL_REQUIRED_TOOLS.has(toolName);
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

// ---------------------------------------------------------------------------
// Confirmation gate — extracted so it can be enforced from a single place
// ---------------------------------------------------------------------------

export interface ConfirmationGateResult {
  /** True if the gate returned a "please confirm" response and the caller must stop here. */
  blocked: boolean;
  /** Set only when blocked is true. */
  response?: McpToolResult;
  /** Set only when blocked is false and a token was consumed — args with _confirmationToken stripped. */
  cleanedArgs?: Record<string, unknown>;
}

/**
 * Tier-3 confirmation gate, extracted so it can be enforced from a single
 * place (ToolRegistry.call()) instead of duplicated per dispatch surface —
 * see A4 in the 2026-08-08 external-host-onboarding-and-fixes review for why
 * duplication let three callers skip it entirely.
 *
 * Limitation: this gate closes the gap fully for `mcp`/`cli` callers, where a
 * human (a chat approval click, a CLI y/n prompt) is the only thing that can
 * ever produce a valid `_confirmationToken`. For `accessMethod: 'agent'` the
 * token is returned in the tool result and an agent loop could hand it back to
 * the model, which would re-issue the call with the token itself — no human
 * ever sees it. That path is now closed upstream: `NexusToolProvider` (the sole
 * agent tool caller) refuses Tier 3 outright before ever reaching this gate, and
 * filters Tier-3 tools out of the definitions offered to the model. So for the
 * agent surface this function is belt-and-suspenders — it is never reached with
 * a Tier-3 tool. Keep both gates: if the provider's refusal is ever weakened,
 * this token check is the only thing standing between a model and a destructive
 * op, and it must not silently become a self-serve token vendor.
 */
export function checkTierThreeConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  tier: SafetyTier,
  confirmationMessage: string | undefined,
  preChecks: string[] | undefined,
  confirmations: ConfirmationManager,
): ConfirmationGateResult {
  if (tier !== 3) {
    return { blocked: false, cleanedArgs: args };
  }

  const token = args._confirmationToken as string | undefined;

  if (!token) {
    const confirmationToken = confirmations.generate(toolName, args);
    return {
      blocked: true,
      response: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            requiresConfirmation: true,
            tier: 3,
            action: confirmationMessage,
            warning: 'This action may not be reversible.',
            howToConfirm: `To proceed, call ${toolName} again with the same arguments plus _confirmationToken set to the value below.`,
            preChecks,
            confirmationToken,
          }, null, 2),
        }],
      },
    };
  }

  const validationParams = { ...args };
  delete validationParams._confirmationToken;
  const validationError = confirmations.validate(token, toolName, validationParams);
  if (validationError) {
    return {
      blocked: true,
      response: { content: [{ type: 'text', text: validationError }], isError: true },
    };
  }

  return { blocked: false, cleanedArgs: validationParams };
}

/**
 * The exact message set `ConfirmationManager.validate()` can return on
 * failure. Callers that need to distinguish "the gate rejected this token"
 * from "the handler itself failed after being validly confirmed" (e.g. for
 * the audit log's `confirmed` field) should match against this rather than
 * assuming every Tier-3 error means confirmation succeeded.
 */
const CONFIRMATION_VALIDATION_ERROR_PREFIXES = [
  'Invalid or expired confirmation token.',
  'Confirmation token expired',
  'Confirmation token was issued for a different tool.',
  'Parameters changed since confirmation was requested.',
];

export function isConfirmationValidationError(errorText: string): boolean {
  return CONFIRMATION_VALIDATION_ERROR_PREFIXES.some((prefix) => errorText.startsWith(prefix));
}
