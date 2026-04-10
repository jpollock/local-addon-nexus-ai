import { McpToolHandler, McpToolResult } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const deleteSiteHandler: McpToolHandler = {
  definition: {
    name: 'wpe_delete_site',
    description: 'Delete a WP Engine site and ALL its installs. Tier 3 — requires confirmation. This permanently deletes production, staging, and development environments.',
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

        // Try to count installs for this site
        let installCount = 'unknown number of';
        try {
          const installData = await services.localServices!.capiDirect(`/installs?site_id=${siteId}`) as any;
          const installs: any[] = installData?.results ?? installData ?? [];
          installCount = String(installs.length);
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

    try {
      await services.localServices!.capiDirect(`/sites/${siteId}`, 'DELETE');
      return ok(`Site "${confirmSiteName}" (\`${siteId}\`) and all its installs have been permanently deleted.`);
    } catch (err: any) {
      return capiError(err);
    }
  },
};
