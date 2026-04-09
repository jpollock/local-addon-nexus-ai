import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const wpePushHandler: McpToolHandler = {
  definition: {
    name: 'local_wpe_push',
    description:
      'Push a local site to WP Engine. This is a destructive operation ' +
      'that overwrites the remote environment.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        include_database: {
          type: 'boolean',
          description: 'Include database in the push. Defaults to false.',
        },
        remote_install_id: {
          type: 'string',
          description: 'WP Engine install ID to push to directly. If omitted, site must be linked.',
        },
      },
      required: ['site'],
    },
    isAvailable: (services) => requireLocalServices(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    const site = resolveSite(args.site as string, services.siteData);
    if (!site) return error(`Site "${args.site}" not found.`);

    // Verify site is running
    const status = services.localServices!.getSiteStatus(site.id);
    if (status !== 'running') {
      return error(`Site "${site.name}" is ${status}. Start it first with local_start_site.`);
    }

    // Check if wpePush service is available
    if (!services.localServices?.wpePush) {
      return error('WPE Push service not available in Local.');
    }

    // Get WPE connection from site
    const rawSite = services.localServices!.resolveSiteObject(site.id) as any;
    const wpeConnection = rawSite?.hostConnections
      ? Object.values(rawSite.hostConnections).find((c: any) => c.hostId === 'wpe' || c.accountId)
      : null;

    if (!wpeConnection && !args.remote_install_id) {
      return error(`Site "${site.name}" is not linked to a WP Engine environment. Link it first or provide remote_install_id.`);
    }

    // If remote_install_id provided, we need to get install details from CAPI
    let installName: string;
    let installId: string;
    let remoteSiteId: string;
    let primaryDomain: string;
    let environment: string;

    if (args.remote_install_id) {
      // Get install details from CAPI
      const installs = (await services.localServices.capiGetInstalls()) as any[];
      const install = installs.find((i: any) => i.id === args.remote_install_id);

      if (!install) {
        return error(`WPE install not found: ${args.remote_install_id}`);
      }

      installName = install.name;
      installId = install.id;
      remoteSiteId = typeof install.site === 'object' ? install.site.id : install.site;
      primaryDomain = install.primaryDomain || install.cname || `${install.name}.wpengine.com`;
      environment = install.environment || 'production';
    } else {
      // Resolve install from CAPI using site UUID + environment stored in hostConnections.
      // remoteSiteId is the WPE *site* UUID — must look up the install name for SSH.
      const wpeSiteId = (wpeConnection as any).remoteSiteId;
      environment = (wpeConnection as any).remoteSiteEnv || 'production';

      const installs = (await services.localServices.capiGetInstalls()) as any[];
      const install = installs.find(
        (i: any) => (typeof i.site === 'object' ? i.site.id : i.site) === wpeSiteId
          && i.environment === environment
      );

      if (!install) {
        return error(
          `Could not find WPE install for site ${wpeSiteId} (${environment}). ` +
          `Try passing install_name or remote_install_id directly.`
        );
      }

      installName = install.name;
      installId = install.id;
      remoteSiteId = wpeSiteId;
      primaryDomain = install.primaryDomain || install.cname || `${install.name}.wpengine.com`;
    }

    try {
      // Call Local's wpePush service
      await services.localServices.wpePush.push({
        includeSql: args.include_database === true,
        wpengineInstallName: installName,
        wpengineInstallId: installId,
        wpengineSiteId: remoteSiteId,
        wpenginePrimaryDomain: primaryDomain,
        localSiteId: site.id,
        environment,
        isMagicSync: false,
      });

      return ok(
        JSON.stringify({
          status: 'queued',
          async: true,
          site: site.name,
          install: installName,
          include_database: args.include_database === true,
          message: 'Push operation queued. Check the Local app for progress.',
        }, null, 2),
      );
    } catch (err: any) {
      return error(`Failed to start push: ${err.message || err}`);
    }
  },
};
