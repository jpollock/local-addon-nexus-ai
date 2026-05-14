import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';
import { isOperationAllowed } from '../../utils/operation-permissions';
import { STORAGE_KEYS } from '../../../../common/constants';
import type { NexusSettings } from '../../../../common/types';

export const deleteSiteHandler: McpToolHandler = {
  definition: {
    name: 'wpe_delete_site',
    description: 'Tier 3 (destructive) — permanently delete a WP Engine site and ALL its installs (production, staging, development). This is irreversible. Create backups for all installs first with wpe_create_backup before proceeding. Requires confirmation token: call once to see the list of installs that will be deleted, then call again with _confirmationToken to proceed. Use wpe_delete_install to remove a single environment without deleting the site.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'WP Engine site ID' },
        confirm_site_name: {
          type: 'string',
          description: 'Must match the site name exactly to confirm deletion.',
        },
        _confirmationToken: { type: 'string', description: 'Set to "confirm" to proceed after reviewing the warning.' },
      },
      required: ['site_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const siteId = args.site_id as string;
    const confirmSiteName = args.confirm_site_name as string | undefined;
    const confirmationToken = args._confirmationToken as string | undefined;

    if (!confirmationToken) {
      // Fetch site details to show in the warning
      try {
        const site = await services.localServices!.capiDirect(`/sites/${siteId}`) as any;
        const siteName: string = site?.name ?? siteId;

        // Check if confirm_site_name was provided but doesn't match
        if (confirmSiteName && confirmSiteName !== siteName) {
          return error(
            `Site name mismatch. You provided "${confirmSiteName}" but the site name is "${siteName}". ` +
            `Pass \`confirm_site_name: "${siteName}"\` to confirm.`,
          );
        }

        // Try to count installs for this site, and check environment access
        let installCount = 'unknown number of';
        try {
          const installData = await services.localServices!.capiDirect(`/installs?site_id=${siteId}`) as any;
          const installs: any[] = installData?.results ?? installData ?? [];
          installCount = String(installs.length);

          // Block if any install is in a restricted environment (e.g. production)
          const settings = ((services as any).registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
          for (const inst of installs) {
            const instEnv = inst?.environment ?? 'production';
            const instName = inst?.name ?? inst?.installName ?? inst?.install_name ?? inst?.id;
            if (!isOperationAllowed('delete', instEnv, settings, instName)) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Operation blocked: this operation is not permitted on "${instEnv}" environments. ` +
                    `Adjust in Nexus Preferences → WP Engine → WP Engine Access.`,
                }],
                isError: true,
              };
            }
          }
        } catch {
          // Non-fatal — continue without install count
        }

        return ok(
          `## ⚠️ Confirm Deletion of Site\n\n` +
          `**Name:** ${siteName}\n` +
          `**ID:** \`${siteId}\`\n` +
          `**Environments:** ${installCount} install(s) will be permanently deleted\n\n` +
          `⚠️ This action is permanent and cannot be undone. ALL installs (production, staging, development) inside this site will be deleted.\n\n` +
          `To confirm, call this tool again with the same parameters plus:\n` +
          `- \`confirm_site_name: "${siteName}"\`\n` +
          `- \`_confirmationToken: "confirm"\``,
        );
      } catch (err: any) {
        return capiError(err);
      }
    }

    // Token is present — validate confirm_site_name before deleting
    if (!confirmSiteName) {
      return error(
        'You must pass `confirm_site_name` matching the exact site name to proceed with deletion.',
      );
    }

    // Fetch the site name to verify it matches
    try {
      const site = await services.localServices!.capiDirect(`/sites/${siteId}`) as any;
      const siteName: string = site?.name ?? '';
      if (confirmSiteName !== siteName) {
        return error(
          `Site name mismatch. You provided "${confirmSiteName}" but the site name is "${siteName}". ` +
          `Pass \`confirm_site_name: "${siteName}"\` to confirm.`,
        );
      }
    } catch (err: any) {
      return capiError(err);
    }

    // Re-check permissions before deletion
    try {
      const confirmInstallsData = await services.localServices!.capiDirect(
        `/installs?site_id=${siteId}&limit=100`,
      ).catch(() => null) as any;
      const confirmInstalls: any[] = confirmInstallsData?.results ?? confirmInstallsData ?? [];
      const confirmSettings = ((services as any).registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as NexusSettings;
      for (const inst of confirmInstalls) {
        const instEnv = inst?.environment ?? 'production';
        const instName = inst?.name ?? inst?.id;
        if (!isOperationAllowed('delete', instEnv, confirmSettings, instName)) {
          return {
            content: [{ type: 'text' as const, text:
              `Operation blocked: this operation is not permitted on "${instEnv}" environments. ` +
              `Adjust in Nexus Preferences → WP Engine → WP Engine Access.`
            }],
            isError: true,
          };
        }
      }
    } catch (err: any) {
      return {
        content: [{
          type: 'text' as const,
          text: `Cannot verify operation permissions for site deletion: ${err?.message ?? 'CAPI error'}. Retry when the API is available.`,
        }],
        isError: true,
      };
    }

    try {
      await services.localServices!.capiDirect(`/sites/${siteId}`, 'DELETE');
      return ok(`Site "${confirmSiteName}" (\`${siteId}\`) and all its installs have been permanently deleted.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
