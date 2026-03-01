import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, requireCAPI } from './helpers';

export const purgeCacheHandler: McpToolHandler = {
  definition: {
    name: 'wpe_purge_cache',
    description: 'Purge the cache for a WP Engine install.',
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
    const installId = args.install_id as string;
    if (!installId) return error('Install ID is required.');

    await services.localServices!.capiPurgeCache(installId);
    return ok(`Cache purged for install "${installId}".`);
  },
};
