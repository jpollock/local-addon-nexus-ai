/**
 * Site CRUD resolvers — list, get, create, clone, rename, export, import,
 * start, stop, restart, delete, logs, config-php, config-ssl, config-xdebug,
 * blueprints.
 */

import type { NexusServices } from '../../types/nexus-services';
import {
  parseTarget,
  resolveSite,
  resolveWpeGraphSite,
  buildWpeSiteDetails,
  formatTwinAge,
} from '../resolver-utils';
import type { ResolverParent } from '../resolver-utils';

export function createSiteResolvers(services: NexusServices) {
  return {
    /**
     * List all sites (local + WPE)
     */
    nexusSitesList: async () => {
      try {
        const sites = Object.values(services.siteData.getSites());
        const statuses = services.localServices?.getAllSiteStatuses() || {};

        let wpeInstalls: any[] = [];
        const wpeAccounts: Map<string, string> = new Map();

        if (services.localServices?.isCAPIAvailable() && services.localServices?.isWPEAuthenticated()) {
          try {
            const [installs, accounts] = await Promise.all([
              services.localServices.capiGetInstalls() as Promise<any[]>,
              services.localServices!.capiGetAccounts() as Promise<any[]>,
            ]);
            wpeInstalls = installs || [];
            if (accounts && Array.isArray(accounts)) {
              accounts.forEach((account: any) => {
                if (account.id && account.name) {
                  wpeAccounts.set(account.id, account.name);
                }
              });
            }
          } catch (err) {
            console.warn('[Nexus GraphQL] WPE sites unavailable:', err);
          }
        }

        const local = sites.map((site) => {
          const twinCompleteness = services.twinService?.get(site.id)?.completeness ?? 'none';
          const rawSite = services.localServices?.resolveSiteObject?.(site.id) as any;
          const wpeConnection = rawSite?.hostConnections
            ? Object.values(rawSite.hostConnections).find((c: any) => c.hostId === 'wpe' || (c as any).accountId)
            : null;

          if (!wpeConnection) {
            return {
              name: site.name,
              status: statuses[site.id] || 'unknown',
              wpVersion: site.wpVersion || null,
              domain: site.domain || 'unknown',
              id: site.id,
              phpVersion: site.phpVersion || null,
              twinCompleteness,
              linkedTo: null,
            };
          }

          const remoteSiteId = (wpeConnection as any).remoteSiteId;
          const remoteSiteEnv = (wpeConnection as any).remoteSiteEnv;

          const install = wpeInstalls.find((i: any) => {
            const siteId = (i.site && i.site.id) ? i.site.id : i.id;
            return siteId === remoteSiteId && (!remoteSiteEnv || i.environment === remoteSiteEnv);
          });

          let accountId = 'unknown';
          let accountName: string | null = null;
          if (install) {
            accountId = typeof install.account === 'object' && install.account?.id
              ? install.account.id
              : (typeof install.account === 'string' ? install.account : 'unknown');
            accountName = wpeAccounts.get(accountId) || null;
          } else {
            const acc = (wpeConnection as any).accountId;
            accountId = typeof acc === 'object' && acc?.id
              ? acc.id
              : (typeof acc === 'string' ? acc : 'unknown');
            accountName = wpeAccounts.get(accountId) || null;
          }

          return {
            name: site.name,
            status: statuses[site.id] || 'unknown',
            wpVersion: site.wpVersion || null,
            domain: site.domain || 'unknown',
            id: site.id,
            phpVersion: site.phpVersion || null,
            twinCompleteness,
            linkedTo: {
              account: accountId,
              accountName,
              installId: install?.id || remoteSiteId || 'unknown',
              installName: install?.name || null,
              environment: remoteSiteEnv || 'unknown',
              createdAt: new Date().toISOString(),
              lastSyncedAt: null,
            },
          };
        });

        let wpe: any[] = [];
        try {
          wpe = wpeInstalls.map((install: any) => {
            const linkedSite = local.find((s: any) => s.linkedTo?.installId === install.id);
            const accountId = typeof install.account === 'object' && install.account?.id
              ? install.account.id
              : (typeof install.account === 'string' ? install.account : 'unknown');
            const accountName = wpeAccounts.get(accountId) || null;
            const domain = install.primaryDomain || install.cname || (install.name ? `${install.name}.wpengine.com` : 'unknown');
            return {
              account: accountId || 'unknown',
              accountName,
              installId: install.id || install.name || 'unknown',
              environment: install.environment || 'unknown',
              name: install.name || null,
              domain,
              wpVersion: install.wpVersion || null,
              phpVersion: install.phpVersion || null,
              linkedTo: linkedSite?.name || null,
            };
          });
        } catch (wpeErr: any) {
          console.warn('[Nexus GraphQL] WPE install processing error:', wpeErr.message);
        }

        return { local, wpe };
      } catch (error: any) {
        console.error('[Nexus GraphQL] nexusSitesList error:', error.message);
        return { local: [], wpe: [] };
      }
    },

    /**
     * Get detailed information about a site
     */
    nexusSitesGet: async (_parent: ResolverParent, { target }: { target: string }) => {
      try {
        const parsed = parseTarget(target);
        const graphService = services.graphService;

        if (parsed.type === 'wpe') {
          const rows = graphService?.getDb?.()
            ? (graphService.getDb()!.prepare("SELECT * FROM sites WHERE source='wpe'").all() as any[])
            : [];
          const installName = parsed.installName!;
          const graphSite = rows.find((r: any) =>
            r.remote_install_id === installName ||
            r.name?.toLowerCase() === installName.toLowerCase()
          ) ?? null;

          if (!graphSite) {
            return { success: false, error: `WPE install not found: ${target}` };
          }

          const twin = services.twinService?.getFromGraph?.(graphSite, graphService) ?? null;
          const twinAge = twin?.asOf ? formatTwinAge(Date.now() - twin.asOf) : null;
          return { success: true, site: buildWpeSiteDetails(graphSite, twin, twinAge) };
        }

        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);

        if (site) {
          const status = services.localServices!.getSiteStatus(site.id);
          const indexEntry = services.indexRegistry.get(site.id);

          let linkedTo = null;
          const rawSite = services.localServices?.resolveSiteObject?.(site.id) as any;
          const wpeConnection = rawSite?.hostConnections
            ? Object.values(rawSite.hostConnections).find((c: any) => c.hostId === 'wpe' || (c as any).accountId)
            : null;

          if (wpeConnection) {
            const remoteSiteId = (wpeConnection as any).remoteSiteId;
            const remoteSiteEnv = (wpeConnection as any).remoteSiteEnv;
            linkedTo = {
              installId: remoteSiteId || 'unknown',
              environment: remoteSiteEnv?.environment || 'unknown',
            };
          }

          const twin = services.twinService?.get(site.id) ?? null;
          const twinAge = twin?.asOf ? formatTwinAge(Date.now() - twin.asOf) : null;

          return {
            success: true,
            site: {
              id: site.id,
              name: site.name,
              domain: site.domain,
              path: site.path,
              status,
              siteKind: 'local',
              wpVersion:            twin?.wpVersion ?? site.wpVersion ?? null,
              phpVersion:           twin?.phpVersion ?? site.phpVersion ?? null,
              mysqlVersion:         twin?.mysqlVersion ?? null,
              siteUrl:              twin?.siteUrl ?? null,
              adminEmail:           twin?.adminEmail ?? null,
              activeTheme:          twin?.activeTheme ?? null,
              activePluginCount:    twin?.plugins?.filter((p) => p.status === 'active').length ?? null,
              installedPluginCount: twin?.plugins?.length ?? (Array.isArray(twin?.installedPlugins) ? twin!.installedPlugins.length : null),
              postCount:            twin?.postCount ?? null,
              lastPostAt:           twin?.lastPostAt ? new Date(Number(twin.lastPostAt)).toISOString() : null,
              twinCompleteness:     twin?.completeness ?? 'none',
              twinAge,
              indexed: !!indexEntry,
              indexedAt: indexEntry?.lastIndexed?.toString() || null,
              documentCount: indexEntry?.documentCount || 0,
              chunkCount: indexEntry?.chunkCount || 0,
              linkedTo,
            },
          };
        }

        const graphSite = resolveWpeGraphSite(parsed.siteName!, graphService);
        if (graphSite) {
          const twin = services.twinService?.getFromGraph?.(graphSite, graphService) ?? null;
          const twinAge = twin?.asOf ? formatTwinAge(Date.now() - twin.asOf) : null;
          return { success: true, site: buildWpeSiteDetails(graphSite, twin, twinAge) };
        }

        return {
          success: false,
          error: `Site "${parsed.siteName}" not found. Try 'nexus sites list' to see available sites.`,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Clone an existing site
     */
    nexusSitesClone: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(input.source);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites can be cloned. Use target format: mysite@local' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Source site "${parsed.siteName}" not found` };
        }

        if (!input.newName || !input.newName.trim()) {
          return { success: false, error: 'New site name is required' };
        }

        const existingSite = resolveSite(input.newName, services.siteData);
        if (existingSite) {
          return { success: false, error: `Site "${input.newName}" already exists` };
        }

        const result = await services.localServices.cloneSite(site.id, input.newName.trim());

        if (!result) {
          return { success: false, error: 'Clone operation returned no result' };
        }

        return { success: true, siteName: result.name, siteId: result.id };
      } catch (error: any) {
        console.error('[nexusSitesClone] Error:', error);
        return { success: false, error: error.message || 'Unknown error during clone' };
      }
    },

    /**
     * Rename a site
     */
    nexusSitesRename: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(input.target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites can be renamed. Use target format: mysite@local' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site "${parsed.siteName}" not found` };
        }

        if (!input.newName || !input.newName.trim()) {
          return { success: false, error: 'New site name is required' };
        }

        const existingSite = resolveSite(input.newName, services.siteData);
        if (existingSite && existingSite.id !== site.id) {
          return { success: false, error: `Site "${input.newName}" already exists` };
        }

        const oldName = site.name;
        services.localServices.updateSite(site.id, { name: input.newName.trim() });

        return { success: true, oldName, newName: input.newName.trim() };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Export a site to archive
     */
    nexusSitesExport: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const siteName = (input.target as string).replace(/@local$/, '');
        const site = resolveSite(siteName, services.siteData);
        if (!site) {
          return { success: false, error: `Site "${siteName}" not found` };
        }

        const outputPath = input.outputPath || `${site.name}-export.zip`;
        const resultPath = await services.localServices.exportSite(site.id, outputPath);

        return { success: true, outputPath: resultPath };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Import a site from archive
     */
    nexusSitesImport: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        if (!input.archivePath) {
          return { success: false, error: 'Archive path is required' };
        }

        const result = await services.localServices.importSite(input.archivePath, input.name);

        return { success: true, siteName: result.name, siteId: result.id };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Get site logs
     */
    nexusSitesLogs: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(input.target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites support logs. Use target format: mysite@local' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site "${parsed.siteName}" not found` };
        }

        const logs = await services.localServices.getSiteLogs!(site.id, {
          tail: input.tail || 100,
          follow: input.follow || false,
        });

        return { success: true, logs };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Change PHP version
     */
    nexusSitesConfigPhp: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(input.target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites support PHP configuration. Use target format: mysite@local' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site "${parsed.siteName}" not found` };
        }

        const oldVersion = site.phpVersion || 'unknown';
        await services.localServices.changePhpVersion!(site.id, input.version);

        return { success: true, oldVersion, newVersion: input.version };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Trust SSL certificate
     */
    nexusSitesConfigSsl: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(input.target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites support SSL trust. Use target format: mysite@local' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site "${parsed.siteName}" not found` };
        }

        await services.localServices.trustSsl!(site.id);

        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Toggle Xdebug
     */
    nexusSitesConfigXdebug: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(input.target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites support Xdebug. Use target format: mysite@local' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site "${parsed.siteName}" not found` };
        }

        const enabled = input.enabled !== false;
        await services.localServices.toggleXdebug!(site.id, enabled);

        return { success: true, enabled };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * List blueprints
     */
    nexusBlueprintsList: async () => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available', blueprints: [] };
        }

        const blueprints = await services.localServices.getBlueprints!();

        return {
          success: true,
          blueprints: blueprints.map((bp: any) => ({
            name: bp.name,
            description: bp.description || null,
          })),
        };
      } catch (error: any) {
        return { success: false, error: error.message, blueprints: [] };
      }
    },

    /**
     * Save site as blueprint
     */
    nexusBlueprintsSave: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(input.target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites can be saved as blueprints. Use target format: mysite@local' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site "${parsed.siteName}" not found` };
        }

        await services.localServices.saveBlueprint!(site.id, input.blueprintName);

        return { success: true, blueprintName: input.blueprintName };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Create a new local site
     */
    nexusSitesCreate: async (_parent: ResolverParent, { input }: { input: any }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const result = await services.localServices.createSite({
          name: input.name,
          phpVersion: input.phpVersion,
        });

        return { success: true, siteName: result.name, siteId: result.id, siteDomain: result.domain };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Start a local site
     */
    nexusSitesStart: async (_parent: ResolverParent, { target }: { target: string }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites can be started. Pull this site to local first.' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site not found: ${parsed.siteName}` };
        }

        await services.localServices.startSite(site.id);
        const newStatus = services.localServices.getSiteStatus(site.id);

        return { success: true, siteName: site.name, status: newStatus };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Stop a local site
     */
    nexusSitesStop: async (_parent: ResolverParent, { target }: { target: string }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites can be stopped. WPE sites are always running.' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site not found: ${parsed.siteName}` };
        }

        await services.localServices.stopSite(site.id);
        const newStatus = services.localServices.getSiteStatus(site.id);

        return { success: true, siteName: site.name, status: newStatus };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Restart a local site
     */
    nexusSitesRestart: async (_parent: ResolverParent, { target }: { target: string }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'Only local sites can be restarted. WPE sites are always running.' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site not found: ${parsed.siteName}` };
        }

        await services.localServices.restartSite(site.id);
        const newStatus = services.localServices.getSiteStatus(site.id);

        return { success: true, siteName: site.name, status: newStatus };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Delete a local site
     */
    nexusSitesDelete: async (_parent: ResolverParent, { target }: { target: string }) => {
      try {
        if (!services.localServices) {
          return { success: false, error: 'Local services not available' };
        }

        const parsed = parseTarget(target);
        if (parsed.type !== 'local') {
          return { success: false, error: 'WPE sites cannot be deleted via CLI. Use WPE Portal or CAPI.' };
        }

        const site = resolveSite(parsed.siteName!, services.siteData);
        if (!site) {
          return { success: false, error: `Site not found: ${parsed.siteName}` };
        }

        const siteName = site.name;
        const sitePath = (site as any).path || (site as any).longPath;
        // trashFiles: true moves site files to trash (recoverable).
        await services.localServices.deleteSite(site.id, true);

        return { success: true, siteName, sitePath, status: 'deleted' };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}
