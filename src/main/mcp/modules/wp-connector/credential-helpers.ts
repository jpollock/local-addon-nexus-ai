/**
 * Credential Helpers
 *
 * Shared constants and PHP builder for syncing AI credentials to WordPress.
 * Used by both sync-credentials (MCP tool) and auto-sync (lifecycle hook).
 *
 * WordPress 7.0 has TWO credential stores:
 * 1. connectors_ai_{provider}_api_key  — raw strings, WP Core Connector Screen
 * 2. wp_ai_client_provider_credentials — serialized array, AI Experiments plugin
 *
 * We write to BOTH so credentials work regardless of which code path reads them.
 */

/**
 * Maps Local provider IDs to WordPress 7.0 Connector Screen option names.
 */
export const PROVIDER_TO_WP_OPTION: Record<string, string> = {
  openai: 'connectors_ai_openai_api_key',
  anthropic: 'connectors_ai_anthropic_api_key',
  google: 'connectors_ai_google_api_key',
};

/**
 * Maps Local provider IDs to WordPress.org plugin slugs.
 * These plugins register the provider with the WP AI Client ProviderRegistry
 * so the Connector Screen can validate keys and AI features can use models.
 *
 * Slugs confirmed from wp-includes/build/routes/connectors-home/content.js.
 */
export const PROVIDER_PLUGIN_SLUGS: Record<string, string> = {
  openai: 'ai-provider-for-openai',
  anthropic: 'ai-provider-for-anthropic',
  google: 'ai-provider-for-google',
};

/**
 * The wp_options key used by the AI Experiments plugin (via API_Credentials_Manager).
 * Value is a serialized associative array: { provider_id => api_key }.
 */
export const AI_CLIENT_CREDENTIALS_OPTION = 'wp_ai_client_provider_credentials';

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_TO_WP_OPTION);

export interface CredentialEntry {
  provider: string;
  key: string;
  optionName: string;
}

export interface CredentialSyncResult {
  connectors: number;
  ai_client: boolean;
  debug: Array<{ option: string; added: boolean; db_type: string; db_len: number }>;
}

/**
 * Build PHP code that writes credentials to BOTH stores:
 * 1. connectors_ai_{provider}_api_key (WP 7.0 Core Connector Screen)
 * 2. wp_ai_client_provider_credentials (AI Experiments plugin)
 *
 * Returns PHP code that echoes a JSON result with debug info.
 */
export function buildCredentialSyncPhp(keysToSync: CredentialEntry[]): string {
  if (keysToSync.length === 0) {
    return "echo json_encode(['connectors' => 0, 'ai_client' => false, 'debug' => []]);";
  }

  const lines: string[] = [];

  // 1. Remove ALL filters, write each connectors_ai_* option, verify with direct DB read
  lines.push('$connectors_ok = 0;');
  lines.push('$debug = [];');
  lines.push('global $wpdb;');
  for (const entry of keysToSync) {
    const escapedKey = entry.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const optName = entry.optionName;
    // Remove every filter that could interfere
    lines.push(`remove_all_filters('sanitize_option_${optName}');`);
    lines.push(`remove_all_filters('pre_update_option_${optName}');`);
    lines.push(`remove_all_filters('pre_option_${optName}');`);
    lines.push(`remove_all_filters('option_${optName}');`);
    // Delete then add to avoid "value unchanged" false return
    lines.push(`delete_option('${optName}');`);
    lines.push(`$added = add_option('${optName}', '${escapedKey}', '', 'no');`);
    // Verify directly from DB to bypass all filters
    lines.push(`$db_val = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM $wpdb->options WHERE option_name = %s", '${optName}'));`);
    lines.push(`if ($db_val === '${escapedKey}') { $connectors_ok++; }`);
    lines.push(`else { $debug[] = ['option' => '${optName}', 'added' => $added, 'db_type' => gettype($db_val), 'db_len' => is_string($db_val) ? strlen($db_val) : -1]; }`);
  }

  // 2. Write wp_ai_client_provider_credentials — remove filters, build array, verify via DB
  const aiOpt = AI_CLIENT_CREDENTIALS_OPTION;
  lines.push(`remove_all_filters('sanitize_option_${aiOpt}');`);
  lines.push(`remove_all_filters('pre_update_option_${aiOpt}');`);
  lines.push(`remove_all_filters('pre_option_${aiOpt}');`);
  lines.push(`remove_all_filters('option_${aiOpt}');`);
  // Read existing value directly from DB to bypass filters
  lines.push(`$raw_creds = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM $wpdb->options WHERE option_name = %s", '${aiOpt}'));`);
  lines.push('$creds = is_string($raw_creds) ? maybe_unserialize($raw_creds) : [];');
  lines.push('if (!is_array($creds)) { $creds = []; }');
  for (const entry of keysToSync) {
    const escapedKey = entry.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    lines.push(`$creds['${entry.provider}'] = '${escapedKey}';`);
  }
  // Delete + add to bypass any update short-circuits
  lines.push(`delete_option('${aiOpt}');`);
  lines.push(`add_option('${aiOpt}', $creds, '', 'no');`);
  // Verify directly from DB
  lines.push(`$verify_raw = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM $wpdb->options WHERE option_name = %s", '${aiOpt}'));`);
  lines.push('$verify_creds = is_string($verify_raw) ? maybe_unserialize($verify_raw) : [];');
  lines.push('$ai_client_ok = is_array($verify_creds);');
  for (const entry of keysToSync) {
    const escapedKey = entry.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    lines.push(`if (!isset($verify_creds['${entry.provider}']) || $verify_creds['${entry.provider}'] != '${escapedKey}') { $ai_client_ok = false; }`);
  }

  // 3. Output JSON result with debug
  lines.push("echo json_encode(['connectors' => $connectors_ok, 'ai_client' => (bool)$ai_client_ok, 'debug' => $debug]);");

  return lines.join(' ');
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return '••••••••' + key.slice(-4);
}
