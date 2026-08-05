/**
 * GraphQL Resolvers for Nexus CLI
 *
 * Resolvers call services directly for most operations.
 * MCP tools are NOT called - they return markdown for chat interfaces.
 * CLI needs structured JSON data.
 */

import type { ToolRegistry } from '../mcp/tool-registry';
import type { ContributedToolRegistry } from '../agent-runtime/ContributedToolRegistry';
import type { AgentDispatcher } from '../agent-runtime/AgentDispatcher';
import * as ollamaClient from '../helpers/ollama-client';
import { isOperationAllowed, getEffectiveSettings } from '../mcp/utils/operation-permissions';
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
import { toSiteSource } from '../../common/types';
import { getApiKey, KeyVault } from '../security/KeyVault';
import { auditDirectOperation } from '../audit/auditDirectOperation';
import type { NexusServices } from '../types/nexus-services';
import type { LocalSite, LocalSiteDataAccessor } from '../types/site-data';
import pLimit from 'p-limit';
import { withQueue, parseTarget } from './resolver-utils';
import { probeExternalHost } from '../external/probeExternalHost';
import type { ProbeReport } from '../external/probeExternalHost';
import { resolveTargetArgs } from '../transport/resolveTargetArgs';
import {
  externalSiteId, getExternalProfile, listExternalProfiles,
  removeExternalProfile, upsertExternalProfile,
} from '../external/externalSiteStore';
import { createWpCliResolvers } from './resolvers/wp-cli';
import { resolveTransport } from '../transport';
import { collectExternalHostData } from '../startup/collectExternalHostData';
import { writeExternalHostData } from '../startup/writeExternalHostData';
import { ExternalContentIndexService } from '../events/ExternalContentIndexService';
import { vectorSiteId } from '../vector-store/vectorSiteId';
import { resolveRemoteGraphSite } from '../mcp/site-resolver';
import { ensureContentIndexedAtColumn } from '../startup/ExternalContentIndexScheduler';

/** The root value for GraphQL resolvers — always null/undefined for Query/Mutation. */
type ResolverParent = unknown;

interface ResolverContext {
  registry: ToolRegistry;
  services: NexusServices;
}

interface AgentStatusType {
  name: string;
  version: string;
  description: string | null;
  cronExpression: string | null;
  lastRunAt: number | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
  lastRunError: string | null;
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

/**
 * Find a WPE site in the graph by name or domain (for plain-name fallback)
 */
function resolveWpeGraphSite(query: string, graphService: NexusServices['graphService']): Record<string, unknown> | null {
  if (!graphService?.getDb?.()) return null;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const db = graphService.getDb()!;
  const q = query.toLowerCase();

  // Exact name match first, then domain
  const rows = db.prepare("SELECT * FROM sites WHERE source IN ('local','wpe','external')").all() as any[];
  const byName = rows.find((r: any) => r.name?.toLowerCase() === q);
  if (byName) return byName;
  const byDomain = rows.find((r: any) => r.domain?.toLowerCase() === q || r.remote_domain?.toLowerCase() === q);
  if (byDomain) return byDomain;
  // Partial name match last
  const partial = rows.find((r: any) => r.name?.toLowerCase().includes(q));
  return partial ?? null;
}

/**
 * Build SiteDetails fields for a graph row (no local site object).
 *
 * `resolveWpeGraphSite` searches all three sources, so this must report the
 * source it was actually given. Hardcoding `siteKind: 'wpe'` made
 * `nexus sites get <alias>` print "🌐 WP Engine Environment" for an external
 * SSH host — the exact mislabelling the `ssh:` branch was added to stop.
 */
function buildWpeSiteDetails(graphSite: any, twin: any, twinAge: string | null): any {
  const siteKind = toSiteSource(graphSite.source);
  return {
    id: graphSite.id,
    name: graphSite.name,
    domain: graphSite.domain ?? graphSite.remote_domain ?? null,
    path: '',
    // A local-source row reached here only because the site is absent from
    // Local's store, so no running/halted status is known for it.
    status: siteKind === 'local' ? 'unknown' : 'remote',
    siteKind,
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
function resolveSite(identifier: string, siteData: LocalSiteDataAccessor): LocalSite | undefined {
  const sites = Object.values(siteData.getSites());
  return sites.find((s) =>
    s.name === identifier ||
    s.id === identifier ||
    s.domain === identifier
  );
}

/** Flatten a ProbeReport into the GraphQL shape (resolved.* becomes three scalars). */
function toHostReport(r: ProbeReport) {
  return {
    ok: r.ok,
    alias: r.alias,
    hostname: r.resolved?.hostname ?? r.alias,
    user: r.resolved?.user ?? '',
    port: r.resolved?.port ?? '22',
    wpCliPath: r.wpCliPath ?? null,
    wpCliVersion: r.wpCliVersion ?? null,
    wpPath: r.wpPath ?? null,
    wpVersion: r.wpVersion ?? null,
    siteUrl: r.siteUrl ?? null,
    candidates: r.candidates ?? null,
    failure: r.failure ?? null,
  };
}

/**
 * Resolvers
 */
export function createResolvers(context: ResolverContext) {
  const { services, registry } = context;

  return {
    Mutation: {
      /**
       * Get Nexus AI settings (all or single key by dotted path)
       */
      nexusGetSettings: (_: any, { key }: { key?: string }) => {
        try {
          const settings = (services.registryStorage!.get(STORAGE_KEYS.SETTINGS) ?? {}) as Record<string, any>;
          if (key) {
            const value = key.split('.').reduce((acc: any, k) => acc?.[k], settings);
            if (value === undefined) {
              return { success: false, error: `Key "${key}" not found in settings.` };
            }
            return { success: true, settings: JSON.stringify({ key, value }) };
          }
          return { success: true, settings: JSON.stringify(settings) };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

      /**
       * Update Nexus AI settings via key+value or a JSON patch object
       */
      nexusUpdateSettings: (_: any, { key, value, patch }: { key?: string; value?: string; patch?: string }) => {
        try {
          if (!key && !patch) {
            return { success: false, error: 'Provide key+value to set a field, or patch with a JSON object.' };
          }

          let current = (services.registryStorage!.get(STORAGE_KEYS.SETTINGS) ?? {}) as Record<string, any>;

          if (patch) {
            let patchObj: Record<string, any>;
            try { patchObj = JSON.parse(patch); } catch {
              return { success: false, error: `patch is not valid JSON: ${patch}` };
            }
            for (const [k, v] of Object.entries(patchObj)) {
              if (v !== null && typeof v === 'object' && !Array.isArray(v) &&
                  current[k] !== null && typeof current[k] === 'object' && !Array.isArray(current[k])) {
                current = { ...current, [k]: { ...current[k], ...v } };
              } else {
                current = { ...current, [k]: v };
              }
            }
          } else if (key) {
            if (value === undefined) {
              return { success: false, error: 'Provide value= when using key=.' };
            }
            // Parse value
            let parsed: unknown = value;
            if (value === 'true') parsed = true;
            else if (value === 'false') parsed = false;
            else if (value === 'null') parsed = null;
            else if (!isNaN(Number(value)) && value.trim() !== '') parsed = Number(value);
            else { try { parsed = JSON.parse(value); } catch { /* string fallback */ } }

            // Set by dotted path
            const keys = key.split('.');
            const result = { ...current };
            let cur: Record<string, any> = result;
            for (let i = 0; i < keys.length - 1; i++) {
              cur[keys[i]] = cur[keys[i]] !== null && typeof cur[keys[i]] === 'object'
                ? { ...cur[keys[i]] } : {};
              cur = cur[keys[i]];
            }
            cur[keys[keys.length - 1]] = parsed;
            current = result;
          }

          services.registryStorage!.set(STORAGE_KEYS.SETTINGS, current);

          // Make the CLI path settings-reactive, exactly as the IPC path is.
          // Without this, `nexus settings set externalRefreshAutoEnabled true`
          // reported success and changed nothing until Local was restarted —
          // and there is no renderer UI row for that setting, so the CLI is the
          // only way to set it. A scheduler fault must not turn a successful
          // write into a reported failure, hence the isolating try.
          try {
            services.onSettingsUpdated?.();
          } catch (cbErr: any) {
            services.logger?.warn?.('[NexusAI] onSettingsUpdated failed after nexusUpdateSettings:', cbErr?.message);
          }

          return { success: true, settings: JSON.stringify(current) };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },

      /**
       * Get current AI provider configuration
       */
      nexusAiGetConfig: () => {
        try {
          const settings = (services.registryStorage!.get(STORAGE_KEYS.SETTINGS) ?? {}) as any;
          const apiKeys = (services.registryStorage!.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
          return {
            success: true,
            config: {
              provider: settings.aiProvider ?? null,
              model: settings.aiModel ?? null,
              hasApiKey: settings.aiProvider ? !!getApiKey(services.registryStorage!, settings.aiProvider) : false,
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
          const current = (services.registryStorage!.get(STORAGE_KEYS.SETTINGS) ?? {}) as any;
          const updated: any = {
            ...current,
            chatProvider: undefined,
            chatModel: undefined,
            aiProvider: provider,
            aiModel: model,
            onboardingDismissed: true,
          };
          if (useLocalGateway !== undefined) updated.useLocalGateway = useLocalGateway;
          services.registryStorage!.set(STORAGE_KEYS.SETTINGS, updated);
          if (apiKey) {
            // Store via KeyVault to ensure encryption at rest
            const vault = new KeyVault(services.registryStorage!, STORAGE_KEYS.API_KEYS);
            vault.setKey(provider, apiKey);
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
                services.localServices!.capiGetAccounts() as Promise<any[]>,
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

          const local = sites.map((site) => {
            const twin = services.twinService?.get(site.id) ?? null;
            const twinCompleteness = twin?.completeness ?? 'none';

            // Index registry fields
            const indexEntry = services.indexRegistry?.get?.(site.id) ?? null;
            const metaEntry  = services.metadataCache?.getWithAge?.(site.id) ?? null;
            const indexFields = {
              indexState:    indexEntry?.state ?? 'idle',
              documentCount: indexEntry?.documentCount ?? 0,
              chunkCount:    indexEntry?.chunkCount ?? 0,
              lastIndexed:   indexEntry?.lastIndexed ?? null,
              pluginCount:   metaEntry?.plugins?.length ?? null,
              postCount:     metaEntry?.postCount ?? null,
              metaUpdatedAt: metaEntry?.lastUpdated ?? null,
              metaAge:       services.metadataCache?.getAgeString?.(site.id) ?? null,
              metaSource:    metaEntry?.updateSource ?? null,
            };

            // Check if site has WPE connection
            const rawSite = services.localServices?.resolveSiteObject?.(site.id) as any;
            const wpeConnection = rawSite?.hostConnections
              ? Object.values(rawSite.hostConnections).find((c: any) => c.hostId === 'wpe' || c.accountId)
              : null;

            if (!wpeConnection) {
              return {
                name: site.name,
                status: statuses[site.id] || 'unknown',
                wpVersion: twin?.wpVersion ?? site.wpVersion ?? null,
                domain: site.domain || 'unknown',
                id: site.id,
                phpVersion: twin?.phpVersion ?? site.phpVersion ?? null,
                twinCompleteness,
                linkedTo: null,
                ...indexFields,
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
              wpVersion: twin?.wpVersion ?? site.wpVersion ?? null,
              domain: site.domain || 'unknown',
              id: site.id,
              phpVersion: twin?.phpVersion ?? site.phpVersion ?? null,
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
              ...indexFields,
            };
          });

          // Build WPE sites list — simple map, no DB writes.
          // WPE installs are persisted to the graph by WPESyncService.syncFromCAPI()
          // on startup and hourly — no need to duplicate it here on every list call.
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

          // Build external sites list from the graph
          let external: any[] = [];
          try {
            const db = services.graphService?.getDb();
            if (db) {
              // I7: `nexus host remove` soft-deletes (is_active = 0) and resets
              // domain back to the alias. Without this filter a removed host
              // stayed in `sites list` — with its domain clobbered — while
              // `host list` correctly omitted it.
              const externalRows = db.prepare(`
                SELECT id, name, environment, domain, wp_version, php_version, last_sync_at
                FROM sites
                WHERE source = 'external' AND is_active = 1
              `).all() as any[];

              external = externalRows.map((row: any) => ({
                alias: row.name,
                id: row.id,
                environment: row.environment || 'unknown',
                domain: row.domain || null,
                wpVersion: row.wp_version || null,
                phpVersion: row.php_version === '' ? null : (row.php_version || null),
                lastSyncAt: row.last_sync_at || null,
              }));
            }
          } catch (externalErr: any) {
            console.warn('[Nexus GraphQL] External sites unavailable:', externalErr.message);
          }

          return { local, wpe, external };
        } catch (error: any) {
          // Never throw — return empty lists so callers get [] instead of 500
          console.error('[Nexus GraphQL] nexusSitesList error:', error.message);
          return { local: [], wpe: [], external: [] };
        }
      },

      /**
       * Get detailed information about a site
       */
      nexusSitesGet: async (_parent: ResolverParent, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const graphService = services.graphService;

          // ── Explicit WPE target: wpe:account/install@environment ──────────
          if (parsed.type === 'wpe') {
            const rows = graphService?.getDb?.()
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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

          // ── Explicit external target: ssh:alias@environment ───────────────
          if (parsed.type === 'external') {
            const alias = parsed.alias!;
            const siteId = externalSiteId(alias);
            const rows = graphService?.getDb?.()
              // I7: is_active = 1 — a soft-deleted host must not resolve.
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              ? (graphService.getDb()!.prepare("SELECT * FROM sites WHERE source='external' AND is_active = 1").all() as any[])
              : [];
            const graphSite = rows.find((r: any) => r.id === siteId) ?? null;

            if (!graphSite) {
              return { success: false, error: `External host not found: ${target}` };
            }

            const twin = services.twinService?.getFromGraph?.(graphSite, graphService) ?? null;
            const twinAge = twin?.asOf ? formatTwinAge(Date.now() - twin.asOf) : null;
            return {
              success: true,
              site: {
                id: graphSite.id,
                name: graphSite.name,
                domain: graphSite.domain ?? null,
                path: '',
                status: 'remote',
                siteKind: 'external',
                wpVersion:            twin?.wpVersion ?? graphSite.wp_version ?? null,
                phpVersion:           twin?.phpVersion ?? graphSite.php_version ?? null,
                mysqlVersion:         null,
                siteUrl:              twin?.siteUrl ?? graphSite.site_url ?? graphSite.domain ?? null,
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
              },
            };
          }

          // ── Local target (plain name or @local) ───────────────────────────
          if (!services.localServices) {
            return { success: false, error: 'Local services not available' };
          }

          const site = resolveSite(parsed.siteName!, services.siteData);

          if (site) {
            // Found in Local — assemble from local siteData + twin
            const status = services.localServices!.getSiteStatus(site.id);
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

          // ── Local not found — try graph as fallback ───────────────────────
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
      nexusSitesClone: async (_parent: ResolverParent, { input }: { input: any }) => {
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
      nexusSitesRename: async (_parent: ResolverParent, { input }: { input: any }) => {
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
      nexusSitesExport: async (_parent: ResolverParent, { input }: { input: any }) => {
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
      nexusSitesImport: async (_parent: ResolverParent, { input }: { input: any }) => {
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
      nexusSitesLogs: async (_parent: ResolverParent, { input }: { input: any }) => {
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

          const logs = await services.localServices.getSiteLogs!(site.id, {
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
      nexusSitesConfigPhp: async (_parent: ResolverParent, { input }: { input: any }) => {
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
          await services.localServices.changePhpVersion!(site.id, input.version);

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
      nexusSitesConfigSsl: async (_parent: ResolverParent, { input }: { input: any }) => {
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

          await services.localServices.trustSsl!(site.id);

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
      nexusSitesConfigXdebug: async (_parent: ResolverParent, { input }: { input: any }) => {
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

          const result = await services.localServices.toggleXdebug!(site.id, input.enable);

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

          const blueprints = await services.localServices.getBlueprints!();

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
      nexusBlueprintsSave: async (_parent: ResolverParent, { input }: { input: any }) => {
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

          await services.localServices.saveBlueprint!(site.id, input.blueprintName);

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
      nexusSitesCreate: async (_parent: ResolverParent, { input }: { input: any }) => {
        return withQueue(async () => {
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
        });
      },

      /**
       * Start a local site
       */
      nexusSitesStart: async (_parent: ResolverParent, { target }: { target: string }) => {
        // Validate before entering queue so "not found" returns immediately
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
        return withQueue(async () => {
          try {
            await services.localServices!.startSite(site.id);
            const newStatus = services.localServices!.getSiteStatus(site.id);
            return { success: true, siteName: site.name, status: newStatus };
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        });
      },

      /**
       * Stop a local site
       */
      nexusSitesStop: async (_parent: ResolverParent, { target }: { target: string }) => {
        // Validate before entering queue so "not found" returns immediately
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
        return withQueue(async () => {
          try {
            await services.localServices!.stopSite(site.id);
            const newStatus = services.localServices!.getSiteStatus(site.id);
            return { success: true, siteName: site.name, status: newStatus };
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        });
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
      nexusSitesDelete: async (_parent: ResolverParent, { target }: { target: string }) => {
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
      nexusSiteStatus: async (_parent: ResolverParent, { target }: { target: string }) => {
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
      nexusSiteRefresh: async (_parent: ResolverParent, { target, force }: { target: string; force?: boolean }) => {
        return withQueue(async () => {
        try {
          const result = await registry.call('nexus_site_refresh', { site: target, force: !!force }, services, 'cli');
          const text = result?.content?.[0]?.text ?? '';
          return { success: !result?.isError, error: result?.isError ? text : null, report: text };
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
        });
      },

      /**
       * Digital twin: refresh all sites
       */
      nexusFleetRefresh: async () => {
        return withQueue(async () => {
        try {
          const result = await registry.call('nexus_fleet_refresh', {}, services, 'cli');
          const text = result?.content?.[0]?.text ?? '';
          return { success: !result?.isError, error: result?.isError ? text : null, report: text };
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
        });
      },

      /**
       * Deep-refresh a WPE site via SSH WP-CLI:
       * fetches plugins, themes, and WP version and persists them to the graph.
       */
      nexusWpeSiteDeepRefresh: async (_parent: ResolverParent, { installName }: { installName: string }) => {
        const empty = { installName, pluginCount: 0, themeCount: 0, wpVersion: null };
        return withQueue(async () => {
        try {
          if (!services.localServices) {
            return { success: false, error: 'Local services not available', ...empty };
          }
          if (!services.localServices.isSSHKeyAvailable()) {
            return { success: false, error: 'WP Engine SSH key not found. Connect to WP Engine via Local first.', ...empty };
          }

          const graphService = services.graphService;
          const now = Date.now();

          // Find the graph site ID for this install
          let siteId: string | null = null;
          if (graphService?.getDb?.()) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const row = graphService.getDb()!.prepare(
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

            graphService.getDb()!.prepare(`
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
        });
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
          const graphService = services.graphService;

          // Local site twins
          const localTwins = services.twinService.getAll() ?? [];

          // Graph sites (WPE + external, minimal twin shape for aggregation)
          const graphTwins: any[] = [];
          try {
            if (graphService?.getDb?.()) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              const db = graphService.getDb()!;
              const graphRows = db.prepare("SELECT * FROM sites WHERE source IN ('wpe','external')").all() as any[];
              for (const row of graphRows) {
                const hasPlugins = db.prepare('SELECT COUNT(*) as c FROM plugins WHERE site_id=?').get(row.id) as { c: number };
                const comp = hasPlugins.c > 0 ? 'metadata' : (row.wp_version ? 'filesystem' : 'none');
                graphTwins.push({
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
          } catch { /* graph optional */ }

          const twins = [...localTwins, ...graphTwins];

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
      nexusFleetPlugins: (_parent: ResolverParent, { search, minSites }: { search?: string; minSites?: number }) => {
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

          // Supplement with graph sites (WPE + external, plugins from graph plugins table)
          const graphPluginTwins: any[] = [];
          try {
            const graphService = services.graphService;
            if (graphService?.getDb?.()) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              const db = graphService.getDb()!;
              const graphRows = db.prepare("SELECT id, name FROM sites WHERE source IN ('wpe','external')").all() as any[];
              for (const row of graphRows) {
                const pluginRows = db.prepare(
                  'SELECT slug as name, name as title, is_active FROM plugins WHERE site_id=?'
                ).all(row.id) as any[];
                if (pluginRows.length) {
                  graphPluginTwins.push({
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

          const twins = [...localTwins, ...graphPluginTwins];

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
      nexusFleetVersionSites: (_parent: ResolverParent, { phpVersion, wpVersion }: { phpVersion?: string; wpVersion?: string }) => {
        try {
          if (!services.twinService) {
            return { success: false, error: 'Twin service not available', sites: [] };
          }

          const localTwins = services.twinService.getAll() ?? [];
          const graphService = services.graphService;
          const graphTwins: any[] = [];

          try {
            if (graphService?.getDb?.()) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              const rows = graphService.getDb()!
                .prepare("SELECT name, wp_version, php_version, source FROM sites WHERE source IN ('wpe','external') AND is_active=1")
                .all() as any[];
              for (const row of rows) {
                graphTwins.push({ siteName: row.name, wpVersion: row.wp_version, phpVersion: row.php_version, source: row.source });
              }
            }
          } catch { /* optional */ }

          const normalizePhp = (v?: string) => v ? (v.match(/^(\d+\.\d+)/)?.[1] ?? v) : 'unknown';
          const all = [
            ...localTwins.map((t: any) => ({ siteName: t.siteName, wpVersion: t.wpVersion, phpVersion: t.phpVersion, source: 'local' })),
            ...graphTwins,
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

      // nexusWpCommand + nexusWpPluginList. One implementation, in
      // resolvers/wp-cli.ts, so the in-progress resolver split cannot land a
      // second copy that has drifted out of audit and gate coverage.
      ...createWpCliResolvers(services),

      /**
       * Pull from WPE to local
       */
      nexusSyncPull: async (_parent: ResolverParent, { input }: { input: any }) => {
        return withQueue(async () => {
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
          const status = services.localServices!.getSiteStatus(site.id);
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
          const installs = await services.localServices!.capiGetInstalls() as any[];
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
        });
      },

      /**
       * Push from local to WPE
       */
      nexusSyncPush: async (_parent: ResolverParent, { input }: { input: any }) => {
        return withQueue(async () => {
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
          const status = services.localServices!.getSiteStatus(site.id);
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
          const installs = await services.localServices!.capiGetInstalls() as any[];
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
        });
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

          const accounts = await services.localServices!.capiGetAccounts() as any[];

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
      nexusWpeInstalls: async (_parent: ResolverParent, { account }: { account?: string }) => {
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

          const installs = await services.localServices!.capiGetInstalls() as any[];
          const accounts = await services.localServices!.capiGetAccounts() as any[];

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
      nexusWpeInstall: async (_parent: ResolverParent, { installId }: { installId: string }) => {
        try {
          if (!services.localServices?.isCAPIAvailable() || !services.localServices?.isWPEAuthenticated()) {
            return {
              success: false,
              error: 'Not authenticated with WP Engine. Use wpe_login or authenticate in Local.',
            };
          }

          const install = await services.localServices.capiGetInstall(installId) as any;
          if (!install) {
            return {
              success: false,
              error: `Install "${installId}" not found`,
            };
          }

          const accounts = await services.localServices!.capiGetAccounts() as any[];
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
      nexusWpeBackup: async (_parent: ResolverParent, { input }: { input: any }) => {
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
          const installs = await services.localServices!.capiGetInstalls() as any[];
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

          auditDirectOperation(services, {
            operation: 'wpe.backup.create',
            target: install.name,
            parameters: { installId: install.id, description: input.description, notificationEmails: input.notificationEmails },
            outcome: 'success',
          });

          return {
            success: true,
            backupId: backupResult?.id || null,
            message: `Backup created for ${parsed.account}/${parsed.installName}@${parsed.environment} (${install.name})`,
          };
        } catch (error: any) {
          auditDirectOperation(services, {
            operation: 'wpe.backup.create',
            target: String(input?.target ?? 'unknown'),
            parameters: { input },
            outcome: 'failure',
            error: error.message,
          });
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Purge WPE cache
       */
      nexusWpeCache: async (_parent: ResolverParent, { target }: { target: string }) => {
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

          // Access control check — use parsed.environment (explicit in target) first
          const cacheSettings = getEffectiveSettings(services.registryStorage);
          const envForCheck = parsed.environment ?? 'production';
          if (!isOperationAllowed('push', envForCheck, cacheSettings, `wpe:${parsed.installName!}`)) {
            return {
              success: false,
              error: `Operation blocked: this operation is not permitted on "${envForCheck}" environments. Adjust in Nexus AI → Settings → WP Engine Access.`,
            };
          }

          // Resolve install name to install ID
          const installs = await services.localServices!.capiGetInstalls() as any[];
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

          auditDirectOperation(services, {
            operation: 'wpe.cache.purge',
            target: install.name,
            parameters: { installId: install.id, environment: envForCheck },
            outcome: 'success',
          });

          return {
            success: true,
            message: `Cache purged for ${parsed.account}/${parsed.installName}@${parsed.environment} (${install.name})`,
          };
        } catch (error: any) {
          auditDirectOperation(services, {
            operation: 'wpe.cache.purge',
            target,
            parameters: { target },
            outcome: 'failure',
            error: error.message,
          });
          return {
            success: false,
            error: error.message,
          };
        }
      },

      /**
       * Link local site to WPE
       */
      nexusWpeLink: async (_parent: ResolverParent, { input }: { input: any }) => {
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
          await services.localServices.linkToWpe!(site.id, wpeParsed.installName!, wpeParsed.environment!);

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
      nexusWpeChanges: async (_parent: ResolverParent, { input }: { input: any }) => {
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

          // getSiteChanges doesn't exist in the bridge — use getSyncHistory instead
          // which returns the history of push/pull operations for this site
          const history = await services.localServices.getSyncHistory?.(site.id) ?? [];

          return {
            success: true,
            changes: history.map((c: any) => ({
              type: c.direction ?? 'unknown',
              path: c.installName ?? '',
              status: c.success ? 'completed' : 'failed',
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
      nexusSyncHistory: async (_parent: ResolverParent, { localSite }: { localSite: string }) => {
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

          const history = await services.localServices.getSyncHistory!(site.id);

          return {
            success: true,
            history: history.map((entry: any) => ({
              timestamp: entry.timestamp,
              direction: entry.direction,
              success: entry.success ?? true,  // non-nullable in schema; default true if not set
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
        return withQueue(async () => {
        try {
          if (!services.healthCalculator) {
            return {
              success: false,
              error: 'Health scoring is not available',
              summary: null,
            };
          }

          // Count Local sites from Local's store (authoritative for local)
          const localSiteData = services.siteData.getSites();
          const localSiteIds = Object.keys(localSiteData);
          const localSites = localSiteIds.length;

          let runningSites = 0;
          let haltedSites = 0;

          for (const id of localSiteIds) {
            const status = services.localServices?.getSiteStatus?.(id) || 'unknown';
            if (status === 'running') runningSites++;
            else haltedSites++;
          }

          // Count remote sites from graph (authoritative for WPE + external)
          let remoteSites = 0;
          let totalPlugins = 0;
          let totalThemes = 0;
          let sitesWithPluginData = 0;
          let sitesWithThemeData = 0;

          const db = services.graphService?.getDb?.();
          if (db) {
            try {
              // Count remote sites (WPE + external only, NULL means local)
              const remoteCount = db
                .prepare(`SELECT COUNT(*) as count FROM sites WHERE is_active = 1 AND source IN ('wpe', 'external')`)
                .get() as { count: number };
              remoteSites = remoteCount.count;

              // Count plugins and distinct sites with plugin data
              const pluginCount = db
                .prepare(`
                  SELECT COUNT(*) as total, COUNT(DISTINCT p.site_id) as sites
                  FROM plugins p
                  INNER JOIN sites s ON p.site_id = s.id
                  WHERE s.is_active = 1
                `)
                .get() as { total: number; sites: number };
              totalPlugins = pluginCount.total;
              sitesWithPluginData = pluginCount.sites;

              // Count themes and distinct sites with theme data
              const themeCount = db
                .prepare(`
                  SELECT COUNT(*) as total, COUNT(DISTINCT t.site_id) as sites
                  FROM themes t
                  INNER JOIN sites s ON t.site_id = s.id
                  WHERE s.is_active = 1
                `)
                .get() as { total: number; sites: number };
              totalThemes = themeCount.total;
              sitesWithThemeData = themeCount.sites;
            } catch {
              // Graph unavailable, degrade to local-only
            }
          }

          const totalSites = localSites + remoteSites;

          // Get content-indexed sites for health scoring.
          //
          // I5: this is NOT the set of local sites and it is NOT the fleet. It
          // is whatever carries an indexRegistry entry in state 'indexed' —
          // measured 2026-08-04, 423 entries against 118 Local sites, 297 of
          // them WPE install ids. `sitesScored` below is its denominator so the
          // caller can qualify the counts rather than print them bare next to a
          // fleet-wide total several times larger.
          //
          // Two known defects live in the loop below and are deliberately NOT
          // fixed here (they predate this branch and want their own change):
          // `localSiteData[entry.siteId]` misses for every WPE entry, so
          // `domain` is '' and `phpVersion` falls back to a fabricated '8.0';
          // and `calculateAllScores` uses the default all-five factor set, so
          // maintenance and activity score 0 for those same WPE entries — the
          // very thing nexusFleetSiteHealth's per-target factor list fixes.
          const entries = services.indexRegistry.listAll().filter((e: any) => e.state === 'indexed');
          const siteInfoMap: Record<string, any> = {};

          for (const entry of entries) {
            const site = localSiteData[entry.siteId];
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
              totalSites,
              localSites,
              runningSites,
              haltedSites,
              healthyCount,
              warningCount,
              criticalCount,
              sitesScored: indexedSiteIds.length,
              totalPlugins,
              outdatedPlugins: null,
              totalThemes,
              outdatedThemes: null,
              sitesWithPluginData,
              sitesWithThemeData,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            summary: null,
          };
        }
        });
      },

      /**
       * Get health breakdown for a single site.
       * Accepts local (@local), WPE (wpe:), or external (ssh:) targets.
       */
      nexusFleetSiteHealth: async (_parent: ResolverParent, { target }: { target: string }) => {
        // M10: this resolver runs resolveTargetArgs, up to four graph queries and a
        // full score calculation — it belongs on the shared queue like its siblings.
        return withQueue(async () => {
        try {
          if (!services.healthCalculator) {
            return {
              success: false,
              error: 'Health scoring is not available',
              health: null,
            };
          }

          // M6: Hoist getDb() call — used three times below
          const db = services.graphService?.getDb?.();

          // Resolve target to determine site type and identity
          const targetArgs = resolveTargetArgs(target, services);

          let siteId: string;
          let siteInfo: { domain: string; phpVersion?: string; siteUrl?: string };
          let wpVersion: string | null = null;
          let factorsToEvaluate: Array<'security' | 'performance' | 'maintenance' | 'activity' | 'stability'>;

          if ('site' in targetArgs) {
            // Local site — all five factors apply
            const siteName = targetArgs.site as string;
            const site = resolveSite(siteName, services.siteData);
            if (!site) {
              return {
                success: false,
                error: `Site not found: ${siteName}`,
                health: null,
              };
            }
            siteId = site.id;
            siteInfo = {
              domain: site.domain || '',
              // C3 note: this `|| '8.0'` is pre-existing on the LOCAL path and is
              // deliberately left alone. Local sites get a real phpVersion from
              // Local's own store; the remote path's identical default was
              // introduced by this branch and has been removed there.
              phpVersion: (site as any)?.phpVersion || '8.0',
            };

            // M4: wp_version/site_url for local sites from graph if indexed, constrain by source
            if (db) {
              try {
                const row = db.prepare(
                  "SELECT wp_version, site_url FROM sites WHERE id = ? AND source = 'local'"
                ).get(siteId) as { wp_version?: string; site_url?: string } | undefined;
                wpVersion = row?.wp_version || null;
                siteInfo.siteUrl = row?.site_url || undefined;
              } catch {
                // Graph unavailable
              }
            }

            factorsToEvaluate = ['security', 'performance', 'maintenance', 'activity', 'stability'];
          } else if ('install_name' in targetArgs || 'ssh_target' in targetArgs) {
            // Remote site (WPE or external). Evaluate a factor only where its inputs
            // exist for that target — the same rule that already excluded maintenance
            // and activity for remote sites:
            //
            //   wpe      → security, performance. Plugin rows exist (populated by the
            //              WPE sync/deep-refresh path). `stability` is NOT evaluated:
            //              calculateStability counts failed `event_queue` rows, and the
            //              only writer of that table is the MU-plugin webhook, which
            //              exists on Local sites alone. A remote site can never have an
            //              event, so the factor was a fixed 100 awarded for absent data.
            //   external → depends on the data actually present, see `externalScoreable`
            //              below. External hosts DO have a refresh mechanism now
            //              (ExternalRefreshScheduler / `nexus host refresh`), so a
            //              refreshed host has plugin rows and a php_version and is
            //              scored on security + performance like a WPE install. An
            //              unrefreshed one has neither and is not scored at all:
            //              scoring security/performance off zero plugin rows produced
            //              "no security plugin detected" and full plugin-hygiene credit
            //              from the same absence, in a response that separately reports
            //              `plugins: null`. The gate is data presence, not host class.
            //              (A host whose PHP disables proc_open never gets a
            //              php_version — `wp --info` cannot run — so it stays unscored
            //              however often it refreshes.)
            if (!db) {
              return {
                success: false,
                error: 'Graph database unavailable for remote site lookup',
                health: null,
              };
            }

            let row: { id: string; domain: string; php_version?: string; wp_version?: string; site_url?: string; remote_install_id?: string } | undefined;
            const isExternal = 'ssh_target' in targetArgs;

            if ('install_name' in targetArgs) {
              // M1: Add is_active filter; M3: prefer remote_install_id when available
              const installName = targetArgs.install_name as string;
              row = db.prepare(
                "SELECT id, domain, php_version, wp_version, site_url, remote_install_id FROM sites WHERE source = 'wpe' AND is_active = 1 AND (remote_install_id = ? OR LOWER(name) = ?) LIMIT 1"
              ).get(installName, installName.toLowerCase()) as typeof row;
            } else {
              // M2: Use LOWER() for external alias match; M3: prefer id
              // I7: is_active = 1 — `nexus host remove` soft-deletes, and without this
              // a removed host still reports health.
              const sshTarget = targetArgs.ssh_target as string;
              const parsed = parseTarget(sshTarget);
              const alias = parsed.alias!;
              const expectedId = externalSiteId(alias);
              row = db.prepare(
                "SELECT id, domain, php_version, wp_version, site_url FROM sites WHERE source = 'external' AND is_active = 1 AND (id = ? OR LOWER(name) = ?) LIMIT 1"
              ).get(expectedId, alias.toLowerCase()) as typeof row;
            }

            if (!row) {
              return {
                success: false,
                error: `Remote site not found in graph database`,
                health: null,
              };
            }

            siteId = row.id;
            siteInfo = {
              domain: row.domain || '',
              // C3: no default. 46 of 331 active WPE rows and every external row have
              // no php_version; `|| '8.0'` invented one and collected 20/25 security
              // and 30/40 performance points for it. The calculator already reports
              // `PHP version unknown` for undefined — let it.
              phpVersion: row.php_version || undefined,
              siteUrl: row.site_url || undefined,
            };
            wpVersion = row.wp_version || null;

            // External hosts become scoreable once L2 data actually exists —
            // a plugin row (Task 1-6 populate these on demand) and a real
            // php_version. Otherwise stay at the existing "no data" path.
            const hasPlugins = isExternal && (db.prepare(
              'SELECT COUNT(*) as c FROM plugins WHERE site_id = ?'
            ).get(row.id) as { c: number }).c > 0;
            const externalScoreable = hasPlugins && !!row.php_version;

            factorsToEvaluate = isExternal
              ? (externalScoreable ? ['security', 'performance'] : [])
              : ['security', 'performance'];
          } else {
            return {
              success: false,
              error: 'Invalid target format',
              health: null,
            };
          }

          // Calculate score with the applicable factor set.
          // An empty factor set is not scoreable: report null rather than a number
          // derived from data that does not exist.
          let score: number | null = null;
          let status: string | null = null;
          let issues: Array<{ severity: string; message: string; category: string }> = [];
          const factorsEvaluated: string[] = [...factorsToEvaluate];

          if (factorsToEvaluate.length > 0) {
            const breakdown = await services.healthCalculator.calculateScore(siteId, siteInfo, factorsToEvaluate);
            score = breakdown.overall;
            status = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical';

            // Map issues to GraphQL shape with severity derived from factor scores
            const { factors, issuesByCategory } = breakdown;
            issues = issuesByCategory.map(({ category, message }) => {
              const factorScore = factors[category as keyof typeof factors] || 0;
              const severity = factorScore >= 80 ? 'healthy' : factorScore >= 50 ? 'warning' : 'critical';
              return { severity, message, category };
            });
          }

          // Get plugin and theme counts from graph
          let plugins: { total: number; active: number; outdated: null } | null = null;
          let themes: { total: number; active: number; outdated: null } | null = null;

          if (db) {
            try {
              const pluginRow = db.prepare(
                "SELECT COUNT(*) AS total, SUM(is_active) AS active FROM plugins WHERE site_id = ?"
              ).get(siteId) as { total: number; active: number } | undefined;

              if (pluginRow && pluginRow.total > 0) {
                plugins = { total: pluginRow.total, active: pluginRow.active, outdated: null };
              }

              const themeRow = db.prepare(
                "SELECT COUNT(*) AS total, SUM(is_active) AS active FROM themes WHERE site_id = ?"
              ).get(siteId) as { total: number; active: number } | undefined;

              if (themeRow && themeRow.total > 0) {
                themes = { total: themeRow.total, active: themeRow.active, outdated: null };
              }
            } catch {
              // Graph query failed, leave as null
            }
          }

          return {
            success: true,
            health: {
              status,
              score,
              factorsEvaluated,
              issues,
              plugins,
              themes,
              wordpress: {
                version: wpVersion || 'unknown',
                updateAvailable: null,
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
        });
      },

      nexusFleetSearch: async (_parent: ResolverParent, { query, limit }: { query: string; limit?: number }) => {
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
          const graphService = services.graphService;
          let graphSiteIds: string[] = [];
          if (graphService?.getDb?.()) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              const rows = graphService.getDb()!!.prepare("SELECT id FROM sites WHERE source IN ('wpe','external')").all() as Array<{ id: string }>;
              graphSiteIds = rows.map((r) => r.id);
            } catch { /* skip graph */ }
          }
          // vectorSiteId: external ids are `ssh:<alias>`; the vector store's
          // table-name validation rejects colons. No-op for local/WPE ids.
          const allSiteIds = [
            ...indexEntries.map((e: any) => vectorSiteId(e.siteId)),
            ...graphSiteIds.map((id) => vectorSiteId(id)),
          ];
          const siteNames = new Map(indexEntries.map((e: any) => [vectorSiteId(e.siteId), e.siteName || e.siteId]));

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

      nexusFleetFilter: async (_parent: ResolverParent, { filter }: { filter: any }) => {
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
              const rawSite = services.localServices?.resolveSiteObject?.(id) as any;
              const hasWpeConnection = rawSite?.hostConnections &&
                Object.values(rawSite.hostConnections).some((c: any) => c.hostId === 'wpe' || c.accountId);
              if (!hasWpeConnection) continue;
            }

            const rawSite = services.localServices?.resolveSiteObject?.(id) as any;
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

      nexusFleetGroupsCreate: async (_parent: ResolverParent, { name, description }: { name: string; description?: string }) => {
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

      nexusFleetGroupsAdd: async (_parent: ResolverParent, { group, sites }: { group: string; sites: string[] }) => {
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
          }).filter((id): id is string => !!id);

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

      nexusFleetGroupsRemove: async (_parent: ResolverParent, { group, sites }: { group: string; sites: string[] }) => {
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
          }).filter((id): id is string => !!id);

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

      nexusFleetGroupsDelete: async (_parent: ResolverParent, { group }: { group: string }) => {
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

      nexusFleetBulkReindex: async (_parent: ResolverParent, { targets }: { targets: string[] }) => {
        return withQueue(async () => {
        try {
          const limit = pLimit(3);

          // Reindex each target with bounded concurrency
          const reindexPromises = targets.map((target) => limit(async () => {
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
          }));

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
        });
      },

      nexusFleetBulkPluginUpdate: async (_parent: ResolverParent, { input }: { input: any }) => {
        return withQueue(async () => {
        try {
          const { targets, plugin, all, dryRun } = input;
          const limit = pLimit(3);

          // Update plugins on each target with bounded concurrency
          const updatePromises = targets.map((target: string) => limit(async () => {
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
          }));

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
        });
      },

      nexusFleetBulkHealthCheck: async (_parent: ResolverParent, { targets }: { targets: string[] }) => {
        return withQueue(async () => {
        try {
          if (!services.healthCalculator) {
            return {
              success: false,
              error: 'Health calculator not available',
              results: [],
            };
          }

          const allSites = services.siteData.getSites();
          const limit = pLimit(3);

          // Check health for each target with bounded concurrency
          const healthPromises = targets.map((target) => limit(async () => {
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

              const scores = await services.healthCalculator!.calculateAllScores([site.id], { [site.id]: siteInfo });
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
          }));

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
        });
      },

      nexusFleetCompare: async (_parent: ResolverParent, { target1, target2 }: { target1: string; target2: string }) => {
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

      nexusContentSearch: async (_parent: ResolverParent, { target, query, limit }: { target: string; query: string; limit?: number }) => {
        try {
          const parsed = parseTarget(target);
          let siteId: string;

          if (parsed.type === 'local') {
            const site = resolveSite(parsed.siteName!, services.siteData);
            if (!site) {
              return {
                success: false,
                error: `Site not found: ${parsed.siteName}`,
                results: [],
              };
            }
            siteId = site.id;
          } else {
            // WPE or external — resolve via the graph, same fallback and
            // collision policy search_site_content uses.
            const lookupName = parsed.type === 'external' ? parsed.alias : parsed.installName;
            const resolved = resolveRemoteGraphSite(services.graphService?.getDb?.(), lookupName);
            if (resolved.kind === 'none') {
              return {
                success: false,
                error: `Site "${target}" not found in the graph database.`,
                results: [],
              };
            }
            if (resolved.kind === 'ambiguous') {
              return {
                success: false,
                error: `"${lookupName}" matches ${resolved.matches.length} sites across sources — specify which one: ${resolved.matches.join(', ')}`,
                results: [],
              };
            }
            siteId = resolved.siteId;
          }

          if (!services.vectorStore || !services.embeddingService) {
            return {
              success: false,
              error: 'Vector store or embedding service not available',
              results: [],
            };
          }

          const queryVector = await services.embeddingService.embed(query);
          // vectorSiteId: external ids are `ssh:<alias>`; no-op for local/WPE.
          const searchResults = await services.vectorStore.search(vectorSiteId(siteId), queryVector, {
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

      nexusContentSearchAll: async (_parent: ResolverParent, { query, limit }: { query: string; limit?: number }) => {
        try {
          if (!services.vectorStore || !services.embeddingService) {
            return { success: false, error: 'Vector store or embedding service not available', results: [] };
          }

          // Embed the query
          const queryVector = await services.embeddingService.embed(query);

          // Search all indexed site IDs (local + WPE + external)
          const indexEntries = services.indexRegistry.listAll();
          const graphService = services.graphService;
          let remoteSiteIds: string[] = [];
          if (graphService?.getDb?.()) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              const rows = graphService.getDb()!!.prepare("SELECT id FROM sites WHERE source IN ('wpe','external')").all() as Array<{ id: string }>;
              remoteSiteIds = rows.map((r) => r.id);
            } catch { /* skip wpe */ }
          }
          // vectorSiteId: external ids are `ssh:<alias>`; the vector store's
          // table names cannot contain a colon. No-op for local/WPE ids.
          // The map returned by searchAcrossSites is keyed by the id passed in,
          // so siteNames must be keyed the same way.
          const allSiteIds = [
            ...indexEntries.map((e: any) => vectorSiteId(e.siteId)),
            ...remoteSiteIds.map((id) => vectorSiteId(id)),
          ];

          // Single tableNames() call + batched search — avoids filesystem lock contention
          interface Hit { siteId: string; siteName: string; score: number; title: string; content: string; postType: string }
          const hits: Hit[] = [];
          const siteNames = new Map(indexEntries.map((e: any) => [vectorSiteId(e.siteId), e.siteName || e.siteId]));

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

      nexusContentStructure: async (_parent: ResolverParent, { target, depth }: { target: string; depth?: number }) => {
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

      nexusContentIndexStatus: async (_parent: ResolverParent, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          let siteId: string;

          if (parsed.type === 'local') {
            const site = resolveSite(parsed.siteName!, services.siteData);
            if (!site) {
              return {
                success: false,
                error: `Site not found: ${parsed.siteName}`,
                status: null,
              };
            }
            siteId = site.id;
          } else {
            const lookupName = parsed.type === 'external' ? parsed.alias : parsed.installName;
            const resolved = resolveRemoteGraphSite(services.graphService?.getDb?.(), lookupName);
            if (resolved.kind === 'none') {
              return {
                success: false,
                error: `Site "${target}" not found in the graph database.`,
                status: null,
              };
            }
            if (resolved.kind === 'ambiguous') {
              return {
                success: false,
                error: `"${lookupName}" matches ${resolved.matches.length} sites across sources — specify which one: ${resolved.matches.join(', ')}`,
                status: null,
              };
            }
            siteId = resolved.siteId;
          }

          const indexEntry = services.indexRegistry.get(siteId);

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
              lastIndexed: indexEntry.lastIndexed || null,
              indexedAt: indexEntry.lastIndexed || null,
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

      nexusContentReindex: async (_parent: ResolverParent, { target }: { target: string }) => {
        return withQueue(async () => {
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
        });
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

      nexusAiAsk: async (_parent: ResolverParent, { query, model }: { query: string; model?: string }) => {
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

      nexusAiSetup: async (_parent: ResolverParent, { target, provider, force }: { target: string; provider?: string; force?: boolean }) => {
        return withQueue(async () => {
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
        });
      },

      nexusAiSyncCredentials: async (_parent: ResolverParent, { target }: { target: string }) => {
        try {
          const parsed = parseTarget(target);
          const site = resolveSite(parsed.siteName!, services.siteData);

          if (!site) {
            return { success: false, error: `Site not found: ${parsed.siteName}` };
          }

          if (!services.localServices || !services.registryStorage) {
            return { success: false, error: 'Local services not available' };
          }

          const siteConfigs = (services.registryStorage!.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
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

      nexusAiAbilities: async (_parent: ResolverParent, { target }: { target: string }) => {
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

      nexusAiRun: async (_parent: ResolverParent, { target, ability, params }: { target: string; ability: string; params?: string }) => {
        return withQueue(async () => {
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
        });
      },

      nexusAiStatus: async (_parent: ResolverParent, { target }: { target: string }) => {
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

      nexusAiGetSiteConfig: (_parent: ResolverParent, { target }: { target: string }) => {
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

      nexusAiSwitchProvider: async (_parent: ResolverParent, { target, provider }: { target: string; provider: string }) => {
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

      nexusAuditSite: async (_parent: ResolverParent, { target }: { target: string }) => {
        return withQueue(async () => {
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
        });
      },

      nexusAuditPlugins: async () => {
        return withQueue(async () => {
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
        });
      },

      /**
       * Scan database health for a local WordPress site
       */
      nexusDbScan: async (_parent: ResolverParent, { target }: { target: string }) => {
        return withQueue(async () => {
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

          const status = services.localServices!.getSiteStatus(site.id);
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
        });
      },

      /**
       * Clean database items (dry_run defaults to true)
       */
      nexusDbClean: async (_parent: ResolverParent, { input }: { input: { target: string; items?: string[]; dryRun?: boolean } }) => {
        return withQueue(async () => {
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

          const status = services.localServices!.getSiteStatus(site.id);
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
        });
      },

      /**
       * Fleet database health report — scans all running sites
       */
      nexusDbReport: async (_parent: ResolverParent) => {
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

      nexusWpeAccount: async (_parent: ResolverParent, { accountId }: { accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/accounts/${accountId}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountLimits: async (_parent: ResolverParent, { accountId }: { accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/limits`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountUsageSummary: async (_parent: ResolverParent, { accountId, monthOffset = 0 }: { accountId: string; monthOffset?: number }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const { firstDate, lastDate } = buildDateRange(monthOffset);
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/usage/summary?first_date=${firstDate}&last_date=${lastDate}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountUsageInsights: async (_parent: ResolverParent, { accountId, monthOffset = 0 }: { accountId: string; monthOffset?: number }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const { firstDate, lastDate } = buildDateRange(monthOffset);
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/usage/insights?first_date=${firstDate}&last_date=${lastDate}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountUsers: async (_parent: ResolverParent, { accountId }: { accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/account_users?limit=100`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeAccountUser: async (_parent: ResolverParent, { accountId, userId }: { accountId: string; userId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/accounts/${accountId}/account_users/${userId}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeUserAdd: async (_parent: ResolverParent, { accountId, email, firstName, lastName, role }: { accountId: string; email: string; firstName: string; lastName: string; role: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          // Swagger: user object requires account_id; roles is a comma-separated string, not array
          await services.localServices.capiDirect(`/accounts/${accountId}/account_users`, 'POST', { user: { account_id: accountId, email, first_name: firstName, last_name: lastName, roles: role } });
          auditDirectOperation(services, {
            operation: 'wpe.user.create', target: accountId,
            parameters: { accountId, email, firstName, lastName, role }, outcome: 'success',
          });
          return { success: true, message: `User ${email} added to account ${accountId} with role ${role}` };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.user.create', target: accountId,
            parameters: { accountId, email, firstName, lastName, role }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeUserUpdate: async (_parent: ResolverParent, { accountId, userId, role }: { accountId: string; userId: string; role: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          // Swagger: roles is a comma-separated string, not array
          await services.localServices.capiDirect(`/accounts/${accountId}/account_users/${userId}`, 'PATCH', { roles: role });
          auditDirectOperation(services, {
            operation: 'wpe.user.update', target: `${accountId}/${userId}`,
            parameters: { accountId, userId, role }, outcome: 'success',
          });
          return { success: true, message: `User ${userId} role updated to ${role}` };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.user.update', target: `${accountId}/${userId}`,
            parameters: { accountId, userId, role }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeUserRemove: async (_parent: ResolverParent, { accountId, userId, confirm }: { accountId: string; userId: string; confirm?: boolean }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          if (!confirm) return { success: false, error: 'Pass --confirm to remove this user' };
          await services.localServices.capiDirect(`/accounts/${accountId}/account_users/${userId}`, 'DELETE');
          auditDirectOperation(services, {
            operation: 'wpe.user.delete', target: `${accountId}/${userId}`,
            parameters: { accountId, userId }, outcome: 'success',
          });
          return { success: true, message: `User ${userId} removed from account ${accountId}` };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.user.delete', target: `${accountId}/${userId}`,
            parameters: { accountId, userId }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeUserAudit: async (_parent: ResolverParent, { accountId }: { accountId?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          let accounts: any[];
          if (accountId) {
            accounts = [{ id: accountId, name: accountId }];
          } else {
            accounts = await services.localServices!.capiGetAccounts() as any[];
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

      nexusWpeSites: async (_parent: ResolverParent, { accountId }: { accountId?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/sites${accountId ? `?account_id=${accountId}` : ''}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSite: async (_parent: ResolverParent, { siteId }: { siteId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/sites/${siteId}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeCreateSite: async (_parent: ResolverParent, { name, accountId }: { name: string; accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect('/sites', 'POST', { name, account_id: accountId }) as any;
          auditDirectOperation(services, {
            operation: 'wpe.site.create', target: name,
            parameters: { name, accountId, createdSiteId: data?.id }, outcome: 'success',
          });
          return { success: true, siteId: data?.id, name: data?.name };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.site.create', target: name,
            parameters: { name, accountId }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeCreateInstall: async (_parent: ResolverParent, { siteId, name, environment, accountId }: { siteId: string; name: string; environment: string; accountId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect('/installs', 'POST', { name, account_id: accountId, site_id: siteId, environment }) as any;
          auditDirectOperation(services, {
            operation: 'wpe.install.create', target: name,
            parameters: { name, siteId, environment, accountId, createdInstallId: data?.id }, outcome: 'success',
          });
          return { success: true, installId: data?.id, name: data?.name, domain: data?.primaryDomain || data?.cname };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.install.create', target: name,
            parameters: { name, siteId, environment, accountId }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeUpdateInstall: async (_parent: ResolverParent, { installId, phpVersion, environment }: { installId: string; phpVersion?: string; environment?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          if (!phpVersion && !environment) return { success: false, error: 'Provide at least one of phpVersion or environment' };
          const body: any = {};
          if (phpVersion) body.php_version = phpVersion;
          if (environment) body.environment = environment;
          await services.localServices.capiDirect(`/installs/${installId}`, 'PATCH', body);
          auditDirectOperation(services, {
            operation: 'wpe.install.update', target: installId,
            parameters: { installId, phpVersion, environment }, outcome: 'success',
          });
          return { success: true, message: `Install ${installId} updated` };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.install.update', target: installId,
            parameters: { installId, phpVersion, environment }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeDeleteInstall: async (_parent: ResolverParent, { installId, confirmName }: { installId: string; confirmName?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          // Access control: check before CAPI call using confirmName + cache for environment
          const deleteSettings = getEffectiveSettings(services.registryStorage);
          const deleteCache = services.registryStorage?.get(STORAGE_KEYS.WPE_INSTALL_CACHE) as { installs?: Array<{ installName?: string; install_name?: string; environment?: string }> } | null;
          const nameForCheck = confirmName || installId;
          const cachedForDelete = deleteCache?.installs?.find((i: any) => (i.installName ?? i.install_name) === nameForCheck);
          const envForDelete = cachedForDelete?.environment ?? 'production';
          if (!isOperationAllowed('delete', envForDelete, deleteSettings, `wpe:${nameForCheck}`)) {
            return { success: false, error: `Operation blocked: delete is not permitted on "${envForDelete}" environments. Adjust in Nexus AI → Settings → WP Engine Access.` };
          }
          const install = await services.localServices.capiDirect(`/installs/${installId}`) as any;
          if (!confirmName) return { success: false, error: `Pass --confirm-name "${install?.name || installId}" to confirm deletion` };
          if (confirmName !== install?.name) return { success: false, error: `Confirmation name "${confirmName}" does not match install name "${install?.name}"` };
          await services.localServices.capiDirect(`/installs/${installId}`, 'DELETE');
          // Irreversible destruction of a WP Engine install.
          auditDirectOperation(services, {
            operation: 'wpe.install.delete', target: install?.name ?? installId,
            parameters: { installId, confirmName, environment: envForDelete }, outcome: 'success',
          });
          return { success: true, message: `Install "${install?.name}" deleted` };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.install.delete', target: confirmName ?? installId,
            parameters: { installId, confirmName }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeBackupStatus: async (_parent: ResolverParent, { installId, backupId }: { installId: string; backupId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/backups/${backupId}`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeBackupVerify: async (_parent: ResolverParent, { installId, description }: { installId: string; description?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const createResult = await services.localServices.capiCreateBackup(installId, description || 'Backup via Nexus AI') as any;
          auditDirectOperation(services, {
            operation: 'wpe.backup.create', target: installId,
            parameters: { installId, description, backupId: createResult?.id ?? createResult?.backup_id }, outcome: 'success',
          });
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
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.backup.create', target: installId,
            parameters: { installId, description }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeDomains: async (_parent: ResolverParent, { installId }: { installId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/domains`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeDomainAdd: async (_parent: ResolverParent, { installId, domain }: { installId: string; domain: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/domains`, 'POST', { name: domain }) as any;
          auditDirectOperation(services, {
            operation: 'wpe.domain.create', target: installId,
            parameters: { installId, domain, createdDomainId: data?.id }, outcome: 'success',
          });
          return { success: true, domainId: data?.id, name: data?.name };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.domain.create', target: installId,
            parameters: { installId, domain }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeDomainRemove: async (_parent: ResolverParent, { installId, domainId, confirm }: { installId: string; domainId: string; confirm?: boolean }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          if (!confirm) return { success: false, error: 'Pass --confirm to remove this domain' };
          await services.localServices.capiDirect(`/installs/${installId}/domains/${domainId}`, 'DELETE');
          auditDirectOperation(services, {
            operation: 'wpe.domain.delete', target: installId,
            parameters: { installId, domainId }, outcome: 'success',
          });
          return { success: true, message: `Domain ${domainId} removed from install ${installId}` };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.domain.delete', target: installId,
            parameters: { installId, domainId }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeDomainCheck: async (_parent: ResolverParent, { installId, domainId }: { installId: string; domainId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/domains/${domainId}/check_status`, 'POST', {}) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSslCertificates: async (_parent: ResolverParent, { installId }: { installId: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect(`/installs/${installId}/ssl_certificates`) as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSslRequest: async (_parent: ResolverParent, { installId, domainIds }: { installId: string; domainIds: string[] }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          await services.localServices.capiDirect(`/installs/${installId}/ssl_certificates`, 'POST', { domain_ids: domainIds });
          auditDirectOperation(services, {
            operation: 'wpe.ssl.request', target: installId,
            parameters: { installId, domainIds }, outcome: 'success',
          });
          return { success: true, message: 'SSL certificate provisioning requested' };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.ssl.request', target: installId,
            parameters: { installId, domainIds }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeSshKeys: async () => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const data = await services.localServices.capiDirect('/ssh_keys') as any;
          return { success: true, data: JSON.stringify(data) };
        } catch (err: any) { return { success: false, error: err.message }; }
      },

      nexusWpeSshKeyAdd: async (_parent: ResolverParent, { label, publicKey }: { label: string; publicKey: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          // Swagger: only accepts public_key, no label field
          const data = await services.localServices.capiDirect('/ssh_keys', 'POST', { public_key: publicKey }) as any;
          // publicKey lands under a `key`-shaped name, so it is redacted by
          // OperationAuditLog before it reaches disk.
          auditDirectOperation(services, {
            operation: 'wpe.sshkey.create', target: label ?? String(data?.id ?? 'unknown'),
            parameters: { label, publicKey, createdKeyId: data?.id }, outcome: 'success',
          });
          return { success: true, keyId: data?.id, label: data?.label };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.sshkey.create', target: label ?? 'unknown',
            parameters: { label, publicKey }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeSshKeyRemove: async (_parent: ResolverParent, { sshKeyId, confirm }: { sshKeyId: string; confirm?: boolean }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          if (!confirm) return { success: false, error: 'Pass --confirm to remove this SSH key' };
          await services.localServices.capiDirect(`/ssh_keys/${sshKeyId}`, 'DELETE');
          auditDirectOperation(services, {
            operation: 'wpe.sshkey.delete', target: sshKeyId,
            parameters: { sshKeyId }, outcome: 'success',
          });
          return { success: true, message: `SSH key ${sshKeyId} removed` };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.sshkey.delete', target: sshKeyId,
            parameters: { sshKeyId }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpePromote: async (_parent: ResolverParent, { sourceInstallId, destInstallId, includeDatabase, confirm }: { sourceInstallId: string; destInstallId: string; includeDatabase?: boolean; confirm?: boolean }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const [src, dst] = await Promise.all([
            services.localServices.capiDirect(`/installs/${sourceInstallId}`) as Promise<any>,
            services.localServices.capiDirect(`/installs/${destInstallId}`) as Promise<any>,
          ]);
          if (!confirm) {
            return {
              success: true,
              requiresConfirmation: true,
              message: `This will overwrite "${(dst as any)?.name}" (${(dst as any)?.environment}) with content from "${(src as any)?.name}" (${(src as any)?.environment}). Pass --confirm to proceed.`,
            };
          }
          await services.localServices.capiDirect('/install_copy', 'POST', {
            source_environment_id: (src as any)?.id ?? sourceInstallId,
            destination_environment_id: (dst as any)?.id ?? destInstallId,
            custom_options: { include_files: true, include_db: includeDatabase !== false },
          });
          // install_copy OVERWRITES the destination environment.
          auditDirectOperation(services, {
            operation: 'wpe.install.copy', target: (dst as any)?.name ?? destInstallId,
            parameters: {
              sourceInstallId, destInstallId, includeDatabase: includeDatabase !== false,
              sourceName: (src as any)?.name, destName: (dst as any)?.name,
              destEnvironment: (dst as any)?.environment,
            },
            outcome: 'success',
          });
          return { success: true, message: `Promotion started from ${sourceInstallId} to ${destInstallId}` };
        } catch (err: any) {
          auditDirectOperation(services, {
            operation: 'wpe.install.copy', target: destInstallId,
            parameters: { sourceInstallId, destInstallId, includeDatabase }, outcome: 'failure', error: err.message,
          });
          return { success: false, error: err.message };
        }
      },

      nexusWpeDiagnose: async (_parent: ResolverParent, { installId }: { installId: string }) => {
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

      nexusWpeGoLiveCheck: async (_parent: ResolverParent, { installId, domain }: { installId: string; domain: string }) => {
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

      nexusWpeFleetHealth: async (_parent: ResolverParent, { accountId }: { accountId?: string }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const installs = await services.localServices!.capiGetInstalls() as any[];
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

      nexusWpePortfolioOverview: async (_parent: ResolverParent, { monthOffset = 0 }: { monthOffset?: number }) => {
        try {
          if (!services.localServices) return { success: false, error: 'Local services not available' };
          const { firstDate, lastDate } = buildDateRange(monthOffset);
          const [accounts, installs] = await Promise.all([
            services.localServices!.capiGetAccounts() as Promise<any[]>,
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

      // ======================================================================
      // Phase 3: Operation Audit Log Resolvers
      // ======================================================================

      nexusResolveTarget: (_parent: ResolverParent, { name }: { name: string }) => {
        const matches: any[] = [];
        const nameLower = name.toLowerCase();

        // 1. Check local sites
        if (services.siteData) {
          const allSites = Object.values(services.siteData.getSites()) as any[];
          const localMatch = allSites.find(
            (s) => s.name?.toLowerCase() === nameLower || s.id === name,
          );
          if (localMatch) {
            const status = services.localServices?.getSiteStatus?.(localMatch.id) ?? 'unknown';
            matches.push({
              target: `${localMatch.name}@local`,
              label: `${localMatch.name} (local)`,
              type: 'local',
              status,
              lastSyncAt: null,
              isLive: status === 'running',
            });
          }
        }

        // 2. Check WPE installs in graph DB
        const db = services.graphService?.getDb?.();
        if (db) {
          try {
            const rows = db.prepare(
              "SELECT name, remote_install_id, account_id, last_sync_at FROM sites WHERE source='wpe' AND (LOWER(name)=? OR remote_install_id=?) AND is_active=1 LIMIT 5"
            ).all(nameLower, name) as any[];

            for (const row of rows) {
              // Build account name from wpe_accounts table
              const accountRow = row.account_id
                ? (db.prepare('SELECT name FROM wpe_accounts WHERE id=?').get(row.account_id) as any)
                : null;
              const accountName = accountRow?.name ?? row.account_id ?? 'unknown';
              // Infer environment from install name convention (stg/dev suffix = staging/dev)
              const env = /stg$|staging$/.test(row.name) ? 'staging'
                : /dev$|development$/.test(row.name) ? 'development'
                : 'production';
              const target = `wpe:${accountName}/${row.name}@${env}`;
              const lastSyncAt = row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null;

              matches.push({
                target,
                label: `${row.name} (WPE ${env}, ${accountName})`,
                type: 'wpe',
                status: 'active',
                lastSyncAt,
                isLive: false,
              });
            }
          } catch { /* graph may not be ready */ }
        }

        // 3. Check external SSH hosts in graph DB
        if (db) {
          try {
            const extRows = db.prepare(
              "SELECT name, environment, ssh_last_sync_at FROM sites WHERE source='external' AND LOWER(name)=? AND is_active=1 LIMIT 5"
            ).all(nameLower) as any[];

            for (const row of extRows) {
              const env = row.environment ?? 'production';
              const lastSyncAt = row.ssh_last_sync_at ? new Date(row.ssh_last_sync_at).toISOString() : null;

              matches.push({
                target: `ssh:${row.name}@${env}`,
                label: `${row.name} (SSH, ${env})`,
                type: 'external',
                status: 'active',
                lastSyncAt,
                isLive: false,
              });
            }
          } catch { /* graph may not be ready */ }
        }

        // Detect linked pair: same name appears in local and either remote source
        const hasLocal = matches.some((m) => m.type === 'local');
        const hasWpe = matches.some((m) => m.type === 'wpe');
        const hasExternal = matches.some((m) => m.type === 'external');
        const isLinked = hasLocal && (hasWpe || hasExternal);

        return { name, matches, isLinked };
      },

      nexusGatewayUsage: (
        _parent: ResolverParent,
        { month, siteId }: { month?: string; siteId?: string },
      ) => {
        try {
          const USAGE_KEY = 'nexus_ai_gateway_usage';
          const allRecords = (services.registryStorage?.get(USAGE_KEY) ?? []) as any[];

          const targetMonth = month ?? new Date().toISOString().slice(0, 7); // YYYY-MM
          const [year, mon] = targetMonth.split('-').map(Number);
          const start = new Date(year, mon - 1, 1).getTime();
          const end = new Date(year, mon, 1).getTime();

          let records = allRecords.filter((r: any) => r.timestamp >= start && r.timestamp < end);
          if (siteId) records = records.filter((r: any) => r.siteId === siteId);

          // Aggregate by site
          const siteMap = new Map<string, { siteName: string; cost: number; requests: number; tokens: number }>();
          const modelMap = new Map<string, { cost: number; requests: number; tokens: number }>();

          for (const r of records) {
            const sid = r.siteId ?? 'unknown';
            const site = services.siteData?.getSite(sid);
            const name = site?.name ?? r.siteName ?? sid;
            // Group by resolved name so the same site under multiple IDs is consolidated
            if (!siteMap.has(name)) siteMap.set(name, { siteName: name, cost: 0, requests: 0, tokens: 0 });
            const s = siteMap.get(name)!;
            s.cost += r.costUsd ?? 0;
            s.requests++;
            s.tokens += r.totalTokens ?? 0;

            const model = r.model ?? 'unknown';
            if (!modelMap.has(model)) modelMap.set(model, { cost: 0, requests: 0, tokens: 0 });
            const m = modelMap.get(model)!;
            m.cost += r.costUsd ?? 0;
            m.requests++;
            m.tokens += r.totalTokens ?? 0;
          }

          const bySite = [...siteMap.entries()]
            .map(([name, v]) => ({ siteId: name, siteName: v.siteName, totalCost: v.cost, totalRequests: v.requests, totalTokens: v.tokens }))
            .sort((a, b) => b.totalCost - a.totalCost);

          const byModel = [...modelMap.entries()]
            .map(([model, v]) => ({ model, totalCost: v.cost, totalRequests: v.requests, totalTokens: v.tokens }))
            .sort((a, b) => b.totalCost - a.totalCost);

          return {
            success: true,
            month: targetMonth,
            totalCost: records.reduce((s: number, r: any) => s + (r.costUsd ?? 0), 0),
            totalRequests: records.length,
            totalTokens: records.reduce((s: number, r: any) => s + (r.totalTokens ?? 0), 0),
            bySite,
            byModel,
          };
        } catch (err: any) {
          return { success: false, error: err.message, month: month ?? '', totalCost: 0, totalRequests: 0, totalTokens: 0, bySite: [], byModel: [] };
        }
      },

      nexusOperationAuditList: async (
        _parent: ResolverParent,
        { limit, operation }: { limit?: number; operation?: string },
      ) => {
        try {
          const { OperationAuditLog, defaultAuditLogPath } = require('../audit/OperationAuditLog');
          const auditLog = new OperationAuditLog(defaultAuditLogPath());
          const entries = auditLog.list(limit, operation ? { operation } : undefined);
          return {
            success: true,
            entries: entries.map((e: any) => ({
              ...e,
              parameters: JSON.stringify(e.parameters),
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message, entries: [] };
        }
      },

      nexusOperationAuditExport: async (
        _parent: ResolverParent,
        { outputPath }: { outputPath: string },
      ) => {
        try {
          const { OperationAuditLog, defaultAuditLogPath } = require('../audit/OperationAuditLog');
          const auditLog = new OperationAuditLog(defaultAuditLogPath());
          auditLog.export(outputPath);
          return { success: true, outputPath };
        } catch (err: any) {
          return { success: false, error: err.message, outputPath: null };
        }
      },

      // ======================================================================
      // B2: Site Users — graph DB read for M4-14 user security audit
      // ======================================================================

      nexusSiteUsers: (_parent: ResolverParent, { siteId }: { siteId: string }) => {
        try {
          const db = services.graphService?.getDb?.();
          if (!db) return { success: false, error: 'Graph DB not available', users: [], siteId };
          const rows = db.prepare(
            'SELECT user_id, username, email, roles FROM users WHERE site_id = ?'
          ).all(siteId) as Array<{ user_id: number; username: string; email: string; roles: string | null }>;
          return {
            success: true,
            siteId,
            users: rows.map(r => ({
              userId: r.user_id,
              username: r.username,
              email: r.email,
              roles: (() => { try { return JSON.parse(r.roles ?? '[]'); } catch { return []; } })(),
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message, users: [], siteId };
        }
      },

      // ======================================================================
      // B3: Plugin Diff — cross-env plugin version comparison (enables M5-04)
      // ======================================================================

      nexusPluginDiff: async (_parent: ResolverParent, { installA, installB }: { installA: string; installB: string }) => {
        const empty = { installA, installB, onlyInA: [], onlyInB: [], versionMismatches: [] };
        try {
          const db = services.graphService?.getDb?.();
          if (!db) return { ...empty, success: false, error: 'Graph DB not available' };

          const getPlugins = (siteId: string) => {
            const rows = db.prepare(
              'SELECT slug, version, is_active FROM plugins WHERE site_id = ?'
            ).all(siteId) as Array<{ slug: string; version: string | null; is_active: number }>;
            return rows.map(r => ({
              slug:    r.slug,
              version: r.version ?? '',
              status:  r.is_active ? 'active' : 'inactive',
            }));
          };

          const { computePluginDiff } = await import('../fleet/plugin-diff');
          const diff = computePluginDiff(getPlugins(installA), getPlugins(installB));

          return {
            ...empty,
            success:          true,
            onlyInA:          diff.onlyInA.map(p => ({ slug: p.slug, versionA: p.version, versionB: null, statusA: p.status, statusB: null })),
            onlyInB:          diff.onlyInB.map(p => ({ slug: p.slug, versionA: null, versionB: p.version, statusA: null, statusB: p.status })),
            versionMismatches: diff.versionMismatches.map(m => ({
              slug:     m.slug,
              versionA: m.versionA,
              versionB: m.versionB,
              statusA:  m.statusA,
              statusB:  m.statusB,
            })),
          };
        } catch (err: any) {
          return { ...empty, success: false, error: err.message };
        }
      },

      // ======================================================================
      // Agent Platform — agentRun (Task 10)
      // ======================================================================

      agentRun: async (_parent: ResolverParent, { name }: { name: string }, _ctx: any) => {
        const registry = services.agentRegistry;
        const runner   = services.agentRunner;
        if (!registry || !runner) {
          throw new Error('Agent runtime not initialised — ensure AgentRegistry and AgentRunner are wired into NexusServices');
        }
        const agent = registry.get(name);
        if (!agent) throw new Error(`Agent "${name}" not found`);
        const result = await runner.run(agent);
        return {
          agentName:  result.agentName,
          status:     result.status,
          error:      result.error ?? null,
          durationMs: result.finishedAt - result.startedAt,
        };
      },

      // ======================================================================
      // Agent Platform — agentEmit (Task 10)
      // ======================================================================

      agentEmit: async (
        _parent: ResolverParent,
        { event, siteId, payload }: { event: string; siteId?: string; payload?: string },
        _ctx: any,
      ) => {
        const bus = services.agentEventBus;
        if (!bus) {
          throw new Error('AgentEventBus not initialised — ensure agent platform is wired into NexusServices');
        }
        const colonIdx = event.indexOf(':');
        if (colonIdx <= 0 || colonIdx === event.length - 1) {
          throw new Error(`Invalid event format "${event}" — expected "namespace:type"`);
        }
        const namespace = event.slice(0, colonIdx);
        const type      = event.slice(colonIdx + 1);
        bus.publish({
          namespace,
          type,
          key:       event,
          siteId:    siteId ?? undefined,
          payload:   payload ? (() => { try { return JSON.parse(payload); } catch { throw new Error(`agentEmit: payload is not valid JSON`); } })() : {},
          createdAt: Date.now(),
        });
        return true;
      },

      // ======================================================================
      // Agent Platform — agentReload (Task 8)
      // ======================================================================

      agentReload: async (_: unknown, __: unknown, _ctx: unknown): Promise<boolean> => {
        if (services.agentReload) {
          await services.agentReload();
        }
        return true;
      },

      // ======================================================================
      // Agent SDK — Contributed Tools
      // ======================================================================

      nexusInvokeAgentTool: async (
        _parent: ResolverParent,
        { agentName, toolName, args }: { agentName: string; toolName: string; args?: string },
      ) => {
        const disp = services.dispatcher;
        const reg = services.contributedRegistry;
        if (!disp || !reg) {
          return { success: false, error: 'Agent dispatcher not available', report: null };
        }
        // Security: tier-3 tools cannot be invoked via GraphQL — the GraphQL path
        // has no confirmation token flow (that only exists in MCP).
        const registered = reg.get(agentName, toolName);
        if (!registered) return { success: false, error: `Tool ${agentName}/${toolName} not found`, report: null };
        if (registered && registered.permissionTier >= 3) {
          return {
            success: false,
            error: 'Tier-3 tools cannot be invoked via GraphQL — use the MCP interface with confirmation token flow.',
            report: null,
          };
        }
        try {
          const parsedArgs: unknown = args ? JSON.parse(args) : {};
          const result = await disp.dispatch(agentName, toolName, parsedArgs);
          const text = result.content[0]?.text ?? '';
          return { success: !result.isError, error: result.isError ? text : null, report: text };
        } catch (err: any) {
          return { success: false, error: err.message, report: null };
        }
      },

      nexusHostProbe: async (_p: ResolverParent, { alias, path }: { alias: string; path?: string }) => {
        return withQueue(async () => {
          try {
            const report = await probeExternalHost(alias, { wpPath: path ?? undefined });
            return { success: true, error: null, report: toHostReport(report) };
          } catch (e: any) {
            return { success: false, error: e?.message ?? String(e), report: null };
          }
        });
      },

      nexusHostAdd: async (
        _p: ResolverParent,
        { alias, path, environment }: { alias: string; path?: string; environment?: string },
      ) => {
        return withQueue(async () => {
          try {
            if (environment !== undefined && environment !== null
              && !['production', 'staging', 'development'].includes(environment)) {
              return {
                success: false, registered: false, report: null, environment: null,
                error: `Invalid environment '${environment}'. Expected production, staging or development.`,
              };
            }
            const storage = (services as any).registryStorage;
            if (!storage) {
              return {
                success: false, registered: false, report: null, environment: null,
                error: 'Storage not available',
              };
            }

            // No --env means "unspecified", not "production". Re-running
            // `nexus host add <alias>` to refresh a discovered path is the
            // idempotency this command advertises; defaulting to production
            // there would silently relabel a staging host — and the label is
            // the write gate. Only a genuinely new host falls back to
            // production, which is the most restrictive default.
            const existing = getExternalProfile(storage, alias);
            const validEnv = (environment ?? existing?.environment ?? 'production') as
              'production' | 'staging' | 'development';

            const report = await probeExternalHost(alias, { wpPath: path ?? undefined });

            // Refuse on any probe failure: a typo must not litter the fleet with
            // hosts that were never reachable.
            if (!report.ok) {
              return {
                success: true, registered: false, report: toHostReport(report),
                environment: validEnv, error: null,
              };
            }

            const now = Date.now();
            // 'registration': this is the deliberate path, so the label it
            // computed wins over whatever a previous lazy sighting stored.
            upsertExternalProfile(storage, {
              alias,
              wpPath: report.wpPath,
              wpCliPath: report.wpCliPath,
              environment: validEnv,
              firstSeenAt: now,
              lastSeenAt: now,
            }, 'registration');

            let domain = alias;
            if (report.siteUrl) {
              try { domain = new URL(report.siteUrl).hostname || alias; } catch { /* keep alias */ }
            }

            await (services as any).graphService?.upsertSite({
              id: externalSiteId(alias),
              name: alias,
              domain,
              source: 'external',
              host: 'external',
              environment: validEnv,
              wp_version: report.wpVersion,
              is_active: true,
              created_at: now,
              updated_at: now,
              last_sync_at: now,
            });

            // `environment` is returned so the CLI can print what was actually
            // used rather than echoing a flag the user may not have passed.
            return {
              success: true, registered: true, report: toHostReport(report),
              environment: validEnv, error: null,
            };
          } catch (e: any) {
            return {
              success: false, registered: false, report: null, environment: null,
              error: e?.message ?? String(e),
            };
          }
        });
      },

      nexusHostList: async () => {
        try {
          const storage = (services as any).registryStorage;
          if (!storage) return { success: false, error: 'Storage not available', hosts: [] };
          return { success: true, error: null, hosts: listExternalProfiles(storage) };
        } catch (e: any) {
          return { success: false, error: e?.message ?? String(e), hosts: [] };
        }
      },

      nexusHostRemove: async (_p: ResolverParent, { alias }: { alias: string }) => {
        return withQueue(async () => {
          try {
            const storage = (services as any).registryStorage;
            if (!storage) return { success: false, error: 'Storage not available', removed: false };

            const profile = getExternalProfile(storage, alias);
            const removed = removeExternalProfile(storage, alias);

            // Deactivate rather than delete: GraphService has no per-site delete,
            // and its retention sweep already hard-deletes inactive sites and
            // their content once they age out. A later re-add revives the row.
            if (removed && profile) {
              const now = Date.now();
              await (services as any).graphService?.upsertSite({
                id: externalSiteId(alias),
                name: alias,
                domain: alias,
                source: 'external',
                host: 'external',
                environment: profile.environment,
                is_active: false,
                created_at: profile.firstSeenAt,
                updated_at: now,
              });
            }

            return { success: true, error: null, removed };
          } catch (e: any) {
            return { success: false, error: e?.message ?? String(e), removed: false };
          }
        });
      },

      // This is read-only from the remote host's perspective — every WP-CLI
      // command collectExternalHostData issues is a read. The only mutation
      // is the local graph write, which writeExternalHostData already owns.
      // Not audited, same reasoning as nexusWpPluginList: nothing here can
      // mutate the remote host.
      nexusHostRefresh: async (_parent: ResolverParent, { alias }: { alias: string }) => {
        try {
          const db = services.graphService?.getDb?.();
          const row = db?.prepare(
            "SELECT id, name, environment FROM sites WHERE source='external' AND is_active=1 AND LOWER(name)=?"
          ).get(alias.toLowerCase()) as { id: string; name: string; environment: string | null } | undefined;
          if (!row) {
            return {
              success: false,
              error: `"${alias}" is not a registered external host. Run \`nexus host add ${alias}\` first.`,
              wpVersion: null, phpVersion: null, pluginCount: null, themeCount: null,
            };
          }

          const target = `ssh:${row.name}@${row.environment ?? 'production'}`;
          const transport = await resolveTransport({ ssh_target: target }, services, 'wpcli_read');
          if ('content' in transport) {
            const msg = (transport.content?.[0] as { text?: string } | undefined)?.text ?? 'Could not reach host';
            return {
              success: false, error: msg,
              wpVersion: null, phpVersion: null, pluginCount: null, themeCount: null,
            };
          }

          const data = await collectExternalHostData(transport as any, console);
          await writeExternalHostData(services.graphService as any, row.id, row.name, data, Date.now(), console);

          return {
            success: true, error: null,
            wpVersion: data.wpVersion ?? null,
            phpVersion: data.phpVersion ?? null,
            pluginCount: data.plugins?.length ?? null,
            themeCount: data.themes?.length ?? null,
          };
        } catch (e: any) {
          return {
            success: false, error: e?.message ?? String(e),
            wpVersion: null, phpVersion: null, pluginCount: null, themeCount: null,
          };
        }
      },

      // Same read-only-from-the-remote-host reasoning as nexusHostRefresh above:
      // `wp post list` is the only remote command this path issues. The only
      // mutation is local (graph `content` table, vector store, IndexRegistry),
      // so this is not audited, matching nexusHostRefresh and nexusWpPluginList.
      nexusHostIndex: async (_parent: ResolverParent, { alias }: { alias: string }) => {
        try {
          const db = services.graphService?.getDb?.();
          const row = db?.prepare(
            "SELECT id, name, environment FROM sites WHERE source='external' AND is_active=1 AND LOWER(name)=?"
          ).get(alias.toLowerCase()) as { id: string; name: string; environment: string | null } | undefined;
          if (!row) {
            return {
              success: false,
              error: `"${alias}" is not a registered external host. Run \`nexus host add ${alias}\` first.`,
              documentCount: null,
            };
          }

          const target = `ssh:${row.name}@${row.environment ?? 'production'}`;
          const transport = await resolveTransport({ ssh_target: target }, services, 'wpcli_read');
          if (transport && typeof transport === 'object' && 'content' in transport) {
            const msg = (transport.content?.[0] as { text?: string } | undefined)?.text ?? 'Could not reach host';
            return { success: false, error: msg, documentCount: null };
          }

          const indexService = new ExternalContentIndexService({
            graphService: services.graphService as any,
            embeddingService: services.embeddingService as any,
            vectorStore: services.vectorStore as any,
            indexRegistry: services.indexRegistry as any,
            logger: console,
          });
          const result = await indexService.indexOne(transport as any, row.id, row.name);

          // Stamp the same staleness column the scheduler reads, so a host
          // indexed by hand is not redundantly re-indexed on the next cycle.
          // The scheduler may never have run in this process (it is opt-in),
          // so the column is ensured here rather than assumed.
          try {
            if (ensureContentIndexedAtColumn(db, console)) {
              db!.prepare('UPDATE sites SET content_indexed_at = ? WHERE id = ?').run(Date.now(), row.id);
            }
          } catch { /* best-effort staleness stamp, matches the scheduler's tolerance */ }

          return { success: true, error: null, documentCount: result.documentCount };
        } catch (e: any) {
          return { success: false, error: e?.message ?? String(e), documentCount: null };
        }
      },
    },

    // =========================================================================
    // Agent Platform — Query resolvers (Task 10)
    // =========================================================================

    Query: {
      agentList: async (_parent: ResolverParent, _args: unknown, _ctx: any) => {
        const registry = services.agentRegistry;
        if (!registry) {
          throw new Error('AgentRegistry not initialised — ensure agent platform is wired into NexusServices');
        }
        return registry.list().map((def: any) => ({
          name:         def.name,
          version:      def.version,
          description:  def.description ?? null,
          triggerTypes: def.triggers.map((t: any) => t.type),
          status:       'registered',
        }));
      },

      agentLogs: async (
        _parent: ResolverParent,
        { name, lines }: { name: string; lines?: number },
        _ctx: any,
      ) => {
        const logPath = require('path').join(
          require('os').homedir(),
          'Library',
          'Application Support',
          'Local',
          'nexus-ai',
          'agents',
          name,
          'logs',
          'agent.log',
        );
        const fs = require('fs') as typeof import('fs');
        if (!fs.existsSync(logPath)) return [];
        const content = fs.readFileSync(logPath, 'utf-8');
        const allLines = content.split('\n').filter(Boolean);
        return allLines.slice(-(lines ?? 50));
      },

      agentReadme: (_: unknown, { agentName }: { agentName: string }): string | null => {
        const _path = require('path') as typeof import('path');
        const _fs   = require('fs')   as typeof import('fs');
        const _os   = require('os')   as typeof import('os');
        const readmePath = _path.join(
          _os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
          'agents', agentName, 'README.md',
        );
        try {
          return _fs.readFileSync(readmePath, 'utf-8');
        } catch {
          return null;
        }
      },

      agentStatus: (_: unknown, __: unknown, _ctx: unknown): AgentStatusType[] => {
        const registry = services.agentRegistry;
        const store = services.agentStateStore;
        if (!registry) return [];
        return registry.list().map(def => {
          const last = store?.getLastRun(def.name);
          const cronTrigger = def.triggers.find(t => t.type === 'cron') as import('../agent-sdk/types').CronTrigger | undefined;
          return {
            name: def.name,
            version: def.version,
            description: def.description ?? null,
            cronExpression: cronTrigger?.expression ?? null,
            lastRunAt: last ? last.startedAt : null,
            lastRunStatus: last ? last.status : null,
            lastRunDurationMs: last ? last.finishedAt - last.startedAt : null,
            lastRunError: last?.error ?? null,
            supportsFullRun: (def as any).supportsFullRun ?? false,
          };
        });
      },

      agentRunHistory: (_: unknown, args: { agentName: string; limit?: number }): unknown[] => {
        const store = services.agentStateStore;
        if (!store) return [];
        return store.getRunHistory(args.agentName, args.limit ?? 20);
      },

      nexusListAgentTools: async () => {
        const reg = services.contributedRegistry;
        if (!reg) return [];
        try {
          const grouped = reg.toolsByAgent();
          return Array.from(grouped.entries()).map(([agentName, tools]) => ({
            agentName,
            tools: tools.map(t => ({
              toolName: t.toolName,
              description: t.description,
              executionMode: t.executionMode,
              permissionTier: t.permissionTier,
              inputSchema: JSON.stringify(t.inputSchema),
            })),
          }));
        } catch (err: any) {
          console.error('[nexusListAgentTools] error:', err?.message);
          return [];
        }
      },
    },
  };
}
