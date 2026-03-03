import type { LocalServicesBridge } from '../../local-services-bridge';
import type { RegistryStorage } from '../../../content/IndexRegistry';
import { STORAGE_KEYS } from '../../../../common/constants';
import {
  PROVIDER_TO_WP_OPTION,
  buildCredentialSyncPhp,
  CredentialEntry,
} from './credential-helpers';

interface AutoSyncLogger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Automatically sync AI credentials to a WordPress 7.0+ site on start.
 * Called from the siteStarted lifecycle hook.
 *
 * Writes to BOTH credential stores:
 * 1. connectors_ai_{provider}_api_key (WP 7.0 Core Connector Screen)
 * 2. wp_ai_client_provider_credentials (AI Experiments plugin)
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

  // Build credential entries for the shared PHP builder
  const entries: CredentialEntry[] = providers.map((provider) => ({
    provider,
    key: storedKeys[provider],
    optionName: PROVIDER_TO_WP_OPTION[provider],
  }));

  const phpCode = buildCredentialSyncPhp(entries);

  try {
    // skipPlugins defaults to true — safe because we remove all filters and verify via $wpdb
    const result = await localServices.wpCliRun(
      siteId,
      ['eval', phpCode],
    );

    if (result.success) {
      try {
        const parsed = JSON.parse((result.stdout ?? '').trim());
        const aiClientStatus = parsed.ai_client ? 'ok' : 'failed';
        logger.info(
          `[NexusAI] Credential sync to "${siteName}": connectors=${parsed.connectors}, ai_client=${aiClientStatus}`,
        );
        if (parsed.debug && parsed.debug.length > 0) {
          logger.error(`[NexusAI] Credential sync debug for "${siteName}": ${JSON.stringify(parsed.debug)}`);
        }
      } catch {
        logger.info(`[NexusAI] Credential sync raw output for "${siteName}": ${result.stdout}`);
      }
    } else {
      logger.error(`[NexusAI] Failed to sync credentials to "${siteName}": ${result.stdout}`);
    }
  } catch (err) {
    logger.error(`[NexusAI] Failed to sync credentials to "${siteName}":`, err);
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
