import { ContentPipeline } from './ContentPipeline';
import { IndexRegistry, RegistryStorage } from './IndexRegistry';
import { SiteConnectionInfo } from './MySQLExtractor';
import { STORAGE_KEYS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import { autoSyncCredentials } from '../mcp/modules/wp-connector/auto-sync';
import type { SiteMetadataCache } from '../metadata/SiteMetadataCache';

export interface LifecycleContext {
  hooks: {
    addAction(hook: string, callback: (...args: any[]) => void | Promise<void>): void;
  };
}

export interface LocalSiteRef {
  id: string;
  name: string;
  path: string;
}

export interface Logger {
  info(...args: any[]): void;
  error(...args: any[]): void;
}

/**
 * Register addon lifecycle hooks that trigger indexing on site events.
 *
 * @param readyPromise — resolves when VectorStore + EmbeddingService are initialized.
 *   Hooks wait on this before indexing so sites that start before init completes
 *   don't hit "EmbeddingService not initialized" errors.
 * @param metadataCache — Digital twin cache for WordPress metadata (version, plugins, themes)
 */
export function registerLifecycleHooks(
  context: LifecycleContext,
  pipeline: ContentPipeline,
  indexRegistry: IndexRegistry,
  logger: Logger,
  readyPromise?: Promise<void>,
  settingsStorage?: RegistryStorage,
  localServices?: LocalServicesBridge,
  metadataCache?: SiteMetadataCache,
): void {
  context.hooks.addAction('siteStarted', async (site: LocalSiteRef) => {
    logger.info(`[NexusAI] Site started: ${site.name}, triggering index`);

    // Check auto-index settings
    if (settingsStorage) {
      try {
        const settings = settingsStorage.get(STORAGE_KEYS.SETTINGS) as unknown as NexusSettings | null;
        if (settings?.autoIndex === false) {
          logger.info(`[NexusAI] Auto-index disabled, skipping ${site.name}`);
          return;
        }
        if (settings?.excludedSiteIds?.includes(site.id)) {
          logger.info(`[NexusAI] Site ${site.name} excluded from auto-index`);
          return;
        }
      } catch {
        // Settings read failed — proceed with default (auto-index enabled)
      }
    }

    // Wait for services to be ready (VectorStore + EmbeddingService)
    if (readyPromise) {
      try {
        await readyPromise;
      } catch {
        logger.error(`[NexusAI] Services failed to initialize, skipping index for ${site.name}`);
        return;
      }
    }

    // Digital Twin: Refresh metadata cache (WP version, plugins, themes)
    // Run in parallel with indexing since both query WordPress
    const metadataRefreshPromise = (async () => {
      if (metadataCache && localServices) {
        try {
          const [wpVersion, plugins, themes] = await Promise.all([
            localServices.getWpVersion(site.id),
            localServices.getPlugins(site.id),
            localServices.getThemes(site.id),
          ]);

          metadataCache.set(site.id, {
            wpVersion: wpVersion ?? 'unknown',
            plugins: plugins.map(p => ({
              name: p.name,
              title: p.title,
              version: p.version,
              status: p.status as 'active' | 'inactive',
              file: p.file,
            })),
            themes: themes.map(t => ({
              name: t.name,
              title: t.title,
              version: t.version,
              status: t.status as 'active' | 'inactive',
            })),
            activeTheme: themes.find(t => t.status === 'active')?.name,
            updateSource: 'lifecycle',
          });

          logger.info(`[NexusAI] Refreshed metadata cache for ${site.name} (${wpVersion})`);
        } catch (err) {
          logger.error(`[NexusAI] Metadata refresh failed for ${site.name}:`, err);
        }
      }
    })();

    const info: SiteConnectionInfo = {
      siteId: site.id,
      siteName: site.name,
      sitePath: site.path,
    };

    try {
      const result = await pipeline.indexSite(info);
      logger.info(
        `[NexusAI] Indexed ${site.name}: ${result.documentsIndexed} docs, ${result.chunksIndexed} chunks in ${result.durationMs}ms`,
      );
      if (result.errors.length > 0) {
        logger.error(`[NexusAI] Indexing warnings for ${site.name}:`, result.errors);
      }
    } catch (error) {
      logger.error(`[NexusAI] Indexing failed for ${site.name}:`, error);
    }

    // Wait for metadata refresh to complete before continuing
    await metadataRefreshPromise;

    // Auto-sync AI credentials to WP 7.0+ sites
    if (localServices && settingsStorage) {
      try {
        await autoSyncCredentials(site.id, site.name, localServices, settingsStorage, logger);
      } catch (err) {
        logger.error(`[NexusAI] Auto-sync credentials failed for ${site.name}:`, err);
      }
    }

    // Auto-install Nexus AI Connector plugin
    if (localServices && settingsStorage) {
      try {
        await installNexusAiConnectorPlugin(site, localServices, settingsStorage, logger);
      } catch (err) {
        logger.error(`[NexusAI] Plugin auto-install failed for ${site.name}:`, err);
      }
    }
  });

  context.hooks.addAction('siteStopped', async (site: LocalSiteRef) => {
    logger.info(`[NexusAI] Site stopped: ${site.name}, marking index stale`);
    indexRegistry.update(site.id, { state: 'stale' });
  });

  context.hooks.addAction('siteRemoved', async (site: LocalSiteRef) => {
    logger.info(`[NexusAI] Site removed: ${site.name}, cleaning up`);
    try {
      await pipeline.removeSite(site.id);
    } catch (error) {
      logger.error(`[NexusAI] Cleanup failed for ${site.name}:`, error);
    }

    // Digital Twin: Invalidate metadata cache
    if (metadataCache) {
      try {
        metadataCache.invalidate(site.id);
        logger.info(`[NexusAI] Invalidated metadata cache for ${site.name}`);
      } catch (error) {
        logger.error(`[NexusAI] Metadata invalidation failed for ${site.name}:`, error);
      }
    }
  });
}

/**
 * Install and activate Nexus AI Connector plugin
 */
async function installNexusAiConnectorPlugin(
  site: LocalSiteRef,
  localServices: LocalServicesBridge,
  settingsStorage: RegistryStorage,
  logger: Logger,
): Promise<void> {
  const fs = require('fs-extra');
  const path = require('path');

  // Source: bundled plugin in addon's lib directory
  const pluginSource = path.join(__dirname, '..', '..', 'wp-plugins', 'nexus-ai-connector');

  // Destination: site's plugins directory
  const pluginDest = path.join(site.path, 'app', 'public', 'wp-content', 'plugins', 'nexus-ai-connector');

  // Check if plugin already exists
  if (fs.existsSync(pluginDest)) {
    logger.info(`[NexusAI] Plugin already installed in ${site.name}`);
    // Still try to activate in case it's not active
  } else {
    // Copy plugin to site
    logger.info(`[NexusAI] Installing Nexus AI Connector plugin to ${site.name}...`);
    await fs.copy(pluginSource, pluginDest);
    logger.info(`[NexusAI] Plugin installed to ${site.name}`);
  }

  // Activate plugin via WP-CLI
  try {
    await localServices.wpCliRun(site.id, ['plugin', 'activate', 'nexus-ai-connector']);
    logger.info(`[NexusAI] Plugin activated in ${site.name}`);
  } catch (err) {
    // Plugin might already be active, that's OK
    const errMsg = (err as Error).message || '';
    if (errMsg.includes('already active')) {
      logger.info(`[NexusAI] Plugin already active in ${site.name}`);
    } else {
      throw err;
    }
  }

  // Configure plugin via MU (must-use) plugin that defines constants
  try {
    const webhookInfo = settingsStorage.get('http_webhook_info') as any;
    if (webhookInfo && webhookInfo.url && webhookInfo.authToken) {
      logger.info(`[NexusAI] Configuring plugin via MU plugin for ${site.name}...`);

      // Create mu-plugins directory if it doesn't exist
      const muPluginsDir = path.join(site.path, 'app', 'public', 'wp-content', 'mu-plugins');
      if (!fs.existsSync(muPluginsDir)) {
        fs.mkdirSync(muPluginsDir, { recursive: true });
      }

      // Create MU plugin file that defines the constants
      const muPluginPath = path.join(muPluginsDir, 'nexus-ai-connector-config.php');
      const muPluginContent = `<?php
/**
 * Nexus AI Connector Configuration
 *
 * Auto-generated by Local addon - defines webhook URL, auth token, and site ID
 * as constants so the Nexus AI Connector plugin can communicate with Local.
 */

define('NEXUS_AI_WEBHOOK_URL', '${webhookInfo.url}');
define('NEXUS_AI_AUTH_TOKEN', '${webhookInfo.authToken}');
define('NEXUS_AI_SITE_ID', '${site.id}');

// Enable WordPress debugging for Nexus AI event logging
if (!defined('WP_DEBUG')) {
    define('WP_DEBUG', true);
}
if (!defined('WP_DEBUG_LOG')) {
    define('WP_DEBUG_LOG', true);
}
if (!defined('WP_DEBUG_DISPLAY')) {
    define('WP_DEBUG_DISPLAY', false);
}
`;

      fs.writeFileSync(muPluginPath, muPluginContent);
      logger.info(`[NexusAI] Plugin configured with webhook ${webhookInfo.url}/wp-events via MU plugin`);
    } else {
      logger.info(`[NexusAI] HTTP webhook not ready yet, plugin will need manual configuration`);
    }
  } catch (err) {
    logger.error(`[NexusAI] Plugin configuration failed for ${site.name}:`, err);
    // Don't throw - plugin is installed and activated, configuration can be done manually
  }
}
