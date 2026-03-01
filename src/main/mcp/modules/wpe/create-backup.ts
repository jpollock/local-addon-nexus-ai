import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, requireCAPI } from './helpers';

export const createBackupHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_backup',
    description: 'Create a backup of a WP Engine install.',
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
    const installId = args.install_id as string;
    if (!installId) return error('Install ID is required.');

    const description = (args.description as string) || 'Backup via Nexus AI';
    await services.localServices!.capiCreateBackup(installId, description);

    return ok(`Backup created for install "${installId}".`);
  },
};
