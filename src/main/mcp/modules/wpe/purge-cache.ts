import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';
import { isOperationAllowed } from '../../utils/operation-permissions';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { NexusSettings } from '../../../../common/types';

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

      // Check operation permissions before purging cache
      const settings = ((services as any).registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
      const cache = (services as any).registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as { installs?: Array<{ installId?: string; environment?: string; installName?: string; install_name?: string }> } | null;
      const cachedInstall = cache?.installs?.find((i: any) => i.installId === installId);
      const installEnvironment = cachedInstall?.environment ?? 'production';
      const installNameForCheck = cachedInstall?.installName ?? cachedInstall?.install_name ?? installId;
      if (!isOperationAllowed('delete', installEnvironment, settings, installNameForCheck)) {
        return {
          content: [{ type: 'text' as const, text:
            `Operation blocked: this operation is not permitted on "${installEnvironment}" environments. ` +
            `Adjust in Nexus Preferences → WP Engine → WP Engine Access.`
          }],
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
