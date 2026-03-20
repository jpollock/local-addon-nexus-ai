/**
 * GraphQL Resolvers for Nexus CLI
 *
 * Resolvers call services directly for most operations.
 * POC: 5 commands (sites list/create, wp plugin list, sync pull/push)
 */

import type { ToolRegistry } from '../mcp/tool-registry';

interface ResolverContext {
  registry: ToolRegistry;
  services: any;  // NexusServices has many properties, simpler to use any
}

/**
 * Target Parser
 */
interface ParsedTarget {
  type: 'local' | 'wpe';
  siteName?: string;
  installName?: string; // For WPE: "account/install" format
  environment?: string;
  account?: string;
  installId?: string;
}

function parseTarget(target: string): ParsedTarget {
  // mysite@local
  if (target.endsWith('@local')) {
    return {
      type: 'local',
      siteName: target.replace('@local', ''),
    };
  }

  // wpe:account/install@environment
  const wpeMatch = target.match(/^wpe:(.+?)\/(.+?)@(production|staging|development)$/);
  if (wpeMatch) {
    return {
      type: 'wpe',
      installName: `${wpeMatch[1]}/${wpeMatch[2]}`,
      environment: wpeMatch[3],
    };
  }

  throw new Error(
    `Invalid target syntax: ${target}. Expected 'mysite@local' or 'wpe:account/install@environment'`
  );
}

/**
 * Resolve site by name, ID, or domain
 */
function resolveSite(identifier: string, siteData: any): any {
  const sites = Object.values(siteData.getSites());
  return sites.find((s: any) =>
    s.name === identifier ||
    s.id === identifier ||
    s.domain === identifier
  );
}

/**
 * Resolvers
 */
export function createResolvers(context: ResolverContext) {
  const { services, registry } = context;

  return {
    Mutation: {
      /**
       * List all sites (local + WPE)
       */
      nexusSitesList: async () => {
        try {
          // Get local sites
          const sites = Object.values(services.siteData.getSites());
          const statuses = services.localServices?.getAllSiteStatuses() || {};

          // Get WPE data (installs + accounts)
          let wpeInstalls: any[] = [];
          let wpeAccounts: Map<string, string> = new Map(); // accountId -> accountName

          if (services.localServices?.isCAPIAvailable()) {
            try {
              // Fetch both installs and accounts in parallel
              const [installs, accounts] = await Promise.all([
                services.localServices.capiGetInstalls() as Promise<any[]>,
                services.localServices.capiGetAccounts() as Promise<any[]>,
              ]);

              wpeInstalls = installs || [];

              // Build account name map from accounts list
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

          const local = sites.map((site: any) => {
            // Check if site has WPE connection
            const rawSite = services.localServices?.resolveSiteObject?.(site.id) as any;
            const wpeConnection = rawSite?.hostConnections
              ? Object.values(rawSite.hostConnections).find((c: any) => c.hostId === 'wpe' || c.accountId)
              : null;

            if (!wpeConnection) {
              return {
                name: site.name,
                status: statuses[site.id] || 'unknown',
                wpVersion: site.wpVersion || null,
                domain: site.domain || 'unknown',
                id: site.id,
                phpVersion: site.phpVersion || null,
                linkedTo: null,
              };
            }

            // WPE connection exists - resolve the install
            const remoteSiteId = (wpeConnection as any).remoteSiteId;
            const remoteSiteEnv = (wpeConnection as any).remoteSiteEnv;

            // Find the install by matching site ID and environment
            const install = wpeInstalls.find((i: any) => {
              const siteId = typeof i.site === 'object' ? i.site?.id : i.site;
              return siteId === remoteSiteId && (!remoteSiteEnv || i.environment === remoteSiteEnv);
            });

            // Extract account ID and name
            let accountId = 'unknown';
            let accountName = null;
            if (install) {
              accountId = typeof install.account === 'object' && install.account?.id
                ? install.account.id
                : (typeof install.account === 'string' ? install.account : 'unknown');
              accountName = wpeAccounts.get(accountId) || null;
            } else {
              // Fallback to connection data if install not found
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

          // Build WPE sites list (only if we have installs)
          const wpe = wpeInstalls.map((install: any) => {
            // Find local site linked to this install
            const linkedSite = local.find((s: any) =>
              s.linkedTo?.installId === install.id
            );

            // Extract account ID (account can be an object with id property)
            const accountId = typeof install.account === 'object' && install.account?.id
              ? install.account.id
              : (typeof install.account === 'string' ? install.account : 'unknown');

            // Get account name from map
            const accountName = wpeAccounts.get(accountId) || null;

            return {
              account: accountId,
              accountName,
              installId: install.id,
              environment: install.environment || 'unknown',
              name: install.name,
              domain: install.primaryDomain || install.cname || `${install.name}.wpengine.com`,
              wpVersion: install.wpVersion || null,
              phpVersion: install.phpVersion || null,
              linkedTo: linkedSite?.name || null,
            };
          });

          return { local, wpe };
        } catch (error: any) {
          throw new Error(`Failed to list sites: ${error.message}`);
        }
      },

      /**
       * Get detailed information about a site
       */
      nexusSitesGet: async (_parent: any, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites are supported. Use target format: mysite@local',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
            };
          }

          const status = services.localServices.getSiteStatus(site.id);
          const indexEntry = services.indexRegistry.get(site.id);

          // Get link info if available
          let linkedTo = null;
          const rawSite = services.localServices?.resolveSiteObject?.(site.id) as any;
          const wpeConnection = rawSite?.hostConnections
            ? Object.values(rawSite.hostConnections).find((c: any) => c.hostId === 'wpe' || c.accountId)
            : null;

          if (wpeConnection) {
            const remoteSiteId = (wpeConnection as any).remoteSiteId;
            const remoteSiteEnv = (wpeConnection as any).remoteSiteEnv;

            linkedTo = {
              installId: remoteSiteId || 'unknown',
              environment: remoteSiteEnv?.environment || 'unknown',
            };
          }

          return {
            success: true,
            site: {
              id: site.id,
              name: site.name,
              domain: site.domain,
              path: site.path,
              status,
              wpVersion: site.wpVersion || null,
              phpVersion: site.phpVersion || null,
              indexed: !!indexEntry,
              indexedAt: indexEntry?.lastIndexed || null,
              documentCount: indexEntry?.documentCount || 0,
              chunkCount: indexEntry?.chunkCount || 0,
              linkedTo,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Clone an existing site
       */
      nexusSitesClone: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(input.source);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites can be cloned. Use target format: mysite@local',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Source site "${parsed.siteName}" not found`,
            };
          }

          if (!input.newName || !input.newName.trim()) {
            return {
              success: false,
              error: 'New site name is required',
            };
          }

          // Check if new name already exists
          const existingSite = resolveSite(input.newName, services.siteData);
          if (existingSite) {
            return {
              success: false,
              error: `Site "${input.newName}" already exists`,
            };
          }

          const result = await services.localServices.cloneSite(site.id, input.newName.trim());

          if (!result) {
            return {
              success: false,
              error: 'Clone operation returned no result',
            };
          }

          return {
            success: true,
            siteName: result.name,
            siteId: result.id,
          };
        } catch (error: any) {
          console.error('[nexusSitesClone] Error:', error);
          return {
            success: false,
            error: error.message || 'Unknown error during clone',
          };
        }
      },

      /**
       * Rename a site
       */
      nexusSitesRename: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites can be renamed. Use target format: mysite@local',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
            };
          }

          if (!input.newName || !input.newName.trim()) {
            return {
              success: false,
              error: 'New site name is required',
            };
          }

          // Check if new name already exists
          const existingSite = resolveSite(input.newName, services.siteData);
          if (existingSite && existingSite.id !== site.id) {
            return {
              success: false,
              error: `Site "${input.newName}" already exists`,
            };
          }

          const oldName = site.name;

          services.localServices.updateSite(site.id, { name: input.newName.trim() });

          return {
            success: true,
            oldName,
            newName: input.newName.trim(),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Export a site to archive
       */
      nexusSitesExport: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites can be exported. Use target format: mysite@local',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
            };
          }

          const outputPath = input.outputPath || `${site.name}-export.zip`;
          const resultPath = await services.localServices.exportSite(site.id, outputPath);

          return {
            success: true,
            outputPath: resultPath,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Import a site from archive
       */
      nexusSitesImport: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          if (!input.archivePath) {
            return {
              success: false,
              error: 'Archive path is required',
            };
          }

          const result = await services.localServices.importSite(input.archivePath, input.name);

          return {
            success: true,
            siteName: result.name,
            siteId: result.id,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Get site logs
       */
      nexusSitesLogs: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites support logs. Use target format: mysite@local',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
            };
          }

          const logs = await services.localServices.getSiteLogs(site.id, {
            tail: input.tail || 100,
            follow: input.follow || false,
          });

          return {
            success: true,
            logs,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Change PHP version
       */
      nexusSitesConfigPhp: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites support PHP configuration. Use target format: mysite@local',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
            };
          }

          const oldVersion = site.phpVersion || 'unknown';
          await services.localServices.changePhpVersion(site.id, input.version);

          return {
            success: true,
            oldVersion,
            newVersion: input.version,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Trust SSL certificate
       */
      nexusSitesConfigSsl: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites support SSL trust. Use target format: mysite@local',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
            };
          }

          await services.localServices.trustSsl(site.id);

          return {
            success: true,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Toggle Xdebug
       */
      nexusSitesConfigXdebug: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites support Xdebug. Use target format: mysite@local',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
            };
          }

          const result = await services.localServices.toggleXdebug(site.id, input.enable);

          return {
            success: true,
            enabled: result.enabled,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            enabled: false,
          };
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

          const blueprints = await services.localServices.listBlueprints();

          return {
            success: true,
            blueprints: blueprints.map((bp: any) => ({
              name: bp.name,
              description: bp.description || null,
            })),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            blueprints: [],
          };
        }
      },

      /**
       * Save site as blueprint
       */
      nexusBlueprintsSave: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites can be saved as blueprints. Use target format: mysite@local',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
            };
          }

          await services.localServices.saveBlueprint(site.id, input.blueprintName);

          return {
            success: true,
            blueprintName: input.blueprintName,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Create a new local site
       */
      nexusSitesCreate: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
            };
          }

          const result = await services.localServices.createSite({
            name: input.name,
            phpVersion: input.phpVersion,
          });

          return {
            success: true,
            siteName: result.name,
            siteId: result.id,
            siteDomain: result.domain,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Start a local site
       */
      nexusSitesStart: async (_parent: any, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites can be started. Pull this site to local first.',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
            };
          }

          await services.localServices.startSite(site.id);
          const newStatus = services.localServices.getSiteStatus(site.id);

          return {
            success: true,
            siteName: site.name,
            status: newStatus,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Stop a local site
       */
      nexusSitesStop: async (_parent: any, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites can be stopped. WPE sites are always running.',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
            };
          }

          await services.localServices.stopSite(site.id);
          const newStatus = services.localServices.getSiteStatus(site.id);

          return {
            success: true,
            siteName: site.name,
            status: newStatus,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Restart a local site
       */
      nexusSitesRestart: async (_parent: any, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Only local sites can be restarted. WPE sites are always running.',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
            };
          }

          await services.localServices.restartSite(site.id);
          const newStatus = services.localServices.getSiteStatus(site.id);

          return {
            success: true,
            siteName: site.name,
            status: newStatus,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Delete a local site
       */
      nexusSitesDelete: async (_parent: any, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'WPE sites cannot be deleted via CLI. Use WPE Portal or CAPI.',
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
            };
          }

          const siteName = site.name;
          await services.localServices.deleteSite(site.id);

          return {
            success: true,
            siteName,
            status: 'deleted',
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Run any WP-CLI command on a site (local or WPE)
       */
      nexusWpCommand: async (_parent: any, { target, command }: { target: string; command: string[] }) => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              stdout: '',
              stderr: '',
              exitCode: 1,
            };
          }

          const parsed = parseTarget(target);

          // Blocked commands on remote (security)
          const blockedRemoteCommands = ['db query', 'eval', 'eval-file', 'shell'];
          const commandStr = command.join(' ');
          if (parsed.type === 'wpe' && blockedRemoteCommands.some(cmd => commandStr.startsWith(cmd))) {
            return {
              success: false,
              error: `Command "${commandStr}" is blocked on remote sites for security reasons.`,
              stdout: '',
              stderr: '',
              exitCode: 1,
            };
          }

          if (parsed.type === 'local') {
            // Local site
            const site = resolveSite(parsed.siteName!, services.siteData);
            if (!site) {
              return {
                success: false,
                error: `Site not found: ${parsed.siteName}`,
                stdout: '',
                stderr: '',
                exitCode: 1,
              };
            }

            const status = services.localServices.getSiteStatus(site.id);
            if (status !== 'running') {
              return {
                success: false,
                error: `Site "${site.name}" is ${status}. Start it first.`,
                stdout: '',
                stderr: '',
                exitCode: 1,
              };
            }

            const result = await services.localServices.wpCliRun(site.id, command);

            return {
              success: result.success || result.exitCode === 0,
              error: result.success ? null : (result.stderr || 'Command failed'),
              stdout: result.stdout || '',
              stderr: result.stderr || '',
              exitCode: result.exitCode || 0,
            };
          } else {
            // WPE site via SSH
            const installNameOnly = parsed.installName!.split('/').pop() || parsed.installName!;

            if (!services.localServices.isSSHKeyAvailable()) {
              return {
                success: false,
                error: 'WP Engine SSH key not found. Connect to WP Engine via Local\'s UI first.',
                stdout: '',
                stderr: '',
                exitCode: 1,
              };
            }

            const result = await services.localServices.remoteWpCliRun(installNameOnly, command);

            return {
              success: result.success,
              error: result.success ? null : (result.stdout || result.stderr || 'Command failed'),
              stdout: result.stdout || '',
              stderr: result.stderr || '',
              exitCode: result.success ? 0 : 1,
            };
          }
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            stdout: '',
            stderr: '',
            exitCode: 1,
          };
        }
      },

      /**
       * List plugins on a site (local or WPE)
       */
      nexusWpPluginList: async (_parent: any, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              plugins: [],
            };
          }

          const parsed = parseTarget(target);

          if (parsed.type === 'local') {
            // Local site
            const site = resolveSite(parsed.siteName!, services.siteData);
            if (!site) {
              return {
                success: false,
                error: `Site not found: ${parsed.siteName}`,
                plugins: [],
              };
            }

            const status = services.localServices.getSiteStatus(site.id);
            if (status !== 'running') {
              return {
                success: false,
                error: `Site "${site.name}" is ${status}. Start it first.`,
                plugins: [],
              };
            }

            const plugins = await services.localServices.getPlugins(site.id);

            return {
              success: true,
              plugins: plugins.map((p: any) => ({
                name: p.title || p.name,
                slug: p.name,
                status: p.status,
                version: p.version,
                update: p.update_version || null,
                autoUpdate: null,
              })),
            };
          } else {
            // WPE site via SSH
            // Extract just the install name from "account/install" format
            const installNameOnly = parsed.installName!.split('/').pop() || parsed.installName!;

            // Check if SSH key is available
            if (!services.localServices.isSSHKeyAvailable()) {
              return {
                success: false,
                error: 'WP Engine SSH key not found. Connect to WP Engine via Local\'s UI first to generate the SSH key.',
                plugins: [],
              };
            }

            const wpCliResult = await services.localServices.remoteWpCliRun(
              installNameOnly,
              ['plugin', 'list', '--format=json']
            );

            if (!wpCliResult.success) {
              let errorMsg = wpCliResult.stdout || 'Failed to list plugins on WPE install';

              // Provide helpful error messages for common issues
              if (errorMsg.includes('Could not resolve hostname')) {
                errorMsg = `Cannot connect to WPE install "${installNameOnly}". ` +
                          `The install name may be incorrect or the install may not exist. ` +
                          `SSH hostname attempted: ${installNameOnly}.ssh.wpengine.net`;
              } else if (errorMsg.includes('Permission denied')) {
                errorMsg = 'SSH authentication failed. Verify your WP Engine SSH key is set up correctly in Local.';
              }

              return {
                success: false,
                error: errorMsg,
                plugins: [],
              };
            }

            try {
              const plugins = JSON.parse(wpCliResult.stdout || '[]');
              return {
                success: true,
                plugins: plugins.map((p: any) => ({
                  name: p.title || p.name,
                  slug: p.name,
                  status: p.status,
                  version: p.version,
                  update: p.update_version || null,
                  autoUpdate: p.auto_update || null,
                })),
              };
            } catch {
              return {
                success: false,
                error: 'Failed to parse plugin list JSON',
                plugins: [],
              };
            }
          }
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            plugins: [],
          };
        }
      },

      /**
       * Pull from WPE to local
       */
      nexusSyncPull: async (_parent: any, { input }: { input: any }) => {
        try {
          const localParsed = parseTarget(input.localSite);
          const wpeParsed = parseTarget(input.wpeTarget);

          if (localParsed.type !== 'local') {
            throw new Error('Local target must use @local syntax (e.g., mysite@local)');
          }

          if (wpeParsed.type !== 'wpe') {
            throw new Error('WPE target must use wpe:account/install@env syntax');
          }

          const site = resolveSite(localParsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site not found: ${localParsed.siteName}`,
              linkCreated: false,
            };
          }

          // Verify site is running
          const status = services.localServices.getSiteStatus(site.id);
          if (status !== 'running') {
            return {
              success: false,
              error: `Site "${site.name}" is ${status}. Start it first with: nexus sites start ${site.name}@local`,
              linkCreated: false,
            };
          }

          // Get WPE install ID from install name
          // The install name in wpeTarget is "account/install" format, we need to find the actual install ID
          const [accountName, installName] = wpeParsed.installName!.split('/');

          // Get all WPE installs to find the one matching our target
          const installs = await services.localServices.capiGetInstalls();
          const targetInstall = installs.find((i: any) =>
            i.name === installName && i.environment === wpeParsed.environment
          );

          if (!targetInstall) {
            return {
              success: false,
              error: `WPE install not found: ${installName} (${wpeParsed.environment}). ` +
                     `Check nexus sites list --wpe-only to verify the install name.`,
              linkCreated: false,
            };
          }

          // Call our local MCP tool which will use Local's wpePull service
          const pullArgs = {
            site: site.name,
            remote_install_id: targetInstall.id,
            include_database: !input.filesOnly, // Default to true unless files-only
          };

          // Mark as 'cli' access since this is the CLI/GraphQL path
          const result = await registry.call('local_wpe_pull', pullArgs, services, 'cli');

          // Parse JSON response from MCP tool
          let pullResult: any;
          try {
            const responseText = result.content[0].text;
            pullResult = JSON.parse(responseText);
          } catch (parseError: any) {
            return {
              success: false,
              error: `Failed to parse pull result: ${result.content?.[0]?.text || 'No response'}`,
              linkCreated: false,
            };
          }

          if (pullResult.status !== 'queued') {
            return {
              success: false,
              error: pullResult.message || 'Pull failed',
              linkCreated: false,
            };
          }

          // Success - pull queued
          return {
            success: true,
            error: null,
            linkCreated: false, // Linking happens automatically during pull
            bytesTransferred: null, // Not available until pull completes
            duration: null,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            linkCreated: false,
          };
        }
      },

      /**
       * Push from local to WPE
       */
      nexusSyncPush: async (_parent: any, { input }: { input: any }) => {
        try {
          const localParsed = parseTarget(input.localSite);
          const wpeParsed = parseTarget(input.wpeTarget);

          if (localParsed.type !== 'local') {
            throw new Error('Local target must use @local syntax (e.g., mysite@local)');
          }

          if (wpeParsed.type !== 'wpe') {
            throw new Error('WPE target must use wpe:account/install@env syntax');
          }

          const site = resolveSite(localParsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site not found: ${localParsed.siteName}`,
              linkCreated: false,
              installCreated: false,
            };
          }

          // Verify site is running
          const status = services.localServices.getSiteStatus(site.id);
          if (status !== 'running') {
            return {
              success: false,
              error: `Site "${site.name}" is ${status}. Start it first with: nexus sites start ${site.name}@local`,
              linkCreated: false,
              installCreated: false,
            };
          }

          // Get WPE install ID from install name
          const [accountName, installName] = wpeParsed.installName!.split('/');

          // Get all WPE installs to find the one matching our target
          const installs = await services.localServices.capiGetInstalls();
          const targetInstall = installs.find((i: any) =>
            i.name === installName && i.environment === wpeParsed.environment
          );

          if (!targetInstall) {
            return {
              success: false,
              error: `WPE install not found: ${installName} (${wpeParsed.environment}). ` +
                     `Check nexus sites list --wpe-only to verify the install name.`,
              linkCreated: false,
              installCreated: false,
            };
          }

          // Call our local MCP tool which will use Local's wpePush service
          const pushArgs: any = {
            site: site.name,
            remote_install_id: targetInstall.id,
            include_database: input.includeDb || input.dbOnly || false,
          };

          // Mark as 'cli' access since this is the CLI/GraphQL path
          const result = await registry.call('local_wpe_push', pushArgs, services, 'cli');

          // Check if MCP tool returned an error
          if (result.isError) {
            return {
              success: false,
              error: result.content[0].text,
              linkCreated: false,
              installCreated: false,
            };
          }

          // Parse JSON response from MCP tool
          let pushResult: any;
          try {
            const responseText = result.content[0].text;
            pushResult = JSON.parse(responseText);
          } catch (parseError: any) {
            return {
              success: false,
              error: `Failed to parse push result: ${result.content?.[0]?.text || 'No response'}`,
              linkCreated: false,
              installCreated: false,
            };
          }

          if (pushResult.status !== 'queued') {
            return {
              success: false,
              error: pushResult.message || pushResult.error || 'Push failed',
              linkCreated: false,
              installCreated: false,
            };
          }

          // Success - push queued
          return {
            success: true,
            error: null,
            linkCreated: false, // Linking happens automatically during push
            installCreated: false, // Install must already exist
            bytesTransferred: null, // Not available until push completes
            duration: null,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            linkCreated: false,
            installCreated: false,
          };
        }
      },

      /**
       * List WP Engine accounts
       */
      nexusWpeAccounts: async () => {
        try {
          if (!services.localServices?.isCAPIAvailable()) {
            return {
              success: false,
              error: 'WP Engine API not available. Please authenticate in Local.',
              accounts: [],
            };
          }

          const accounts = await services.localServices.capiGetAccounts();

          return {
            success: true,
            accounts: accounts.map((acc: any) => ({
              id: acc.id,
              name: acc.name,
            })),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            accounts: [],
          };
        }
      },

      /**
       * List WPE installs
       */
      nexusWpeInstalls: async (_parent: any, { account }: { account?: string }) => {
        try {
          if (!services.localServices?.isCAPIAvailable()) {
            return {
              success: false,
              error: 'WP Engine API not available. Please authenticate in Local.',
              installs: [],
            };
          }

          const installs = await services.localServices.capiGetInstalls();
          const accounts = await services.localServices.capiGetAccounts();

          // Build account name map
          const accountMap = new Map();
          accounts.forEach((acc: any) => {
            accountMap.set(acc.id, acc.name);
          });

          // Filter by account if specified
          let filtered = installs;
          if (account) {
            filtered = installs.filter((inst: any) => {
              const accId = typeof inst.account === 'object' ? inst.account.id : inst.account;
              return accId === account || accountMap.get(accId) === account;
            });
          }

          return {
            success: true,
            installs: filtered.map((inst: any) => {
              const accId = typeof inst.account === 'object' ? inst.account.id : inst.account;
              return {
                id: inst.id,
                name: inst.name,
                account: accId,
                accountName: accountMap.get(accId) || null,
                environment: inst.environment,
                domain: inst.primaryDomain || inst.cname || `${inst.name}.wpengine.com`,
                phpVersion: inst.phpVersion || null,
                wpVersion: inst.wpVersion || null,
              };
            }),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            installs: [],
          };
        }
      },

      /**
       * Get WPE install details
       */
      nexusWpeInstall: async (_parent: any, { installId }: { installId: string }) => {
        try {
          if (!services.localServices?.isCAPIAvailable()) {
            return {
              success: false,
              error: 'WP Engine API not available. Please authenticate in Local.',
            };
          }

          const install = await services.localServices.capiGetInstall(installId);
          if (!install) {
            return {
              success: false,
              error: `Install "${installId}" not found`,
            };
          }

          const accounts = await services.localServices.capiGetAccounts();
          const accountMap = new Map();
          accounts.forEach((acc: any) => {
            accountMap.set(acc.id, acc.name);
          });

          const accId = typeof install.account === 'object' ? install.account.id : install.account;

          return {
            success: true,
            install: {
              id: install.id,
              name: install.name,
              account: accId,
              accountName: accountMap.get(accId) || null,
              environment: install.environment,
              domain: install.primaryDomain || install.cname || `${install.name}.wpengine.com`,
              phpVersion: install.phpVersion || null,
              wpVersion: install.wpVersion || null,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Create WPE backup
       */
      nexusWpeBackup: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices?.isCAPIAvailable()) {
            return {
              success: false,
              error: 'WP Engine API not available. Please authenticate in Local.',
            };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'wpe') {
            return {
              success: false,
              error: 'Target must be a WPE install. Use format: wpe:account/install@environment',
            };
          }

          // For now, return not implemented - would need CAPI backup endpoint
          return {
            success: false,
            error: 'Backup creation via CLI not yet implemented. Use WP Engine portal.',
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Purge WPE cache
       */
      nexusWpeCache: async (_parent: any, { target }: { target: string }) => {
        try {
          if (!services.localServices?.isCAPIAvailable()) {
            return {
              success: false,
              error: 'WP Engine API not available. Please authenticate in Local.',
            };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'wpe') {
            return {
              success: false,
              error: 'Target must be a WPE install. Use format: wpe:account/install@environment',
            };
          }

          await services.localServices.capiPurgeCache(parsed.installName!);

          return {
            success: true,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Link local site to WPE
       */
      nexusWpeLink: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
            };
          }

          const localParsed = parseTarget(input.localSite);
          if (localParsed.type !== 'local') {
            return {
              success: false,
              error: 'Local site must use format: mysite@local',
            };
          }

          const wpeParsed = parseTarget(input.wpeTarget);
          if (wpeParsed.type !== 'wpe') {
            return {
              success: false,
              error: 'WPE target must use format: wpe:account/install@environment',
            };
          }

          const site = resolveSite(localParsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${localParsed.siteName}" not found`,
            };
          }

          // Link via local services (this will call the wpe-link MCP tool)
          await services.localServices.linkToWpe(site.id, wpeParsed.installName!, wpeParsed.environment!);

          return {
            success: true,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Get changes between local and WPE
       */
      nexusWpeChanges: async (_parent: any, { input }: { input: any }) => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              changes: [],
            };
          }

          const parsed = parseTarget(input.localSite);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Local site must use format: mysite@local',
              changes: [],
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
              changes: [],
            };
          }

          const changes = await services.localServices.getSiteChanges(site.id, input.since);

          return {
            success: true,
            changes: changes.map((c: any) => ({
              type: c.type,
              path: c.path,
              status: c.status || null,
            })),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            changes: [],
          };
        }
      },

      /**
       * Get sync history
       */
      nexusSyncHistory: async (_parent: any, { localSite }: { localSite: string }) => {
        try {
          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              history: [],
            };
          }

          const parsed = parseTarget(localSite);
          if (parsed.type !== 'local') {
            return {
              success: false,
              error: 'Local site must use format: mysite@local',
              history: [],
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${parsed.siteName}" not found`,
              history: [],
            };
          }

          const history = await services.localServices.getSyncHistory(site.id);

          return {
            success: true,
            history: history.map((entry: any) => ({
              timestamp: entry.timestamp,
              direction: entry.direction,
              success: entry.success,
              filesTransferred: entry.filesTransferred || null,
              databaseIncluded: entry.databaseIncluded || false,
            })),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            history: [],
          };
        }
      },
    },
  };
}
