import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const backupAndVerifyHandler: McpToolHandler = {
  definition: {
    name: 'wpe_backup_and_verify',
    description:
      'Create a WP Engine backup and poll until it completes. ' +
      'More reliable than wpe_create_backup alone since it confirms the backup succeeded. ' +
      'Requires API credentials (wpe_credentials_status).',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: {
          type: 'string',
          description: 'WP Engine install ID',
        },
        description: {
          type: 'string',
          description: 'Backup description (optional)',
        },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const installId = args.install_id as string;
    if (!installId) return error('install_id is required.');

    const description = (args.description as string) || 'Backup via Nexus AI';

    // Step 1: Create the backup
    let createResponse: any;
    try {
      createResponse = await services.localServices!.capiCreateBackup(installId, description);
    } catch (err: any) {
      return capiError(err);
    }

    // Step 2: Attempt to poll if we have a backup_id
    const backupId = createResponse?.id ?? createResponse?.backup_id ?? null;

    if (!backupId) {
      return ok(
        '## Backup Created\n\n' +
        `Backup was created for install \`${installId}\`.\n\n` +
        '- **Status:** created\n' +
        '- **Note:** The backup API response did not include a backup ID, so completion status cannot be polled. ' +
        'Check the WP Engine portal to verify the backup completed successfully.',
      );
    }

    // Poll up to 60 attempts (5 minutes, every 5 seconds)
    const MAX_ATTEMPTS = 60;
    const POLL_INTERVAL_MS = 5000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      let backupData: any;
      try {
        backupData = await services.localServices!.capiDirect(
          `/installs/${installId}/backups/${backupId}`,
        ) as any;
      } catch {
        // Polling error — continue
        continue;
      }

      const status: string = (backupData?.status ?? '').toLowerCase();

      if (status === 'complete' || status === 'completed' || status === 'success') {
        const createdAt = backupData?.created_at ?? backupData?.date ?? null;
        const lines = [
          '## Backup Completed',
          '',
          `Backup for install \`${installId}\` completed successfully.`,
          '',
          `- **Backup ID:** ${backupId}`,
          `- **Status:** ${status}`,
          createdAt ? `- **Created at:** ${createdAt}` : '',
          backupData?.description ? `- **Description:** ${backupData.description}` : '',
        ].filter((l) => l !== '');
        return ok(lines.join('\n'));
      }

      if (status === 'failed' || status === 'error') {
        const lines = [
          '## Backup Failed',
          '',
          `Backup for install \`${installId}\` failed.`,
          '',
          `- **Backup ID:** ${backupId}`,
          `- **Status:** ${status}`,
          backupData?.message ? `- **Message:** ${backupData.message}` : '',
        ].filter((l) => l !== '');
        return ok(lines.join('\n'));
      }
    }

    // Timed out
    return ok(
      '## Backup Timed Out (Still Running)\n\n' +
      `Backup \`${backupId}\` for install \`${installId}\` was created but did not complete within 5 minutes of polling.\n\n` +
      '- The backup may still be running in the background.\n' +
      '- Check the WP Engine portal for the final status.\n' +
      `- Backup ID: ${backupId}`,
    );
  },
};
