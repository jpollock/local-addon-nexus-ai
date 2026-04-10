import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const createBackupHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_backup',
    description: 'Create a backup of a WP Engine install. Requires WP Engine API credentials stored via wpe_set_api_credentials — the backup endpoint does not support OAuth. Get credentials from https://my.wpengine.com.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        description: { type: 'string', description: 'Backup description' },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const installId = args.install_id as string;
      if (!installId) return error('Install ID is required.');

      const description = (args.description as string) || 'Backup via Nexus AI';
      await services.localServices!.capiCreateBackup(installId, description);

      return ok(`Backup created for install "${installId}".`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
