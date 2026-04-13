import { McpToolHandler, McpToolResult } from '../../types';
import { resolveSite } from '../../site-resolver';
import { ok, error, requireLocalServices } from './helpers';

export const wpePushHandler: McpToolHandler = {
  definition: {
    name: 'local_wpe_push',
    description:
      'Tier 3 (destructive) — push a local site to WP Engine, overwriting the live environment. ' +
      'PREREQUISITES: (1) always pull first (local_wpe_pull) to ensure local copy is current; ' +
      '(2) run wp_site_health to confirm no regressions; ' +
      '(3) confirm user understands this overwrites the live WPE environment — no automatic rollback. ' +
      'include_database defaults to false — set true to also push the database. ' +
      'ASYNC: returns immediately. Poll local_operation_status every 20s until complete. ' +
      'WPE keeps backups in the portal (my.wpengine.com) if rollback is needed.',
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
      // Register with tracker before firing (tracker also picks up Local's IPC events)
      services.operationTracker?.register(site.id, site.name, 'push');

      // Fire-and-forget: wpePush.push() is a long-running operation (1-5 min).
      // Return immediately and let the user poll local_operation_status.
      services.localServices.wpePush.push({
        includeSql: args.include_database === true,
        wpengineInstallName: installName,
        wpengineInstallId: installId,
        wpengineSiteId: remoteSiteId,
        wpenginePrimaryDomain: primaryDomain,
        localSiteId: site.id,
        environment,
        isMagicSync: false,
      }).catch(() => { /* errors surfaced in Local UI */ });

      return ok(
        JSON.stringify({
          status: 'in_progress',
          site: site.name,
          install: installName,
          include_database: args.include_database === true,
          message: `Push started. This takes 2–10 minutes for files + database.`,
          IMPORTANT: 'Do NOT proceed with backups, WP-CLI commands, or any follow-up steps until the push is confirmed complete.',
          how_to_check: `Call local_get_site with site="${site.name}" every 30 seconds. Status will be "pushing" while in progress and return to "running" when complete. Only proceed once status is "running".`,
        }, null, 2),
      );
    } catch (err: any) {
      return error(`Failed to start push: ${err.message || err}`);
    }
  },
};
