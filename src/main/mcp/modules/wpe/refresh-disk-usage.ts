import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const refreshInstallDiskUsageHandler: McpToolHandler = {
  definition: {
    name: 'wpe_refresh_install_disk_usage',
    description: 'Trigger a fresh disk usage calculation for a WP Engine install. WPE disk usage data can be up to an hour stale — use this to get current numbers after large file operations. Calculation runs asynchronously; check wpe_get_install_usage for the updated values after a few minutes.',
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

      await services.localServices!.capiDirect(
        `/installs/${installId}/usage/refresh_disk_usage`,
        'POST',
        {},
      );

      return ok(
        `Disk usage recalculation triggered for install \`${installId}\`.\n\n` +
        `The updated usage data may take a few minutes to reflect.`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
