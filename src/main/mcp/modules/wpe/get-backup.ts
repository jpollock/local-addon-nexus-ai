import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const getBackupHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_backup',
    description: 'Get the status of a WP Engine backup by backup_id. Returns status (pending/running/complete/failed), started/completed timestamps, and size. Use after wpe_create_backup to poll completion. For a blocking wait, use wpe_backup_and_verify instead.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        backup_id: { type: 'string', description: 'Backup ID' },
      },
      required: ['install_id', 'backup_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const installId = args.install_id as string;
      const backupId = args.backup_id as string;

      if (!installId) return error('Install ID is required.');
      if (!backupId) return error('Backup ID is required.');

      const backup = await services.localServices!.capiDirect(
        `/installs/${installId}/backups/${backupId}`,
      ) as any;
      if (!backup) return error(`Backup "${backupId}" not found.`);

      const created = backup.created_at
        ? new Date(backup.created_at).toLocaleString()
        : 'unknown';

      const lines = [
        `## Backup: \`${backupId}\``,
        ``,
        `| Field | Value |`,
        `|-------|-------|`,
        `| **Status** | ${backup.status ?? 'unknown'} |`,
        `| **Type** | ${backup.type ?? 'unknown'} |`,
        `| **Created** | ${created} |`,
        `| **Description** | ${backup.description ?? '—'} |`,
      ];
      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
