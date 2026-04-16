/**
 * GraphQL Resolvers for Nexus CLI
 *
 * Resolvers call services directly for most operations.
 * MCP tools are NOT called - they return markdown for chat interfaces.
 * CLI needs structured JSON data.
 */

import type { ToolRegistry } from '../mcp/tool-registry';
import * as ollamaClient from '../helpers/ollama-client';
import {
  buildDateRange,
  getUsageCached,
  isCurrentMonthRange,
  makeUsageCacheKey,
  setUsageCached,
} from '../mcp/modules/wpe/usage-cache';
import { setupSiteForAI } from '../mcp/modules/wp-connector/setup-ai';
import { scanDatabase, cleanDatabase } from '../mcp/modules/db-scanner/db-scanner';
import { buildCredentialSyncPhp, SUPPORTED_PROVIDERS, PROVIDER_TO_WP_OPTION } from '../mcp/modules/wp-connector/credential-helpers';
import { switchProviderForSite } from '../mcp/modules/wp-connector/switch-provider';
import { autoSyncCredentials } from '../mcp/modules/wp-connector/auto-sync';
import { STORAGE_KEYS, EXCLUDED_POST_TYPES } from '../../common/constants';

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

function formatTwinAge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60)   return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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
      account: wpeMatch[1],
      installName: wpeMatch[2],
      environment: wpeMatch[3],
    };
  }

  // Incomplete WPE target (starts with wpe: but missing @environment)
  if (target.startsWith('wpe:')) {
    throw new Error(
      `Incomplete WPE target: ${target}. Expected wpe:account/install@environment`
    );
  }

  // Plain name (no @) — treat as local, resolved later by resolveSite()
  if (!target.includes('@')) {
    return {
      type: 'local',
      siteName: target,
    };
  }

  throw new Error(
    `Invalid target syntax: ${target}. Expected 'mysite', 'mysite@local', or 'wpe:account/install@environment'`
  );
}

/**
 * Find a WPE site in the graph by name or domain (for plain-name fallback)
 */
function resolveWpeGraphSite(query: string, graphService: any): any | null {
  if (!graphService?.getDb?.()) return null;
  const db = graphService.getDb();
  const q = query.toLowerCase();

  // Exact name match first, then domain
  const rows = db.prepare("SELECT * FROM sites WHERE source='wpe'").all() as any[];
  const byName = rows.find((r: any) => r.name?.toLowerCase() === q);
  if (byName) return byName;
  const byDomain = rows.find((r: any) => r.domain?.toLowerCase() === q || r.remote_domain?.toLowerCase() === q);
  if (byDomain) return byDomain;
  // Partial name match last
  const partial = rows.find((r: any) => r.name?.toLowerCase().includes(q));
  return partial ?? null;
}

/**
 * Build SiteDetails fields for a WPE graph row (no local site object)
 */
function buildWpeSiteDetails(graphSite: any, twin: any, twinAge: string | null): any {
  return {
    id: graphSite.id,
    name: graphSite.name,
    domain: graphSite.domain ?? graphSite.remote_domain ?? null,
    path: '',
    status: 'remote',
    siteKind: 'wpe',
    wpVersion:            twin?.wpVersion ?? graphSite.wp_version ?? null,
    phpVersion:           twin?.phpVersion ?? graphSite.php_version ?? null,
    mysqlVersion:         null,
    siteUrl:              twin?.siteUrl ?? graphSite.remote_domain ?? graphSite.domain ?? null,
    adminEmail:           null,
    activeTheme:          twin?.activeTheme ?? null,
    activePluginCount:    twin?.plugins?.filter((p: any) => p.status === 'active').length ?? null,
    installedPluginCount: twin?.plugins?.length ?? null,
    postCount:            twin?.postCount ?? null,
    lastPostAt:           null,
    twinCompleteness:     twin?.completeness ?? 'none',
    twinAge,
    indexed: false,
    indexedAt: null,
    documentCount: 0,
    chunkCount: 0,
    linkedTo: null,
  };
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
       * Get current AI provider configuration
       */
      nexusAiGetConfig: () => {
        try {
          const settings = (services.registryStorage.get(STORAGE_KEYS.SETTINGS) ?? {}) as any;
          const apiKeys = (services.registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
          return {
            success: true,
            config: {
              provider: settings.aiProvider ?? null,
              model: settings.aiModel ?? null,
              hasApiKey: settings.aiProvider ? !!apiKeys[settings.aiProvider] : false,
              useLocalGateway: !!settings.useLocalGateway,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

      /**
       * Set AI provider, model, and optionally API key
       */
      nexusAiSetConfig: (_: any, { provider, model, apiKey, useLocalGateway }: { provider: string; model: string; apiKey?: string; useLocalGateway?: boolean }) => {
        try {
          const current = (services.registryStorage.get(STORAGE_KEYS.SETTINGS) ?? {}) as any;
          const updated: any = {
            ...current,
            chatProvider: undefined,
            chatModel: undefined,
            aiProvider: provider,
            aiModel: model,
            onboardingDismissed: true,
          };
          if (useLocalGateway !== undefined) updated.useLocalGateway = useLocalGateway;
          services.registryStorage.set(STORAGE_KEYS.SETTINGS, updated);
          if (apiKey) {
            const keys = (services.registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
            services.registryStorage.set(STORAGE_KEYS.API_KEYS, { ...keys, [provider]: apiKey });
          }
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

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

          if (services.localServices?.isCAPIAvailable() && services.localServices?.isWPEAuthenticated()) {
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
              const siteId = (i.site && i.site.id) ? i.site.id : i.id;
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

          // Build WPE sites list — defensively wrapped + persist to graph for fleet tools.
          const graphService = (services as any).graphService;
          let wpe: any[] = [];
          try {
            wpe = wpeInstalls.map((install: any) => {
              const linkedSite = local.find((s: any) =>
                s.linkedTo?.installId === install.id
              );

              const accountId = typeof install.account === 'object' && install.account?.id
                ? install.account.id
                : (typeof install.account === 'string' ? install.account : 'unknown');

              const accountName = wpeAccounts.get(accountId) || null;
              const domain = install.primaryDomain || install.cname || (install.name ? `${install.name}.wpengine.com` : 'unknown');

              // Upsert into graph sites table so fleet summary/plugins/deep-refresh can find it
              if (graphService && install.id && install.name) {
                try {
                  const now = Date.now();
                  graphService.getDb()?.prepare(`
                    INSERT INTO sites (id, name, domain, wp_version, php_version, account_id,
                                       source, remote_install_id, last_sync_at, is_active,
                                       created_at, updated_at)
                    VALUES (?,?,?,?,?,?,'wpe',?,?,1,?,?)
                    ON CONFLICT(id) DO UPDATE SET
                      name=excluded.name, domain=excluded.domain,
                      wp_version=excluded.wp_version, php_version=excluded.php_version,
                      account_id=excluded.account_id, remote_install_id=excluded.remote_install_id,
                      last_sync_at=excluded.last_sync_at, updated_at=excluded.updated_at
                  `).run(
                    `wpe-${install.id}`, install.name, domain,
                    install.wpVersion || null, install.phpVersion || null, accountId,
                    install.id, now, now, now
                  );
                } catch { /* graph upsert is best-effort */ }
              }

              return {
                account:     accountId || 'unknown',
                accountName,
                installId:   install.id   || install.name || 'unknown',
                environment: install.environment || 'unknown',
                name:        install.name || null,
                domain,
                wpVersion:   install.wpVersion  || null,
                phpVersion:  install.phpVersion || null,
                linkedTo:    linkedSite?.name   || null,
              };
            });
          } catch (wpeErr: any) {
            console.warn('[Nexus GraphQL] WPE install processing error:', wpeErr.message);
          }

          return { local, wpe };
        } catch (error: any) {
          // Never throw — return empty lists so callers get [] instead of 500
          console.error('[Nexus GraphQL] nexusSitesList error:', error.message);
          return { local: [], wpe: [] };
        }
      },

      /**
       * Get detailed information about a site
       */
      nexusSitesGet: async (_parent: any, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const graphService = (services as any).graphService;

          // ── Explicit WPE target: wpe:account/install@environment ──────────
          if (parsed.type === 'wpe') {
            const rows = graphService?.getDb?.()
              ? (graphService.getDb().prepare("SELECT * FROM sites WHERE source='wpe'").all() as any[])
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

          // ── Local target (plain name or @local) ───────────────────────────
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);

          if (site) {
            // Found in Local — assemble from local siteData + twin
            const status = services.localServices.getSiteStatus(site.id);
            const indexEntry = services.indexRegistry.get(site.id);

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
                activePluginCount:    twin?.plugins?.filter((p: any) => p.status === 'active').length ?? null,
                installedPluginCount: twin?.plugins?.length ?? twin?.installedPlugins?.length ?? null,
                postCount:            twin?.postCount ?? null,
                lastPostAt:           twin?.lastPostAt ? new Date(twin.lastPostAt).toISOString() : null,
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

          // ── Local not found — try WPE graph as fallback ───────────────────
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

          // Accept both 'mysite@local' (from UI/MCP) and 'mysite' (from CLI after stripping @local)
          const siteName = (input.target as string).replace(/@local$/, '');
          const site = resolveSite(siteName, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site "${siteName}" not found`,
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
          const sitePath = (site as any).path || (site as any).longPath;
          // trashFiles: true moves site files to trash (recoverable).
          // Without this, wp-config.php stays on disk and blocks re-creating a same-named site.
          await services.localServices.deleteSite(site.id, true);

          return {
            success: true,
            siteName,
            sitePath,
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
       * Digital twin: status report for one site
       */
      nexusSiteStatus: async (_parent: any, { target }: { target: string }) => {
        try {
          const result = await registry.call('nexus_site_status', { site: target }, services, 'cli');
          const text = result?.content?.[0]?.text ?? '';
          return { success: !result?.isError, error: result?.isError ? text : null, report: text };
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
      },

      /**
       * Digital twin: refresh one site
       */
      nexusSiteRefresh: async (_parent: any, { target, force }: { target: string; force?: boolean }) => {
        try {
          const result = await registry.call('nexus_site_refresh', { site: target, force: !!force }, services, 'cli');
          const text = result?.content?.[0]?.text ?? '';
          return { success: !result?.isError, error: result?.isError ? text : null, report: text };
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
      },

      /**
       * Digital twin: refresh all sites
       */
      nexusFleetRefresh: async () => {
        try {
          const result = await registry.call('nexus_fleet_refresh', {}, services, 'cli');
          const text = result?.content?.[0]?.text ?? '';
          return { success: !result?.isError, error: result?.isError ? text : null, report: text };
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
      },

      /**
       * Deep-refresh a WPE site via SSH WP-CLI:
       * fetches plugins, themes, and WP version and persists them to the graph.
       */
      nexusWpeSiteDeepRefresh: async (_parent: any, { installName }: { installName: string }) => {
        const empty = { installName, pluginCount: 0, themeCount: 0, wpVersion: null };
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', ...empty };
          }
          if (!services.localServices.isSSHKeyAvailable()) {
            return { success: false, error: 'WP Engine SSH key not found. Connect to WP Engine via Local first.', ...empty };
          }

          const graphService = (services as any).graphService;
          const now = Date.now();

          // Find the graph site ID for this install
          let siteId: string | null = null;
          if (graphService?.getDb?.()) {
            const row = graphService.getDb().prepare(
              "SELECT id FROM sites WHERE source='wpe' AND (name=? OR remote_install_id=?)"
            ).get(installName, installName) as any;
            siteId = row?.id ?? null;
          }

          // Run all SSH WP-CLI calls in parallel
          const [
            pluginResult, themeResult, versionResult,
            siteUrlResult, adminEmailResult, postCountResult, activeThemeResult,
          ] = await Promise.all([
            services.localServices.remoteWpCliRun(installName, ['plugin', 'list', '--format=json', '--fields=name,title,version,status']),
            services.localServices.remoteWpCliRun(installName, ['theme', 'list', '--format=json', '--fields=name,title,version,status']),
            services.localServices.remoteWpCliRun(installName, ['core', 'version']),
            services.localServices.remoteWpCliRun(installName, ['option', 'get', 'siteurl']),
            services.localServices.remoteWpCliRun(installName, ['option', 'get', 'admin_email']),
            services.localServices.remoteWpCliRun(installName, ['post', 'list', '--post_status=publish', '--format=count']),
            services.localServices.remoteWpCliRun(installName, ['option', 'get', 'stylesheet']),
          ]);

          const errors: string[] = [];
          let pluginCount = 0;
          let themeCount = 0;
          let wpVersion: string | null = null;

          // Persist plugins
          if (pluginResult.success && pluginResult.stdout && siteId && graphService) {
            try {
              const plugins = JSON.parse(pluginResult.stdout);
              await graphService.deletePlugins(siteId);
              for (const p of plugins) {
                await graphService.upsertPlugin({
                  site_id: siteId, slug: p.name, name: p.title || p.name,
                  version: p.version || null, is_active: p.status === 'active',
                  author: null, created_at: now, updated_at: now,
                });
                pluginCount++;
              }
            } catch (e) { errors.push(`plugins: ${(e as Error).message}`); }
          } else if (!pluginResult.success) {
            errors.push(`plugin list failed: ${pluginResult.stdout || pluginResult.stderr || 'unknown'}`);
          }

          // Persist themes
          if (themeResult.success && themeResult.stdout && siteId && graphService) {
            try {
              const themes = JSON.parse(themeResult.stdout);
              await graphService.deleteThemes(siteId);
              for (const t of themes) {
                await graphService.upsertTheme({
                  site_id: siteId, slug: t.name, name: t.title || t.name,
                  version: t.version || null, is_active: t.status === 'active',
                  author: null, created_at: now, updated_at: now,
                });
                themeCount++;
              }
            } catch (e) { errors.push(`themes: ${(e as Error).message}`); }
          } else if (!themeResult.success) {
            errors.push(`theme list failed: ${themeResult.stdout || themeResult.stderr || 'unknown'}`);
          }

          // Collect scalar fields and write them + wp_version in one UPDATE
          if (versionResult.success && versionResult.stdout) {
            wpVersion = versionResult.stdout.trim();
          } else if (!versionResult.success) {
            errors.push(`core version failed: ${versionResult.stdout || 'unknown'}`);
          }

          if (siteId && graphService?.getDb?.()) {
            const siteUrl    = siteUrlResult.success    ? siteUrlResult.stdout?.trim()    || null : null;
            const adminEmail = adminEmailResult.success ? adminEmailResult.stdout?.trim() || null : null;
            const postCount  = postCountResult.success  ? parseInt(postCountResult.stdout?.trim() || '0', 10) || null : null;
            const activeTheme = activeThemeResult.success ? activeThemeResult.stdout?.trim() || null : null;

            graphService.getDb().prepare(`
              UPDATE sites
                 SET wp_version=?, site_url=?, admin_email=?, active_theme=?, post_count=?, last_sync_at=?
               WHERE id=?
            `).run(wpVersion, siteUrl, adminEmail, activeTheme, postCount, now, siteId);
          }

          return {
            success: errors.length === 0 || pluginCount > 0 || themeCount > 0,
            error: errors.length > 0 ? errors.join('; ') : null,
            installName, pluginCount, themeCount, wpVersion,
          };
        } catch (error: any) {
          return { success: false, error: error.message, ...empty };
        }
      },

      /**
       * Fleet-wide summary from twin cache — WP/PHP version distribution,
       * completeness breakdown, recent post activity, stale count.
       */
      nexusFleetSummary: () => {
        try {
          if (!services.twinService) {
            return {
              success: false,
              error: 'Twin service not available',
              totalSites: 0,
              sitesWithFullData: 0,
              wpVersions: [],
              phpVersions: [],
              completeness: { none: 0, filesystem: 0, metadata: 0, indexed: 0 },
              staleCount: 0,
              neverScannedCount: 0,
              recentActivityCount: 0,
            };
          }

          const DAY_MS = 24 * 60 * 60 * 1000;
          const MONTH_MS = 30 * DAY_MS;
          const now = Date.now();
          const graphService = (services as any).graphService;

          // Local site twins
          const localTwins = services.twinService.getAll() ?? [];

          // WPE-only graph sites (minimal twin shape for aggregation)
          const wpeTwins: any[] = [];
          try {
            if (graphService?.getDb?.()) {
              const db = graphService.getDb();
              const wpeRows = db.prepare("SELECT * FROM sites WHERE source='wpe'").all() as any[];
              for (const row of wpeRows) {
                const hasPlugins = db.prepare('SELECT COUNT(*) as c FROM plugins WHERE site_id=?').get(row.id) as { c: number };
                const comp = hasPlugins.c > 0 ? 'metadata' : (row.wp_version ? 'filesystem' : 'none');
                wpeTwins.push({
                  siteName: row.name,
                  wpVersion: row.wp_version ?? undefined,
                  phpVersion: row.php_version ?? undefined,
                  completeness: comp,
                  asOf: row.last_sync_at ?? null,
                  lastPostAt: row.post_count != null ? now - 1 : null, // post_count present means was scanned; no exact date
                  plugins: hasPlugins.c > 0
                    ? db.prepare('SELECT slug as name, name as title, is_active FROM plugins WHERE site_id=?').all(row.id)
                        .map((p: any) => ({ name: p.name, title: p.title, status: p.is_active ? 'active' : 'inactive' }))
                    : undefined,
                });
              }
            }
          } catch { /* WPE graph optional */ }

          const twins = [...localTwins, ...wpeTwins];

          const completeness = { none: 0, filesystem: 0, metadata: 0, indexed: 0 };
          let staleCount = 0;
          let neverScannedCount = 0;
          let recentActivityCount = 0;

          const wpVersionMap = new Map<string, number>();
          const phpVersionMap = new Map<string, number>();

          for (const twin of twins) {
            // Completeness — twin.completeness is 'none'|'filesystem'|'metadata'|'indexed'
            const comp = twin.completeness as 'none' | 'filesystem' | 'metadata' | 'indexed';
            completeness[comp]++;

            // Stale (asOf exists and > 24h old)
            if (twin.asOf && now - twin.asOf > DAY_MS) staleCount++;

            // Never scanned
            if (comp === 'none') neverScannedCount++;

            // Recent activity
            if (twin.lastPostAt && now - twin.lastPostAt < MONTH_MS) recentActivityCount++;

            // WP version — normalize RC/dev suffixes for grouping but keep the base
            const wpV: string = twin.wpVersion ?? 'unknown';
            wpVersionMap.set(wpV, (wpVersionMap.get(wpV) ?? 0) + 1);

            // PHP version — normalize to major.minor (8.2.29 → 8.2) for clean grouping
            const rawPhp: string = twin.phpVersion ?? 'unknown';
            const phpV = rawPhp === 'unknown' ? 'unknown'
              : (rawPhp.match(/^(\d+\.\d+)/)?.[1] ?? rawPhp);
            phpVersionMap.set(phpV, (phpVersionMap.get(phpV) ?? 0) + 1);
          }

          const sitesWithFullData = twins.filter(
            (t: any) => t.completeness === 'metadata' || t.completeness === 'indexed'
          ).length;

          // Build sorted version arrays, 'unknown' last
          const sortVersions = (map: Map<string, number>) => {
            const entries = Array.from(map.entries()).map(([version, count]) => ({ version, count }));
            entries.sort((a, b) => {
              if (a.version === 'unknown') return 1;
              if (b.version === 'unknown') return -1;
              return b.count - a.count;
            });
            return entries;
          };

          return {
            success: true,
            error: null,
            totalSites: twins.length,
            sitesWithFullData,
            wpVersions: sortVersions(wpVersionMap),
            phpVersions: sortVersions(phpVersionMap),
            completeness,
            staleCount,
            neverScannedCount,
            recentActivityCount,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message,
            totalSites: 0,
            sitesWithFullData: 0,
            wpVersions: [],
            phpVersions: [],
            completeness: { none: 0, filesystem: 0, metadata: 0, indexed: 0 },
            staleCount: 0,
            neverScannedCount: 0,
            recentActivityCount: 0,
          };
        }
      },

      /**
       * Aggregate plugin presence across the fleet from twin cache.
       */
      nexusFleetPlugins: (_parent: any, { search, minSites }: { search?: string; minSites?: number }) => {
        try {
          if (!services.twinService) {
            return {
              success: false,
              error: 'Twin service not available',
              totalSites: 0,
              sitesWithFullData: 0,
              plugins: [],
            };
          }

          const localTwins = services.twinService.getAll() ?? [];

          // Supplement with WPE graph sites (plugins from graph plugins table)
          const wpePluginTwins: any[] = [];
          try {
            const graphService = (services as any).graphService;
            if (graphService?.getDb?.()) {
              const db = graphService.getDb();
              const wpeRows = db.prepare("SELECT id, name FROM sites WHERE source='wpe'").all() as any[];
              for (const row of wpeRows) {
                const pluginRows = db.prepare(
                  'SELECT slug as name, name as title, is_active FROM plugins WHERE site_id=?'
                ).all(row.id) as any[];
                if (pluginRows.length) {
                  wpePluginTwins.push({
                    siteName: row.name,
                    completeness: 'metadata',
                    plugins: pluginRows.map((p: any) => ({
                      name: p.name, title: p.title,
                      status: p.is_active ? 'active' : 'inactive',
                    })),
                    installedPlugins: undefined,
                  });
                }
              }
            }
          } catch { /* optional */ }

          const twins = [...localTwins, ...wpePluginTwins];

          const pluginMap = new Map<string, {
            slug: string;
            title?: string;
            activeOnCount: number;
            installedOnCount: number;
            sites: string[];
          }>();

          for (const twin of twins) {
            // Process plugins with status (from metadata/indexed completeness)
            if (twin.plugins?.length) {
              for (const plugin of twin.plugins) {
                const slug = plugin.name;
                if (!pluginMap.has(slug)) {
                  pluginMap.set(slug, { slug, title: plugin.title, activeOnCount: 0, installedOnCount: 0, sites: [] });
                }
                const entry = pluginMap.get(slug)!;
                if (plugin.title && !entry.title) entry.title = plugin.title;
                entry.installedOnCount++;
                if (plugin.status === 'active') {
                  entry.activeOnCount++;
                  if (!entry.sites.includes(twin.siteName)) entry.sites.push(twin.siteName);
                }
              }
            }

            // Process filesystem-only installed plugins (count as installed, not active)
            if (twin.installedPlugins?.length) {
              for (const slug of twin.installedPlugins) {
                // Only add if not already tracked via plugins[] (avoid double-counting)
                if (!twin.plugins?.some((p: any) => p.name === slug)) {
                  if (!pluginMap.has(slug)) {
                    pluginMap.set(slug, { slug, activeOnCount: 0, installedOnCount: 0, sites: [] });
                  }
                  pluginMap.get(slug)!.installedOnCount++;
                }
              }
            }
          }

          const effectiveMinSites = minSites ?? 1;
          let plugins = Array.from(pluginMap.values());

          // Apply search filter
          if (search) {
            const q = search.toLowerCase();
            plugins = plugins.filter(p =>
              p.slug.toLowerCase().includes(q) ||
              (p.title ?? '').toLowerCase().includes(q)
            );
          }

          // Apply minSites filter
          plugins = plugins.filter(p => p.activeOnCount >= effectiveMinSites);

          // Sort by activeOnCount desc
          plugins.sort((a, b) => b.activeOnCount - a.activeOnCount);

          const sitesWithFullData = twins.filter(
            (t: any) => t.completeness === 'metadata' || t.completeness === 'indexed'
          ).length;

          return {
            success: true,
            error: null,
            totalSites: twins.length,
            sitesWithFullData,
            plugins,
          };
        } catch (err: any) {
          return {
            success: false,
            error: err.message,
            totalSites: 0,
            sitesWithFullData: 0,
            plugins: [],
          };
        }
      },

      /**
       * List sites on a specific PHP or WP version — for security triage
       * (e.g. find all sites on PHP 7.4).
       */
      nexusFleetVersionSites: (_parent: any, { phpVersion, wpVersion }: { phpVersion?: string; wpVersion?: string }) => {
        try {
          if (!services.twinService) {
            return { success: false, error: 'Twin service not available', sites: [] };
          }

          const localTwins = services.twinService.getAll() ?? [];
          const graphService = (services as any).graphService;
          const wpeTwins: any[] = [];

          try {
            if (graphService?.getDb?.()) {
              const rows = graphService.getDb()
                .prepare("SELECT name, wp_version, php_version FROM sites WHERE source='wpe' AND is_active=1")
                .all() as any[];
              for (const row of rows) {
                wpeTwins.push({ siteName: row.name, wpVersion: row.wp_version, phpVersion: row.php_version, source: 'wpe' });
              }
            }
          } catch { /* optional */ }

          const normalizePhp = (v?: string) => v ? (v.match(/^(\d+\.\d+)/)?.[1] ?? v) : 'unknown';
          const all = [
            ...localTwins.map((t: any) => ({ siteName: t.siteName, wpVersion: t.wpVersion, phpVersion: t.phpVersion, source: 'local' })),
            ...wpeTwins,
          ];

          const matched = all.filter((s) => {
            if (phpVersion) {
              const normalized = normalizePhp(s.phpVersion);
              const target = normalizePhp(phpVersion);
              if (normalized !== target) return false;
            }
            if (wpVersion && s.wpVersion !== wpVersion) return false;
            return true;
          });

          return {
            success: true,
            error: null,
            sites: matched.map((s) => ({
              name: s.siteName,
              wpVersion: s.wpVersion ?? null,
              phpVersion: normalizePhp(s.phpVersion),
              source: s.source ?? 'local',
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message, sites: [] };
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
          // installName is already just the install name (account was parsed separately by parseTarget)
          const installName = wpeParsed.installName!;

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

          // MCP tool returns 'in_progress' (fire-and-forget async pull)
          if (pullResult.status !== 'queued' && pullResult.status !== 'in_progress') {
            return {
              success: false,
              error: pullResult.message || 'Pull failed',
              linkCreated: false,
            };
          }

          // Success - pull started
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
          // installName is already just the install name (account was parsed separately by parseTarget)
          const installName = wpeParsed.installName!;

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

          if (pushResult.status !== 'queued' && pushResult.status !== 'in_progress') {
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
          if (!services.localServices?.isCAPIAvailable() || !services.localServices?.isWPEAuthenticated()) {
            return {
              success: false,
              error: 'Not authenticated with WP Engine. Use wpe_login or authenticate in Local.',
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
        console.log('[NEXUS DEBUG] nexusWpeInstalls resolver called, account:', account);
        try {
          const hasCapi = services.localServices?.isCAPIAvailable();
          const hasAuth = services.localServices?.isWPEAuthenticated();
          console.log('[NEXUS DEBUG] nexusWpeInstalls: hasCapi =', hasCapi, 'hasAuth =', hasAuth);

          if (!hasCapi || !hasAuth) {
            return {
              success: false,
              error: 'Not authenticated with WP Engine. Use wpe_login or authenticate in Local.',
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
          if (!services.localServices?.isCAPIAvailable() || !services.localServices?.isWPEAuthenticated()) {
            return {
              success: false,
              error: 'Not authenticated with WP Engine. Use wpe_login or authenticate in Local.',
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
          // Don't check OAuth here - capiCreateBackup handles auth internally
          // (uses basic auth if credentials exist, otherwise attempts OAuth)
          if (!services.localServices?.isCAPIAvailable()) {
            return {
              success: false,
              error: 'WP Engine API not available',
            };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'wpe') {
            return {
              success: false,
              error: 'Target must be a WPE install. Use format: wpe:account/install@environment',
            };
          }

          // Resolve install name to install ID
          // Install names in CAPI are like "testjpp1prod" (base name + environment suffix)
          // We match by checking if the install name starts with our parsed name and has the right env
          const installs = await services.localServices.capiGetInstalls();
          const install = installs.find((i: any) =>
            i.name.startsWith(parsed.installName!) &&
            i.environment === parsed.environment
          );
          if (!install) {
            return {
              success: false,
              error: `Install "${parsed.installName}" with environment "${parsed.environment}" not found`,
            };
          }

          const backupResult = await services.localServices.capiCreateBackup(
            install.id,
            input.description || 'Backup created via Nexus CLI',
            input.notificationEmails || undefined
          ) as any;

          return {
            success: true,
            backupId: backupResult?.id || null,
            message: `Backup created for ${parsed.account}/${parsed.installName}@${parsed.environment} (${install.name})`,
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
          if (!services.localServices?.isCAPIAvailable() || !services.localServices?.isWPEAuthenticated()) {
            return {
              success: false,
              error: 'Not authenticated with WP Engine. Use wpe_login or authenticate in Local.',
            };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'wpe') {
            return {
              success: false,
              error: 'Target must be a WPE install. Use format: wpe:account/install@environment',
            };
          }

          // Resolve install name to install ID
          const installs = await services.localServices.capiGetInstalls();
          const install = installs.find((i: any) =>
            i.name.startsWith(parsed.installName!) &&
            i.environment === parsed.environment
          );
          if (!install) {
            return {
              success: false,
              error: `Install "${parsed.installName}" with environment "${parsed.environment}" not found`,
            };
          }

          await services.localServices.capiPurgeCache(install.id);

          return {
            success: true,
            message: `Cache purged for ${parsed.account}/${parsed.installName}@${parsed.environment} (${install.name})`,
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

      // ========================================================================
      // Fleet Intelligence Resolvers
      // ========================================================================

      nexusFleetHealth: async () => {
        try {
          if (!services.healthCalculator) {
            return {
              success: false,
              error: 'Health scoring is not available',
              summary: null,
            };
          }

          const allSites = services.siteData.getSites();
          const siteIds = Object.keys(allSites);

          let runningSites = 0;
          let haltedSites = 0;
          let totalPlugins = 0;
          let outdatedPlugins = 0;
          let totalThemes = 0;
          let outdatedThemes = 0;

          // Count sites by status
          for (const id of siteIds) {
            const status = services.localServices?.getSiteStatus?.(id) || 'unknown';
            if (status === 'running') runningSites++;
            else haltedSites++;
          }

          // Get indexed sites for health scoring
          const entries = services.indexRegistry.listAll().filter((e: any) => e.state === 'indexed');
          const siteInfoMap: Record<string, any> = {};

          for (const entry of entries) {
            const site = allSites[entry.siteId];
            siteInfoMap[entry.siteId] = {
              domain: site?.domain || '',
              phpVersion: (site as any)?.phpVersion || '8.0',
            };
          }

          const indexedSiteIds = entries.map((e: any) => e.siteId);
          const scores = await services.healthCalculator.calculateAllScores(indexedSiteIds, siteInfoMap);

          let healthyCount = 0;
          let warningCount = 0;
          let criticalCount = 0;

          for (const id of indexedSiteIds) {
            const score = scores[id] || 0;
            if (score >= 80) healthyCount++;
            else if (score >= 50) warningCount++;
            else criticalCount++;
          }

          return {
            success: true,
            summary: {
              totalSites: siteIds.length,
              runningSites,
              haltedSites,
              healthyCount,
              warningCount,
              criticalCount,
              totalPlugins,
              outdatedPlugins,
              totalThemes,
              outdatedThemes,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            summary: null,
          };
        }
      },

      nexusFleetSiteHealth: async (_parent: any, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);

          if (!services.healthCalculator) {
            return {
              success: false,
              error: 'Health scoring is not available',
              health: null,
            };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              health: null,
            };
          }

          const siteInfo = {
            domain: site.domain || '',
            phpVersion: (site as any)?.phpVersion || '8.0',
          };

          const scores = await services.healthCalculator.calculateAllScores([site.id], { [site.id]: siteInfo });
          const score = scores[site.id] || 0;

          const status = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical';

          return {
            success: true,
            health: {
              status,
              score,
              issues: [],
              plugins: {
                total: 0,
                active: 0,
                outdated: 0,
              },
              themes: {
                total: 0,
                active: 0,
                outdated: 0,
              },
              wordpress: {
                version: 'unknown',
                updateAvailable: false,
              },
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            health: null,
          };
        }
      },

      nexusFleetSearch: async (_parent: any, { query, limit }: { query: string; limit?: number }) => {
        try {
          if (!services.vectorStore || !services.embeddingService) {
            return {
              success: false,
              error: 'Vector store or embedding service not available',
              results: [],
            };
          }

          const queryVector = await services.embeddingService.embed(query);

          const indexEntries = services.indexRegistry.listAll();
          const graphService = (services as any).graphService;
          let wpeSiteIds: string[] = [];
          if (graphService?.getDb?.()) {
            try {
              const rows = graphService.getDb().prepare("SELECT id FROM sites WHERE source='wpe'").all() as Array<{ id: string }>;
              wpeSiteIds = rows.map((r) => r.id);
            } catch { /* skip wpe */ }
          }
          const allSiteIds = [
            ...indexEntries.map((e: any) => e.siteId),
            ...wpeSiteIds,
          ];
          const siteNames = new Map(indexEntries.map((e: any) => [e.siteId, e.siteName || e.siteId]));

          const matchMap = await services.vectorStore.searchAcrossSites(
            allSiteIds,
            queryVector,
            { limit: 3, relevanceFloor: 0.35, queryText: query, excludedTypes: EXCLUDED_POST_TYPES },
            5,
          );

          interface Hit { siteName: string; postType: string; score: number; title: string; content: string }
          const hits: Hit[] = [];
          for (const [siteId, results] of matchMap) {
            for (const r of results) {
              hits.push({
                siteName: siteNames.get(siteId) || siteId,
                postType: r.postType || 'post',
                score: r.score,
                title: r.title || '',
                content: r.content || '',
              });
            }
          }
          hits.sort((a, b) => b.score - a.score);
          const topHits = hits.slice(0, limit || 20);

          return {
            success: true,
            results: topHits.map((h) => ({
              target: `${h.siteName}@local`,
              siteName: h.siteName,
              type: h.postType,
              score: h.score,
              snippet: h.title ? `${h.title} — ${h.content.substring(0, 160)}` : h.content.substring(0, 200),
            })),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
      },

      nexusFleetFilter: async (_parent: any, { filter }: { filter: any }) => {
        try {
          const allSites = services.siteData.getSites();
          const siteIds = Object.keys(allSites);
          const results = [];

          for (const id of siteIds) {
            const site = allSites[id];
            const status = services.localServices?.getSiteStatus?.(id) || 'unknown';

            // Apply filters
            if (filter.status && status !== filter.status) continue;
            if (filter.linkedOnly) {
              const rawSite = services.localServices?.resolveSiteObject?.(id);
              const hasWpeConnection = rawSite?.hostConnections &&
                Object.values(rawSite.hostConnections).some((c: any) => c.hostId === 'wpe' || c.accountId);
              if (!hasWpeConnection) continue;
            }

            const rawSite = services.localServices?.resolveSiteObject?.(id);
            const wpeConnection = rawSite?.hostConnections
              ? Object.values(rawSite.hostConnections).find((c: any) => c.hostId === 'wpe' || c.accountId)
              : null;

            results.push({
              target: `${site.name}@local`,
              name: site.name,
              status,
              wpVersion: (site as any)?.wpVersion || null,
              linkedTo: wpeConnection
                ? `wpe:${(wpeConnection as any).accountId}/${(wpeConnection as any).installId}@${(wpeConnection as any).environment}`
                : null,
            });
          }

          return {
            success: true,
            sites: results,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            sites: [],
          };
        }
      },

      nexusFleetGroupsList: async () => {
        try {
          if (!services.localServices?.getSiteGroups) {
            return {
              success: false,
              error: 'Site groups are not available',
              groups: [],
            };
          }

          const groups = services.localServices.getSiteGroups();

          return {
            success: true,
            groups: groups.map((g: any) => ({
              id: g.id,
              name: g.name,
              description: g.description || null,
              siteCount: g.siteIds?.length || 0,
              createdAt: g.createdAt || new Date().toISOString(),
            })),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            groups: [],
          };
        }
      },

      nexusFleetGroupsCreate: async (_parent: any, { name, description }: { name: string; description?: string }) => {
        try {
          if (!services.localServices?.createSiteGroup) {
            return {
              success: false,
              error: 'Site groups are not available',
              groupId: null,
            };
          }

          const group = services.localServices.createSiteGroup(name);

          return {
            success: true,
            groupId: group.id,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            groupId: null,
          };
        }
      },

      nexusFleetGroupsAdd: async (_parent: any, { group, sites }: { group: string; sites: string[] }) => {
        try {
          if (!services.localServices?.getSiteGroups || !services.localServices?.moveSitesToGroup) {
            return {
              success: false,
              error: 'Site groups are not available',
              addedCount: 0,
            };
          }

          // Find group by name
          const groups = services.localServices.getSiteGroups();
          const targetGroup = groups.find((g: any) => g.name === group);

          if (!targetGroup) {
            return {
              success: false,
              error: `Group "${group}" not found`,
              addedCount: 0,
            };
          }

          // Parse site targets to get site IDs
          const siteIds = sites.map(target => {
            const parsed = parseTarget(target);
            const site = resolveSite(parsed.siteName!, services.siteData);
            return site?.id;
          }).filter(Boolean);

          if (siteIds.length === 0) {
            return {
              success: false,
              error: 'No valid sites found',
              addedCount: 0,
            };
          }

          services.localServices.moveSitesToGroup(siteIds, targetGroup.id);

          return {
            success: true,
            addedCount: siteIds.length,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            addedCount: 0,
          };
        }
      },

      nexusFleetGroupsRemove: async (_parent: any, { group, sites }: { group: string; sites: string[] }) => {
        try {
          if (!services.localServices?.removeSitesFromGroups) {
            return {
              success: false,
              error: 'Site groups are not available',
              removedCount: 0,
            };
          }

          // Parse site targets to get site IDs
          const siteIds = sites.map(target => {
            const parsed = parseTarget(target);
            const site = resolveSite(parsed.siteName!, services.siteData);
            return site?.id;
          }).filter(Boolean);

          if (siteIds.length === 0) {
            return {
              success: false,
              error: 'No valid sites found',
              removedCount: 0,
            };
          }

          services.localServices.removeSitesFromGroups(siteIds);

          return {
            success: true,
            removedCount: siteIds.length,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            removedCount: 0,
          };
        }
      },

      nexusFleetGroupsDelete: async (_parent: any, { group }: { group: string }) => {
        try {
          if (!services.localServices?.getSiteGroups || !services.localServices?.deleteSiteGroup) {
            return {
              success: false,
              error: 'Site groups are not available',
            };
          }

          // Find group by name
          const groups = services.localServices.getSiteGroups();
          const targetGroup = groups.find((g: any) => g.name === group);

          if (!targetGroup) {
            return {
              success: false,
              error: `Group "${group}" not found`,
            };
          }

          services.localServices.deleteSiteGroup(targetGroup.id);

          return { success: true };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          };
        }
      },

      nexusFleetBulkReindex: async (_parent: any, { targets }: { targets: string[] }) => {
        try {
          const results = [];

          // Reindex each target in parallel
          const reindexPromises = targets.map(async (target) => {
            try {
              const parsed = parseTarget(target);
              const site = resolveSite(parsed.siteName!, services.siteData);

              if (!site) {
                return {
                  target,
                  success: false,
                  error: `Site not found: ${parsed.siteName}`,
                  documentCount: 0,
                };
              }

              const siteInfo = {
                siteId: site.id,
                siteName: site.name,
                sitePath: site.path,
              };

              const result = await services.contentPipeline.reindexSite(siteInfo);

              return {
                target,
                success: true,
                error: null,
                documentCount: result.documentsIndexed || 0,
              };
            } catch (error: any) {
              return {
                target,
                success: false,
                error: error.message,
                documentCount: 0,
              };
            }
          });

          const reindexResults = await Promise.all(reindexPromises);

          return {
            success: true,
            results: reindexResults,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
      },

      nexusFleetBulkPluginUpdate: async (_parent: any, { input }: { input: any }) => {
        try {
          const { targets, plugin, all, dryRun } = input;
          const results = [];

          // Update plugins on each target in parallel
          const updatePromises = targets.map(async (target: string) => {
            try {
              const parsed = parseTarget(target);
              const site = resolveSite(parsed.siteName!, services.siteData);

              if (!site) {
                return {
                  target,
                  success: false,
                  error: `Site not found: ${parsed.siteName}`,
                  updatedPlugins: [],
                };
              }

              // Build wp-cli command
              const cmd = ['plugin', 'update'];
              if (plugin) {
                cmd.push(plugin);
              } else if (all) {
                cmd.push('--all');
              }
              if (dryRun) {
                cmd.push('--dry-run');
              }
              cmd.push('--format=json');

              const wpResult = await services.localServices?.wpCliRun(site.id, cmd);

              if (!wpResult?.success) {
                return {
                  target,
                  success: false,
                  error: wpResult?.stderr || 'Plugin update failed',
                  updatedPlugins: [],
                };
              }

              try {
                const updateData = JSON.parse(wpResult.stdout || '[]');
                const updatedPlugins = Array.isArray(updateData) ? updateData.map((p: any) => ({
                  slug: p.name || p.plugin,
                  oldVersion: p.version || p.old_version,
                  newVersion: p.update_version || p.new_version,
                })) : [];

                return {
                  target,
                  success: true,
                  error: null,
                  updatedPlugins,
                };
              } catch {
                return {
                  target,
                  success: true,
                  error: null,
                  updatedPlugins: [],
                };
              }
            } catch (error: any) {
              return {
                target,
                success: false,
                error: error.message,
                updatedPlugins: [],
              };
            }
          });

          const updateResults = await Promise.all(updatePromises);

          return {
            success: true,
            results: updateResults,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
      },

      nexusFleetBulkHealthCheck: async (_parent: any, { targets }: { targets: string[] }) => {
        try {
          if (!services.healthCalculator) {
            return {
              success: false,
              error: 'Health calculator not available',
              results: [],
            };
          }

          const results = [];
          const allSites = services.siteData.getSites();

          // Check health for each target in parallel
          const healthPromises = targets.map(async (target) => {
            try {
              const parsed = parseTarget(target);
              const site = resolveSite(parsed.siteName!, services.siteData);

              if (!site) {
                return {
                  target,
                  status: 'error',
                  score: 0,
                  issueCount: 0,
                };
              }

              const siteInfo = {
                domain: site.domain || '',
                phpVersion: (allSites[site.id] as any)?.phpVersion || '8.0',
              };

              const scores = await services.healthCalculator.calculateAllScores([site.id], { [site.id]: siteInfo });
              const score = scores[site.id] || 0;
              const status = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical';

              return {
                target,
                status,
                score,
                issueCount: 0,
              };
            } catch (error: any) {
              return {
                target,
                status: 'error',
                score: 0,
                issueCount: 0,
              };
            }
          });

          const healthResults = await Promise.all(healthPromises);

          return {
            success: true,
            results: healthResults,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
      },

      nexusFleetCompare: async (_parent: any, { target1, target2 }: { target1: string; target2: string }) => {
        try {
          // Get plugin lists for both sites
          const [result1, result2] = await Promise.all([
            registry.call('get_site_health', { target: target1 }, services, 'cli'),
            registry.call('get_site_health', { target: target2 }, services, 'cli'),
          ]);

          if (result1.isError || result2.isError) {
            return {
              success: false,
              error: 'Failed to get site information for comparison',
              comparison: null,
            };
          }

          const data1 = JSON.parse(result1.content[0]?.text || '{}');
          const data2 = JSON.parse(result2.content[0]?.text || '{}');

          // Build comparison
          const differences = [];

          if (data1.wordpress?.version !== data2.wordpress?.version) {
            differences.push({
              category: 'WordPress',
              item: 'Version',
              site1Value: data1.wordpress?.version || 'unknown',
              site2Value: data2.wordpress?.version || 'unknown',
            });
          }

          return {
            success: true,
            comparison: {
              site1: {
                target: target1,
                wpVersion: data1.wordpress?.version || 'unknown',
                pluginCount: data1.plugins?.total || 0,
                themeCount: data1.themes?.total || 0,
              },
              site2: {
                target: target2,
                wpVersion: data2.wordpress?.version || 'unknown',
                pluginCount: data2.plugins?.total || 0,
                themeCount: data2.themes?.total || 0,
              },
              differences,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            comparison: null,
          };
        }
      },

      // ========================================================================
      // Content & Context Resolvers
      // ========================================================================

      nexusContentSearch: async (_parent: any, { target, query, limit }: { target: string; query: string; limit?: number }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              results: [],
            };
          }

          if (!services.vectorStore || !services.embeddingService) {
            return {
              success: false,
              error: 'Vector store or embedding service not available',
              results: [],
            };
          }

          const queryVector = await services.embeddingService.embed(query);
          const searchResults = await services.vectorStore.search(site.id, queryVector, {
            limit: limit || 10,
            relevanceFloor: 0.3,
          });

          return {
            success: true,
            results: searchResults.map((r: any) => ({
              path: r.title || `${r.postType}/${r.postId}`,
              type: r.postType || 'post',
              score: r.score,
              snippet: (r.content || '').substring(0, 200),
              lineNumber: null,
            })),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            results: [],
          };
        }
      },

      nexusContentSearchAll: async (_parent: any, { query, limit }: { query: string; limit?: number }) => {
        try {
          if (!services.vectorStore || !services.embeddingService) {
            return { success: false, error: 'Vector store or embedding service not available', results: [] };
          }

          // Embed the query
          const queryVector = await services.embeddingService.embed(query);

          // Search all indexed site IDs (local + WPE)
          const indexEntries = services.indexRegistry.listAll();
          const graphService = (services as any).graphService;
          let wpeSiteIds: string[] = [];
          if (graphService?.getDb?.()) {
            try {
              const rows = graphService.getDb().prepare("SELECT id FROM sites WHERE source='wpe'").all() as Array<{ id: string }>;
              wpeSiteIds = rows.map((r) => r.id);
            } catch { /* skip wpe */ }
          }
          const allSiteIds = [
            ...indexEntries.map((e: any) => e.siteId),
            ...wpeSiteIds,
          ];

          // Single tableNames() call + batched search — avoids filesystem lock contention
          interface Hit { siteId: string; siteName: string; score: number; title: string; content: string; postType: string }
          const hits: Hit[] = [];
          const siteNames = new Map(indexEntries.map((e: any) => [e.siteId, e.siteName || e.siteId]));

          const matchMap = await services.vectorStore!.searchAcrossSites(
            allSiteIds,
            queryVector,
            { limit: 3, relevanceFloor: 0.35, queryText: query, excludedTypes: EXCLUDED_POST_TYPES },
            5,
          );
          for (const [siteId, results] of matchMap) {
            for (const r of results) {
              hits.push({
                siteId,
                siteName: siteNames.get(siteId) || siteId,
                score: r.score,
                title: r.title || '',
                content: r.content || '',
                postType: r.postType || 'post',
              });
            }
          }

          // Sort by score, take top N
          hits.sort((a, b) => b.score - a.score);
          const topHits = hits.slice(0, limit || 20);

          return {
            success: true,
            results: topHits.map((h) => ({
              target: `${h.siteName}@local`,
              siteName: h.siteName,
              path: h.title || '(untitled)',
              type: h.postType,
              score: h.score,
              snippet: h.content.substring(0, 200),
            })),
          };
        } catch (error: any) {
          return { success: false, error: error.message, results: [] };
        }
      },

      nexusContentStructure: async (_parent: any, { target, depth }: { target: string; depth?: number }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              structure: null,
            };
          }

          // Use fileScanner to get directory structure
          if (!services.fileScanner) {
            return {
              success: false,
              error: 'File scanner not available',
              structure: null,
            };
          }

          const fs = require('fs');
          const path = require('path');

          const sitePath = site.path;
          const wpContentPath = path.join(sitePath, 'app', 'public', 'wp-content');

          // Check if wp-content exists
          if (!fs.existsSync(wpContentPath)) {
            return {
              success: false,
              error: 'wp-content directory not found',
              structure: null,
            };
          }

          // Read directory contents
          const children = fs.readdirSync(wpContentPath).map((name: string) => {
            const fullPath = path.join(wpContentPath, name);
            const stats = fs.statSync(fullPath);
            return {
              path: name,
              type: stats.isDirectory() ? 'directory' : 'file',
              size: stats.isFile() ? stats.size : null,
            };
          });

          return {
            success: true,
            structure: {
              path: 'wp-content',
              type: 'directory',
              fileCount: children.filter((c: any) => c.type === 'file').length,
              children,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            structure: null,
          };
        }
      },

      nexusContentIndexStatus: async (_parent: any, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              status: null,
            };
          }

          const indexEntry = services.indexRegistry.get(site.id);

          if (!indexEntry) {
            return {
              success: true,
              status: {
                state: 'not-indexed',
                documentCount: 0,
                chunkCount: 0,
                lastIndexed: null,
                indexedAt: null,
                errorMessage: null,
              },
            };
          }

          return {
            success: true,
            status: {
              state: indexEntry.state,
              documentCount: indexEntry.documentCount || 0,
              chunkCount: indexEntry.chunkCount || 0,
              lastIndexed: indexEntry.indexedAt || null,
              indexedAt: indexEntry.indexedAt || null,
              errorMessage: indexEntry.error || null,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            status: null,
          };
        }
      },

      nexusContentListIndexed: async () => {
        try {
          const entries = services.indexRegistry.listAll();
          const allSites = services.siteData.getSites();

          const sites = entries.map((entry: any) => {
            const site = allSites[entry.siteId];
            return {
              target: `${entry.siteName || site?.name || 'unknown'}@local`,
              siteName: entry.siteName || site?.name || 'unknown',
              state: entry.state,
              documentCount: entry.documentCount || 0,
              chunkCount: entry.chunkCount || 0,
              lastIndexed: entry.indexedAt || null,
            };
          });

          return {
            success: true,
            sites,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            sites: [],
          };
        }
      },

      nexusContentReindex: async (_parent: any, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              documentCount: 0,
              chunkCount: 0,
            };
          }

          // Call contentPipeline directly (don't use MCP tool)
          const siteInfo = {
            siteId: site.id,
            siteName: site.name,
            sitePath: site.path,
          };

          const result = await services.contentPipeline.reindexSite(siteInfo);

          return {
            success: true,
            documentCount: result.documentsIndexed || 0,
            chunkCount: result.chunksIndexed || 0,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            documentCount: 0,
            chunkCount: 0,
          };
        }
      },

      // ========================================================================
      // AI & Connector Resolvers
      // ========================================================================

      nexusAiModels: async () => {
        try {
          // Call Ollama API directly for structured data
          const models = await ollamaClient.listModels();

          return {
            success: true,
            models: models.map(m => ({
              name: m.name,
              size: m.size,
              modified: m.modified,
            })),
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            models: [],
          };
        }
      },

      nexusAiAsk: async (_parent: any, { query, model }: { query: string; model?: string }) => {
        try {
          // Call Ollama API directly for structured data
          const response = await ollamaClient.generate({
            model: model || 'llama3.2',
            prompt: query,
          });

          return {
            success: true,
            response,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            response: null,
          };
        }
      },

      nexusAiSetup: async (_parent: any, { target, provider, force }: { target: string; provider?: string; force?: boolean }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              installed: [],
              configured: null,
            };
          }

          if (!services.localServices || !services.registryStorage) {
            return {
              success: false,
              error: 'Local services not available',
              installed: [],
              configured: null,
            };
          }

          // Resolve provider: explicit arg > global settings > default 'ollama'
          const settings = (services.registryStorage?.get(STORAGE_KEYS.SETTINGS) ?? {}) as any;
          const resolvedProvider = (provider as any) ?? settings?.aiProvider ?? 'ollama';

          // Call setupSiteForAI directly
          const result = await setupSiteForAI(
            site.id,
            services.localServices,
            services.registryStorage,
            services.logger,
            { provider: resolvedProvider }
          );

          if (!result.success) {
            return {
              success: false,
              error: result.message,
              installed: [],
              configured: null,
            };
          }

          return {
            success: true,
            installed: [
              { plugin: 'Nexus AI Connector', version: '1.0.0' },
              { plugin: 'AI Provider for Ollama', version: '1.0.0' },
            ],
            configured: {
              experiments: ['ai-assistant-screen'],
              providers: ['ollama'],
              credentials: true,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            installed: [],
            configured: null,
          };
        }
      },

      nexusAiSyncCredentials: async (_parent: any, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return { success: false, error: `Site not found: ${parsed.siteName}` };
          }

          if (!services.localServices || !services.registryStorage) {
            return { success: false, error: 'Local services not available' };
          }

          const siteConfigs = (services.registryStorage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
          const siteConfig = siteConfigs[site.id];

          if (!siteConfig) {
            return { success: false, error: 'Site has not been configured with Setup AI yet' };
          }

          await autoSyncCredentials(
            site.id,
            site.name,
            services.localServices,
            services.registryStorage,
            services.logger,
          );

          return { success: true, provider: siteConfig.provider };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },

      nexusAiAbilities: async (_parent: any, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              abilities: [],
            };
          }

          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              abilities: [],
            };
          }

          // PHP code to list abilities via wp_get_abilities()
          const phpCode = [
            `if (!function_exists('wp_get_abilities')) { echo json_encode([]); exit; }`,
            `$abilities = wp_get_abilities();`,
            `$result = [];`,
            `foreach ($abilities as $a) {`,
            `  $result[] = [`,
            `    'name' => $a->get_name(),`,
            `    'description' => $a->get_description() ?: $a->get_label(),`,
            `    'input_schema' => $a->get_input_schema(),`,
            `  ];`,
            `}`,
            `echo json_encode($result);`,
          ].join(' ');

          const wpResult = await services.localServices.wpCliRun(site.id, ['eval', phpCode]);

          if (!wpResult.success) {
            return {
              success: false,
              error: 'Failed to query abilities',
              abilities: [],
            };
          }

          try {
            const abilitiesData = JSON.parse(wpResult.stdout || '[]');
            const abilities = abilitiesData.map((a: any) => {
              const params = [];
              if (a.input_schema?.properties) {
                for (const [name, schema] of Object.entries(a.input_schema.properties)) {
                  params.push({
                    name,
                    type: (schema as any).type || 'string',
                    required: a.input_schema.required?.includes(name) || false,
                    description: (schema as any).description || '',
                  });
                }
              }

              return {
                name: a.name,
                description: a.description || '',
                parameters: params,
              };
            });

            return {
              success: true,
              abilities,
            };
          } catch {
            return {
              success: true,
              abilities: [],
            };
          }
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            abilities: [],
          };
        }
      },

      nexusAiRun: async (_parent: any, { target, ability, params }: { target: string; ability: string; params?: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              result: null,
            };
          }

          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              result: null,
            };
          }

          let parsedParams = {};
          if (params) {
            try {
              parsedParams = JSON.parse(params);
            } catch {
              return {
                success: false,
                error: 'Invalid JSON in params',
                result: null,
              };
            }
          }

          // Build PHP code to run the ability
          const escapedName = ability.replace(/'/g, "\\'");
          const inputJson = JSON.stringify(parsedParams).replace(/'/g, "\\'");
          const hasInput = Object.keys(parsedParams).length > 0;

          const phpCode = [
            `if (!function_exists('wp_get_ability')) { echo json_encode(['error' => 'Abilities API not available']); exit; }`,
            `$ability = wp_get_ability('${escapedName}');`,
            `if (!$ability) { echo json_encode(['error' => 'Ability not found']); exit; }`,
            hasInput
              ? `$input = json_decode('${inputJson}', true);`
              : `$schema = $ability->get_input_schema(); $input = (empty($schema) || (isset($schema['type']) && $schema['type'] === 'null')) ? null : [];`,
            `$perm = $ability->check_permissions($input);`,
            `if (is_wp_error($perm)) { echo json_encode(['error' => $perm->get_error_message()]); exit; }`,
            `$result = $ability->execute($input);`,
            `if (is_wp_error($result)) { echo json_encode(['error' => $result->get_error_message()]); exit; }`,
            `echo json_encode(['result' => $result]);`,
          ].join(' ');

          const wpResult = await services.localServices.wpCliRun(site.id, ['eval', phpCode]);

          if (!wpResult.success) {
            return {
              success: false,
              error: 'Failed to execute ability',
              result: null,
            };
          }

          try {
            const data = JSON.parse(wpResult.stdout || '{}');
            if (data.error) {
              return {
                success: false,
                error: data.error,
                result: null,
              };
            }

            return {
              success: true,
              result: JSON.stringify(data.result),
            };
          } catch {
            return {
              success: false,
              error: 'Invalid response from ability',
              result: null,
            };
          }
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            result: null,
          };
        }
      },

      nexusAiStatus: async (_parent: any, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              status: null,
            };
          }

          // Check if site is running
          const siteStatus = services.localServices?.getSiteStatus?.(site.id) || 'unknown';
          if (siteStatus !== 'running') {
            return {
              success: false,
              error: `Site is ${siteStatus}. Start it first.`,
              status: null,
            };
          }

          // Get plugin list to check if connector is installed
          const pluginResult = await services.localServices?.wpCliRun(site.id, ['plugin', 'list', '--format=json']);

          let connectorInstalled = false;
          let connectorVersion = null;

          if (pluginResult?.success) {
            try {
              const plugins = JSON.parse(pluginResult.stdout || '[]');
              const connector = plugins.find((p: any) => p.name === 'Nexus AI Connector' || p.name.includes('nexus-ai'));
              if (connector) {
                connectorInstalled = true;
                connectorVersion = connector.version;
              }
            } catch {
              // Failed to parse plugins
            }
          }

          return {
            success: true,
            status: {
              connectorInstalled,
              connectorVersion,
              experimentsEnabled: connectorInstalled,
              providersConfigured: connectorInstalled ? 1 : 0,
              credentialsSynced: connectorInstalled,
              abilitiesAvailable: connectorInstalled ? 3 : 0,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            status: null,
          };
        }
      },

      nexusAiGetSiteConfig: (_parent: any, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) return { success: false, error: `Site not found: ${parsed.siteName}` };

          const siteConfigs = (services.registryStorage?.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
          const config = siteConfigs[site.id];

          if (!config) return { success: true, config: null };

          return { success: true, config };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

      nexusAiSwitchProvider: async (_parent: any, { target, provider }: { target: string; provider: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) return { success: false, error: `Site not found: ${parsed.siteName}` };

          if (!services.localServices || !services.registryStorage) {
            return { success: false, error: 'Local services not available' };
          }

          const result = await switchProviderForSite(
            site.id,
            provider as any,
            services.localServices,
            services.registryStorage,
            services.logger,
          );

          return result;
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

      // ========================================================================
      // Composite Audit Resolvers
      // ========================================================================

      nexusAuditSite: async (_parent: any, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return {
              success: false,
              error: `Site not found: ${parsed.siteName}`,
              audit: null,
            };
          }

          if (!services.localServices) {
            return {
              success: false,
              error: 'Local services not available',
              audit: null,
            };
          }

          // Get structured data from services directly (no MCP tool call)
          const wpVersion = await services.localServices.getWpVersion(site.id) || 'unknown';
          const phpVersion = (site as any)?.phpVersion || 'unknown';
          const pluginResult = await services.localServices.wpCliRun(site.id, ['plugin', 'list', '--format=json']);
          const themeResult = await services.localServices.wpCliRun(site.id, ['theme', 'list', '--format=json']);

          let plugins: any[] = [];
          let themes: any[] = [];

          if (pluginResult?.success) {
            try {
              const rawPlugins = JSON.parse(pluginResult.stdout || '[]');
              plugins = rawPlugins.map((p: any) => ({
                name: p.name,
                version: p.version,
                status: p.status,
                updateAvailable: !!p.update_version,
                updateVersion: p.update_version || null,
              }));
            } catch {
              // Failed to parse
            }
          }

          if (themeResult?.success) {
            try {
              const rawThemes = JSON.parse(themeResult.stdout || '[]');
              themes = rawThemes.map((t: any) => ({
                name: t.name,
                version: t.version,
                status: t.status,
                updateAvailable: !!t.update_version,
              }));
            } catch {
              // Failed to parse
            }
          }

          const outdatedPlugins = plugins.filter(p => p.updateAvailable).length;
          const outdatedThemes = themes.filter(t => t.updateAvailable).length;

          return {
            success: true,
            audit: {
              siteName: site.name,
              wpVersion,
              phpVersion,
              plugins,
              themes,
              health: {
                status: 'good',
                score: 85,
                issues: [],
              },
              security: {
                outdatedPlugins,
                outdatedThemes,
                coreUpToDate: true,
                phpUpToDate: true,
              },
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            audit: null,
          };
        }
      },

      nexusAuditPlugins: async () => {
        try {
          // Get all sites
          const allSites = services.siteData.getSites();
          const siteIds = Object.keys(allSites);
          const statuses = services.localServices?.getAllSiteStatuses() || {};
          const runningSites = siteIds.filter(id => statuses[id] === 'running');

          // Audit each running site
          const siteReports: any[] = [];
          let totalPlugins = 0;
          let outdatedPlugins = 0;

          for (const siteId of runningSites) {
            try {
              const site = allSites[siteId];
              const pluginResult = await services.localServices?.wpCliRun(siteId, ['plugin', 'list', '--format=json']);

              if (!pluginResult?.success) continue;

              const rawPlugins = JSON.parse(pluginResult.stdout || '[]');
              const plugins = rawPlugins.map((p: any) => ({
                name: p.name,
                version: p.version,
                status: p.status,
                updateAvailable: !!p.update_version,
                updateVersion: p.update_version || null,
              }));

              const activeCount = plugins.filter((p: any) => p.status === 'active').length;
              const outdatedCount = plugins.filter((p: any) => p.updateAvailable).length;

              totalPlugins += plugins.length;
              outdatedPlugins += outdatedCount;

              siteReports.push({
                siteName: site.name,
                pluginCount: plugins.length,
                activePlugins: activeCount,
                outdatedCount,
                plugins,
              });
            } catch {
              // Skip site if error
            }
          }

          return {
            success: true,
            report: {
              totalSites: siteIds.length,
              sitesAudited: runningSites.length,
              totalPlugins,
              outdatedPlugins,
              sites: siteReports,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            report: null,
          };
        }
      },

      /**
       * Scan database health for a local WordPress site
       */
      nexusDbScan: async (_parent: any, { target }: { target: string }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', scan: null };
          }

          const parsed = parseTarget(target);
          if (parsed.type !== 'local') {
            return { success: false, error: 'Database scanner only supports local sites', scan: null };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return { success: false, error: `Site not found: ${parsed.siteName}`, scan: null };
          }

          const status = services.localServices.getSiteStatus(site.id);
          if (status !== 'running') {
            return { success: false, error: `Site "${site.name}" is not running. Start it first.`, scan: null };
          }

          const scan = await scanDatabase(site.id, services);

          // Map to GraphQL-friendly structure (Float fields for large numbers)
          const scanGql = {
            ...scan,
            tables: scan.tables.map((t) => ({
              ...t,
              dataSizeBytes: t.dataSizeBytes,
              indexSizeBytes: t.indexSizeBytes,
              totalSizeBytes: t.totalSizeBytes,
            })),
            pluginTables: {
              leftoverTables: scan.pluginTables.leftoverTables,
              customTables: scan.pluginTables.customTables.map((t) => ({
                ...t,
                dataSizeBytes: t.dataSizeBytes,
                indexSizeBytes: t.indexSizeBytes,
                totalSizeBytes: t.totalSizeBytes,
              })),
            },
          };

          return { success: true, scan: scanGql };
        } catch (error: any) {
          return { success: false, error: error.message, scan: null };
        }
      },

      /**
       * Clean database items (dry_run defaults to true)
       */
      nexusDbClean: async (_parent: any, { input }: { input: { target: string; items?: string[]; dryRun?: boolean } }) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', result: null };
          }

          const parsed = parseTarget(input.target);
          if (parsed.type !== 'local') {
            return { success: false, error: 'Database cleaner only supports local sites', result: null };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);
          if (!site) {
            return { success: false, error: `Site not found: ${parsed.siteName}`, result: null };
          }

          const status = services.localServices.getSiteStatus(site.id);
          if (status !== 'running') {
            return { success: false, error: `Site "${site.name}" is not running. Start it first.`, result: null };
          }

          const dryRun = input.dryRun !== false; // Default true
          const items = input.items ?? [
            'post_revisions',
            'expired_transients',
            'orphaned_post_meta',
            'orphaned_comment_meta',
            'auto_drafts',
            'trashed_posts',
          ];

          const cleanResult = await cleanDatabase(site.id, items, dryRun, services);

          return { success: true, result: cleanResult };
        } catch (error: any) {
          return { success: false, error: error.message, result: null };
        }
      },

      /**
       * Fleet database health report — scans all running sites
       */
      nexusDbReport: async (_parent: any) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', sites: null };
          }

          const allSites = services.siteData.getSites();
          const statuses = services.localServices.getAllSiteStatuses() || {};
          const runningSiteIds = Object.keys(allSites).filter((id) => statuses[id] === 'running');

          if (runningSiteIds.length === 0) {
            return {
              success: true,
              scannedAt: Date.now(),
              sitesScanned: 0,
              sitesFailed: 0,
              sites: [],
            };
          }

          const scanResults = await Promise.allSettled(
            runningSiteIds.map((id) => scanDatabase(id, services)),
          );

          const sites: any[] = [];
          let sitesFailed = 0;

          for (let i = 0; i < scanResults.length; i++) {
            const r = scanResults[i];
            if (r.status === 'fulfilled') {
              const s = r.value;
              sites.push({
                siteId: s.siteId,
                siteName: s.siteName,
                healthScore: s.healthScore,
                wpVersion: s.wpVersion,
                isWooCommerceActive: s.isWooCommerceActive,
                revisionCount: s.revisions.totalCount,
                expiredTransients: s.transients.expiredCount,
                leftoverTables: s.pluginTables.leftoverTables.length,
                topIssue: s.summary[0] ?? null,
                summary: s.summary,
                durationMs: s.durationMs,
              });
            } else {
              sitesFailed++;
            }
          }

          // Sort by healthScore ascending (worst first)
          sites.sort((a, b) => a.healthScore - b.healthScore);

          return {
            success: true,
            scannedAt: Date.now(),
            sitesScanned: sites.length,
            sitesFailed,
            sites,
          };
        } catch (error: any) {
          return { success: false, error: error.message, sites: null };
        }
      },

      nexusWpeStatus: async () => {
        try {
          if (!services.localServices) return { success: true, authenticated: false };
          const userInfo = await services.localServices.wpeGetUserInfo();
          if (!userInfo) return { success: true, authenticated: false };
          return { success: true, authenticated: true, email: userInfo.email ?? null, accountName: userInfo.accountName ?? null };
        } catch (err: any) {
          return { success: false, error: err.message, authenticated: false };
        }
      },

      nexusWpeLogin: async () => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          // Fire-and-forget: Express server stays alive in main process independently
          services.localServices.wpeAuthenticate().catch(() => {});
          return { success: true, email: null };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

      nexusWpeLogout: async () => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          await services.localServices.wpeLogout();
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

      nexusWpeSetApiCredentials: async (
        _parent: any,
        { username, password }: { username: string; password: string },
      ) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          await services.localServices.wpeSetApiCredentials(username, password);
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

      nexusWpeClearApiCredentials: async () => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          await services.localServices.wpeClearApiCredentials();
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

      nexusWpeApiCredentialsStatus: async () => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available', configured: false };
          const status = await services.localServices.wpeGetApiCredentialsStatus();
          return { success: true, configured: status.configured, username: status.username ?? null };
        } catch (err: any) {
          return { success: false, error: err.message, configured: false };
        }
      },

      nexusWpeInstallUsage: async (
        _parent: any,
        { installId, monthOffset = 0 }: { installId: string; monthOffset?: number },
      ) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', cached: false, cachedAgeMinutes: 0 };
          }
          const { firstDate, lastDate } = buildDateRange(monthOffset);
          const cacheKey = makeUsageCacheKey('install', installId, firstDate, lastDate);

          const hit = getUsageCached(cacheKey);
          if (hit) {
            const age = Math.round((Date.now() - hit.cachedAt) / 60000);
            return {
              success: true,
              data: JSON.stringify(hit.data),
              cached: true,
              cachedAgeMinutes: age,
              firstDate,
              lastDate,
            };
          }

          const data = await services.localServices.capiDirect(
            `/installs/${installId}/usage?first_date=${firstDate}&last_date=${lastDate}`,
          );
          setUsageCached(cacheKey, data, isCurrentMonthRange(firstDate, lastDate));
          return { success: true, data: JSON.stringify(data), cached: false, cachedAgeMinutes: 0, firstDate, lastDate };
        } catch (err: any) {
          return { success: false, error: err.message, cached: false, cachedAgeMinutes: 0 };
        }
      },

      nexusWpeAccountUsage: async (
        _parent: any,
        { accountId, monthOffset = 0 }: { accountId: string; monthOffset?: number },
      ) => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', cached: false, cachedAgeMinutes: 0 };
          }
          const { firstDate, lastDate } = buildDateRange(monthOffset);
          const cacheKey = makeUsageCacheKey('account', accountId, firstDate, lastDate);

          const hit = getUsageCached(cacheKey);
          if (hit) {
            const age = Math.round((Date.now() - hit.cachedAt) / 60000);
            return {
              success: true,
              data: JSON.stringify(hit.data),
              cached: true,
              cachedAgeMinutes: age,
              firstDate,
              lastDate,
            };
          }

          const data = await services.localServices.capiDirect(
            `/accounts/${accountId}/usage?first_date=${firstDate}&last_date=${lastDate}`,
          );
          setUsageCached(cacheKey, data, isCurrentMonthRange(firstDate, lastDate));
          return { success: true, data: JSON.stringify(data), cached: false, cachedAgeMinutes: 0, firstDate, lastDate };
        } catch (err: any) {
          return { success: false, error: err.message, cached: false, cachedAgeMinutes: 0 };
        }
      },

      nexusWpeAccount: async (_parent: any, { accountId }: { accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/accounts/${accountId}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountLimits: async (_parent: any, { accountId }: { accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/limits`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountUsageSummary: async (_parent: any, { accountId, monthOffset = 0 }: { accountId: string; monthOffset?: number }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const { firstDate, lastDate } = buildDateRange(monthOffset);
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/usage/summary?first_date=${firstDate}&last_date=${lastDate}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountUsageInsights: async (_parent: any, { accountId, monthOffset = 0 }: { accountId: string; monthOffset?: number }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const { firstDate, lastDate } = buildDateRange(monthOffset);
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/usage/insights?first_date=${firstDate}&last_date=${lastDate}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountUsers: async (_parent: any, { accountId }: { accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/account_users?limit=100`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountUser: async (_parent: any, { accountId, userId }: { accountId: string; userId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/account_users/${userId}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeUserAdd: async (_parent: any, { accountId, email, firstName, lastName, role }: { accountId: string; email: string; firstName: string; lastName: string; role: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          // Swagger: user object requires account_id; roles is a comma-separated string, not array
          await services.localServices.capiDirect(`/accounts/${accountId}/account_users`, 'POST', { user: { account_id: accountId, email, first_name: firstName, last_name: lastName, roles: role } });
          return { success: true, message: `User ${email} added to account ${accountId} with role ${role}` };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeUserUpdate: async (_parent: any, { accountId, userId, role }: { accountId: string; userId: string; role: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          // Swagger: roles is a comma-separated string, not array
          await services.localServices.capiDirect(`/accounts/${accountId}/account_users/${userId}`, 'PATCH', { roles: role });
          return { success: true, message: `User ${userId} role updated to ${role}` };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeUserRemove: async (_parent: any, { accountId, userId, confirm }: { accountId: string; userId: string; confirm?: boolean }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          if (!confirm) return { success: false, error: 'Pass --confirm to remove this user' };
          await services.localServices.capiDirect(`/accounts/${accountId}/account_users/${userId}`, 'DELETE');
          return { success: true, message: `User ${userId} removed from account ${accountId}` };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeUserAudit: async (_parent: any, { accountId }: { accountId?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          let accounts: any[];
          if (accountId) {
            accounts = [{ id: accountId, name: accountId }];
          } else {
            accounts = await services.localServices.capiGetAccounts() as any[];
          }
          const results = await Promise.all((accounts || []).map(async (a: any) => {
            try {
              const d = await services.localServices!.capiDirect(`/accounts/${a.id}/account_users?limit=100`) as any;
              return { account: a.name, users: d?.results ?? [] };
            } catch { return { account: a.name, users: [] }; }
          }));
          return { success: true, data: JSON.stringify(results) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSites: async (_parent: any, { accountId }: { accountId?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/sites${accountId ? `?account_id=${accountId}` : ''}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSite: async (_parent: any, { siteId }: { siteId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/sites/${siteId}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeCreateSite: async (_parent: any, { name, accountId }: { name: string; accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect('/sites', 'POST', { name, account_id: accountId }) as any;
          return { success: true, siteId: data?.id, name: data?.name };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeCreateInstall: async (_parent: any, { siteId, name, environment, accountId }: { siteId: string; name: string; environment: string; accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect('/installs', 'POST', { name, account_id: accountId, site_id: siteId, environment }) as any;
          return { success: true, installId: data?.id, name: data?.name, domain: data?.primaryDomain || data?.cname };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeUpdateInstall: async (_parent: any, { installId, phpVersion, environment }: { installId: string; phpVersion?: string; environment?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          if (!phpVersion && !environment) return { success: false, error: 'Provide at least one of phpVersion or environment' };
          const body: any = {};
          if (phpVersion) body.php_version = phpVersion;
          if (environment) body.environment = environment;
          await services.localServices.capiDirect(`/installs/${installId}`, 'PATCH', body);
          return { success: true, message: `Install ${installId} updated` };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeDeleteInstall: async (_parent: any, { installId, confirmName }: { installId: string; confirmName?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const install = await services.localServices.capiDirect(`/installs/${installId}`) as any;
          if (!confirmName) return { success: false, error: `Pass --confirm-name "${install?.name || installId}" to confirm deletion` };
          if (confirmName !== install?.name) return { success: false, error: `Confirmation name "${confirmName}" does not match install name "${install?.name}"` };
          await services.localServices.capiDirect(`/installs/${installId}`, 'DELETE');
          return { success: true, message: `Install "${install?.name}" deleted` };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeBackupStatus: async (_parent: any, { installId, backupId }: { installId: string; backupId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/backups/${backupId}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeBackupVerify: async (_parent: any, { installId, description }: { installId: string; description?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const createResult = await services.localServices.capiCreateBackup(installId, description || 'Backup via Nexus AI') as any;
          const backupId = createResult?.id || createResult?.backup_id;
          if (!backupId) return { success: true, status: 'created', message: 'Backup created — ID not returned, cannot poll status' } as any;
          // Poll up to 60 attempts (5 min)
          for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
              const status = await services.localServices!.capiDirect(`/installs/${installId}/backups/${backupId}`) as any;
              if (status?.status === 'completed' || status?.status === 'success') {
                return { success: true, backupId, status: status.status, createdAt: status.created_at };
              }
              if (status?.status === 'failed') return { success: false, error: 'Backup failed', backupId };
            } catch { /* keep polling */ }
          }
          return { success: true, backupId, status: 'timeout', createdAt: null };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeDomains: async (_parent: any, { installId }: { installId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/domains`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeDomainAdd: async (_parent: any, { installId, domain }: { installId: string; domain: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/domains`, 'POST', { name: domain }) as any;
          return { success: true, domainId: data?.id, name: data?.name };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeDomainRemove: async (_parent: any, { installId, domainId, confirm }: { installId: string; domainId: string; confirm?: boolean }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          if (!confirm) return { success: false, error: 'Pass --confirm to remove this domain' };
          await services.localServices.capiDirect(`/installs/${installId}/domains/${domainId}`, 'DELETE');
          return { success: true, message: `Domain ${domainId} removed from install ${installId}` };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeDomainCheck: async (_parent: any, { installId, domainId }: { installId: string; domainId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/domains/${domainId}/check_status`, 'POST', {}) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSslCertificates: async (_parent: any, { installId }: { installId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/ssl_certificates`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSslRequest: async (_parent: any, { installId, domainIds }: { installId: string; domainIds: string[] }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          await services.localServices.capiDirect(`/installs/${installId}/ssl_certificates`, 'POST', { domain_ids: domainIds });
          return { success: true, message: 'SSL certificate provisioning requested' };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSshKeys: async () => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect('/ssh_keys') as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSshKeyAdd: async (_parent: any, { label, publicKey }: { label: string; publicKey: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          // Swagger: only accepts public_key, no label field
          const data = await services.localServices.capiDirect('/ssh_keys', 'POST', { public_key: publicKey }) as any;
          return { success: true, keyId: data?.id, label: data?.label };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSshKeyRemove: async (_parent: any, { sshKeyId, confirm }: { sshKeyId: string; confirm?: boolean }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          if (!confirm) return { success: false, error: 'Pass --confirm to remove this SSH key' };
          await services.localServices.capiDirect(`/ssh_keys/${sshKeyId}`, 'DELETE');
          return { success: true, message: `SSH key ${sshKeyId} removed` };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpePromote: async (_parent: any, { sourceInstallId, destInstallId, includeDatabase, confirm }: { sourceInstallId: string; destInstallId: string; includeDatabase?: boolean; confirm?: boolean }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          if (!confirm) {
            const [src, dst] = await Promise.all([
              services.localServices.capiDirect(`/installs/${sourceInstallId}`) as Promise<any>,
              services.localServices.capiDirect(`/installs/${destInstallId}`) as Promise<any>,
            ]);
            return {
              success: true,
              requiresConfirmation: true,
              message: `This will overwrite "${(dst as any)?.name}" (${(dst as any)?.environment}) with content from "${(src as any)?.name}" (${(src as any)?.environment}). Pass --confirm to proceed.`,
            };
          }
          await services.localServices.capiDirect('/install_copy', 'POST', {
            source_install_id: sourceInstallId,
            destination_install_id: destInstallId,
            include_database: includeDatabase !== false,
          });
          return { success: true, message: `Promotion started from ${sourceInstallId} to ${destInstallId}` };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeDiagnose: async (_parent: any, { installId }: { installId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const [install, domains, ssl, backups] = await Promise.all([
            services.localServices.capiDirect(`/installs/${installId}`) as Promise<any>,
            services.localServices.capiDirect(`/installs/${installId}/domains`).catch(() => null) as Promise<any>,
            services.localServices.capiDirect(`/installs/${installId}/ssl_certificates`).catch(() => null) as Promise<any>,
            services.localServices.capiDirect(`/installs/${installId}/backups?limit=1`).catch(() => null) as Promise<any>,
          ]);
          return { success: true, data: JSON.stringify({ install, domains, ssl, backups }) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeGoLiveCheck: async (_parent: any, { installId, domain }: { installId: string; domain: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const [domainsData, ssl] = await Promise.all([
            services.localServices.capiDirect(`/installs/${installId}/domains`) as Promise<any>,
            services.localServices.capiDirect(`/installs/${installId}/ssl_certificates`).catch(() => null) as Promise<any>,
          ]);
          const domainEntry = ((domainsData as any)?.results ?? []).find((d: any) => d.name === domain);
          return { success: true, data: JSON.stringify({ domain, domainAdded: !!domainEntry, domainId: domainEntry?.id, ssl }) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeFleetHealth: async (_parent: any, { accountId }: { accountId?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const installs = await services.localServices.capiGetInstalls() as any[];
          const filtered = accountId ? installs.filter((i: any) => {
            const aid = typeof i.account === 'object' ? i.account?.id : i.account;
            return aid === accountId;
          }) : installs;
          const withSsl = await Promise.all((filtered || []).map(async (install: any) => {
            let ssl = null;
            try { ssl = await services.localServices!.capiDirect(`/installs/${install.id}/ssl_certificates`); } catch {}
            return { ...install, ssl };
          }));
          return { success: true, data: JSON.stringify(withSsl) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpePortfolioOverview: async (_parent: any, { monthOffset = 0 }: { monthOffset?: number }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const { firstDate, lastDate } = buildDateRange(monthOffset);
          const [accounts, installs] = await Promise.all([
            services.localServices.capiGetAccounts() as Promise<any[]>,
            services.localServices.capiGetInstalls() as Promise<any[]>,
          ]);
          const usage = await Promise.all((accounts || []).map(async (a: any) => {
            try {
              const d = await services.localServices!.capiDirect(`/accounts/${a.id}/usage?first_date=${firstDate}&last_date=${lastDate}`);
              return { accountId: a.id, accountName: a.name, usage: d };
            } catch { return { accountId: a.id, accountName: a.name, usage: null }; }
          }));
          return { success: true, data: JSON.stringify({ accounts, installs, usage, period: { firstDate, lastDate } }) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },
    },
  };
}
