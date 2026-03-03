import type { LocalServicesBridge } from '../../local-services-bridge';
import type { RegistryStorage } from '../../../content/IndexRegistry';
import { STORAGE_KEYS } from '../../../../common/constants';

/**
 * Maps Local provider IDs to WordPress 7.0 Connector Screen option names.
 */
const PROVIDER_TO_WP_OPTION: Record<string, string> = {
  openai: 'connectors_ai_openai_api_key',
  anthropic: 'connectors_ai_anthropic_api_key',
  google: 'connectors_ai_google_api_key',
};

interface AutoSyncLogger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Automatically sync AI credentials to a WordPress 7.0+ site on start.
 * Called from the siteStarted lifecycle hook.
 *
 * Checks WP version first — skips sites below 7.0 (no Connector Screen).
 * Only syncs providers that have a key configured in Local.
 * Silently succeeds or logs errors — never throws.
 */
export async function autoSyncCredentials(
  siteId: string,
  siteName: string,
  localServices: LocalServicesBridge,
  storage: RegistryStorage,
  logger: AutoSyncLogger,
): Promise<void> {
  // Read stored API keys
  const storedKeys = (storage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
  const providers = Object.keys(PROVIDER_TO_WP_OPTION).filter((p) => storedKeys[p]);

  if (providers.length === 0) {
    return; // No keys configured — nothing to sync
  }

  // Check WordPress version — Connector Screen requires 7.0+
  let wpVersion: string | null = null;
  try {
    wpVersion = await localServices.getWpVersion(siteId);
  } catch {
    return; // Can't determine version — skip silently
  }

  if (!wpVersion || !isWp7OrLater(wpVersion)) {
    return; // Not WP 7.0+ — no Connector Screen
  }

  logger.info(`[NexusAI] Auto-syncing AI credentials to "${siteName}" (WP ${wpVersion})`);

  let synced = 0;
  for (const provider of providers) {
    const key = storedKeys[provider];
    const optionName = PROVIDER_TO_WP_OPTION[provider];
    const escapedKey = key.replace(/'/g, "\\'");

    const phpCode = [
      `remove_all_filters('sanitize_option_${optionName}');`,
      `update_option('${optionName}', '${escapedKey}');`,
      `echo 'synced';`,
    ].join(' ');

    try {
      const result = await localServices.wpCliRun(siteId, ['eval', phpCode]);
      if (result.success && (result.stdout ?? '').includes('synced')) {
        synced++;
      } else {
        logger.error(`[NexusAI] Failed to sync ${provider} to "${siteName}": ${result.stdout}`);
      }
    } catch (err) {
      logger.error(`[NexusAI] Failed to sync ${provider} to "${siteName}":`, err);
    }
  }

  if (synced > 0) {
    logger.info(`[NexusAI] Synced ${synced} AI provider(s) to "${siteName}"`);
  }
}

/**
 * Returns true if the version string is WordPress 7.0 or later.
 * Handles formats like "7.0", "7.0-beta2", "7.1.3", "6.7.2".
 */
function isWp7OrLater(version: string): boolean {
  const match = version.match(/^(\d+)/);
  if (!match) return false;
  return parseInt(match[1], 10) >= 7;
}
