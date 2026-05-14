import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';
import { isOperationAllowed } from '../../utils/operation-permissions';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { NexusSettings } from '../../../../common/types';

export const deleteInstallHandler: McpToolHandler = {
  definition: {
    name: 'wpe_delete_install',
    description: 'Tier 3 (destructive) — permanently delete a WP Engine install (single environment). Always create a backup first with wpe_backup_and_verify or wpe_create_backup. Requires confirmation token AND the install name must be provided exactly as confirm_install_name. This removes the environment and all its content — it does NOT delete the parent site or other installs. Use wpe_delete_site to remove an entire site with all its environments.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        confirm_install_name: {
          type: 'string',
          description: 'Must match the install name exactly. Required to proceed.',
        },
        _confirmationToken: { type: 'string', description: 'Set to "confirm" to proceed after reviewing the warning.' },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const installId = args.install_id as string;
    const confirmInstallName = args.confirm_install_name as string | undefined;
    const confirmationToken = args._confirmationToken as string | undefined;

    if (!confirmationToken) {
      try {
        const install = await services.localServices!.capiDirect(`/installs/${installId}`) as any;
        const installName: string = install?.name ?? installId;
        const environment: string = install?.environment ?? 'unknown';
        const domain: string = install?.primaryDomain ?? install?.cname ?? `${installName}.wpengine.com`;

        // Block deletion if environment is not permitted
        const settings = ((services as any).registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
        const effectiveEnv = environment === 'unknown' ? 'production' : environment;
        if (!isOperationAllowed('delete', effectiveEnv, settings, installName)) {
          return {
            content: [{ type: 'text' as const, text:
              `Operation blocked: this operation is not permitted on "${effectiveEnv}" environments. ` +
              `Adjust in Nexus Preferences → WP Engine → WP Engine Access.`
            }],
            isError: true,
          };
        }

        // Check if confirm_install_name was provided but doesn't match
        if (confirmInstallName && confirmInstallName !== installName) {
          return error(
            `Install name mismatch. You provided "${confirmInstallName}" but the install name is "${installName}". ` +
            `Pass \`confirm_install_name: "${installName}"\` to confirm.`,
          );
        }

        // Check for a recent backup
        let backupWarning = '';
        try {
          const backupData = await services.localServices!.capiDirect(
            `/installs/${installId}/backups?limit=1`,
          ) as any;
          const backups: any[] = backupData?.results ?? backupData ?? [];
          if (backups.length === 0) {
            backupWarning = '\n\n⚠️ **No backup found** — run `wpe_create_backup` first to protect your data.';
          } else {
            const latestBackup = backups[0];
            const backupDate = latestBackup?.created_at ? new Date(latestBackup.created_at) : null;
            const ageMs = backupDate ? Date.now() - backupDate.getTime() : Infinity;
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays > 7) {
              const daysAgo = Math.round(ageDays);
              backupWarning = `\n\n⚠️ **No recent backup** — last backup was ${daysAgo} days ago. Run \`wpe_create_backup\` first.`;
            }
          }
        } catch {
          backupWarning = '\n\n⚠️ **Could not verify backup status** — consider running `wpe_create_backup` before proceeding.';
        }

        return ok(
          `## ⚠️ Confirm Deletion of Install\n\n` +
          `**Name:** ${installName}\n` +
          `**Environment:** ${environment}\n` +
          `**Domain:** ${domain}` +
          backupWarning + '\n\n' +
          `⚠️ This action is permanent and cannot be undone.\n\n` +
          `To confirm, call this tool again with the same parameters plus:\n` +
          `- \`confirm_install_name: "${installName}"\`\n` +
          `- \`_confirmationToken: "confirm"\``,
        );
      } catch (err: any) {
        return capiError(err);
      }
    }

    // Token is present — validate confirm_install_name before deleting
    if (!confirmInstallName) {
      return error(
        'You must pass `confirm_install_name` matching the exact install name to proceed with deletion.',
      );
    }

    // Fetch the install name to verify it matches
    try {
      const install = await services.localServices!.capiDirect(`/installs/${installId}`) as any;
      const installName: string = install?.name ?? '';
      if (confirmInstallName !== installName) {
        return error(
          `Install name mismatch. You provided "${confirmInstallName}" but the install name is "${installName}". ` +
          `Pass \`confirm_install_name: "${installName}"\` to confirm.`,
        );
      }
    } catch (err: any) {
      return capiError(err);
    }

    // Re-check permissions on confirmation path (prevents race between warning and deletion)
    try {
      const confirmInstall = await services.localServices!.capiDirect(`/installs/${installId}`) as any;
      const confirmEnv = confirmInstall?.environment ?? 'production';
      const confirmSettings = ((services as any).registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
      if (!isOperationAllowed('delete', confirmEnv, confirmSettings, confirmInstall?.name ?? installId)) {
        return {
          content: [{ type: 'text' as const, text:
            `Operation blocked: this operation is not permitted on "${confirmEnv}" environments. ` +
            `Adjust in Nexus Preferences → WP Engine → WP Engine Access.`
          }],
          isError: true,
        };
      }
    } catch (err: any) {
      return capiError(err);
    }

    try {
      await services.localServices!.capiDirect(`/installs/${installId}`, 'DELETE');
      return ok(`Install "${confirmInstallName}" (\`${installId}\`) has been permanently deleted.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
