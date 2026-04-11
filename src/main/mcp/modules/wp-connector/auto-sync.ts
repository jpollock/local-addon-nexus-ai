import type { LocalServicesBridge } from '../../local-services-bridge';
import type { RegistryStorage } from '../../../content/IndexRegistry';
import { STORAGE_KEYS } from '../../../../common/constants';
import {
  PROVIDER_TO_WP_OPTION,
  buildCredentialSyncPhp,
  CredentialEntry,
} from './credential-helpers';
import { redactCredentials } from '../../security/credential-redaction';

interface AutoSyncLogger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Automatically sync AI credentials to a WordPress 7.0+ site on start.
 * Called from the siteStarted lifecycle hook.
 *
 * Uses per-site AI config to determine which provider to sync.
 * Sites that haven't run Setup AI are skipped.
 * Silently succeeds or logs errors — never throws.
 */
export async function autoSyncCredentials(
  siteId: string,
  siteName: string,
  localServices: LocalServicesBridge,
  storage: RegistryStorage,
  logger: AutoSyncLogger,
): Promise<void> {
  // Look up per-site AI config — if not set up, nothing to sync
  const siteConfigs = (storage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
  const siteConfig = siteConfigs[siteId];

  if (!siteConfig) {
    return; // Site hasn't run Setup AI yet
  }

  const { provider, useLocalGateway } = siteConfig;

  // Local Gateway sites manage credentials in Local's Node.js process — never in WordPress DB
  if (useLocalGateway) {
    return;
  }

  // Only sync the key for this site's configured provider
  const storedKeys = (storage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
  const apiKey = storedKeys[provider];

  // Providers that don't need a key (ollama, local-gateway) — nothing to sync
  if (!apiKey || !PROVIDER_TO_WP_OPTION[provider]) {
    return;
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

  logger.info(`[NexusAI] Auto-syncing ${provider} credentials to "${siteName}" (WP ${wpVersion})`);

  const entries: CredentialEntry[] = [{
    provider,
    key: apiKey,
    optionName: PROVIDER_TO_WP_OPTION[provider],
  }];

  const phpCode = buildCredentialSyncPhp(entries);

  try {
    const result = await localServices.wpCliRun(siteId, ['eval', phpCode]);
    if (result.success) {
      try {
        const parsed = JSON.parse((result.stdout ?? '').trim());
        logger.info(`[NexusAI] Credential sync to "${siteName}": connectors=${parsed.connectors}, ai_client=${parsed.ai_client ? 'ok' : 'failed'}`);
      } catch {
        logger.info(`[NexusAI] Credential sync raw output for "${siteName}": ${redactCredentials(result.stdout ?? '')}`);
      }
    } else {
      logger.error(`[NexusAI] Failed to sync credentials to "${siteName}": ${redactCredentials(result.stdout ?? '')}`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[NexusAI] Failed to sync credentials to "${siteName}": ${redactCredentials(errMsg)}`);
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
