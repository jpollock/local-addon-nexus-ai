import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const getSiteChangesHandler: McpToolHandler = {
  definition: {
    name: 'local_get_site_changes',
    description: 'Show which files differ between a local site and its linked WP Engine environment (rsync dry-run diff). This is a DIFF tool — it compares two environments. It does NOT list or count remote files, inventory the site, or check file sizes. Use wpe_get_install_usage for storage info.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Site name, ID, or domain',
        },
        direction: {
          type: 'string',
          enum: ['push', 'pull'],
          description: 'Direction of comparison (default: push)',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    const direction = (args.direction as 'push' | 'pull') || 'push';

    try {
      // Get WPE install info
      const installInfo = await services.localServices!.resolveWpeInstall(site.id);
      if (!installInfo) {
        return error(`Site "${site.name}" is not linked to a WP Engine environment. Link it first with local_wpe_link.`);
      }

      // Ensure site is running
      const status = services.localServices!.getSiteStatus(site.id);
      if (status !== 'running') {
        await services.localServices!.startSite(site.id);
      }

      // Get file modifications
      const modifications = await services.localServices!.listModifications?.({
        localSiteId: site.id,
        wpengineInstallName: installInfo.installName,
        wpengineInstallId: installInfo.installId,
        wpengineSiteId: installInfo.remoteSiteId,
        wpenginePrimaryDomain: installInfo.primaryDomain,
        direction,
      });

      if (!modifications) {
        return error('WPE Connect service not available in this version of Local');
      }

      const result = {
        site: site.name,
        direction,
        remoteName: installInfo.installName,
        totalChanges: modifications.length,
        changes: modifications.map((m) => ({
          path: m.path,
          type: m.instruction,
        })),
      };

      return ok(JSON.stringify(result, null, 2));
    } catch (err: any) {
      return error(`Failed to get site changes: ${err.message}`);
    }
  },
};
