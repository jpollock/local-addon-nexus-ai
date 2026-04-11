/**
 * IPC Handlers
 *
 * All Electron IPC handlers for the Nexus AI addon, extracted from index.ts
 * to keep the main entry point focused on initialization.
 */
import { IPC_CHANNELS, STORAGE_KEYS, EXCLUDED_POST_TYPES } from '../common/constants';
import type { NexusSettings } from '../common/types';
import type { IndexRegistry, RegistryStorage } from './content/IndexRegistry';
import type { ContentPipeline } from './content/ContentPipeline';
import type { EmbeddingService } from './embeddings/EmbeddingService';
import type { VectorStore } from './vector-store/VectorStore';
import type { McpServer } from './mcp/McpServer';
import type { LocalServicesBridge } from './mcp/local-services-bridge';
import type { GraphService } from './events/GraphService';
import type { EventProcessor } from './events/EventProcessor';
import { setupSiteForAI } from './mcp/modules/wp-connector/setup-ai';
import { scanDatabase } from './mcp/modules/db-scanner/db-scanner';
import { switchProviderForSite } from './mcp/modules/wp-connector/switch-provider';
import { generateEventSummary } from './events/event-summary';
import type { EventTimelineEntry, EventStats } from '../common/types';
import { SearchService } from './search/SearchService';
import { HealthScoreCalculator } from './health/HealthScoreCalculator';
import { FilterEngine } from './search/FilterEngine';
import { QueryStorage } from './search/QueryStorage';
import { BulkOperationManager } from './bulk/BulkOperationManager';
// GroupStorage no longer used — groups come from Local's native siteData
import { HealthTrendTracker } from './health/HealthTrendTracker';
import { WPESyncService } from './events/WPESyncService';
import { WpeAutoPullService } from './wpe-auto-pull';
import { SiteMetadataCache } from './metadata/SiteMetadataCache';
import { AIContextGenerator } from './ai-context/AIContextGenerator';
import type { AIContextData } from './ai-context/AIContextGenerator';
import { AuditLogger, AUDITED_OPERATIONS } from './audit/AuditLogger';
import {
  validateInput,
  SiteIdSchema,
  UpdateSettingsSchema,
  IndexSiteSchema,
  SearchUnifiedSchema,
  BulkOperationRequestSchema,
  BulkOperationIdSchema,
  FleetOperationOptionsSchema,
  WpeRemoveSiteSchema,
  WpePullToLocalSchema,
  WpeSyncSingleSchema,
  WpeSyncAllSchema,
  WpeInstallIdSchema,
  HealthGetScoreSchema,
  HealthGetTrendSchema,
  HealthGetFleetTrendSchema,
  QuerySchema,
  QueryUpdateSchema,
  QueryIdSchema,
  AIGatewayUsageOptionsSchema,
  AIGatewayCostOptionsSchema,
  AIGatewayRateLimitSchema,
  EventTimelineOptionsSchema,
  StorageCleanupOptionsSchema,
  FilterIdSchema,
  GroupIdSchema,
  GroupCreateSchema,
  GroupUpdateSchema,
  GroupAddRemoveSiteSchema,
  SidebarFilterSchema,
  SidebarBulkActionSchema,
  SearchContentSchema,
  SiteFinderAIParseSchema,
  SiteFinderFiltersSchema,
} from '../common/schemas';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcMain } = require('electron');

/**
 * Safe IPC handler registration - removes existing handler first to prevent
 * "Attempted to register a second handler" errors during hot-reload
 */
function safeHandle(channel: string, handler: (...args: any[]) => any): void {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    // Handler didn't exist, that's fine
  }
  ipcMain.handle(channel, handler);
}

const DEFAULT_SETTINGS: NexusSettings = {
  autoIndex: true,
  excludedSiteIds: [],
};

export interface IpcHandlerDeps {
  siteData: any;
  localServicesBridge: LocalServicesBridge;
  indexRegistry: IndexRegistry;
  embeddingService: EmbeddingService;
  contentPipeline: ContentPipeline;
  vectorStore: VectorStore;
  registryStorage: RegistryStorage;
  localLogger: any;
  getMcpServer: () => McpServer | null;
  graphService: GraphService;
  eventProcessor: EventProcessor;
  vectorDbPath: string;
  /** Raw service container for accessing Local services directly */
  serviceContainer?: any;
  /** NexusServices object — mutated to add Sprint 2/3 services after creation */
  nexusServices?: any;
  /** WPE site sync service (Phase 1) */
  wpeSyncService?: WPESyncService;
  /** Site metadata cache (Digital Twin) */
  metadataCache?: SiteMetadataCache;
}

/**
 * Wait for database to be ready by polling with a simple WP-CLI command.
 * Required after starting sites - web server starts quickly but DB takes longer.
 */
async function waitForDatabaseReady(
  siteId: string,
  localServices: LocalServicesBridge,
  logger: any,
  timeoutMs: number = 30000,
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 1000; // Check every 1 second

  logger.info(`[NexusAI] Waiting for database to be ready for site ${siteId}...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Simple DB-dependent command to test readiness
      const result = await localServices.wpCliRun(siteId, [
        'eval',
        "echo 'ready';",
      ]);

      if (result.success && result.stdout?.trim() === 'ready') {
        logger.info(`[NexusAI] Database ready for site ${siteId} after ${Date.now() - startTime}ms`);
        return; // Database is ready!
      }
    } catch {
      // Database not ready yet, continue polling
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Database did not become ready within ${timeoutMs}ms`);
}

/**
 * Helper function to ensure a site is running before executing an operation.
 * Auto-starts the site if needed, executes the work function, then auto-stops if we started it.
 *
 * Safety: stopSite() is wrapped in try-catch because Local's database dump can fail and
 * leave the site in a broken state. If stop fails, we log the error but don't crash.
 *
 * @param siteId - The site ID to ensure is running
 * @param localServices - LocalServicesBridge instance
 * @param logger - Logger instance
 * @param work - Async function to execute while site is running
 * @returns Result of the work function
 */
async function withSiteRunning<T>(
  siteId: string,
  localServices: LocalServicesBridge,
  logger: any,
  work: () => Promise<T>,
): Promise<T> {
  let wasAutoStarted = false;

  try {
    // Check if site is running
    const statuses = localServices.getAllSiteStatuses();
    const wasRunning = statuses[siteId] === 'running';

    // Auto-start if not running
    if (!wasRunning) {
      logger.info(`[NexusAI] Site ${siteId} not running - auto-starting for operation`);
      await localServices.startSite(siteId);
      wasAutoStarted = true;

      // Wait for database to be ready
      await waitForDatabaseReady(siteId, localServices, logger, 30000);
    }

    // Execute work
    const result = await work();

    // Auto-stop if we started it
    if (wasAutoStarted) {
      logger.info(`[NexusAI] Operation complete - auto-stopping site ${siteId}`);

      // Add small delay to let site settle after operation (prevents database dump errors)
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        await localServices.stopSite(siteId);
        logger.info(`[NexusAI] Site ${siteId} stopped successfully`);
      } catch (stopErr) {
        // stopSite() can fail if Local's database dump fails. Don't crash the operation,
        // just warn the user. The site will remain running, which is safer than a broken state.
        logger.error(`[NexusAI] Failed to auto-stop site ${siteId}: ${(stopErr as Error).message}`);
        logger.error(`[NexusAI] Site ${siteId} remains running. You may need to stop it manually from Local's UI.`);
      }
    }

    return result;
  } catch (err) {
    // Auto-stop if we started it (even on error)
    if (wasAutoStarted) {
      try {
        logger.info(`[NexusAI] Operation failed - attempting to auto-stop site ${siteId}`);

        // Add small delay before stopping
        await new Promise(resolve => setTimeout(resolve, 1000));

        await localServices.stopSite(siteId);
        logger.info(`[NexusAI] Site ${siteId} stopped after operation failure`);
      } catch (stopErr) {
        // Non-fatal - log error but don't mask the original error
        logger.error(`[NexusAI] Failed to auto-stop site ${siteId} after error: ${(stopErr as Error).message}`);
        logger.error(`[NexusAI] Site ${siteId} remains running. You may need to stop it manually from Local's UI.`);
      }
    }
    throw err;
  }
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  console.log('[NexusAI] 🟢🟢🟢 registerIpcHandlers() CALLED - starting execution');

  // Clean up any existing handlers from previous loads (hot-reload scenario)
  const handlersToRemove = [
    'nexus-ai:wpe:get-site-details',
    'nexus-ai:wpe:sync-single-site',
    'capi:get-accounts',
  ];
  handlersToRemove.forEach(channel => {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler didn't exist, that's fine
    }
  });
  console.log('[NexusAI] 🟢 Cleaned up existing handlers');

  const {
    siteData, localServicesBridge, indexRegistry, embeddingService,
    contentPipeline, vectorStore, registryStorage, localLogger, getMcpServer,
    graphService, eventProcessor, vectorDbPath, serviceContainer, metadataCache,
  } = deps;
  console.log('[NexusAI] 🟢 registerIpcHandlers() - deps destructured successfully');

  // Initialize audit logger for tracking remote operations
  const auditLogger = new AuditLogger(registryStorage);

  /**
   * Notify Local's main UI to refresh site groups after a mutation.
   * moveSitesToGroup([], groupId, refetchGroups=true) is the documented way
   * to trigger Local's sidebar refresh. We call it as a no-op to fire the event.
   */
  function notifyGroupsChanged(): void {
    try {
      const org = serviceContainer?.sitesOrganization;
      if (!org?.moveSitesToGroup) return;
      const groups = org.getSiteGroups?.() ?? [];
      const defaultGroup = groups.find((g: any) => g.name === 'Sites') ?? groups[0];
      if (defaultGroup) {
        org.moveSitesToGroup([], defaultGroup.id, true);
      }
    } catch { /* best-effort */ }
  }

  safeHandle(IPC_CHANNELS.GET_MCP_INFO, () => {
    return getMcpServer()?.getConnectionInfo() ?? null;
  });

  safeHandle(IPC_CHANNELS.GET_FLEET_STATUS, () => {
    return indexRegistry.listAll();
  });

  safeHandle(IPC_CHANNELS.GET_SITES, async () => {
    try {
      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();
      const indexed = indexRegistry.listAll();
      const indexedIds = new Set(indexed.map((e: any) => e.siteId));

      // Fetch WP versions from graph for all local sites
      const wpVersionsMap = new Map<string, string>();
      const db = graphService.getDb();
      if (db) {
        const rows = db.prepare('SELECT id, wp_version FROM sites WHERE source = ? OR source IS NULL').all('local') as Array<{ id: string; wp_version: string | null }>;
        rows.forEach(row => {
          if (row.wp_version) {
            wpVersionsMap.set(row.id, row.wp_version);
          }
        });
      }

      return Object.values(allSites).map((site: any) => {
        const connections = site.hostConnections;
        const connList = connections
          ? (Array.isArray(connections) ? connections : Object.values(connections))
          : [];
        const wpeConn = (connList as any[]).find((c: any) => c.hostId === 'wpe');

        return {
          id: site.id,
          name: site.name,
          domain: site.domain || '',
          port: site.ports?.site?.[0] || site.services?.nginx?.ports?.site?.[0] || null,
          status: statuses[site.id] || 'halted',
          isWpe: !!wpeConn,
          wpeEnvironment: wpeConn?.remoteSiteEnv?.environment || null,
          wpeInstallId: wpeConn?.installId || null,
          indexed: indexedIds.has(site.id),
          wpVersion: wpVersionsMap.get(site.id) || null,
          phpVersion: site.phpVersion || null,
          hostConnections: site.hostConnections,
        };
      });
    } catch (err) {
      localLogger.error('[NexusAI] get-sites failed:', (err as Error).message);
      return [];
    }
  });

  safeHandle(IPC_CHANNELS.GET_WPE_SITE_IDS, () => {
    try {
      const allSites = siteData.getSites();
      const siteIds: string[] = [];

      for (const site of Object.values(allSites) as any[]) {
        const connections = site.hostConnections;
        if (!connections) continue;
        const connList = Array.isArray(connections) ? connections : Object.values(connections);
        const hasWpe = (connList as any[]).some((c: any) => c.hostId === 'wpe');
        if (hasWpe) siteIds.push(site.id);
      }

      return { success: true, siteIds };
    } catch (err) {
      localLogger.error('[NexusAI] get-wpe-site-ids failed:', (err as Error).message);
      return { success: false, siteIds: [] };
    }
  });

  safeHandle(IPC_CHANNELS.GET_DASHBOARD_STATS, async () => {
    try {
      const allSites = siteData.getSites();
      const siteList = Object.values(allSites) as any[];
      const statuses = localServicesBridge.getAllSiteStatuses();

      // Local sites
      const totalSites = siteList.length;
      const runningSites = siteList.filter((s: any) => statuses[s.id] === 'running').length;

      // WPE-connected local sites
      let wpeConnectedSites = 0;
      const linkedRemoteIds = new Set<string>();
      for (const site of siteList) {
        const connections = site.hostConnections;
        if (!connections) continue;
        const connList = Array.isArray(connections) ? connections : Object.values(connections);
        const wpeConn = (connList as any[]).find((c: any) => c.hostId === 'wpe');
        if (wpeConn) {
          wpeConnectedSites++;
          if (wpeConn.remoteSiteId) linkedRemoteIds.add(wpeConn.remoteSiteId);
        }
      }

      // Remote WPE installs (not linked to a local site)
      let remoteInstalls = 0;
      let totalRemoteInstalls = 0;
      let capiAvailable = false;
      try {
        capiAvailable = localServicesBridge.isCAPIAvailable();
        if (capiAvailable) {
          const installs = await localServicesBridge.capiGetInstalls() as any[];
          totalRemoteInstalls = installs?.length ?? 0;
          const linkedCount = installs
            ? installs.filter((i: any) => linkedRemoteIds.has(i.site?.id)).length
            : 0;
          remoteInstalls = totalRemoteInstalls - linkedCount;
        }
      } catch {
        // CAPI may not be authenticated
      }

      // MCP server
      const mcpInfo = getMcpServer()?.getConnectionInfo() ?? null;

      // Embedding model
      const embeddingReady = embeddingService.isReady();

      // Index stats — local (index registry) + WPE (graph content table)
      const indexEntries = indexRegistry.listAll();
      const localIndexedSites = indexEntries.filter((e: any) => e.state === 'indexed').length;
      const totalDocs = indexEntries.reduce((sum: number, e: any) => sum + (e.documentCount || 0), 0);
      const totalChunks = indexEntries.reduce((sum: number, e: any) => sum + (e.chunkCount || 0), 0);
      const lastIndexed = indexEntries.reduce((max: number, e: any) => Math.max(max, e.lastIndexed || 0), 0);

      // WPE indexed sites — count distinct sites with content in graph DB
      let wpeIndexedSites = 0;
      let wpeIndexedDocs = 0;
      try {
        const db = graphService.getDb();
        if (db) {
          wpeIndexedSites = (db.prepare("SELECT COUNT(DISTINCT site_id) as c FROM content WHERE site_id LIKE 'wpe-%'").get() as { c: number }).c;
          wpeIndexedDocs = (db.prepare("SELECT COUNT(*) as c FROM content WHERE site_id LIKE 'wpe-%'").get() as { c: number }).c;
        }
      } catch { /* graph may not be ready */ }

      return {
        localSites: { total: totalSites, running: runningSites, halted: totalSites - runningSites },
        wpeConnected: { count: wpeConnectedSites },
        remoteSites: { total: totalRemoteInstalls, unlinked: remoteInstalls, capiAvailable },
        mcpServer: {
          running: !!mcpInfo,
          toolCount: mcpInfo?.tools?.length ?? 0,
          port: mcpInfo?.port ?? null,
          version: mcpInfo?.version ?? null,
        },
        embedding: {
          ready: embeddingReady,
          model: 'all-MiniLM-L6-v2',
          quantized: true,
          dimensions: 384,
          maxSequenceLength: 256,
        },
        index: {
          localIndexed: localIndexedSites,
          localTotal: totalSites,
          wpeIndexed: wpeIndexedSites,
          wpeTotal: totalRemoteInstalls,
          totalDocuments: totalDocs + wpeIndexedDocs,
          totalChunks: totalChunks,
          lastIndexed: lastIndexed || null,
        },
      };
    } catch (err) {
      localLogger.error('[NexusAI] get-dashboard-stats failed:', (err as Error).message);
      return null;
    }
  });

  safeHandle(IPC_CHANNELS.START_SITE, async (_event: any, siteId: string) => {
    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);
      await localServicesBridge.startSite(validated);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] start-site failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.STOP_SITE, async (_event: any, siteId: string) => {
    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);
      await localServicesBridge.stopSite(validated);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] stop-site failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.SEARCH, async (_event: any, query: string, siteId?: string, limit?: number) => {
    try {
      // Validate input
      const validated = validateInput(SearchContentSchema, { query, siteIds: siteId ? [siteId] : undefined, limit });
      const maxResults = validated.limit ?? 10;
      const [queryVector] = await embeddingService.embedBatch([validated.query]);
      const targetSiteId = validated.siteIds?.[0];

      if (targetSiteId) {
        const results = await vectorStore.search(targetSiteId, queryVector, { limit: maxResults });
        const site = siteData.getSite(targetSiteId);
        return {
          results: results.map((r: any) => ({ ...r, siteId: targetSiteId, siteName: site?.name ?? targetSiteId })),
        };
      }

      // Search all indexed sites, merge results
      const entries = indexRegistry.listAll().filter((e: any) => e.state === 'indexed');
      const allResults: any[] = [];
      for (const entry of entries) {
        const results = await vectorStore.search(entry.siteId, queryVector, { limit: maxResults });
        const site = siteData.getSite(entry.siteId);
        for (const r of results) {
          allResults.push({ ...r, siteId: entry.siteId, siteName: site?.name ?? entry.siteName });
        }
      }

      allResults.sort((a, b) => b.score - a.score);
      return { results: allResults.slice(0, maxResults) };
    } catch (err) {
      localLogger.error('[NexusAI] search failed:', (err as Error).message);
      return { results: [], error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.INDEX_SITE, async (_event: any, params: { siteId: string }) => {
    const startTime = Date.now();
    try {
      // Validate input
      const validated = validateInput(IndexSiteSchema, params);
      const siteId = validated.siteId;

      const site = siteData.getSite(siteId);
      if (!site) {
        auditLogger.logFailure(
          'index_site',
          siteId,
          'local_site',
          'Site not found',
          params,
          Date.now() - startTime,
        );
        return { success: false, error: `Site ${siteId} not found` };
      }

      const result = await contentPipeline.indexSite({
        siteId: site.id,
        siteName: site.name,
        sitePath: site.path,
      });

      // Audit log success
      auditLogger.logSuccess(
        'index_site',
        siteId,
        'local_site',
        { documentsIndexed: result.documentsIndexed, chunksIndexed: result.chunksIndexed },
        Date.now() - startTime,
      );

      return {
        success: true,
        documentsIndexed: result.documentsIndexed,
        chunksIndexed: result.chunksIndexed,
        durationMs: result.durationMs,
        errors: result.errors,
      };
    } catch (err) {
      localLogger.error('[NexusAI] index-site failed:', (err as Error).message);
      auditLogger.logFailure(
        'index_site',
        params?.siteId || 'unknown',
        'local_site',
        (err as Error).message,
        params,
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.GET_SETTINGS, () => {
    try {
      const raw = registryStorage.get(STORAGE_KEYS.SETTINGS) as any;
      if (!raw) return DEFAULT_SETTINGS;
      // Migrate pre-rename field names (chatProvider→aiProvider, chatModel→aiModel)
      if (raw.chatProvider !== undefined && raw.aiProvider === undefined) {
        raw.aiProvider = raw.chatProvider;
      }
      if (raw.chatModel !== undefined && raw.aiModel === undefined) {
        raw.aiModel = raw.chatModel;
      }
      delete raw.chatProvider;
      delete raw.chatModel;
      return raw;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  safeHandle(IPC_CHANNELS.UPDATE_SETTINGS, async (_event: any, partial: Partial<NexusSettings>) => {
    try {
      const validated = validateInput(UpdateSettingsSchema, partial);

      const raw = registryStorage.get(STORAGE_KEYS.SETTINGS) as any;
      const current: NexusSettings = raw ?? DEFAULT_SETTINGS;
      const updated = { ...current, ...validated };
      registryStorage.set(STORAGE_KEYS.SETTINGS, updated as any);

      // If provider or gateway toggle changed, immediately apply to all running gateway sites.
      const providerChanged = validated.aiProvider !== undefined && validated.aiProvider !== (current as any).aiProvider;
      const gatewayChanged  = validated.useLocalGateway !== undefined && validated.useLocalGateway !== (current as any).useLocalGateway;

      if ((providerChanged || gatewayChanged) && localServicesBridge) {
        const newProvider: string = (updated as any).aiProvider ?? 'anthropic';
        const useGateway: boolean = !!(updated as any).useLocalGateway;
        const siteConfigs = (registryStorage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
        const statuses = localServicesBridge.getAllSiteStatuses();

        for (const [siteId, status] of Object.entries(statuses)) {
          if (status !== 'running') continue;
          const cfg = siteConfigs[siteId];
          if (!cfg?.useLocalGateway) continue;  // Only gateway sites

          // Provider-only change: update MU plugin, no plugin swap
          if (providerChanged && !gatewayChanged) {
            try {
              const { generateMuPluginContent } = await import('./ai-gateway/mu-plugin-template');
              const path = await import('path');
              const fs = await import('fs');
              const webhookInfo = registryStorage.get('http_webhook_info') as any;
              const aiProxyInfo = registryStorage.get('ai_proxy_info') as any;
              if (webhookInfo?.url) {
                const site = localServicesBridge.resolveSiteObject(siteId) as any;
                const muPluginsDir = path.join(site.paths.webRoot, 'wp-content', 'mu-plugins');
                const content = generateMuPluginContent({
                  webhookUrl: webhookInfo.url,
                  webhookAuthToken: webhookInfo.authToken,
                  siteId,
                  aiGatewayUrl: aiProxyInfo?.url,
                  aiGatewayToken: aiProxyInfo?.authToken,
                  aiProvider: newProvider,
                });
                fs.writeFileSync(path.join(muPluginsDir, 'nexus-ai-connector-config.php'), content);
                siteConfigs[siteId] = { ...cfg, provider: newProvider };
                localLogger.info(`[NexusAI] Provider broadcast to "${site.name}": NEXUS_AI_PROVIDER=${newProvider}`);
              }
            } catch (err) {
              localLogger.error(`[NexusAI] Provider broadcast failed for ${siteId}:`, err);
            }
          }
        }

        // Persist updated site configs
        if (providerChanged && !gatewayChanged) {
          registryStorage.set(STORAGE_KEYS.SITE_AI_CONFIG, siteConfigs);
        }
      }

      return { ...updated, _providerChanged: providerChanged, _gatewayChanged: gatewayChanged };
    } catch (err) {
      localLogger.error('[NexusAI] update-settings failed:', (err as Error).message);
      return DEFAULT_SETTINGS;
    }
  });

  safeHandle(IPC_CHANNELS.GET_WP_VERSION, async (_event: any, siteId: string) => {
    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);

      let version: string | null = null;
      let fromCache = false;
      let metadataAge: string | null = null;

      // Digital Twin: Check cache first (instant)
      const cachedMetadata = metadataCache?.getWithAge(validated);
      if (cachedMetadata) {
        version = cachedMetadata.wpVersion;
        fromCache = true;
        metadataAge = metadataCache?.getAgeString(validated) ?? null;
      }

      // If cache is stale or doesn't exist, try live WP-CLI (slower)
      const statuses = localServicesBridge.getAllSiteStatuses();
      const siteStatus = statuses[validated] ?? 'unknown';

      if (siteStatus === 'running' && (!cachedMetadata || cachedMetadata.isStale)) {
        try {
          const liveVersion = await localServicesBridge.getWpVersion(validated);
          if (liveVersion) {
            version = liveVersion;
            fromCache = false;
            metadataAge = null; // Fresh data, no age
          }
        } catch (err) {
          // WP-CLI failed - keep using cached version if we have it
          if (!version) {
            throw err; // No cache, propagate error
          }
        }
      }

      return {
        success: true,
        version,
        fromCache,
        metadataAge,
      };
    } catch (err) {
      localLogger.error('[NexusAI] get-wp-version failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.UPGRADE_WP, async (_event: any, siteId: string) => {
    const startTime = Date.now();
    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);
      siteId = validated; // Use validated value

      localLogger.info(`[NexusAI] Starting WordPress upgrade for site ${siteId}`);

      // Ensure site is running — but don't auto-stop after upgrade.
      // Stopping triggers Local's database dump which can fail, and users
      // need the site running to verify the upgrade worked.
      const statuses = localServicesBridge.getAllSiteStatuses();
      if (statuses[siteId] !== 'running') {
        localLogger.info(`[NexusAI] Site ${siteId} not running - auto-starting for upgrade`);
        await localServicesBridge.startSite(siteId);
        await waitForDatabaseReady(siteId, localServicesBridge, localLogger, 30000);
      }

      const result = await (async () => {
        // Get current version
        const currentVersion = await localServicesBridge.getWpVersion(siteId);
        localLogger.info(`[NexusAI] Current WordPress version: ${currentVersion}`);

        // Run wp core update to upgrade to WP 7.0
        // Using --force to allow upgrading from older dev/beta versions
        const targetVersion = '7.0-RC2';

        localLogger.info(`[NexusAI] Running wp core update --version=${targetVersion} --force for site ${siteId}`);
        const updateResult = await localServicesBridge.wpCliRun(siteId, ['core', 'update', `--version=${targetVersion}`, '--force']);
        localLogger.info(`[NexusAI] wp core update result:`, updateResult);

        // Check if update succeeded
        if (!updateResult.success) {
          const errorMsg = updateResult.stdout || 'WordPress core update failed';
          localLogger.error(`[NexusAI] WordPress core update failed for site ${siteId}:`, errorMsg);
          throw new Error(errorMsg);
        }

        // Update database if needed
        localLogger.info(`[NexusAI] Running wp core update-db for site ${siteId}`);
        const dbResult = await localServicesBridge.wpCliRun(siteId, ['core', 'update-db']);
        localLogger.info(`[NexusAI] wp core update-db result:`, dbResult);

        // Get the new version
        const newVersion = await localServicesBridge.getWpVersion(siteId);
        localLogger.info(`[NexusAI] WordPress upgrade complete. New version: ${newVersion}`);

        // Digital Twin: Refresh metadata cache after successful upgrade
        // This ensures the WP version, plugin list, and theme list reflect the upgraded state
        if (metadataCache) {
          try {
            const [wpVersion, plugins, themes] = await Promise.all([
              localServicesBridge.getWpVersion(siteId),
              localServicesBridge.getPlugins(siteId),
              localServicesBridge.getThemes(siteId),
            ]);

            metadataCache.set(siteId, {
              wpVersion: wpVersion ?? 'unknown',
              plugins: plugins.map(p => ({
                name: p.name,
                title: p.title,
                version: p.version,
                status: p.status as 'active' | 'inactive',
                file: p.file,
              })),
              themes: themes.map(t => ({
                name: t.name,
                title: t.title,
                version: t.version,
                status: t.status as 'active' | 'inactive',
              })),
              activeTheme: themes.find(t => t.status === 'active')?.name,
              updateSource: 'upgrade-wp',
            });

            localLogger.info(`[NexusAI] Refreshed metadata cache after upgrade-wp for site ${siteId}`);

            // Also update IndexRegistry structure to refresh digital twin
            const existingEntry = indexRegistry.get(siteId);
            if (existingEntry?.structure) {
              indexRegistry.update(siteId, {
                structure: {
                  ...existingEntry.structure,
                  wpVersion: wpVersion ?? 'unknown',
                  plugins: plugins.map(p => ({
                    name: p.name,
                    slug: p.file?.split('/')[0] ?? p.name,
                    version: p.version,
                    isActive: p.status === 'active',
                    description: '',
                  })),
                  themes: themes.map(t => ({
                    name: t.name,
                    slug: t.name,
                    version: t.version,
                    isActive: t.status === 'active',
                    isChildTheme: false,
                  })),
                },
              });

              localLogger.info(`[NexusAI] Updated IndexRegistry structure after upgrade-wp for site ${siteId}`);
            }
          } catch (err) {
            // Non-fatal — upgrade succeeded, cache refresh is nice-to-have
            localLogger.error(`[NexusAI] Metadata refresh after upgrade-wp failed for ${siteId}:`, (err as Error).message);
          }
        }

        return { success: true, version: newVersion, fromVersion: currentVersion, targetVersion };
      })();

      // Audit log success
      auditLogger.logSuccess(
        'upgrade_wp',
        siteId,
        'local_site',
        { fromVersion: result.fromVersion, toVersion: result.version, targetVersion: result.targetVersion },
        Date.now() - startTime,
      );

      return { success: true, version: result.version };
    } catch (err) {
      localLogger.error('[NexusAI] upgrade-wp failed:', (err as Error).message, err);
      auditLogger.logFailure(
        'upgrade_wp',
        siteId || 'unknown',
        'local_site',
        (err as Error).message,
        {},
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.SETUP_AI, async (_event: any, siteId: string, provider?: string) => {
    const startTime = Date.now();
    let wasAutoStarted = false;

    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);
      siteId = validated; // Use validated value

      // Check if site is running
      const statuses = localServicesBridge.getAllSiteStatuses();
      const wasRunning = statuses[siteId] === 'running';

      // Auto-start if not running
      if (!wasRunning) {
        localLogger.info(`[NexusAI] Site ${siteId} not running - auto-starting for Setup AI`);
        await localServicesBridge.startSite(siteId);
        wasAutoStarted = true;

        // Wait for database to be ready
        await waitForDatabaseReady(siteId, localServicesBridge, localLogger, 30000);
      }

      // Determine which provider to configure for this site
      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;

      const result = await setupSiteForAI(siteId, localServicesBridge, registryStorage, localLogger, {
        provider: (provider as any) ?? settings?.aiProvider,
      });

      // Cache setup state if AI plugin was successfully installed/activated
      if (result.success && (result.aiPlugin === 'installed' || result.aiPlugin === 'activated' || result.aiPlugin === 'already_active')) {
        const setupState = (registryStorage.get(STORAGE_KEYS.AI_SETUP_STATE) ?? {}) as Record<string, {
          aiPlugin: string;
          ollamaProvider: string;
          timestamp: number;
        }>;

        setupState[siteId] = {
          aiPlugin: result.aiPlugin,
          ollamaProvider: result.ollamaProvider,
          timestamp: Date.now(),
        };

        registryStorage.set(STORAGE_KEYS.AI_SETUP_STATE, setupState);
      }

      // Digital Twin: Refresh metadata cache after successful setup
      // This ensures the plugin list reflects newly installed plugins (AI, Ollama provider, etc.)
      if (result.success && metadataCache) {
        try {
          const [wpVersion, plugins, themes] = await Promise.all([
            localServicesBridge.getWpVersion(siteId),
            localServicesBridge.getPlugins(siteId),
            localServicesBridge.getThemes(siteId),
          ]);

          metadataCache.set(siteId, {
            wpVersion: wpVersion ?? 'unknown',
            plugins: plugins.map(p => ({
              name: p.name,
              title: p.title,
              version: p.version,
              status: p.status as 'active' | 'inactive',
              file: p.file,
            })),
            themes: themes.map(t => ({
              name: t.name,
              title: t.title,
              version: t.version,
              status: t.status as 'active' | 'inactive',
            })),
            activeTheme: themes.find(t => t.status === 'active')?.name,
            updateSource: 'setup-ai',
          });

          localLogger.info(`[NexusAI] Refreshed metadata cache after setup-ai for site ${siteId}`);
        } catch (err) {
          // Non-fatal — setup succeeded, cache refresh is nice-to-have
          localLogger.error(`[NexusAI] Metadata refresh after setup-ai failed for ${siteId}:`, (err as Error).message);
        }
      }

      // Don't auto-stop after Setup AI - leave site running for user to verify
      // Setup AI is a heavy operation (plugins, config, credentials) and auto-stop
      // can trigger database dump errors that corrupt the site. Safer to let user
      // stop manually when ready.
      if (wasAutoStarted) {
        localLogger.info(`[NexusAI] Setup AI complete - site ${siteId} remains running`);
        localLogger.info(`[NexusAI] You can stop the site manually when ready`);
      }

      // Audit log successful setup
      auditLogger.logSuccess(
        'setup_ai',
        siteId,
        'local_site',
        { provider: settings?.aiProvider },
        Date.now() - startTime
      );

      return result;
    } catch (err) {
      // Don't auto-stop even on error - safer to leave running for debugging
      if (wasAutoStarted) {
        localLogger.error(`[NexusAI] Setup AI failed - site ${siteId} remains running for debugging`);
        localLogger.info(`[NexusAI] You can stop the site manually when ready`);
      }

      // Audit log failure
      auditLogger.logFailure(
        'setup_ai',
        siteId,
        'local_site',
        (err as Error).message,
        {},
        Date.now() - startTime
      );

      return {
        success: false,
        aiPlugin: 'failed' as const,
        connectorPlugin: 'failed' as const,
        providerPlugins: 'failed' as const,
        gatewayProvider: 'failed' as const,
        ollamaProvider: 'failed' as const,
        aiFeatures: 'failed' as const,
        credentials: 'failed' as const,
        acfAbilities: 'failed' as const,
        message: (err as Error).message,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // Per-Site AI Config (Phase 4)
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.GET_SITE_AI_CONFIG, (_event: any, siteId: string) => {
    try {
      const validated = validateInput(SiteIdSchema, siteId);
      const siteConfigs = (registryStorage.get(STORAGE_KEYS.SITE_AI_CONFIG) ?? {}) as Record<string, any>;
      const config = siteConfigs[validated] ?? null;
      return { success: true, config };
    } catch (err: any) {
      return { success: false, error: err.message, config: null };
    }
  });

  safeHandle(IPC_CHANNELS.SWITCH_AI_PROVIDER, async (_event: any, siteId: string, provider: string) => {
    try {
      const validatedSiteId = validateInput(SiteIdSchema, siteId);

      // Ensure site is running
      const statuses = localServicesBridge.getAllSiteStatuses();
      let wasAutoStarted = false;
      if (statuses[validatedSiteId] !== 'running') {
        await localServicesBridge.startSite(validatedSiteId);
        wasAutoStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      const result = await switchProviderForSite(
        validatedSiteId,
        provider as any,
        localServicesBridge,
        registryStorage,
        localLogger,
      );

      if (wasAutoStarted) {
        await localServicesBridge.stopSite(validatedSiteId);
      }

      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------------------------
  // Event Tracking & Visibility (Sprint 1)
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.EVENTS_GET_TIMELINE, async (_event: any, options?: {
    limit?: number;
    filter?: string;
    status?: 'pending' | 'processed' | 'failed';
    siteId?: string;
  }) => {
    try {
      // Validate input
      const validated = validateInput(EventTimelineOptionsSchema, options);

      const events = await graphService.getRecentEvents(validated as any);

      // Transform to renderer-safe format with site names
      const timeline: EventTimelineEntry[] = events.map(e => {
        const site = siteData.getSite(e.site_id);
        return {
          id: e.id,
          siteId: e.site_id,
          siteName: site?.name ?? e.site_id,
          eventType: e.event_type,
          timestamp: e.created_at,
          status: e.status,
          summary: generateEventSummary(e),
          details: e.payload,
        };
      });

      return { success: true, events: timeline };
    } catch (err) {
      localLogger.error('[NexusAI] events:get-timeline failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, events: [] };
    }
  });

  safeHandle(IPC_CHANNELS.EVENTS_GET_STATS, async () => {
    try {
      const stats = await graphService.getEventStats();

      // Determine health status
      let healthStatus: 'good' | 'warning' | 'error' = 'good';
      if (stats.failed > 0) {
        healthStatus = 'error';
      } else if (stats.pending > 10) {
        healthStatus = 'warning';
      }

      const eventStats: EventStats = {
        total: stats.total,
        today: stats.today,
        yesterday: stats.yesterday,
        pending: stats.pending,
        failed: stats.failed,
        byType: stats.by_type as Record<string, number>,
        healthStatus,
      };

      return { success: true, stats: eventStats };
    } catch (err) {
      localLogger.error('[NexusAI] events:get-stats failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.STORAGE_GET_HEALTH, async () => {
    try {
      // vectorDbPath is passed as a dep
      const rawHealth = await graphService.getStorageHealth(vectorDbPath);

      // Transform snake_case to camelCase for renderer
      const health = {
        graphDb: {
          sizeBytes: rawHealth.graph_db.size_bytes,
          path: rawHealth.graph_db.path,
          eventCount: rawHealth.graph_db.event_count,
          oldestEvent: rawHealth.graph_db.oldest_event,
          newestEvent: rawHealth.graph_db.newest_event,
        },
        vectorDb: {
          sizeBytes: rawHealth.vector_db.size_bytes,
          path: rawHealth.vector_db.path,
          tableCount: rawHealth.vector_db.table_count,
        },
        pendingEvents: rawHealth.pending_events,
        failedEvents: rawHealth.failed_events,
      };

      return { success: true, health };
    } catch (err) {
      localLogger.error('[NexusAI] storage:get-health failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.ISSUES_DETECT, async () => {
    try {
      const issues = await graphService.detectIssues();
      return { success: true, issues };
    } catch (err) {
      localLogger.error('[NexusAI] issues:detect failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, issues: [] };
    }
  });

  safeHandle(IPC_CHANNELS.STORAGE_CLEANUP, async (_event: any, options?: {
    retentionDays?: number;
  }) => {
    const startTime = Date.now();
    try {
      // Validate input
      const validated = validateInput(StorageCleanupOptionsSchema, options);

      const retentionDays = validated?.retentionDays ?? 30;
      const deleted = await graphService.cleanupOldData(retentionDays);

      // Audit log success
      auditLogger.logSuccess(
        'storage_cleanup',
        'all',
        'database',
        { retentionDays, eventsDeleted: deleted.events },
        Date.now() - startTime,
      );

      localLogger.info(`[NexusAI] Cleaned up ${deleted} old events (retention: ${retentionDays} days)`);
      return { success: true, deletedCount: deleted.events };
    } catch (err) {
      localLogger.error('[NexusAI] storage:cleanup failed:', (err as Error).message);
      auditLogger.logFailure(
        'storage_cleanup',
        'all',
        'database',
        (err as Error).message,
        options || {},
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.EVENTS_RETRY_FAILED, async () => {
    try {
      const count = await eventProcessor.retryFailed();

      localLogger.info(`[NexusAI] Retrying ${count} failed events`);
      return { success: true, retriedCount: count };
    } catch (err) {
      localLogger.error('[NexusAI] events:retry-failed failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // ---------------------------------------------------------------------------
  // Search & Discovery (Sprint 2)
  // ---------------------------------------------------------------------------

  const searchService = new SearchService(vectorStore, graphService, embeddingService, indexRegistry);
  const healthCalculator = new HealthScoreCalculator({ graphService, indexRegistry, siteDataBridge: siteData });
  const filterEngine = new FilterEngine({ graphService, indexRegistry, siteDataBridge: siteData });

  // Determine query storage path (alongside vector DB)
  const queryStoragePath = vectorDbPath.replace(/\/vectors\/?$/, '');
  const queryStorage = new QueryStorage(queryStoragePath);
  queryStorage.load().catch(err => localLogger.error('[NexusAI] Failed to load saved queries:', err.message));

  // Unified search
  safeHandle(IPC_CHANNELS.SEARCH_UNIFIED, async (_event: any, params: { query: string; filters?: any; options?: any }) => {
    try {
      // Validate input
      const validated = validateInput(SearchUnifiedSchema, params);

      localLogger.info('[NexusAI] Search request:', { query: validated.query, filters: validated.filters, options: validated.options });
      const results = await searchService.searchFleet(validated.query, validated.filters, validated.options);
      localLogger.info('[NexusAI] Search results:', { total: results.total, resultCount: results.results.length });
      return { success: true, ...results };
    } catch (err) {
      localLogger.error('[NexusAI] search:unified failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, results: [], total: 0 };
    }
  });

  // Smart filters
  safeHandle(IPC_CHANNELS.FILTERS_GET_COUNTS, async () => {
    try {
      const filters = await filterEngine.getFilterCounts();
      return { success: true, filters };
    } catch (err) {
      localLogger.error('[NexusAI] filters:get-counts failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, filters: [] };
    }
  });

  safeHandle(IPC_CHANNELS.FILTERS_APPLY, async (_event: any, filterId: string) => {
    try {
      // Validate input
      const validated = validateInput(FilterIdSchema, filterId);

      const siteIds = await filterEngine.applyFilter(validated);
      return { success: true, siteIds };
    } catch (err) {
      localLogger.error('[NexusAI] filters:apply failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, siteIds: [] };
    }
  });

  // Health scores
  safeHandle(IPC_CHANNELS.HEALTH_GET_SCORE, async (_event: any, params: { siteId: string }) => {
    try {
      // Validate input
      const validated = validateInput(HealthGetScoreSchema, params);
      const siteId = validated.siteId;

      const site = siteData.getSite(siteId);
      const breakdown = await healthCalculator.calculateScore(siteId, {
        phpVersion: site?.phpVersion,
        domain: site?.domain,
      });
      return { success: true, score: breakdown.overall, ...breakdown };
    } catch (err) {
      localLogger.error('[NexusAI] health:get-score failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.HEALTH_GET_ALL_SCORES, async () => {
    try {
      const allSites = siteData.getSites();
      const siteIds = Object.keys(allSites);
      const siteInfoMap: Record<string, { phpVersion?: string; domain?: string }> = {};
      for (const id of siteIds) {
        const s = allSites[id];
        siteInfoMap[id] = { phpVersion: s?.phpVersion, domain: s?.domain };
      }
      const scores = await healthCalculator.calculateAllScores(siteIds, siteInfoMap);
      return { success: true, scores };
    } catch (err) {
      localLogger.error('[NexusAI] health:get-all-scores failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, scores: {} };
    }
  });

  // Saved queries
  safeHandle(IPC_CHANNELS.QUERIES_LIST, async () => {
    try {
      const queries = queryStorage.list();
      return { success: true, queries };
    } catch (err) {
      localLogger.error('[NexusAI] queries:list failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, queries: [] };
    }
  });

  safeHandle(IPC_CHANNELS.QUERIES_CREATE, async (_event: any, query: any) => {
    try {
      // Validate input
      const validated = validateInput(QuerySchema, query);

      // Ensure pinned has a default value
      const queryToSave = {
        ...validated,
        pinned: validated.pinned ?? false,
      };

      const saved = await queryStorage.save(queryToSave);
      return { success: true, query: saved };
    } catch (err) {
      localLogger.error('[NexusAI] queries:create failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.QUERIES_UPDATE, async (_event: any, params: { id: string; changes: any }) => {
    try {
      // Validate input
      const validated = validateInput(QueryUpdateSchema, params);

      const updated = await queryStorage.update(validated.id, validated.changes);
      return { success: true, query: updated };
    } catch (err) {
      localLogger.error('[NexusAI] queries:update failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.QUERIES_DELETE, async (_event: any, id: string) => {
    try {
      // Validate input
      const validated = validateInput(QueryIdSchema, id);

      await queryStorage.delete(validated);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] queries:delete failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.QUERIES_RUN, async (_event: any, id: string) => {
    try {
      // Validate input
      const validated = validateInput(QueryIdSchema, id);

      const query = queryStorage.get(validated);
      if (!query) {
        return { success: false, error: 'Query not found' };
      }

      const results = await searchService.searchFleet(
        query.filters.searchText || '',
        {
          contentTypes: query.filters.contentTypes,
          siteIds: query.filters.siteIds,
        }
      );

      await queryStorage.update(id, {
        lastRun: Date.now(),
        resultCount: results.total,
      });

      return { success: true, ...results };
    } catch (err) {
      localLogger.error('[NexusAI] queries:run failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // ---------------------------------------------------------------------------
  // Bulk Operations & Groups (Sprint 3)
  // ---------------------------------------------------------------------------

  const bulkOpManager = new BulkOperationManager({
    contentPipeline,
    siteDataBridge: localServicesBridge,
    healthCalculator,
    graphService,
    setupSiteForAI: async (siteId: string, options?: any) => {
      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;
      const provider = options?.provider ?? settings?.aiProvider;
      const result = await setupSiteForAI(siteId, localServicesBridge, registryStorage, localLogger, { provider });

      // Digital Twin: Refresh metadata cache after successful setup (bulk operations)
      if (result.success && metadataCache) {
        try {
          const statuses = localServicesBridge.getAllSiteStatuses();
          const siteStatus = statuses[siteId] ?? 'unknown';

          if (siteStatus === 'running') {
            const [wpVersion, plugins, themes] = await Promise.all([
              localServicesBridge.getWpVersion(siteId),
              localServicesBridge.getPlugins(siteId),
              localServicesBridge.getThemes(siteId),
            ]);

            metadataCache.set(siteId, {
              wpVersion: wpVersion ?? 'unknown',
              plugins: plugins.map(p => ({
                name: p.name,
                title: p.title,
                version: p.version,
                status: p.status as 'active' | 'inactive',
                file: p.file,
              })),
              themes: themes.map(t => ({
                name: t.name,
                title: t.title,
                version: t.version,
                status: t.status as 'active' | 'inactive',
              })),
              activeTheme: themes.find(t => t.status === 'active')?.name,
              updateSource: 'setup-ai',
            });

            localLogger.info(`[NexusAI] Refreshed metadata cache after bulk setup-ai for site ${siteId}`);
          }
        } catch (err) {
          // Non-fatal — setup succeeded, cache refresh is nice-to-have
          localLogger.error(`[NexusAI] Bulk metadata refresh after setup-ai failed for ${siteId}:`, (err as Error).message);
        }
      }

      return result;
    },
    onProgress: (opId, status) => {
      try {
        // Stream progress to all renderer windows
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          win.webContents.send(IPC_CHANNELS.BULK_PROGRESS, opId, status);
        }
      } catch {
        // Ignore if no windows
      }
    },
  });

  // Site groups use Local's native siteData service via localServicesBridge

  // Wire Sprint 2/3 services into NexusServices so MCP tools can use them
  if (deps.nexusServices) {
    deps.nexusServices.searchService = searchService;
    deps.nexusServices.healthCalculator = healthCalculator;
    deps.nexusServices.filterEngine = filterEngine;
    deps.nexusServices.bulkOpManager = bulkOpManager;
  }

  let healthTrendTracker: HealthTrendTracker | null = null;
  try {
    const db = graphService.getDb();
    if (db) {
      healthTrendTracker = new HealthTrendTracker(db);
    }
  } catch {
    localLogger.error('[NexusAI] Failed to init HealthTrendTracker');
  }

  // --- Bulk Operations ---

  safeHandle(IPC_CHANNELS.BULK_EXECUTE, async (_event: any, request: any) => {
    const startTime = Date.now();
    try {
      // Validate input
      const validated = validateInput(BulkOperationRequestSchema, request);

      // Audit log bulk operation start
      auditLogger.log({
        operation: `bulk_${validated.type}`,
        target: `${validated.siteIds.length} sites`,
        targetType: 'bulk_operation',
        result: 'started',
        params: { type: validated.type, siteCount: validated.siteIds.length },
        durationMs: 0,
      });

      const opId = await bulkOpManager.execute(validated);

      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] bulk:execute failed:', (err as Error).message);
      auditLogger.logFailure(
        'bulk_execute',
        'multiple',
        'bulk_operation',
        (err as Error).message,
        request,
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.BULK_STATUS, async (_event: any, opId: string) => {
    try {
      // Validate input
      const validated = validateInput(BulkOperationIdSchema, opId);
      const status = bulkOpManager.getStatus(validated);
      return status ? { success: true, ...status } : { success: false, error: 'Operation not found' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.BULK_CANCEL, async (_event: any, opId: string) => {
    try {
      // Validate input
      const validated = validateInput(BulkOperationIdSchema, opId);
      return { success: bulkOpManager.cancel(validated) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.BULK_LIST, async () => {
    return { success: true, operations: bulkOpManager.listAll() };
  });

  // --- Site Groups (Local native) ---

  safeHandle(IPC_CHANNELS.GROUPS_LIST, async () => {
    try {
      const groups = localServicesBridge.getSiteGroups();
      return { success: true, groups };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.GROUPS_CREATE, async (_event: any, args: { name: string }) => {
    try {
      // Validate input
      const validated = validateInput(GroupCreateSchema, args);

      const group = localServicesBridge.createSiteGroup(validated.name);
      notifyGroupsChanged();
      return { success: true, group };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.GROUPS_UPDATE, async (_event: any, params: { id: string; changes: { name?: string } }) => {
    try {
      // Validate input
      const validated = validateInput(GroupUpdateSchema, params);

      if (validated.changes.name) {
        const group = localServicesBridge.renameSiteGroup(validated.id, validated.changes.name);
        notifyGroupsChanged();
        return { success: true, group };
      }
      return { success: false, error: 'No changes specified' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.GROUPS_DELETE, async (_event: any, id: string) => {
    try {
      // Validate input
      const validated = validateInput(GroupIdSchema, id);

      localServicesBridge.deleteSiteGroup(validated);
      notifyGroupsChanged();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.GROUPS_ADD_SITE, async (_event: any, params: { groupId: string; siteId: string }) => {
    try {
      // Validate input
      const validated = validateInput(GroupAddRemoveSiteSchema, params);

      localServicesBridge.moveSitesToGroup([validated.siteId], validated.groupId);
      notifyGroupsChanged();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.GROUPS_REMOVE_SITE, async (_event: any, params: { groupId: string; siteId: string }) => {
    try {
      // Validate input
      const validated = validateInput(GroupAddRemoveSiteSchema, params);

      localServicesBridge.removeSitesFromGroups([validated.siteId]);
      notifyGroupsChanged();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // --- Health Trends ---

  safeHandle(IPC_CHANNELS.HEALTH_GET_TREND, async (_event: any, params: { siteId: string; days?: number }) => {
    if (!healthTrendTracker) return { success: false, error: 'Health trend tracker not available' };

    // Validate input
    const validated = validateInput(HealthGetTrendSchema, params);

    return { success: true, trend: healthTrendTracker.getSiteTrend(validated.siteId, validated.days || 30) };
  });

  safeHandle(IPC_CHANNELS.HEALTH_GET_FLEET_TREND, async (_event: any, params?: { days?: number }) => {
    if (!healthTrendTracker) return { success: false, error: 'Health trend tracker not available' };

    // Validate input
    const validated = validateInput(HealthGetFleetTrendSchema, params);

    return { success: true, trend: healthTrendTracker.getFleetTrend(validated?.days || 30) };
  });

  // --- Dashboard v2 ---

  safeHandle(IPC_CHANNELS.DASHBOARD_V2_STATS, async () => {
    try {
      // Health distribution
      const allEntries = indexRegistry.listAll().filter((e: any) => e.state === 'indexed');
      const siteIds = allEntries.map((e: any) => e.siteId);
      const siteInfoMap: Record<string, any> = {};

      const allSites = siteData.getSites();
      for (const siteId of siteIds) {
        const site = allSites[siteId];
        if (site) {
          siteInfoMap[siteId] = { domain: site.domain || '', phpVersion: site.phpVersion || '8.0' };
        }
      }

      const scores = await healthCalculator.calculateAllScores(siteIds, siteInfoMap);
      let healthy = 0, warning = 0, critical = 0;
      for (const score of Object.values(scores)) {
        if ((score as number) >= 80) healthy++;
        else if ((score as number) >= 50) warning++;
        else critical++;
      }

      // Action items from smart filters
      const filters = await filterEngine.getFilterCounts();
      const actionItems = filters
        .filter((f: any) => f.count > 0)
        .map((f: any) => ({ filterId: f.id, label: f.label, count: f.count, severity: f.severity }));

      // Group summaries (from Local's native groups)
      const groups = localServicesBridge.getSiteGroups();
      const groupSummaries = groups.map((g: any) => {
        const groupScores = g.siteIds.map((id: string) => scores[id] || 0).filter((s: number) => s > 0);
        const avgHealth = groupScores.length > 0
          ? Math.round(groupScores.reduce((a: number, b: number) => a + b, 0) / groupScores.length)
          : 0;
        return { groupId: g.id, name: g.name, siteCount: g.siteIds.length, avgHealth };
      });

      // Recent bulk ops
      const recentBulkOps = bulkOpManager.listAll().slice(0, 5);

      return {
        success: true,
        healthDistribution: { healthy, warning, critical },
        actionItems,
        groupSummaries,
        recentBulkOps,
      };
    } catch (err) {
      localLogger.error('[NexusAI] dashboard:v2-stats failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // ---------------------------------------------------------------------------
  // AI Status & Proxy (Sprint 4)
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.GET_AI_STATUS, async (_event: any, siteId?: string) => {
    try {
      // Validate input if siteId provided
      const validatedSiteId = siteId ? validateInput(SiteIdSchema, siteId) : undefined;

      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();
      const targetIds = validatedSiteId ? [validatedSiteId] : Object.keys(allSites);

      // Load cached setup state
      const setupState = (registryStorage.get(STORAGE_KEYS.AI_SETUP_STATE) ?? {}) as Record<string, {
        aiPlugin: string;
        ollamaProvider: string;
        gatewayProvider?: string; // Optional: added in later version
        timestamp: number;
      }>;

      const results: Record<string, any> = {};
      for (const id of targetIds) {
        const site = allSites[id];
        if (!site) continue;

        const siteStatus = statuses[id] ?? 'unknown';
        let aiPlugin: 'active' | 'inactive' | 'not_installed' = 'not_installed';
        let ollamaProvider: 'active' | 'inactive' | 'not_installed' = 'not_installed';
        let gatewayProvider: 'active' | 'inactive' | 'not_installed' = 'not_installed';
        let credentialsSynced = false;
        const providers: string[] = [];
        let metadataAge: string | null = null;

        // Digital Twin: Check cached metadata first (much faster than WP-CLI)
        const cachedMetadata = metadataCache?.getWithAge(id);
        if (cachedMetadata) {
          // Use cached plugin data
          const aiPluginData = cachedMetadata.plugins.find(p => p.name === 'ai');
          if (aiPluginData) {
            aiPlugin = aiPluginData.status;
          }

          const ollamaPluginData = cachedMetadata.plugins.find(p => p.name === 'ai-provider-for-ollama');
          if (ollamaPluginData) {
            ollamaProvider = ollamaPluginData.status;
          }

          const gatewayPluginData = cachedMetadata.plugins.find(p => p.name === 'ai-provider-for-local-gateway');
          if (gatewayPluginData) {
            gatewayProvider = gatewayPluginData.status;
          }

          metadataAge = metadataCache?.getAgeString(id) ?? null;
        } else {
          // No cache - fall back to AI setup state cache
          const cached = setupState[id];
          if (cached) {
            // Use cached state - if setup completed successfully, plugin should be active
            aiPlugin = cached.aiPlugin === 'already_active' || cached.aiPlugin === 'installed' || cached.aiPlugin === 'activated'
              ? 'active'
              : cached.aiPlugin === 'inactive'
              ? 'inactive'
              : 'not_installed';

            ollamaProvider = cached.ollamaProvider === 'already_active' || cached.ollamaProvider === 'installed' || cached.ollamaProvider === 'activated'
              ? 'active'
              : cached.ollamaProvider === 'inactive'
              ? 'inactive'
              : 'not_installed';

            if (cached.gatewayProvider) {
              gatewayProvider = cached.gatewayProvider === 'already_active' || cached.gatewayProvider === 'installed' || cached.gatewayProvider === 'activated'
                ? 'active'
                : cached.gatewayProvider === 'inactive'
                ? 'inactive'
                : 'not_installed';
            }
          }
        }

        // If cache is stale or doesn't exist, and site is running, verify with live WP-CLI
        // This keeps the cache accurate if plugins were manually deactivated
        if (siteStatus === 'running' && (!cachedMetadata || cachedMetadata.isStale)) {
          try {
            const plugins = await localServicesBridge.getPlugins(id);
            const ai = plugins.find((p: any) => p.name === 'ai');
            if (ai) {
              aiPlugin = ai.status === 'active' ? 'active' : 'inactive';
            } else if (!cachedMetadata && !setupState[id]) {
              // Only mark as not_installed if we don't have any cached state
              aiPlugin = 'not_installed';
            }

            const ollama = plugins.find((p: any) => p.name === 'ai-provider-for-ollama');
            if (ollama) {
              ollamaProvider = ollama.status === 'active' ? 'active' : 'inactive';
            } else if (!cachedMetadata && !setupState[id]) {
              ollamaProvider = 'not_installed';
            }

            const gateway = plugins.find((p: any) => p.name === 'ai-provider-for-local-gateway');
            if (gateway) {
              gatewayProvider = gateway.status === 'active' ? 'active' : 'inactive';
            } else if (!cachedMetadata && !setupState[id]) {
              gatewayProvider = 'not_installed';
            }
          } catch {
            // WP-CLI failed — keep using cached state (if available)
          }
        }

        // Check if credentials are synced by looking at stored keys
        const storedKeys = (registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
        for (const [provider, key] of Object.entries(storedKeys)) {
          if (key) providers.push(provider);
        }
        credentialsSynced = providers.length > 0;

        results[id] = {
          siteId: id,
          siteName: site.name,
          isRunning: siteStatus === 'running',
          aiPlugin,
          ollamaProvider,
          gatewayProvider,
          credentialsSynced,
          providers,
          metadataAge, // NEW: Age of cached metadata ("Just now", "5m ago", etc.)
          metadataIsStale: cachedMetadata?.isStale ?? false, // NEW: True if > 24 hours old
        };
      }

      return { success: true, sites: results };
    } catch (err) {
      localLogger.error('[NexusAI] get-ai-status failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.GET_AI_PROXY_INFO, () => {
    try {
      const proxyInfo = registryStorage.get('ai_proxy_info') as any;
      return {
        success: true,
        proxy: proxyInfo ? {
          url: proxyInfo.url,
          port: proxyInfo.port,
          running: true,
          models: proxyInfo.models ?? [],
          toolCapableModels: proxyInfo.toolCapableModels ?? [],
        } : null,
      };
    } catch (err) {
      localLogger.error('[NexusAI] get-ai-proxy-info failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.SETUP_AI_FLEET, async (_event: any, options?: { siteIds?: string[] }) => {
    try {
      // Validate input
      const validated = validateInput(FleetOperationOptionsSchema, options);

      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();

      // Use provided siteIds or all running sites
      const targetIds = validated?.siteIds
        ?? Object.keys(allSites).filter((id) => statuses[id] === 'running');

      if (targetIds.length === 0) {
        return { success: true, opId: null, message: 'No running sites to set up' };
      }

      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;

      const opId = bulkOpManager.execute({
        type: 'setup-ai',
        siteIds: targetIds,
        options: { provider: settings?.aiProvider },
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] setup-ai-fleet failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.INDEX_ALL_FLEET, async (_event: any, options?: { siteIds?: string[] }) => {
    try {
      // Validate input
      const validated = validateInput(FleetOperationOptionsSchema, options);

      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();

      // Use provided siteIds or all running sites
      const targetIds = validated?.siteIds
        ?? Object.keys(allSites).filter((id) => statuses[id] === 'running');

      if (targetIds.length === 0) {
        return { success: true, opId: null, message: 'No running sites to index' };
      }

      const opId = bulkOpManager.execute({
        type: 'reindex',
        siteIds: targetIds,
        options: {},
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] index-all-fleet failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // Auto-start/stop: Setup AI for ALL sites (including halted)
  safeHandle(IPC_CHANNELS.SETUP_AI_ALL_AUTO, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const allSiteIds = Object.keys(allSites);

      if (allSiteIds.length === 0) {
        return { success: true, opId: null, message: "No sites to setup" };
      }

      const opId = bulkOpManager.execute({
        type: "setup-ai",
        siteIds: allSiteIds,
        options: { autoStartStop: true },
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error("[NexusAI] setup-ai-all-auto failed:", (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // Auto-start/stop: Index ALL sites (including halted)
  safeHandle(IPC_CHANNELS.INDEX_ALL_AUTO, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const allSiteIds = Object.keys(allSites);

      if (allSiteIds.length === 0) {
        return { success: true, opId: null, message: "No sites to index" };
      }

      const opId = bulkOpManager.execute({
        type: "reindex",
        siteIds: allSiteIds,
        options: { autoStartStop: true },
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error("[NexusAI] index-all-auto failed:", (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // Sync Graph: Refresh GraphService with current plugin/theme/user data (auto-start/stop)
  safeHandle(IPC_CHANNELS.SYNC_GRAPH_ALL, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const allSiteIds = Object.keys(allSites);

      if (allSiteIds.length === 0) {
        return { success: false, error: "No sites to sync." };
      }

      const opId = bulkOpManager.execute({
        type: "sync-graph",
        siteIds: allSiteIds,
        options: { autoStartStop: true },
      });

      return { success: true, opId, count: allSiteIds.length };
    } catch (err) {
      localLogger.error("[NexusAI] sync-graph-all failed:", (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // ---------------------------------------------------------------------------
  // Site Finder (Advanced Site Search)
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.SITE_FINDER_GET_OPTIONS, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();
      const db = graphService.getDb();

      // Get plugins from graph (all sites, fast)
      const pluginRows = db ? db.prepare('SELECT DISTINCT slug FROM plugins ORDER BY slug').all() as Array<{ slug: string }> : [];
      const plugins = pluginRows.map(r => r.slug);

      // Get WP versions from graph (all sites, fast)
      const wpRows = db ? db.prepare('SELECT DISTINCT wp_version FROM sites WHERE wp_version IS NOT NULL ORDER BY wp_version').all() as Array<{ wp_version: string }> : [];
      const wpVersions = wpRows.map(r => r.wp_version);

      // Get PHP versions from site data (all sites, fast)
      const phpSet = new Set<string>();
      for (const site of Object.values(allSites)) {
        const phpVersion = (site as any).phpVersion;
        if (phpVersion) phpSet.add(phpVersion);
      }
      const phpVersions = Array.from(phpSet).sort();

      // Get themes from WP-CLI (running sites only, slow)
      const themesSet = new Set<string>();
      for (const [siteId] of Object.entries(allSites)) {
        const isRunning = statuses[siteId] === 'running';
        if (isRunning) {
          try {
            const themes = await localServicesBridge.getThemes(siteId);
            for (const theme of themes) {
              if (theme.name) themesSet.add(theme.name);
            }
          } catch {
            // Site WP-CLI call failed, skip
          }
        }
      }
      const themes = Array.from(themesSet).sort();

      return {
        success: true,
        plugins,
        themes,
        phpVersions,
        wpVersions,
      };
    } catch (err) {
      localLogger.error('[NexusAI] site-finder:get-options failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.SITE_FINDER_APPLY, async (_event: any, filters: any) => {
    try {
      // Validate input
      const validated = validateInput(SiteFinderFiltersSchema, filters);

      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();
      const db = graphService.getDb();
      const matchingSiteIds: string[] = [];

      // Pre-filter by content if contentQuery is provided (semantic search)
      let contentMatchingSiteIds: Set<string> | null = null;
      if (validated?.contentQuery && validated.contentQuery.trim()) {
        try {
          localLogger.info('[NexusAI] Running content search for:', validated.contentQuery);

          // Convert query text to embedding vector
          const queryVector = await embeddingService.embed(validated.contentQuery);

          // Search across all indexed sites (local + WPE)
          contentMatchingSiteIds = new Set<string>();
          const localSiteIds = Object.keys(allSites);

          // Get WPE site IDs from graph
          const wpeSites = await graphService.listSites({ source: 'wpe' });
          const wpeSiteIds = wpeSites.map(s => s.id);

          const allSearchableSiteIds = [...localSiteIds, ...wpeSiteIds];
          localLogger.info(`[NexusAI] Searching ${localSiteIds.length} local + ${wpeSiteIds.length} WPE sites for content`);

          // Hybrid search: vector + FTS keyword boost, single tableNames() call
          const matchMap = await vectorStore.searchAcrossSites(
            allSearchableSiteIds,
            queryVector,
            { limit: 3, relevanceFloor: 0.35, queryText: validated.contentQuery, excludedTypes: EXCLUDED_POST_TYPES },
            5,
          );
          for (const siteId of matchMap.keys()) {
            contentMatchingSiteIds!.add(siteId);
          }

          localLogger.info('[NexusAI] Content search found', contentMatchingSiteIds.size, 'sites with matching content');

          // If no sites have matching content, return empty immediately
          if (contentMatchingSiteIds.size === 0) {
            return { success: true, siteIds: [] };
          }
        } catch (err) {
          localLogger.error('[NexusAI] Content search failed:', (err as Error).message);
          // Continue without content filter if search fails
        }
      }

      // Check local sites
      for (const [siteId, site] of Object.entries(allSites)) {
        let matches = true;
        const isRunning = statuses[siteId] === 'running';

        // Content filter - check if this site has matching content
        if (contentMatchingSiteIds !== null) {
          if (!contentMatchingSiteIds.has(siteId)) {
            matches = false;
            continue; // Skip other checks if content doesn't match
          }
        }

        // Text search (name or domain)
        if (validated?.searchText && validated.searchText.trim()) {
          const searchLower = validated.searchText.toLowerCase();
          const nameMatch = (site as any).name?.toLowerCase().includes(searchLower);
          const domainMatch = (site as any).domain?.toLowerCase().includes(searchLower);
          if (!nameMatch && !domainMatch) {
            matches = false;
          }
        }

        // PHP version filter (available even when stopped) - OR logic within array
        if (matches && validated?.phpVersions && validated.phpVersions.length > 0) {
          const phpVersion = (site as any).phpVersion;
          if (!validated.phpVersions.includes(phpVersion)) {
            matches = false;
          }
        }

        // Plugin filter (use graph - works on all sites) - OR logic within array
        if (matches && validated?.plugins && validated.plugins.length > 0) {
          if (db) {
            const placeholders = validated.plugins.map(() => '?').join(',');
            const pluginRow = db.prepare(`SELECT 1 FROM plugins WHERE site_id = ? AND slug IN (${placeholders}) LIMIT 1`)
              .get(siteId, ...validated.plugins);
            if (!pluginRow) matches = false;
          } else {
            matches = false;
          }
        }

        // WP version filter (use graph - works on all sites) - OR logic within array
        if (matches && validated?.wpVersions && validated.wpVersions.length > 0) {
          if (db) {
            const siteRow = db.prepare('SELECT wp_version FROM sites WHERE id = ? LIMIT 1')
              .get(siteId) as any;
            if (!siteRow || !validated.wpVersions.includes(siteRow.wp_version)) {
              matches = false;
            }
          } else {
            matches = false;
          }
        }

        // Theme filter (requires WP-CLI - running sites only) - OR logic within array
        if (matches && validated?.themes && validated.themes.length > 0) {
          if (!isRunning) {
            matches = false;
          } else {
            try {
              const themes = await localServicesBridge.getThemes(siteId);
              const hasAnyTheme = themes.some((t: any) => validated.themes!.includes(t.name));
              if (!hasAnyTheme) matches = false;
            } catch {
              matches = false;
            }
          }
        }

        if (matches) {
          matchingSiteIds.push(siteId);
        }
      }

      // Check WPE sites (remote sites only support content/plugin/WP version filters)
      const wpeSites = await graphService.listSites({ source: 'wpe' });
      for (const wpeSite of wpeSites) {
        let matches = true;

        // Content filter - check if this site has matching content
        if (contentMatchingSiteIds !== null) {
          if (!contentMatchingSiteIds.has(wpeSite.id)) {
            matches = false;
            continue;
          }
        }

        // Text search (name or domain)
        if (validated?.searchText && validated.searchText.trim()) {
          const searchLower = validated.searchText.toLowerCase();
          const nameMatch = wpeSite.name?.toLowerCase().includes(searchLower);
          const domainMatch = wpeSite.domain?.toLowerCase().includes(searchLower);
          if (!nameMatch && !domainMatch) {
            matches = false;
          }
        }

        // Plugin filter (use graph)
        if (matches && validated?.plugins && validated.plugins.length > 0) {
          if (db) {
            const placeholders = validated.plugins.map(() => '?').join(',');
            const pluginRow = db.prepare(`SELECT 1 FROM plugins WHERE site_id = ? AND slug IN (${placeholders}) LIMIT 1`)
              .get(wpeSite.id, ...validated.plugins);
            if (!pluginRow) matches = false;
          } else {
            matches = false;
          }
        }

        // WP version filter (use graph)
        if (matches && validated?.wpVersions && validated.wpVersions.length > 0) {
          if (!wpeSite.wp_version || !validated.wpVersions.includes(wpeSite.wp_version)) {
            matches = false;
          }
        }

        // Skip theme filter for WPE sites (requires WP-CLI on running sites)
        if (matches && validated?.themes && validated.themes.length > 0) {
          matches = false; // WPE sites don't support theme filtering yet
        }

        if (matches) {
          matchingSiteIds.push(wpeSite.id);
        }
      }

      localLogger.info(`[NexusAI] Site Finder results: ${matchingSiteIds.length} total (local + WPE)`);

      // Build detailed results for UI display
      const localResults: Array<{ id: string; name: string; type: 'local' }> = [];
      const wpeResults: Array<{ id: string; name: string; domain: string; installId: string; type: 'wpe' }> = [];

      for (const siteId of matchingSiteIds) {
        // Check if it's a local site
        if (allSites[siteId]) {
          localResults.push({
            id: siteId,
            name: allSites[siteId].name,
            type: 'local',
          });
        } else {
          // It's a WPE site - get details from graph
          const wpeSite = wpeSites.find(s => s.id === siteId);
          if (wpeSite) {
            wpeResults.push({
              id: wpeSite.id,
              name: wpeSite.name,
              domain: wpeSite.domain || wpeSite.remote_domain || 'Unknown',
              installId: wpeSite.remote_install_id || wpeSite.id,
              type: 'wpe',
            });
          }
        }
      }

      localLogger.info(`[NexusAI] Site Finder breakdown: ${localResults.length} local, ${wpeResults.length} WPE`);

      return {
        success: true,
        siteIds: matchingSiteIds,
        local: localResults,
        wpe: wpeResults,
      };
    } catch (err) {
      localLogger.error('[NexusAI] site-finder:apply failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.SITE_FINDER_AI_PARSE, async (_event: any, payload: { conversation: Array<{ role: string; content: string }> }) => {
    try {
      // Validate input
      const validated = validateInput(SiteFinderAIParseSchema, payload);

      const { getProvider } = require('./chat/providers/index');

      // Get settings to determine which provider to use
      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;
      const apiKeys = (registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;

      const aiProvider = settings?.aiProvider ?? 'ollama';
      const aiModel = settings?.aiModel ?? 'llama3.2';
      const apiKey = apiKeys[aiProvider];

      localLogger.info('[NexusAI] AI parse request - provider:', aiProvider, 'model:', aiModel, 'hasKey:', !!apiKey);

      // Check if provider is available
      if (aiProvider !== 'ollama' && !apiKey) {
        return {
          success: false,
          error: `No API key configured for ${aiProvider}. Please configure in Settings.`,
        };
      }

      const provider = getProvider(aiProvider);
      if (!provider) {
        return {
          success: false,
          error: `Provider ${aiProvider} not available. Try reloading the addon.`,
        };
      }

      // Build system prompt for query parsing
      const systemPrompt = `You are a site finder query parser. Convert natural language queries into structured filters for searching WordPress sites.

Available filter types:
- plugins: array of plugin slugs (e.g., ["advanced-custom-fields", "woocommerce"])
- themes: array of theme slugs (e.g., ["twentytwentyfour"])
- phpVersions: array of PHP version strings (e.g., ["8.1", "8.2"])
- wpVersions: array of WordPress version strings (e.g., ["6.8.1", "6.7"])
- contentQuery: semantic search for indexed site content - finds sites with posts/pages about a topic (e.g., "cars", "recipes", "travel")
- searchText: exact text match in site names or domains

Common plugin name mappings:
- "ACF" or "Advanced Custom Fields" → "advanced-custom-fields"
- "WooCommerce" → "woocommerce"
- "Yoast" or "Yoast SEO" → "wordpress-seo"
- "Akismet" → "akismet"

IMPORTANT: contentQuery searches actual page/post content using AI embeddings. Use it for:
- "sites about X" → contentQuery: "X"
- "sites with content about X" → contentQuery: "X"
- "sites mentioning X" → contentQuery: "X"

CRITICAL OUTPUT FORMAT:
- You MUST respond with ONLY a JSON object, nothing else
- NO explanations, NO markdown, NO code blocks
- Just the raw JSON object starting with { and ending with }

Examples:
User: "WP 6.8.1 with ACF and content about cars"
Assistant: { "filters": { "wpVersions": ["6.8.1"], "plugins": ["advanced-custom-fields"], "contentQuery": "cars automobiles vehicles" } }

User: "sites with car content"
Assistant: { "filters": { "contentQuery": "cars automobiles automotive vehicles" } }

User: "WooCommerce sites on old PHP"
Assistant: { "needsClarification": true, "question": "What PHP version range? (e.g., below 8.0)" }

User: "sites about cooking"
Assistant: { "filters": { "contentQuery": "cooking recipes food culinary kitchen" } }`;

      // Build messages array
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...validated.conversation.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
      ];

      // Stream and collect response
      const abortController = new AbortController();
      let responseText = '';
      let eventCount = 0;

      localLogger.info('[NexusAI] Starting AI parse with provider:', aiProvider, 'model:', aiModel);

      const stream = provider.streamChat(
        messages,
        [], // No tools for this call
        { model: aiModel, apiKey },
        abortController.signal,
      );

      for await (const event of stream) {
        eventCount++;
        if (event.type === 'token') {
          responseText += event.text;
        } else if (event.type === 'error') {
          localLogger.error('[NexusAI] Stream error event:', event.message);
          throw new Error(event.message);
        } else if (event.type === 'done') {
          localLogger.info('[NexusAI] Stream done, total events:', eventCount, 'response length:', responseText.length);
        }
      }

      if (!responseText.trim()) {
        throw new Error('AI provider returned empty response. Check your API key and model configuration.');
      }

      // Log raw response for debugging
      localLogger.info('[NexusAI] AI parse raw response (first 300 chars):', responseText.substring(0, 300));

      // Extract JSON from response (handle markdown code blocks)
      let jsonText = responseText.trim();

      // Remove markdown code blocks if present
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
        localLogger.info('[NexusAI] Extracted from code block');
      }

      // Try to find JSON object if surrounded by text
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
        localLogger.info('[NexusAI] Extracted JSON object');
      }

      localLogger.info('[NexusAI] Final JSON to parse (first 200 chars):', jsonText.substring(0, 200));

      // Parse JSON response
      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch (parseErr) {
        localLogger.error('[NexusAI] JSON parse failed, full response:', responseText);
        throw new Error(`Invalid JSON: ${(parseErr as Error).message}`);
      }

      if (parsed.needsClarification && parsed.question) {
        return {
          success: true,
          needsClarification: true,
          question: parsed.question,
        };
      } else if (parsed.filters) {
        return {
          success: true,
          filters: parsed.filters,
        };
      } else {
        localLogger.error('[NexusAI] Unexpected response structure:', parsed);
        throw new Error('Invalid response format from LLM - missing filters or clarification');
      }
    } catch (err) {
      localLogger.error('[NexusAI] site-finder:ai-parse failed:', (err as Error).message);
      return {
        success: false,
        error: `AI parsing failed: ${(err as Error).message}. Try rephrasing your query or use manual filters.`,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // Sidebar Search Panel
  // ---------------------------------------------------------------------------

  // Store current filter state
  let sidebarFilteredSiteIds: string[] = [];

  safeHandle(IPC_CHANNELS.SIDEBAR_FILTER, async (event: any, payload: { siteIds: string[] }) => {
    try {
      // Validate input
      const validated = validateInput(SidebarFilterSchema, payload);
      sidebarFilteredSiteIds = validated.siteIds || [];

      // Broadcast filter to renderer via CSS injection
      const siteIds = validated.siteIds || [];
      if (siteIds.length > 0) {
        event.sender.send('nexus:apply-sidebar-filter', siteIds);
      } else {
        event.sender.send('nexus:clear-sidebar-filter');
      }

      localLogger.info('[NexusAI] Sidebar filter applied:', siteIds.length, 'sites');

      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] sidebar:filter failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.SIDEBAR_NAVIGATE_TO_SITE, async (_event: any, payload: { siteId: string }) => {
    try {
      const { siteId } = payload;

      if (!serviceContainer) {
        localLogger.error('[NexusAI] Navigate to site failed: Service container not available');
        return { success: false, error: 'Service container not available' };
      }

      // Use Local's routing to navigate to site info page
      const sendIPCEvent = serviceContainer.sendIPCEvent;
      if (!sendIPCEvent || typeof sendIPCEvent !== 'function') {
        localLogger.error('[NexusAI] Navigate to site failed: sendIPCEvent not available in service container');
        localLogger.error('[NexusAI] Available keys:', Object.keys(serviceContainer).slice(0, 20).join(', '));
        return { success: false, error: 'Navigation not available' };
      }

      sendIPCEvent('goToRoute', `/main/site-info/${siteId}`);
      localLogger.info(`[NexusAI] Navigating to site ${siteId}`);
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      localLogger.error('[NexusAI] Navigate to site failed:', errorMsg);
      return { success: false, error: errorMsg };
    }
  });

  safeHandle(IPC_CHANNELS.SIDEBAR_BULK_ACTION, async (_event: any, payload: { action: string; siteIds: string[] }) => {
    try {
      // Validate input
      const validated = validateInput(SidebarBulkActionSchema, payload);
      const { action, siteIds } = validated;

      const bulkMgr = deps.nexusServices?.bulkOperationManager;
      if (!bulkMgr) {
        return { success: false, error: 'Bulk operation manager not available' };
      }

      let opType: string;
      let options: Record<string, any> = {};

      switch (action) {
        case 'start':
          opType = 'start';
          break;
        case 'stop':
          opType = 'stop';
          break;
        case 'setup-ai':
          opType = 'setup-ai';
          options = { autoStartStop: true };
          break;
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      const opId = bulkMgr.execute({
        type: opType as any,
        siteIds,
        options,
      });

      return { success: true, operationId: opId };
    } catch (err) {
      localLogger.error('[NexusAI] sidebar:bulk-action failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // Synchronous getter for renderer filter hook
  ipcMain.on('nexus:get-sidebar-filter', (event: any) => {
    event.returnValue = sidebarFilteredSiteIds;
  });

  // Expose filter function for SitesList hook
  if (deps.nexusServices) {
    (deps.nexusServices as any).getSidebarFilter = () => sidebarFilteredSiteIds;
  }

  // =========================================================================
  // WPE API Credentials (for backup creation via basic auth)
  // =========================================================================

  safeHandle(IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS, async () => {
    try {
      const status = await localServicesBridge.wpeGetApiCredentialsStatus();
      return { configured: status.configured, username: status.username ?? null };
    } catch (err: any) {
      localLogger.error(`[NexusAI] Failed to get WPE credentials status: ${err.message}`);
      return { configured: false, username: null };
    }
  });

  safeHandle(IPC_CHANNELS.WPE_GET_API_CREDENTIALS, async () => {
    try {
      const status = await localServicesBridge.wpeGetApiCredentialsStatus();
      if (!status.configured) {
        return { username: '', password: '' };
      }
      // Return username only for display, password stays encrypted
      return { username: status.username ?? '', password: '' };
    } catch (err: any) {
      localLogger.error(`[NexusAI] Failed to get WPE credentials: ${err.message}`);
      return { username: '', password: '' };
    }
  });

  safeHandle(IPC_CHANNELS.WPE_SET_API_CREDENTIALS, async (_event: any, username: string, password: string) => {
    try {
      await localServicesBridge.wpeSetApiCredentials(username, password);
      localLogger.info(`[NexusAI] WPE API credentials stored for user: ${username}`);
      return { success: true };
    } catch (err: any) {
      localLogger.error(`[NexusAI] Failed to store WPE credentials: ${err.message}`);
      throw err;
    }
  });

  safeHandle(IPC_CHANNELS.WPE_CLEAR_API_CREDENTIALS, async () => {
    try {
      await localServicesBridge.wpeClearApiCredentials();
      localLogger.info(`[NexusAI] WPE API credentials cleared`);
      return { success: true };
    } catch (err: any) {
      localLogger.error(`[NexusAI] Failed to clear WPE credentials: ${err.message}`);
      throw err;
    }
  });

  // =========================================================================
  // WPE Site Sync Handlers (Phase 1)
  // =========================================================================

  /**
   * Sync all WPE sites from wp-nexus MCP
   */
  safeHandle(IPC_CHANNELS.WPE_SYNC_ALL, async (_event: any, options?: { limit?: number }) => {
    const startTime = Date.now();

    if (!deps.wpeSyncService) {
      localLogger.warn('[NexusAI] WPE sync service not initialized');
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      // Validate input
      const validated = validateInput(WpeSyncAllSchema, options);

      const limit = validated?.limit;
      // Manual sync always force-refreshes all installs (staleThresholdHours=0)
      // Incremental staleness is only for scheduled/auto syncs
      localLogger.info(`[NexusAI] Starting WPE site sync (force)${limit ? ` (limit: ${limit})` : ''}...`);
      const result = await deps.wpeSyncService.syncAllWPESites(limit, 0);
      localLogger.info(`[NexusAI] WPE sync completed: ${result.synced} synced, ${result.skipped} skipped, ${result.failed} failed`);

      // Audit log success
      auditLogger.logSuccess(
        'wpe_sync_all',
        'all_installs',
        'wpe_install',
        { synced: result.synced, failed: result.failed, limit },
        Date.now() - startTime,
      );

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      localLogger.error('[NexusAI] WPE sync failed:', errorMsg, errorStack);
      auditLogger.logFailure(
        'wpe_sync_all',
        'all_installs',
        'wpe_install',
        errorMsg,
        options || {},
        Date.now() - startTime,
      );
      return { success: false, error: errorMsg };
    }
  });

  /**
   * Get current sync progress
   */
  safeHandle(IPC_CHANNELS.WPE_SYNC_STATUS, async () => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const progress = deps.wpeSyncService.getProgress();
      return { success: true, progress };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.WPE_DIAGNOSE, async (_event: any, params: { installName: string; args: string[] }) => {
    const { installName, args } = params;
    if (!installName || !args?.length) return { success: false, error: 'installName and args required' };
    const start = Date.now();
    try {
      const result = await localServicesBridge.remoteWpCliRun(installName, args);
      return { success: result.success, stdout: result.stdout, durationMs: Date.now() - start };
    } catch (err: any) {
      return { success: false, error: err.message, durationMs: Date.now() - start };
    }
  });

  safeHandle(IPC_CHANNELS.RESET_AND_REFRESH, async () => {
    try {
      localLogger.info('[NexusAI] Starting reset and refresh...');

      // 1. Clear graph data tables (preserve schema and event_queue)
      const db = graphService.getDb();
      if (db) {
        db.exec(`
          DELETE FROM content;
          DELETE FROM plugins;
          DELETE FROM users;
          DELETE FROM relationships;
          DELETE FROM themes;
          DELETE FROM wpe_accounts;
          DELETE FROM sites;
        `);
        localLogger.info('[NexusAI] Graph DB cleared');
      }

      // 2. Drop all vector store lance tables
      const droppedTables = await vectorStore.dropAllTables();
      localLogger.info(`[NexusAI] Dropped ${droppedTables} vector tables`);

      // 3. Tier 1: CAPI sync (accounts + all installs, fast)
      let capiResult = { accounts: 0, total: 0, newInstalls: [] as string[] };
      if (deps.wpeSyncService && localServicesBridge.isCAPIAvailable()) {
        capiResult = await deps.wpeSyncService.syncFromCAPI();
        localLogger.info(`[NexusAI] CAPI sync: ${capiResult.total} installs, ${capiResult.accounts} accounts`);
      }

      // 4. Tier 2: Full SSH sync (force all, staleThresholdHours=0)
      let syncResult = { synced: 0, skipped: 0, failed: 0 };
      if (deps.wpeSyncService && localServicesBridge.isCAPIAvailable()) {
        localLogger.info('[NexusAI] Starting full SSH sync...');
        syncResult = await deps.wpeSyncService.syncAllWPESites(undefined, 0);
        localLogger.info(`[NexusAI] SSH sync: ${syncResult.synced} synced, ${syncResult.failed} failed`);
      }

      return {
        success: true,
        graphCleared: true,
        vectorTablesDropped: droppedTables,
        capiInstalls: capiResult.total,
        sshSynced: syncResult.synced,
        sshFailed: syncResult.failed,
      };
    } catch (err: any) {
      localLogger.error('[NexusAI] Reset and refresh failed:', err.message);
      return { success: false, error: err.message };
    }
  });

  safeHandle(IPC_CHANNELS.WPE_CAPI_SYNC, async () => {
    if (!deps.wpeSyncService) return { success: false, error: 'Sync service not available' };
    try {
      const result = await deps.wpeSyncService.syncFromCAPI();
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  safeHandle(IPC_CHANNELS.CLEANUP_GHOST_INSTALLS, async () => {
    try {
      const db = graphService.getDb();
      if (!db) return { success: false, error: 'Graph DB not available' };
      const result = db.prepare(
        "DELETE FROM sites WHERE source='wpe' AND is_active=0"
      ).run();
      // Also clean up orphaned plugins/content/users for removed sites
      db.prepare("DELETE FROM plugins WHERE site_id NOT IN (SELECT id FROM sites)").run();
      db.prepare("DELETE FROM content WHERE site_id NOT IN (SELECT id FROM sites)").run();
      db.prepare("DELETE FROM users WHERE site_id NOT IN (SELECT id FROM sites)").run();
      localLogger.info(`[NexusAI] Cleaned up ${result.changes} ghost installs`);
      return { success: true, removed: result.changes };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  safeHandle(IPC_CHANNELS.CLEANUP_EXCLUDED_TYPES, async () => {
    try {
      // Clean vector store
      const vecResult = await vectorStore.cleanupExcludedTypes(EXCLUDED_POST_TYPES);

      // Clean graph DB content table
      const db = graphService.getDb();
      let graphRemoved = 0;
      if (db) {
        const placeholders = EXCLUDED_POST_TYPES.map(() => '?').join(',');
        const result = db.prepare(
          `DELETE FROM content WHERE post_type IN (${placeholders})`
        ).run(...EXCLUDED_POST_TYPES);
        graphRemoved = result.changes;
      }

      localLogger.info(
        `[NexusAI] Cleanup: removed ${vecResult.docsRemoved} vector docs + ${graphRemoved} graph content rows for excluded types`
      );

      return { success: true, vectorDocsRemoved: vecResult.docsRemoved, graphRowsRemoved: graphRemoved, tablesScanned: vecResult.tablesScanned };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  safeHandle(IPC_CHANNELS.WPE_SYNC_STOP, () => {
    if (!deps.wpeSyncService) return { success: false, error: 'Sync service not available' };
    deps.wpeSyncService.stopSync();
    return { success: true };
  });

  /**
   * Get WPE sync summary stats from graph DB for dashboard display
   */
  safeHandle(IPC_CHANNELS.WPE_SYNC_STATS, async () => {
    try {
      const db = graphService.getDb();
      if (!db) return { success: true, stats: null };

      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeSyncIntervalHours?: number } | null;
      const thresholdHours = settings?.wpeSyncIntervalHours ?? 8;
      const cutoff = Date.now() - thresholdHours * 60 * 60 * 1000;

      const row = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN wp_version IS NOT NULL THEN 1 ELSE 0 END) as has_wp_version,
          SUM(CASE WHEN php_version IS NOT NULL THEN 1 ELSE 0 END) as has_php_version,
          MAX(last_sync_at) as last_sync_at,
          SUM(CASE WHEN last_sync_at >= ? THEN 1 ELSE 0 END) as fresh_count,
          SUM(CASE WHEN last_sync_at IS NULL OR last_sync_at < ? THEN 1 ELSE 0 END) as stale_count
        FROM sites WHERE source = 'wpe'
      `).get(cutoff, cutoff) as {
        total: number; has_wp_version: number; has_php_version: number;
        last_sync_at: number | null; fresh_count: number; stale_count: number;
      } | undefined;

      return { success: true, stats: row ?? null, thresholdHours };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Get list of synced WPE sites
   */
  safeHandle(IPC_CHANNELS.WPE_GET_SYNCED_SITES, async () => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const sites = await deps.wpeSyncService.getSyncedWPESites();

      // Enrich sites with account_id from CAPI if available
      let wpeAuthError = false;
      if (localServicesBridge.isCAPIAvailable()) {
        try {
          const installs = await localServicesBridge.capiGetInstalls() as any[];
          const installMap = new Map(installs.map((i: any) => [i.id, i.account?.id]));

          sites.forEach((site: any) => {
            const accountId = installMap.get(site.remote_install_id);
            if (accountId) {
              site.account_id = accountId;
            }
          });
        } catch (err) {
          const status = (err as any)?.response?.status;
          if (status === 401 || status === 403) {
            wpeAuthError = true;
          } else {
            localLogger.warn('[NexusAI] Failed to enrich sites with account_id:', String(err));
          }
        }
      }

      return { success: true, sites, wpeAuthError };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to get synced WPE sites:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Get details for a specific WPE site
   */
  safeHandle(IPC_CHANNELS.WPE_GET_SITE_DETAILS, async (_event: any, installId: string) => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      // Validate input
      const validated = validateInput(WpeInstallIdSchema, installId);

      const sites = await deps.wpeSyncService.getSyncedWPESites();
      // installId could be:
      // - Full ID: "wpe-myinstprod"
      // - Stripped ID: "myinstprod"
      // - Install ID: "myinstprod"
      const site = sites.find((s: any) =>
        s.id === validated ||
        s.id === `wpe-${validated}` ||
        s.remote_install_id === validated ||
        s.install_id === validated
      );

      if (!site) {
        localLogger.warn(`[NexusAI] WPE site not found: ${validated}. Available sites:`, sites.map((s: any) => s.id));
        return { success: false, error: `Site not found: ${validated}` };
      }

      return { success: true, site };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to get WPE site details:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Re-sync a single WPE site
   */
  safeHandle(IPC_CHANNELS.WPE_SYNC_SINGLE, async (_event: any, params: { installId: string }) => {
    const startTime = Date.now();

    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      // Validate input
      const validated = validateInput(WpeSyncSingleSchema, params);
      let installId = validated.installId;

      // If looks like a name (not a UUID), resolve to UUID via graph
      const isUuid = /^[0-9a-f-]{36}$/i.test(installId);
      if (!isUuid) {
        const db = graphService.getDb();
        if (db) {
          const row = db.prepare(
            "SELECT remote_install_id FROM sites WHERE source='wpe' AND name=? LIMIT 1"
          ).get(installId) as { remote_install_id: string } | undefined;
          if (row?.remote_install_id) {
            installId = row.remote_install_id;
          } else {
            return { success: false, error: `Install "${installId}" not found in graph. Run Sync All first.` };
          }
        }
      }

      await deps.wpeSyncService.syncSingleSite(installId);

      // Audit log success
      auditLogger.logSuccess(
        'wpe_sync_single',
        installId,
        'wpe_install',
        {},
        Date.now() - startTime,
      );

      localLogger.info(`[NexusAI] Re-synced WPE site: ${installId}`);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to re-sync WPE site:', (err as Error).message);
      auditLogger.logFailure(
        'wpe_sync_single',
        params?.installId || 'unknown',
        'wpe_install',
        (err as Error).message,
        params,
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Run diagnostics on a WPE site
   *
   * Uses wp-nexus MCP tools to gather detailed site information
   */
  safeHandle(IPC_CHANNELS.WPE_DIAGNOSE_SITE, async (_event: any, installId: string) => {
    try {
      // Validate input
      const validated = validateInput(WpeInstallIdSchema, installId);

      // TODO: Call wpe_diagnose_site MCP tool when available
      // For now, return placeholder diagnostics
      const diagnostics = {
        sslStatus: 'active',
        backupStatus: 'recent',
        diskUsage: { used: 2.5, limit: 10, percentage: 25 },
        bandwidthUsage: { used: 150, limit: 500, percentage: 30 },
        cacheStatus: 'enabled',
        phpVersion: '8.1',
      };

      return { success: true, diagnostics };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to diagnose WPE site:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Remove a WPE site from the graph
   */
  safeHandle(IPC_CHANNELS.WPE_REMOVE_SITE, async (_event: any, params: { installId: string }) => {
    const startTime = Date.now();

    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      // Validate input
      const validated = validateInput(WpeRemoveSiteSchema, params);
      const installId = validated.installId;

      await deps.wpeSyncService.removeWPESite(installId);

      // Audit log success
      auditLogger.logSuccess(
        'wpe_remove_site',
        installId,
        'wpe_install',
        {},
        Date.now() - startTime,
      );

      localLogger.info(`[NexusAI] Removed WPE site: ${installId}`);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to remove WPE site:', (err as Error).message);
      auditLogger.logFailure(
        'wpe_remove_site',
        params?.installId || 'unknown',
        'wpe_install',
        (err as Error).message,
        params,
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Pull a WPE site to Local (PRODUCTION-READY VERSION)
   *
   * Fully automated pull with proper pre-flight checks:
   * - Validates WPE authentication
   * - Ensures SSH key is registered with CAPI
   * - Creates local site
   * - Links to WPE environment
   * - Triggers pull operation (database + files)
   */
  safeHandle(IPC_CHANNELS.WPE_PULL_TO_LOCAL, async (_event: any, params: { wpeSiteId: string; installName: string; installId: string }) => {
    const startTime = Date.now();
    try {
      // Validate input
      const validated = validateInput(WpePullToLocalSchema, params);

      if (!serviceContainer) {
        return { success: false, errorCode: 'SERVICE_UNAVAILABLE', error: 'Service container not initialized' };
      }

      localLogger.info(`[WpeAutoPull] Starting pull for ${validated.installName} (${validated.installId})`);

      // Initialize WpeAutoPullService with Local's service container
      const autoPullService = new WpeAutoPullService(serviceContainer);

      // Execute the pull with full automation
      const result = await autoPullService.pullToLocal({
        installId: validated.installId,
        installName: validated.installName,
        includeSql: true,
        environment: 'production',
      });

      if (result.success) {
        // Audit log success
        auditLogger.logSuccess(
          'wpe_pull_to_local',
          validated.installId,
          'wpe_install',
          { siteId: result.siteId, siteName: result.siteName },
          Date.now() - startTime,
        );

        localLogger.info(`[WpeAutoPull] SUCCESS: ${result.message}`);

        // Re-sync this install's metadata so the graph reflects post-pull state
        if (deps.wpeSyncService) {
          deps.wpeSyncService.syncSingleSite(validated.installId).catch((err: Error) => {
            localLogger.warn('[NexusAI] Post-pull sync failed (non-fatal):', err.message);
          });
        }

        return {
          success: true,
          siteId: result.siteId,
          siteName: result.siteName,
          installName: validated.installName,
          installId: validated.installId,
          message: result.message,
        };
      } else {
        // Audit log failure
        auditLogger.logFailure(
          'wpe_pull_to_local',
          validated.installId,
          'wpe_install',
          result.message || 'Pull to local failed',
          params,
          Date.now() - startTime,
        );

        localLogger.error(`[WpeAutoPull] FAILED: ${result.message} (${result.errorCode})`);
        return {
          success: false,
          errorCode: result.errorCode,
          error: result.message,
        };
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      const errorCode = (err as any)?.errorCode || 'UNKNOWN';

      // Audit log failure
      auditLogger.logFailure(
        'wpe_pull_to_local',
        params?.installId || 'unknown',
        'wpe_install',
        errorMsg,
        params,
        Date.now() - startTime,
      );

      localLogger.error('[WpeAutoPull] Unexpected error:', errorMsg, errorStack);

      return {
        success: false,
        errorCode,
        error: errorMsg,
      };
    }
  });

  /**
   * Get details for a single WPE site
   */
  safeHandle('nexus-ai:wpe:get-site-details', async (_event: any, installId: string) => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      // Validate input
      const validated = validateInput(WpeInstallIdSchema, installId);

      const site = await graphService.getSite(validated);

      if (!site) {
        return { success: false, error: 'Site not found' };
      }

      return { success: true, site };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to get WPE site details:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Re-sync metadata for a single WPE site
   */
  safeHandle('nexus-ai:wpe:sync-single-site', async (_event: any, installId: string) => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      // Validate input
      const validated = validateInput(WpeInstallIdSchema, installId);

      await deps.wpeSyncService.syncSingleSite(validated);
      localLogger.info(`[NexusAI] Re-synced WPE site: ${validated}`);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to re-sync WPE site:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });
  console.log('[NexusAI] 🟢 Registered nexus-ai:wpe:sync-single-site handler');

  /**
   * Get WPE accounts for tree view grouping
   */
  console.log('[NexusAI] 🟢 About to register capi:get-accounts handler...');
  safeHandle('capi:get-accounts', async () => {
    console.log('[NexusAI] 🔵 capi:get-accounts handler called');

    try {
      if (!localServicesBridge.isCAPIAvailable()) {
        console.warn('[NexusAI] ⚠️ CAPI not available - returning empty array');
        return [];
      }

      console.log('[NexusAI] 🔵 CAPI available, calling capiGetAccounts...');
      const accounts = (await localServicesBridge.capiGetAccounts()) as any[];
      console.log('[NexusAI] ✓ Got accounts:', accounts?.length || 0);

      if (accounts && accounts.length > 0) {
        console.log('[NexusAI] Sample account:', JSON.stringify(accounts[0]).slice(0, 200));
      }

      return accounts || [];
    } catch (err) {
      console.error('[NexusAI] ❌ CAPI error:', err);

      // Check if this is a 401 Unauthorized error
      const errorMessage = (err as Error).message || '';
      const isUnauthorized = errorMessage.includes('401') ||
                            errorMessage.includes('Unauthorized') ||
                            (err as any).response?.status === 401;

      if (isUnauthorized) {
        console.log('[NexusAI] 🔒 WPE not authenticated (401)');
        return { error: 'UNAUTHORIZED' };
      }

      localLogger.error('[NexusAI] Failed to get CAPI accounts:', (err as Error).message);
      return [];
    }
  });

  console.log('[NexusAI] ✓ Registered capi:get-accounts IPC handler');

  // ---------------------------------------------------------------------------
  // Digital Twin: Site Metadata Cache
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.GET_SITE_METADATA, async (_event: any, siteId: string) => {
    if (!metadataCache) {
      return { success: false, error: 'Metadata cache not available' };
    }

    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);

      const metadata = metadataCache.getWithAge(validated);
      return {
        success: true,
        metadata,
        ageString: metadata ? metadataCache.getAgeString(validated) : null,
      };
    } catch (err) {
      localLogger.error('[NexusAI] get-site-metadata failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.REFRESH_SITE_METADATA, async (_event: any, siteId: string) => {
    const startTime = Date.now();

    if (!metadataCache) {
      return { success: false, error: 'Metadata cache not available' };
    }

    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);
      siteId = validated; // Use validated value

      // Fetch metadata with auto-start/stop
      const result = await withSiteRunning(siteId, localServicesBridge, localLogger, async () => {
        // Fetch fresh metadata via WP-CLI
        const [wpVersion, plugins, themes] = await Promise.all([
          localServicesBridge.getWpVersion(siteId),
          localServicesBridge.getPlugins(siteId),
          localServicesBridge.getThemes(siteId),
        ]);

        // Store in cache
        metadataCache.set(siteId, {
          wpVersion: wpVersion ?? 'unknown',
          plugins: plugins.map(p => ({
            name: p.name,
            title: p.title,
            version: p.version,
            status: p.status as 'active' | 'inactive',
            file: p.file,
          })),
          themes: themes.map(t => ({
            name: t.name,
            title: t.title,
            version: t.version,
            status: t.status as 'active' | 'inactive',
          })),
          activeTheme: themes.find(t => t.status === 'active')?.name,
          updateSource: 'manual',
        });

        // Digital Twin: Also update IndexRegistry structure to refresh searchable data
        const existingEntry = indexRegistry.get(siteId);
        if (existingEntry?.structure) {
          indexRegistry.update(siteId, {
            structure: {
              ...existingEntry.structure,
              wpVersion: wpVersion ?? 'unknown',
              plugins: plugins.map(p => ({
                name: p.name,
                slug: p.file?.split('/')[0] ?? p.name,
                version: p.version,
                isActive: p.status === 'active',
                description: '',
              })),
              themes: themes.map(t => ({
                name: t.name,
                slug: t.name,
                version: t.version,
                isActive: t.status === 'active',
                isChildTheme: false,
              })),
            },
          });

          localLogger.info(`[NexusAI] Updated IndexRegistry structure after metadata refresh for site ${siteId}`);
        }

        const metadata = metadataCache.getWithAge(siteId);

        return {
          success: true,
          metadata,
          ageString: metadataCache.getAgeString(siteId),
          pluginCount: plugins.length,
          themeCount: themes.length,
        };
      });

      // Audit log success
      auditLogger.logSuccess(
        'refresh_site_metadata',
        siteId,
        'local_site',
        { pluginCount: result.pluginCount, themeCount: result.themeCount },
        Date.now() - startTime,
      );

      localLogger.info(`[NexusAI] Refreshed metadata for ${siteId}`);

      return {
        success: result.success,
        metadata: result.metadata,
        ageString: result.ageString,
      };
    } catch (err) {
      localLogger.error('[NexusAI] refresh-site-metadata failed:', (err as Error).message);
      auditLogger.logFailure(
        'refresh_site_metadata',
        siteId || 'unknown',
        'local_site',
        (err as Error).message,
        { siteId },
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  // ---------------------------------------------------------------------------
  // AI Gateway (Phase 2.3)
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.AI_GATEWAY_GET_USAGE, async (_event: any, options?: {
    siteId?: string;
    since?: number;
    until?: number;
    limit?: number;
  }) => {
    try {
      // Validate input
      const validated = validateInput(AIGatewayUsageOptionsSchema, options);

      const USAGE_KEY = 'nexus_ai_gateway_usage';
      const allRecords = (registryStorage.get(USAGE_KEY) ?? []) as any[];

      let filtered = allRecords;

      // Filter by site ID if provided
      if (validated?.siteId) {
        filtered = filtered.filter(r => r.siteId === validated.siteId);
      }

      // Filter by date range if provided
      if (validated?.since !== undefined) {
        filtered = filtered.filter(r => r.timestamp >= validated.since!);
      }
      if (validated?.until !== undefined) {
        filtered = filtered.filter(r => r.timestamp <= validated.until!);
      }

      // Apply limit (most recent first)
      if (validated?.limit) {
        filtered = filtered.slice(-validated.limit);
      }

      return { success: true, records: filtered };
    } catch (err) {
      localLogger.error('[NexusAI] ai-gateway-get-usage failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.AI_GATEWAY_GET_COST, async (_event: any, options?: {
    siteId?: string;
    startDate?: number;
    endDate?: number;
  }) => {
    try {
      // Validate input
      const validated = validateInput(AIGatewayCostOptionsSchema, options);

      const USAGE_KEY = 'nexus_ai_gateway_usage';
      const allRecords = (registryStorage.get(USAGE_KEY) ?? []) as any[];

      let filtered = allRecords;

      // Filter by site ID if provided
      if (validated?.siteId) {
        filtered = filtered.filter(r => r.siteId === validated.siteId);
      }

      // Filter by date range if provided
      if (validated?.startDate !== undefined) {
        filtered = filtered.filter(r => r.timestamp >= validated.startDate!);
      }
      if (validated?.endDate !== undefined) {
        filtered = filtered.filter(r => r.timestamp <= validated.endDate!);
      }

      // Calculate totals
      const totalCost = filtered.reduce((sum, r) => sum + (r.costUsd || 0), 0);
      const totalRequests = filtered.length;
      const totalTokens = filtered.reduce((sum, r) => sum + (r.totalTokens || 0), 0);
      const totalPromptTokens = filtered.reduce((sum, r) => sum + (r.promptTokens || 0), 0);
      const totalCompletionTokens = filtered.reduce((sum, r) => sum + (r.completionTokens || 0), 0);

      // Group by model
      const byModel: Record<string, { requests: number; cost: number; tokens: number }> = {};
      for (const record of filtered) {
        if (!byModel[record.model]) {
          byModel[record.model] = { requests: 0, cost: 0, tokens: 0 };
        }
        byModel[record.model].requests++;
        byModel[record.model].cost += record.costUsd || 0;
        byModel[record.model].tokens += record.totalTokens || 0;
      }

      return {
        success: true,
        totalCost,
        totalRequests,
        totalTokens,
        totalPromptTokens,
        totalCompletionTokens,
        byModel,
      };
    } catch (err) {
      localLogger.error('[NexusAI] ai-gateway-get-cost failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.AI_GATEWAY_GET_STATS, async (_event: any) => {
    try {
      const USAGE_KEY = 'nexus_ai_gateway_usage';
      const allRecords = (registryStorage.get(USAGE_KEY) ?? []) as any[];

      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);

      const lastHour = allRecords.filter(r => r.timestamp >= oneHourAgo);
      const lastDay = allRecords.filter(r => r.timestamp >= oneDayAgo);
      const lastWeek = allRecords.filter(r => r.timestamp >= oneWeekAgo);

      // Get unique sites
      const uniqueSites = new Set(allRecords.map(r => r.siteId));

      // Get most active site (last 24 hours)
      const siteActivity: Record<string, number> = {};
      for (const record of lastDay) {
        siteActivity[record.siteId] = (siteActivity[record.siteId] || 0) + 1;
      }
      const mostActiveSite = Object.entries(siteActivity)
        .sort(([, a], [, b]) => b - a)[0];

      return {
        success: true,
        stats: {
          totalRequests: allRecords.length,
          totalCost: allRecords.reduce((sum, r) => sum + (r.costUsd || 0), 0),
          totalTokens: allRecords.reduce((sum, r) => sum + (r.totalTokens || 0), 0),
          lastHour: {
            requests: lastHour.length,
            cost: lastHour.reduce((sum, r) => sum + (r.costUsd || 0), 0),
          },
          lastDay: {
            requests: lastDay.length,
            cost: lastDay.reduce((sum, r) => sum + (r.costUsd || 0), 0),
          },
          lastWeek: {
            requests: lastWeek.length,
            cost: lastWeek.reduce((sum, r) => sum + (r.costUsd || 0), 0),
          },
          uniqueSites: uniqueSites.size,
          mostActiveSite: mostActiveSite ? {
            siteId: mostActiveSite[0],
            requests: mostActiveSite[1],
          } : null,
        },
      };
    } catch (err) {
      localLogger.error('[NexusAI] ai-gateway-get-stats failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.AI_GATEWAY_CLEAR_USAGE, async (_event: any) => {
    const startTime = Date.now();
    try {
      const USAGE_KEY = 'nexus_ai_gateway_usage';
      const existingRecords = registryStorage.get(USAGE_KEY) || [];
      const recordCount = Array.isArray(existingRecords) ? existingRecords.length : 0;

      registryStorage.set(USAGE_KEY, []);

      // Audit log success
      auditLogger.logSuccess(
        'ai_gateway_clear_usage',
        'all',
        'registry',
        { recordsCleared: recordCount },
        Date.now() - startTime,
      );

      localLogger.info(`[NexusAI] Cleared ${recordCount} AI Gateway usage records`);
      return { success: true, recordsCleared: recordCount };
    } catch (err) {
      localLogger.error('[NexusAI] ai-gateway-clear-usage failed:', (err as Error).message);
      auditLogger.logFailure(
        'ai_gateway_clear_usage',
        'all',
        'registry',
        (err as Error).message,
        {},
        Date.now() - startTime,
      );
      return { success: false, error: (err as Error).message };
    }
  });

  // Rate limiting (Phase 2.4)
  safeHandle(IPC_CHANNELS.AI_GATEWAY_GET_RATE_LIMIT, async (_event: any, siteId: string) => {
    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);

      const { getRateLimit } = require('./ai-gateway/rate-limiter');
      const config = getRateLimit(registryStorage, validated);
      return { success: true, config };
    } catch (err) {
      localLogger.error('[NexusAI] ai-gateway-get-rate-limit failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.AI_GATEWAY_SET_RATE_LIMIT, async (_event: any, params: { siteId: string; config?: any }) => {
    try {
      // Validate input
      const validated = validateInput(AIGatewayRateLimitSchema, params);

      const { setRateLimit } = require('./ai-gateway/rate-limiter');
      setRateLimit(registryStorage, validated.siteId, validated.config);
      localLogger.info(`[NexusAI] Updated rate limit for site ${validated.siteId}`);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] ai-gateway-set-rate-limit failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.AI_GATEWAY_CHECK_RATE_LIMIT, async (_event: any, params: { siteId: string }) => {
    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, params.siteId);

      const { checkRateLimit } = require('./ai-gateway/rate-limiter');
      const status = checkRateLimit(registryStorage, validated);
      return { success: true, status };
    } catch (err) {
      localLogger.error('[NexusAI] ai-gateway-check-rate-limit failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // ---------------------------------------------------------------------------
  // AI Context File Generation
  // ---------------------------------------------------------------------------

  safeHandle(IPC_CHANNELS.AI_CONTEXT_GENERATE, async (_event: any, siteId: string) => {
    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);

      const site = siteData.getSite(validated);
      if (!site) {
        return { success: false, error: `Site ${validated} not found` };
      }

      // Get site metadata
      const metadata = metadataCache?.getWithAge(validated);

      // Get AI Gateway info
      const proxyInfo = registryStorage.get('ai_proxy_info') as any;

      // Find active theme from metadata
      let activeTheme: AIContextData['theme'];
      if (metadata?.activeTheme && metadata?.themes) {
        const themeData = metadata.themes.find(t => t.name === metadata.activeTheme);
        if (themeData) {
          activeTheme = {
            name: themeData.name,
            title: themeData.title,
            version: themeData.version,
          };
        }
      }

      // Build AI context data
      const contextData: AIContextData = {
        siteName: site.name,
        siteUrl: site.url || `http://${site.domain}`,
        sitePath: site.path,
        wpVersion: metadata?.wpVersion,
        phpVersion: site.phpVersion,
        mysqlPort: site.mysqlPort,
        plugins: metadata?.plugins,
        theme: activeTheme,
        generatedAt: Date.now(),
      };

      // Add AI Gateway config if available
      if (proxyInfo?.url && proxyInfo?.authToken) {
        contextData.aiGateway = {
          url: proxyInfo.url,
          token: proxyInfo.authToken,
          models: proxyInfo.models ?? [],
        };
      }

      // Generate context markdown
      const generator = new AIContextGenerator();
      const markdown = generator.generateContext(contextData);

      // Write to site root
      const fs = require('fs').promises;
      const path = require('path');
      const filePath = path.join(site.path, 'app', 'public', 'AI-CONTEXT.md');
      await fs.writeFile(filePath, markdown, 'utf-8');

      localLogger.info(`[NexusAI] Generated AI context file: ${filePath}`);
      return { success: true, filePath };
    } catch (err) {
      localLogger.error('[NexusAI] ai-context-generate failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.AI_CONTEXT_GET_STATUS, async (_event: any, siteId: string) => {
    try {
      // Validate input
      const validated = validateInput(SiteIdSchema, siteId);

      const site = siteData.getSite(validated);
      if (!site) {
        return { success: false, error: `Site ${validated} not found` };
      }

      const fs = require('fs').promises;
      const path = require('path');
      const filePath = path.join(site.path, 'app', 'public', 'AI-CONTEXT.md');

      try {
        const stats = await fs.stat(filePath);
        const ageMs = Date.now() - stats.mtimeMs;
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        const ageHours = Math.floor((ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        let ageString;
        if (ageDays > 0) {
          ageString = `${ageDays}d ${ageHours}h ago`;
        } else if (ageHours > 0) {
          ageString = `${ageHours}h ago`;
        } else {
          const ageMinutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
          ageString = `${ageMinutes}m ago`;
        }

        return {
          success: true,
          exists: true,
          filePath,
          lastModified: stats.mtimeMs,
          ageString,
        };
      } catch (statErr: any) {
        if (statErr.code === 'ENOENT') {
          return { success: true, exists: false, filePath };
        }
        throw statErr;
      }
    } catch (err) {
      localLogger.error('[NexusAI] ai-context-get-status failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // Database Scanner IPC handlers
  safeHandle(IPC_CHANNELS.DB_SCAN_ALL, async () => {
    try {
      const allSites = Object.values(siteData.getSites() as Record<string, any>);
      const statuses = localServicesBridge.getAllSiteStatuses();
      const runningSites = allSites.filter((s: any) => statuses[s.id] === 'running');

      if (runningSites.length === 0) {
        return { success: false, error: 'No running sites. Start at least one site first.' };
      }

      const results = await Promise.allSettled(
        runningSites.map(async (site: any) => {
          const { scanDatabase } = await import('./mcp/modules/db-scanner/db-scanner');
          const nexusServicesForDb = {
            siteData: {
              getSite: (id: string) => siteData.getSite(id),
              getSites: () => siteData.getSites(),
            },
            localServices: localServicesBridge,
            logger: localLogger,
          };
          const result = await scanDatabase(site.id, nexusServicesForDb as any);
          const { siteId: _sid, siteName: _sn, ...rest } = result as any;
          return { siteId: site.id, siteName: site.name, ...rest };
        })
      );

      const scans = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return { siteId: runningSites[i].id, siteName: runningSites[i].name, error: String(r.reason) };
      });

      // Sort worst first
      scans.sort((a: any, b: any) => (a.healthScore ?? 100) - (b.healthScore ?? 100));

      return { success: true, scans, scanned: runningSites.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  safeHandle(IPC_CHANNELS.DB_SCAN_SITE, async (_event: any, siteId: string) => {
    try {
      const site = siteData.getSite(siteId);
      if (!site) return { success: false, error: `Site ${siteId} not found` };

      const status = localServicesBridge.getSiteStatus(siteId);
      if (status !== 'running') {
        return { success: false, error: `Site "${site.name}" is not running. Start it first.` };
      }

      const nexusServicesForDb = {
        siteData: {
          getSite: (id: string) => {
            const s = siteData.getSite(id);
            if (!s) return null;
            return { id: s.id, name: s.name, path: s.path, domain: s.domain };
          },
          getSites: () => {
            const all = siteData.getSites();
            const result: Record<string, any> = {};
            for (const [id, s] of Object.entries(all) as [string, any][]) {
              result[id] = { id: s.id, name: s.name, path: s.path, domain: s.domain };
            }
            return result;
          },
        },
        localServices: localServicesBridge,
        registryStorage,
        logger: localLogger,
      } as any;

      const scan = await scanDatabase(siteId, nexusServicesForDb);
      return { success: true, scan };
    } catch (err) {
      localLogger.error('[NexusAI] db-scan-site failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // WPE Login — fire-and-forget so the Express OAuth server stays alive in the
  // main process independently of the IPC/GraphQL connection lifetime.
  // The caller should poll wpe status after this returns.
  safeHandle(IPC_CHANNELS.WPE_LOGIN_START, async () => {
    try {
      const wpeOAuth = (serviceContainer as any).wpeOAuth;
      if (!wpeOAuth) return { success: false, error: 'WPE OAuth service not available in this version of Local' };
      // Start auth in background — keeps server alive until callback is received
      wpeOAuth.authenticate().catch((err: Error) => {
        localLogger.warn('[NexusAI] WPE auth failed:', err.message);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle(IPC_CHANNELS.DB_GET_LAST_SCAN, async (_event: any, siteId: string) => {
    try {
      const cache = registryStorage.get(STORAGE_KEYS.DB_SCAN_CACHE) ?? {};
      const scan = (cache as Record<string, any>)[siteId] ?? null;
      return { success: true, scan };
    } catch (err) {
      localLogger.error('[NexusAI] db-get-last-scan failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, scan: null };
    }
  });

  console.log('[NexusAI] 🟢🟢🟢 registerIpcHandlers() COMPLETED - all handlers registered');
}
