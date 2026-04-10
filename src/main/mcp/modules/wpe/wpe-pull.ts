import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const wpePullHandler: McpToolHandler = {
  definition: {
    name: 'local_wpe_pull',
    description:
      'Pull a WP Engine environment to a local site. This is an async operation — ' +
      'check the Local app for progress.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Local site name, ID, or domain' },
        include_database: {
          type: 'boolean',
          description: 'Include database in the pull. Defaults to false.',
        },
        remote_install_id: {
          type: 'string',
          description: 'WP Engine install ID to pull from directly. If omitted, site must be linked.',
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

    // Check if wpePull service is available
    if (!services.localServices?.wpePull) {
      return error('WPE Pull service not available in Local.');
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

    let installAccountId: string | null = null;

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
      installAccountId = install.account?.id ?? null;
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
          `Try passing remote_install_id directly.`
        );
      }

      installName = install.name;
      installId = install.id;
      remoteSiteId = wpeSiteId;
      primaryDomain = install.primaryDomain || install.cname || `${install.name}.wpengine.com`;
      installAccountId = install.account?.id ?? null;
    }

    // Prepare hostConnections object (will be saved twice to work around race condition)
    const userId = services.localServices!.getWpeUserId();
    const hostConnectionUpdate = {
      hostConnections: [{
        hostId: 'wpe' as const,
        remoteSiteId,
        remoteSiteEnv: environment,
        accountId: installAccountId,
        userId: userId || undefined,
        magicSync: true,
        database: true,
      }],
    };

    // FIRST UPDATE: Before the pull starts (so UI shows it's linked)
    if (args.remote_install_id && !wpeConnection && remoteSiteId) {
      try {
        services.localServices.updateSite(site.id, hostConnectionUpdate);
      } catch {
        // Non-fatal — pull still works without the link
      }
    }

    try {
      // Register with tracker before firing (tracker also picks up Local's IPC events)
      services.operationTracker?.register(site.id, site.name, 'pull');

      // Fire-and-forget: wpePull.pull() is a long-running operation.
      // Return immediately and let the user poll local_operation_status.
      const pullPromise = services.localServices.wpePull.pull({
        includeSql: args.include_database === true,
        wpengineInstallName: installName,
        wpengineInstallId: installId,
        wpengineSiteId: remoteSiteId,
        wpenginePrimaryDomain: primaryDomain,
        localSiteId: site.id,
        environment,
        isMagicSync: false,
      }).catch(() => { /* errors surfaced in Local UI */ });

      // SECOND UPDATE: After pull completes, re-save hostConnections to ensure it persists
      // (works around race condition where pull process might overwrite site.json)
      if (args.remote_install_id && !wpeConnection && remoteSiteId) {
        pullPromise.then(() => {
          try {
            services.localServices?.updateSite(site.id, hostConnectionUpdate);
          } catch {
            // Non-fatal
          }
        });
      }

      return ok(
        JSON.stringify({
          status: 'in_progress',
          site: site.name,
          install: installName,
          include_database: args.include_database === true,
          linked: true,
          message: `Pull started. The site is now linked to "${installName}" in Local.`,
          next_steps: 'Poll local_operation_status every 15-30s to track progress. Operation typically takes 1-3 minutes.',
        }, null, 2),
      );
    } catch (err: any) {
      return error(`Failed to start pull: ${err.message}`);
    }
  },
};
