import { ContentPipeline } from './ContentPipeline';
import { IndexRegistry, RegistryStorage } from './IndexRegistry';
import { SiteConnectionInfo } from './MySQLExtractor';
import { STORAGE_KEYS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import { autoSyncCredentials } from '../mcp/modules/wp-connector/auto-sync';

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
 */
export function registerLifecycleHooks(
  context: LifecycleContext,
  pipeline: ContentPipeline,
  indexRegistry: IndexRegistry,
  logger: Logger,
  readyPromise?: Promise<void>,
  settingsStorage?: RegistryStorage,
  localServices?: LocalServicesBridge,
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

    // Auto-sync AI credentials to WP 7.0+ sites
    if (localServices && settingsStorage) {
      try {
        await autoSyncCredentials(site.id, site.name, localServices, settingsStorage, logger);
      } catch (err) {
        logger.error(`[NexusAI] Auto-sync credentials failed for ${site.name}:`, err);
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
  });
}
