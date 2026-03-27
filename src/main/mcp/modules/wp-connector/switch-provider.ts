/**
 * Switch AI Provider for a Site
 *
 * Lightweight alternative to full setup-ai when changing providers.
 * Deactivates the old provider plugin, installs/activates the new one,
 * syncs the new provider's key, and updates SiteAIConfig.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { LocalServicesBridge } from '../../local-services-bridge';
import type { RegistryStorage } from '../../../content/IndexRegistry';
import type { AIProvider, SiteAIConfig } from '../../../../common/types';
import { STORAGE_KEYS } from '../../../../common/constants';
import { PROVIDER_TO_WP_OPTION, buildCredentialSyncPhp, CredentialEntry } from './credential-helpers';

const WP_PLUGINS_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'wp-plugins');

interface Logger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Maps provider ID to the WordPress plugin slug */
const PROVIDER_PLUGIN_SLUG: Partial<Record<AIProvider, string>> = {
  anthropic: 'ai-provider-for-anthropic',
  openai:    'ai-provider-for-openai',
  google:    'ai-provider-for-google',
  ollama:    'ai-provider-for-ollama',
  'local-gateway': 'ai-provider-for-local-gateway',
};

export interface SwitchProviderResult {
  success: boolean;
  error?: string;
  previousProvider?: AIProvider;
  newProvider?: AIProvider;
}

export async function switchProviderForSite(
  siteId: string,
  newProvider: AIProvider,
  localServices: LocalServicesBridge,
  registryStorage: RegistryStorage,
  logger: Logger,
): Promise<SwitchProviderResult> {
  const tag = '[NexusAI:switch-provider]';

  // Get current per-site config
  const siteConfigs = (registryStorage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, SiteAIConfig>;
  const current = siteConfigs[siteId];
  const previousProvider = current?.provider;

  logger.info(`${tag} Switching site ${siteId}: ${previousProvider ?? 'unconfigured'} → ${newProvider}`);

  // Step 1: Deactivate old provider plugin (if different from new)
  if (previousProvider && previousProvider !== newProvider) {
    const oldSlug = PROVIDER_PLUGIN_SLUG[previousProvider];
    if (oldSlug) {
      try {
        const deactivateResult = await localServices.wpCliRun(siteId, ['plugin', 'deactivate', oldSlug, '--quiet']);
        if (deactivateResult.success) {
          logger.info(`${tag} Deactivated ${oldSlug}`);
        } else {
          // Non-fatal — plugin may not have been installed
          logger.info(`${tag} Could not deactivate ${oldSlug} (may not be installed)`);
        }
      } catch {
        logger.info(`${tag} Could not deactivate old provider plugin`);
      }
    }
  }

  // Step 2: Install/activate new provider plugin
  const newSlug = PROVIDER_PLUGIN_SLUG[newProvider];
  if (newSlug) {
    try {
      // Try activating first (already installed)
      const activateResult = await localServices.wpCliRun(siteId, ['plugin', 'activate', newSlug, '--quiet']);
      if (!activateResult.success) {
        const isBundled = newProvider === 'ollama' || newProvider === 'local-gateway';
        if (!isBundled) {
          // External provider — install from wp.org
          const installResult = await localServices.wpCliRun(siteId, ['plugin', 'install', newSlug, '--activate', '--quiet']);
          if (!installResult.success) {
            return { success: false, error: `Failed to install provider plugin: ${newSlug}` };
          }
        } else {
          // Bundled provider — copy from addon bundle then activate
          const site = localServices.resolveSiteObject(siteId) as any;
          const sitePluginsDir = site?.paths?.webRoot
            ? path.join(site.paths.webRoot, 'wp-content', 'plugins')
            : null;

          if (!sitePluginsDir) {
            return { success: false, error: `Could not determine plugins directory for site` };
          }

          const pluginSource = path.join(WP_PLUGINS_ROOT, newSlug);
          if (!fs.existsSync(pluginSource)) {
            return { success: false, error: `Bundled plugin not found: ${newSlug}` };
          }

          const pluginDest = path.join(sitePluginsDir, newSlug);
          fs.cpSync(pluginSource, pluginDest, { recursive: true });
          logger.info(`${tag} Copied bundled plugin ${newSlug} to site`);

          const activateCopied = await localServices.wpCliRun(siteId, ['plugin', 'activate', newSlug, '--quiet']);
          if (!activateCopied.success) {
            return { success: false, error: `Failed to activate bundled plugin: ${newSlug}` };
          }
        }
      }
      logger.info(`${tag} Activated ${newSlug}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Plugin error: ${msg}` };
    }
  }

  // Step 3: Sync new provider's API key (if needed)
  const storedKeys = (registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
  const apiKey = storedKeys[newProvider];

  if (apiKey && PROVIDER_TO_WP_OPTION[newProvider]) {
    const entries: CredentialEntry[] = [{
      provider: newProvider,
      key: apiKey,
      optionName: PROVIDER_TO_WP_OPTION[newProvider],
    }];
    const phpCode = buildCredentialSyncPhp(entries);
    try {
      await localServices.wpCliRun(siteId, ['eval', phpCode]);
      logger.info(`${tag} Synced ${newProvider} credentials`);
    } catch {
      logger.info(`${tag} Could not sync credentials (non-fatal)`);
    }
  }

  // Step 4: Update SiteAIConfig
  siteConfigs[siteId] = {
    provider: newProvider,
    model: current?.model,
    configuredAt: Date.now(),
  };
  registryStorage.set(STORAGE_KEYS.SITE_AI_CONFIG, siteConfigs);

  logger.info(`${tag} Done — site now uses ${newProvider}`);
  return { success: true, previousProvider, newProvider };
}
