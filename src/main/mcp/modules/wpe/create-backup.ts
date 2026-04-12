import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const createBackupHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_backup',
    description: 'Create a WP Engine backup checkpoint for an install. REQUIRES basic auth API credentials (not OAuth) — configure once with wpe_set_api_credentials. Get credentials from my.wpengine.com → Profile → API Access. Returns a backup_id — use wpe_get_backup to poll completion status. Always create a backup before wpe_promote_environment or any destructive operation. Use wpe_backup_and_verify for a blocking call that waits until the backup is confirmed complete.',
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
