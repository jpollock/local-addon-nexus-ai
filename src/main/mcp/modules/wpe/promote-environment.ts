import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const promoteEnvironmentHandler: McpToolHandler = {
  definition: {
    name: 'wpe_promote_environment',
    description:
      'Copy one WP Engine install to another (e.g., staging → production). ' +
      'Tier 3 — requires confirmation. ' +
      'Always verify the destination has a recent backup before promoting.',
    inputSchema: {
      type: 'object',
      properties: {
        source_install_id: {
          type: 'string',
          description: 'ID of the install to copy from (source)',
        },
        destination_install_id: {
          type: 'string',
          description: 'ID of the install to copy to (destination)',
        },
        include_database: {
          type: 'boolean',
          description: 'Whether to copy the database. Default: true',
        },
        _confirmationToken: {
          type: 'string',
          description: 'Pass "confirm" after reviewing the warning to proceed.',
        },
      },
      required: ['source_install_id', 'destination_install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const sourceId = args.source_install_id as string;
    const destId = args.destination_install_id as string;
    const includeDatabase = args.include_database !== false;
    const confirmationToken = args._confirmationToken as string | undefined;

    if (!confirmationToken) {
      // Fetch source and destination installs in parallel
      const [sourceResult, destResult] = await Promise.allSettled([
        services.localServices!.capiGetInstall(sourceId) as Promise<any>,
        services.localServices!.capiGetInstall(destId) as Promise<any>,
      ]);

      if (sourceResult.status === 'rejected') {
        return capiError(sourceResult.reason);
      }
      if (destResult.status === 'rejected') {
        return capiError(destResult.reason);
      }

      const source = sourceResult.value as any;
      const dest = destResult.value as any;

      const sourceName = source?.name ?? sourceId;
      const destName = dest?.name ?? destId;
      const sourceEnv = source?.environment ?? 'unknown';
      const destEnv = dest?.environment ?? 'unknown';

      const isDestProduction = destEnv === 'production';

      // Try to fetch the most recent backup for destination
      let backupWarning = '';
      try {
        const backupData = await services.localServices!.capiDirect(
          `/installs/${destId}/backups?limit=1`,
        ) as any;
        const backups: any[] = backupData?.results ?? [];
        if (backups.length === 0) {
          backupWarning = '\n\n> ⚠️ **No backups found** for the destination install. It is strongly recommended to create a backup before promoting.';
        } else {
          const latestBackup = backups[0];
          const createdAt = latestBackup?.created_at ? new Date(latestBackup.created_at) : null;
          if (createdAt) {
            const ageMs = Date.now() - createdAt.getTime();
            const ageHours = ageMs / 3600000;
            if (ageHours > 24) {
              const ageLabel = ageHours > 48
                ? `${Math.round(ageHours / 24)} days`
                : `${Math.round(ageHours)} hours`;
              backupWarning = `\n\n> ⚠️ **Last backup is ${ageLabel} old** (${createdAt.toISOString()}). Consider creating a fresh backup before promoting.`;
            } else {
              backupWarning = `\n\n> ✅ Recent backup exists (${createdAt.toISOString()}).`;
            }
          } else {
            backupWarning = '\n\n> ⚠️ Could not determine backup age. Verify a recent backup exists before promoting.';
          }
        }
      } catch {
        backupWarning = '\n\n> ⚠️ Could not check backup status for destination. Verify a recent backup exists before promoting.';
      }

      const productionWarning = isDestProduction
        ? '\n\n## 🚨 PRODUCTION DESTINATION\n\nThe destination is a **production** environment. This will overwrite live site content. This action cannot be undone.'
        : '';

      const dbLine = includeDatabase
        ? '- **Database:** included in copy'
        : '- **Database:** NOT included (files only)';

      const lines = [
        `## ⚠️ Confirm Environment Copy`,
        '',
        `Copy **${sourceName}** (${sourceEnv}) → **${destName}** (${destEnv})`,
        '',
        '### Details',
        `- **Source:** ${sourceName} (ID: ${sourceId}, env: ${sourceEnv})`,
        `- **Destination:** ${destName} (ID: ${destId}, env: ${destEnv})`,
        dbLine,
        productionWarning,
        backupWarning,
        '',
        '---',
        '',
        'To confirm, call this tool again with the same parameters plus `_confirmationToken: "confirm"`.',
      ];

      return ok(lines.join('\n'));
    }

    // Proceed with the copy
    try {
      const result = await services.localServices!.capiDirect('/install_copy', 'POST', {
        source_install_id: sourceId,
        destination_install_id: destId,
        include_database: includeDatabase,
      }) as any;

      const lines = [
        '## Environment Copy Started',
        '',
        `Copy from \`${sourceId}\` → \`${destId}\` has been initiated.`,
        '',
        `- **Include database:** ${includeDatabase ? 'yes' : 'no'}`,
        result?.id ? `- **Operation ID:** ${result.id}` : '',
        result?.status ? `- **Status:** ${result.status}` : '',
        '',
        'The copy typically takes several minutes. Check the WP Engine portal for progress.',
      ].filter((l) => l !== '');

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
