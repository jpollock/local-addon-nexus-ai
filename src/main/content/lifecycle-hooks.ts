import { ContentPipeline } from './ContentPipeline';
import { IndexRegistry } from './IndexRegistry';
import { SiteConnectionInfo } from './MySQLExtractor';

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
): void {
  context.hooks.addAction('siteStarted', async (site: LocalSiteRef) => {
    logger.info(`[NexusAI] Site started: ${site.name}, triggering index`);

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
