import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';
import { checkWpeInstallIdEnvironmentAccess } from '../../utils/environment-filter';

export const purgeCacheHandler: McpToolHandler = {
  definition: {
    name: 'wpe_purge_cache',
    description: 'Purge the page cache for a WP Engine install — forces all cached pages to regenerate on next request. Use after deploying content changes, plugin updates, or switching themes to ensure visitors see fresh content. Cache purge is near-instant but a full cache warm-up takes time as pages are re-cached on demand.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const installId = args.install_id as string;
      if (!installId) return error('Install ID is required.');

      // Check environment before purging cache
      const envError = checkWpeInstallIdEnvironmentAccess(
        installId,
        (services as any).registryStorage,
      );
      if (envError) {
        return {
          content: [{ type: 'text' as const, text: `Cannot purge cache: ${envError}` }],
          isError: true,
        };
      }

      await services.localServices!.capiPurgeCache(installId);
      return ok(`Cache purged for install "${installId}".`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
