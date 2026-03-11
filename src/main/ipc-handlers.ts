/**
 * IPC Handlers
 *
 * All Electron IPC handlers for the Nexus AI addon, extracted from index.ts
 * to keep the main entry point focused on initialization.
 */
import { IPC_CHANNELS, STORAGE_KEYS } from '../common/constants';
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcMain } = require('electron');

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
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const {
    siteData, localServicesBridge, indexRegistry, embeddingService,
    contentPipeline, vectorStore, registryStorage, localLogger, getMcpServer,
    graphService, eventProcessor, vectorDbPath, serviceContainer,
  } = deps;

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

  ipcMain.handle(IPC_CHANNELS.GET_MCP_INFO, () => {
    return getMcpServer()?.getConnectionInfo() ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.GET_FLEET_STATUS, () => {
    return indexRegistry.listAll();
  });

  ipcMain.handle(IPC_CHANNELS.GET_SITES, () => {
    try {
      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();
      const indexed = indexRegistry.listAll();
      const indexedIds = new Set(indexed.map((e: any) => e.siteId));

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
          indexed: indexedIds.has(site.id),
        };
      });
    } catch (err) {
      localLogger.error('[NexusAI] get-sites failed:', (err as Error).message);
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.GET_WPE_SITE_IDS, () => {
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

  ipcMain.handle(IPC_CHANNELS.GET_DASHBOARD_STATS, async () => {
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
          remoteInstalls = installs
            ? installs.filter((i: any) => !linkedRemoteIds.has(i.site?.id)).length
            : 0;
        }
      } catch {
        // CAPI may not be authenticated
      }

      // MCP server
      const mcpInfo = getMcpServer()?.getConnectionInfo() ?? null;

      // Embedding model
      const embeddingReady = embeddingService.isReady();

      // Index stats
      const indexEntries = indexRegistry.listAll();
      const indexedSites = indexEntries.filter((e: any) => e.state === 'indexed').length;
      const totalDocs = indexEntries.reduce((sum: number, e: any) => sum + (e.documentCount || 0), 0);
      const totalChunks = indexEntries.reduce((sum: number, e: any) => sum + (e.chunkCount || 0), 0);
      const lastIndexed = indexEntries.reduce((max: number, e: any) => Math.max(max, e.lastIndexed || 0), 0);

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
          sitesIndexed: indexedSites,
          totalSites: totalSites,
          totalDocuments: totalDocs,
          totalChunks: totalChunks,
          lastIndexed: lastIndexed || null,
        },
      };
    } catch (err) {
      localLogger.error('[NexusAI] get-dashboard-stats failed:', (err as Error).message);
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.START_SITE, async (_event: any, siteId: string) => {
    try {
      await localServicesBridge.startSite(siteId);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] start-site failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STOP_SITE, async (_event: any, siteId: string) => {
    try {
      await localServicesBridge.stopSite(siteId);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] stop-site failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SEARCH, async (_event: any, query: string, siteId?: string, limit?: number) => {
    try {
      const maxResults = limit ?? 10;
      const [queryVector] = await embeddingService.embedBatch([query]);

      if (siteId) {
        const results = await vectorStore.search(siteId, queryVector, { limit: maxResults });
        const site = siteData.getSite(siteId);
        return {
          results: results.map((r: any) => ({ ...r, siteId, siteName: site?.name ?? siteId })),
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

  ipcMain.handle(IPC_CHANNELS.INDEX_SITE, async (_event: any, siteId: string) => {
    try {
      const site = siteData.getSite(siteId);
      if (!site) {
        return { success: false, error: `Site ${siteId} not found` };
      }
      const result = await contentPipeline.indexSite({
        siteId: site.id,
        siteName: site.name,
        sitePath: site.path,
      });
      return {
        success: true,
        documentsIndexed: result.documentsIndexed,
        chunksIndexed: result.chunksIndexed,
        durationMs: result.durationMs,
        errors: result.errors,
      };
    } catch (err) {
      localLogger.error('[NexusAI] index-site failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, () => {
    try {
      const raw = registryStorage.get(STORAGE_KEYS.SETTINGS) as any;
      return raw ?? DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, (_event: any, partial: Partial<NexusSettings>) => {
    try {
      const raw = registryStorage.get(STORAGE_KEYS.SETTINGS) as any;
      const current: NexusSettings = raw ?? DEFAULT_SETTINGS;
      const updated = { ...current, ...partial };
      registryStorage.set(STORAGE_KEYS.SETTINGS, updated as any);
      return updated;
    } catch (err) {
      localLogger.error('[NexusAI] update-settings failed:', (err as Error).message);
      return DEFAULT_SETTINGS;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETUP_AI, async (_event: any, siteId: string) => {
    try {
      // Check if user has selected Ollama as their chat provider
      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;
      const enableOllama = settings?.chatProvider === 'ollama';

      return await setupSiteForAI(siteId, localServicesBridge, registryStorage, localLogger, {
        enableOllama,
      });
    } catch (err) {
      return {
        success: false,
        aiPlugin: 'failed' as const,
        providerPlugins: 'failed' as const,
        ollamaProvider: 'failed' as const,
        aiFeatures: 'failed' as const,
        credentials: 'failed' as const,
        acfAbilities: 'failed' as const,
        message: (err as Error).message,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // Event Tracking & Visibility (Sprint 1)
  // ---------------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.EVENTS_GET_TIMELINE, async (_event: any, options?: {
    limit?: number;
    filter?: string;
    status?: 'pending' | 'processed' | 'failed';
    siteId?: string;
  }) => {
    try {
      const events = await graphService.getRecentEvents(options as any);

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

  ipcMain.handle(IPC_CHANNELS.EVENTS_GET_STATS, async () => {
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

  ipcMain.handle(IPC_CHANNELS.STORAGE_GET_HEALTH, async () => {
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

  ipcMain.handle(IPC_CHANNELS.ISSUES_DETECT, async () => {
    try {
      const issues = await graphService.detectIssues();
      return { success: true, issues };
    } catch (err) {
      localLogger.error('[NexusAI] issues:detect failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, issues: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_CLEANUP, async (_event: any, options?: {
    retentionDays?: number;
  }) => {
    try {
      const retentionDays = options?.retentionDays ?? 30;
      const deleted = await graphService.cleanupOldData(retentionDays);

      localLogger.info(`[NexusAI] Cleaned up ${deleted} old events (retention: ${retentionDays} days)`);
      return { success: true, deletedCount: deleted.events };
    } catch (err) {
      localLogger.error('[NexusAI] storage:cleanup failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EVENTS_RETRY_FAILED, async () => {
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
  ipcMain.handle(IPC_CHANNELS.SEARCH_UNIFIED, async (_event: any, query: string, filters?: any, options?: any) => {
    try {
      localLogger.info('[NexusAI] Search request:', { query, filters, options });
      const results = await searchService.searchFleet(query, filters, options);
      localLogger.info('[NexusAI] Search results:', { total: results.total, resultCount: results.results.length });
      return { success: true, ...results };
    } catch (err) {
      localLogger.error('[NexusAI] search:unified failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, results: [], total: 0 };
    }
  });

  // Smart filters
  ipcMain.handle(IPC_CHANNELS.FILTERS_GET_COUNTS, async () => {
    try {
      const filters = await filterEngine.getFilterCounts();
      return { success: true, filters };
    } catch (err) {
      localLogger.error('[NexusAI] filters:get-counts failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, filters: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILTERS_APPLY, async (_event: any, filterId: string) => {
    try {
      const siteIds = await filterEngine.applyFilter(filterId);
      return { success: true, siteIds };
    } catch (err) {
      localLogger.error('[NexusAI] filters:apply failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, siteIds: [] };
    }
  });

  // Health scores
  ipcMain.handle(IPC_CHANNELS.HEALTH_GET_SCORE, async (_event: any, siteId: string) => {
    try {
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

  ipcMain.handle(IPC_CHANNELS.HEALTH_GET_ALL_SCORES, async () => {
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
  ipcMain.handle(IPC_CHANNELS.QUERIES_LIST, async () => {
    try {
      const queries = queryStorage.list();
      return { success: true, queries };
    } catch (err) {
      localLogger.error('[NexusAI] queries:list failed:', (err as Error).message);
      return { success: false, error: (err as Error).message, queries: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.QUERIES_CREATE, async (_event: any, query: any) => {
    try {
      const saved = await queryStorage.save(query);
      return { success: true, query: saved };
    } catch (err) {
      localLogger.error('[NexusAI] queries:create failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.QUERIES_UPDATE, async (_event: any, id: string, changes: any) => {
    try {
      const updated = await queryStorage.update(id, changes);
      return { success: true, query: updated };
    } catch (err) {
      localLogger.error('[NexusAI] queries:update failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.QUERIES_DELETE, async (_event: any, id: string) => {
    try {
      await queryStorage.delete(id);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] queries:delete failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.QUERIES_RUN, async (_event: any, id: string) => {
    try {
      const query = queryStorage.get(id);
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
      const enableOllama = options?.enableOllama ?? (settings?.chatProvider === 'ollama');
      return setupSiteForAI(siteId, localServicesBridge, registryStorage, localLogger, { enableOllama });
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

  ipcMain.handle(IPC_CHANNELS.BULK_EXECUTE, async (_event: any, request: any) => {
    try {
      const opId = await bulkOpManager.execute(request);
      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] bulk:execute failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BULK_STATUS, async (_event: any, opId: string) => {
    const status = bulkOpManager.getStatus(opId);
    return status ? { success: true, ...status } : { success: false, error: 'Operation not found' };
  });

  ipcMain.handle(IPC_CHANNELS.BULK_CANCEL, async (_event: any, opId: string) => {
    return { success: bulkOpManager.cancel(opId) };
  });

  ipcMain.handle(IPC_CHANNELS.BULK_LIST, async () => {
    return { success: true, operations: bulkOpManager.listAll() };
  });

  // --- Site Groups (Local native) ---

  ipcMain.handle(IPC_CHANNELS.GROUPS_LIST, async () => {
    try {
      const groups = localServicesBridge.getSiteGroups();
      return { success: true, groups };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GROUPS_CREATE, async (_event: any, args: { name: string }) => {
    try {
      const group = localServicesBridge.createSiteGroup(args.name);
      notifyGroupsChanged();
      return { success: true, group };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GROUPS_UPDATE, async (_event: any, id: string, changes: { name?: string }) => {
    try {
      if (changes.name) {
        const group = localServicesBridge.renameSiteGroup(id, changes.name);
        notifyGroupsChanged();
        return { success: true, group };
      }
      return { success: false, error: 'No changes specified' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GROUPS_DELETE, async (_event: any, id: string) => {
    try {
      localServicesBridge.deleteSiteGroup(id);
      notifyGroupsChanged();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GROUPS_ADD_SITE, async (_event: any, groupId: string, siteId: string) => {
    try {
      localServicesBridge.moveSitesToGroup([siteId], groupId);
      notifyGroupsChanged();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GROUPS_REMOVE_SITE, async (_event: any, groupId: string, siteId: string) => {
    try {
      localServicesBridge.removeSitesFromGroups([siteId]);
      notifyGroupsChanged();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // --- Health Trends ---

  ipcMain.handle(IPC_CHANNELS.HEALTH_GET_TREND, async (_event: any, siteId: string, days?: number) => {
    if (!healthTrendTracker) return { success: false, error: 'Health trend tracker not available' };
    return { success: true, trend: healthTrendTracker.getSiteTrend(siteId, days || 30) };
  });

  ipcMain.handle(IPC_CHANNELS.HEALTH_GET_FLEET_TREND, async (_event: any, days?: number) => {
    if (!healthTrendTracker) return { success: false, error: 'Health trend tracker not available' };
    return { success: true, trend: healthTrendTracker.getFleetTrend(days || 30) };
  });

  // --- Dashboard v2 ---

  ipcMain.handle(IPC_CHANNELS.DASHBOARD_V2_STATS, async () => {
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

  ipcMain.handle(IPC_CHANNELS.GET_AI_STATUS, async (_event: any, siteId?: string) => {
    try {
      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();
      const targetIds = siteId ? [siteId] : Object.keys(allSites);

      const results: Record<string, any> = {};
      for (const id of targetIds) {
        const site = allSites[id];
        if (!site) continue;

        const siteStatus = statuses[id] ?? 'unknown';
        let aiPlugin: 'active' | 'inactive' | 'not_installed' = 'not_installed';
        let ollamaProvider: 'active' | 'inactive' | 'not_installed' = 'not_installed';
        let credentialsSynced = false;
        const providers: string[] = [];

        // Always try to get plugin data — WP-CLI will fail naturally if site isn't running
        try {
          const plugins = await localServicesBridge.getPlugins(id);
          const ai = plugins.find((p: any) => p.name === 'ai');
          if (ai) {
            aiPlugin = ai.status === 'active' ? 'active' : 'inactive';
          }
          const ollama = plugins.find((p: any) => p.name === 'ai-provider-for-ollama');
          if (ollama) {
            ollamaProvider = ollama.status === 'active' ? 'active' : 'inactive';
          }

          // Check if credentials are synced by looking at stored keys
          const storedKeys = (registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
          for (const [provider, key] of Object.entries(storedKeys)) {
            if (key) providers.push(provider);
          }
          credentialsSynced = providers.length > 0;
        } catch {
          // Site may not be accessible — defaults remain
        }

        results[id] = {
          siteId: id,
          siteName: site.name,
          isRunning: siteStatus === 'running',
          aiPlugin,
          ollamaProvider,
          credentialsSynced,
          providers,
        };
      }

      return { success: true, sites: results };
    } catch (err) {
      localLogger.error('[NexusAI] get-ai-status failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GET_AI_PROXY_INFO, () => {
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

  ipcMain.handle(IPC_CHANNELS.SETUP_AI_FLEET, async (_event: any, options?: { siteIds?: string[] }) => {
    try {
      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();

      // Use provided siteIds or all running sites
      const targetIds = options?.siteIds
        ?? Object.keys(allSites).filter((id) => statuses[id] === 'running');

      if (targetIds.length === 0) {
        return { success: true, opId: null, message: 'No running sites to set up' };
      }

      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;
      const enableOllama = settings?.chatProvider === 'ollama';

      const opId = bulkOpManager.execute({
        type: 'setup-ai',
        siteIds: targetIds,
        options: { enableOllama },
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error('[NexusAI] setup-ai-fleet failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.INDEX_ALL_FLEET, async (_event: any, options?: { siteIds?: string[] }) => {
    try {
      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();

      // Use provided siteIds or all running sites
      const targetIds = options?.siteIds
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
  ipcMain.handle(IPC_CHANNELS.SETUP_AI_ALL_AUTO, async (_event: any) => {
    try {
      const allSites = siteData.getSites();
      const allSiteIds = Object.keys(allSites);

      if (allSiteIds.length === 0) {
        return { success: true, opId: null, message: "No sites to setup" };
      }

      const opId = bulkOpManager.execute({
        type: "setup-ai",
        siteIds: allSiteIds,
        options: { autoStartStop: true, enableOllama: false },
      });

      return { success: true, opId };
    } catch (err) {
      localLogger.error("[NexusAI] setup-ai-all-auto failed:", (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  // Auto-start/stop: Index ALL sites (including halted)
  ipcMain.handle(IPC_CHANNELS.INDEX_ALL_AUTO, async (_event: any) => {
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
  ipcMain.handle(IPC_CHANNELS.SYNC_GRAPH_ALL, async (_event: any) => {
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

  ipcMain.handle(IPC_CHANNELS.SITE_FINDER_GET_OPTIONS, async (_event: any) => {
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

  ipcMain.handle(IPC_CHANNELS.SITE_FINDER_APPLY, async (_event: any, filters: any) => {
    try {
      const allSites = siteData.getSites();
      const statuses = localServicesBridge.getAllSiteStatuses();
      const db = graphService.getDb();
      const matchingSiteIds: string[] = [];

      // Pre-filter by content if contentQuery is provided (semantic search)
      let contentMatchingSiteIds: Set<string> | null = null;
      if (filters.contentQuery && filters.contentQuery.trim()) {
        try {
          localLogger.info('[NexusAI] Running content search for:', filters.contentQuery);

          // Convert query text to embedding vector
          const queryVector = await embeddingService.embed(filters.contentQuery);

          // Search across all indexed sites (local + WPE)
          contentMatchingSiteIds = new Set<string>();
          const localSiteIds = Object.keys(allSites);

          // Get WPE site IDs from graph
          const wpeSites = await graphService.listSites({ source: 'wpe' });
          const wpeSiteIds = wpeSites.map(s => s.id);

          const allSearchableSiteIds = [...localSiteIds, ...wpeSiteIds];
          localLogger.info(`[NexusAI] Searching ${localSiteIds.length} local + ${wpeSiteIds.length} WPE sites for content`);

          for (const siteId of allSearchableSiteIds) {
            try {
              const results = await vectorStore.search(siteId, queryVector, {
                limit: 5, // Top 5 results per site
                relevanceFloor: 0.5, // Only return good matches
              });

              // If site has matching content, add it to the set
              if (results.length > 0) {
                contentMatchingSiteIds.add(siteId);
                localLogger.info('[NexusAI] Site', siteId, 'has', results.length, 'matching content (top score:', results[0].score.toFixed(3), ')');
              }
            } catch (err) {
              // Site not indexed or search failed - skip it
            }
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
        if (filters.searchText && filters.searchText.trim()) {
          const searchLower = filters.searchText.toLowerCase();
          const nameMatch = (site as any).name?.toLowerCase().includes(searchLower);
          const domainMatch = (site as any).domain?.toLowerCase().includes(searchLower);
          if (!nameMatch && !domainMatch) {
            matches = false;
          }
        }

        // PHP version filter (available even when stopped) - OR logic within array
        if (matches && filters.phpVersions && filters.phpVersions.length > 0) {
          const phpVersion = (site as any).phpVersion;
          if (!filters.phpVersions.includes(phpVersion)) {
            matches = false;
          }
        }

        // Plugin filter (use graph - works on all sites) - OR logic within array
        if (matches && filters.plugins && filters.plugins.length > 0) {
          if (db) {
            const placeholders = filters.plugins.map(() => '?').join(',');
            const pluginRow = db.prepare(`SELECT 1 FROM plugins WHERE site_id = ? AND slug IN (${placeholders}) LIMIT 1`)
              .get(siteId, ...filters.plugins);
            if (!pluginRow) matches = false;
          } else {
            matches = false;
          }
        }

        // WP version filter (use graph - works on all sites) - OR logic within array
        if (matches && filters.wpVersions && filters.wpVersions.length > 0) {
          if (db) {
            const siteRow = db.prepare('SELECT wp_version FROM sites WHERE id = ? LIMIT 1')
              .get(siteId) as any;
            if (!siteRow || !filters.wpVersions.includes(siteRow.wp_version)) {
              matches = false;
            }
          } else {
            matches = false;
          }
        }

        // Theme filter (requires WP-CLI - running sites only) - OR logic within array
        if (matches && filters.themes && filters.themes.length > 0) {
          if (!isRunning) {
            matches = false;
          } else {
            try {
              const themes = await localServicesBridge.getThemes(siteId);
              const hasAnyTheme = themes.some((t: any) => filters.themes.includes(t.name));
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
        if (filters.searchText && filters.searchText.trim()) {
          const searchLower = filters.searchText.toLowerCase();
          const nameMatch = wpeSite.name?.toLowerCase().includes(searchLower);
          const domainMatch = wpeSite.domain?.toLowerCase().includes(searchLower);
          if (!nameMatch && !domainMatch) {
            matches = false;
          }
        }

        // Plugin filter (use graph)
        if (matches && filters.plugins && filters.plugins.length > 0) {
          if (db) {
            const placeholders = filters.plugins.map(() => '?').join(',');
            const pluginRow = db.prepare(`SELECT 1 FROM plugins WHERE site_id = ? AND slug IN (${placeholders}) LIMIT 1`)
              .get(wpeSite.id, ...filters.plugins);
            if (!pluginRow) matches = false;
          } else {
            matches = false;
          }
        }

        // WP version filter (use graph)
        if (matches && filters.wpVersions && filters.wpVersions.length > 0) {
          if (!filters.wpVersions.includes(wpeSite.wp_version)) {
            matches = false;
          }
        }

        // Skip theme filter for WPE sites (requires WP-CLI on running sites)
        if (matches && filters.themes && filters.themes.length > 0) {
          matches = false; // WPE sites don't support theme filtering yet
        }

        if (matches) {
          matchingSiteIds.push(wpeSite.id);
        }
      }

      localLogger.info(`[NexusAI] Site Finder results: ${matchingSiteIds.length} total (local + WPE)`);

      return { success: true, siteIds: matchingSiteIds };
    } catch (err) {
      localLogger.error('[NexusAI] site-finder:apply failed:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SITE_FINDER_AI_PARSE, async (_event: any, payload: { conversation: Array<{ role: string; content: string }> }) => {
    try {
      const { getProvider } = require('./chat/providers/index');

      // Get settings to determine which provider to use
      const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;
      const apiKeys = (registryStorage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;

      const chatProvider = settings?.chatProvider ?? 'ollama';
      const chatModel = settings?.chatModel ?? 'llama3.2';
      const apiKey = apiKeys[chatProvider];

      localLogger.info('[NexusAI] AI parse request - provider:', chatProvider, 'model:', chatModel, 'hasKey:', !!apiKey);

      // Check if provider is available
      if (chatProvider !== 'ollama' && !apiKey) {
        return {
          success: false,
          error: `No API key configured for ${chatProvider}. Please configure in Settings.`,
        };
      }

      const provider = getProvider(chatProvider);
      if (!provider) {
        return {
          success: false,
          error: `Provider ${chatProvider} not available. Try reloading the addon.`,
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
        ...payload.conversation.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
      ];

      // Stream and collect response
      const abortController = new AbortController();
      let responseText = '';
      let eventCount = 0;

      localLogger.info('[NexusAI] Starting AI parse with provider:', chatProvider, 'model:', chatModel);

      const stream = provider.streamChat(
        messages,
        [], // No tools for this call
        { model: chatModel, apiKey },
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

  ipcMain.handle(IPC_CHANNELS.SIDEBAR_FILTER, async (event: any, payload: { siteIds: string[] }) => {
    try {
      sidebarFilteredSiteIds = payload.siteIds || [];

      // Broadcast filter to renderer via CSS injection
      const siteIds = payload.siteIds || [];
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

  ipcMain.handle(IPC_CHANNELS.SIDEBAR_BULK_ACTION, async (_event: any, payload: { action: string; siteIds: string[] }) => {
    try {
      const { action, siteIds } = payload;

      if (!siteIds || siteIds.length === 0) {
        return { success: false, error: 'No sites selected' };
      }

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
  // WPE Site Sync Handlers (Phase 1)
  // =========================================================================

  /**
   * Sync all WPE sites from wp-nexus MCP
   */
  ipcMain.handle(IPC_CHANNELS.WPE_SYNC_ALL, async (_event: any, options?: { limit?: number }) => {
    if (!deps.wpeSyncService) {
      localLogger.warn('[NexusAI] WPE sync service not initialized');
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const limit = options?.limit;
      localLogger.info(`[NexusAI] Starting WPE site sync${limit ? ` (limit: ${limit})` : ''}...`);
      const result = await deps.wpeSyncService.syncAllWPESites(limit);
      localLogger.info(`[NexusAI] WPE sync completed: ${result.synced} synced, ${result.failed} failed`);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      localLogger.error('[NexusAI] WPE sync failed:', errorMsg, errorStack);
      return { success: false, error: errorMsg };
    }
  });

  /**
   * Get current sync progress
   */
  ipcMain.handle(IPC_CHANNELS.WPE_SYNC_STATUS, async () => {
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

  /**
   * Get list of synced WPE sites
   */
  ipcMain.handle(IPC_CHANNELS.WPE_GET_SYNCED_SITES, async () => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    try {
      const sites = await deps.wpeSyncService.getSyncedWPESites();
      return { success: true, sites };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to get synced WPE sites:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Remove a WPE site from the graph
   */
  ipcMain.handle(IPC_CHANNELS.WPE_REMOVE_SITE, async (_event: any, installId: string) => {
    if (!deps.wpeSyncService) {
      return { success: false, error: 'WPE sync service not available' };
    }

    if (!installId) {
      return { success: false, error: 'installId is required' };
    }

    try {
      await deps.wpeSyncService.removeWPESite(installId);
      localLogger.info(`[NexusAI] Removed WPE site: ${installId}`);
      return { success: true };
    } catch (err) {
      localLogger.error('[NexusAI] Failed to remove WPE site:', (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * Pull a WPE site to Local
   * Creates a new local site and initiates a pull from WP Engine
   */
  ipcMain.handle(IPC_CHANNELS.WPE_PULL_TO_LOCAL, async (_event: any, { wpeSiteId, installName }: { wpeSiteId: string; installName: string }) => {
    try {
      localLogger.info(`[NexusAI] Starting pull to local for WPE site: ${installName}`);

      // Generate local site name (strip special chars from install name)
      const localSiteName = installName
        .replace(/[^a-z0-9\s-]/gi, "")
        .replace(/\s+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();

      // Check if site already exists
      const existingSites = siteData.getSites();
      const siteExists = existingSites.some((s: any) => 
        s.name.toLowerCase() === localSiteName.toLowerCase()
      );

      if (siteExists) {
        localLogger.warn(`[NexusAI] Local site "${localSiteName}" already exists`);
        return {
          success: false,
          error: `A local site named "${localSiteName}" already exists. Use a different name or delete the existing site first.`
        };
      }

      // Create local site
      localLogger.info(`[NexusAI] Creating local site: ${localSiteName}`);
      const newSite = await localServicesBridge.createSite({
        name: installName, // Use original name (Local will sanitize it)
      });

      localLogger.info(`[NexusAI] Local site created: ${newSite.id} (${newSite.name})`);

      // Start the site (required for pull to work)
      localLogger.info(`[NexusAI] Starting site ${newSite.id}...`);
      await localServicesBridge.startSite(newSite.id);

      // Wait a bit for site to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      localLogger.info(`[NexusAI] Site started. Pull operation ready.`);
      localLogger.info(`[NexusAI] User should manually link site to WPE and pull via Local UI.`);

      return {
        success: true,
        siteId: newSite.id,
        siteName: newSite.name,
        message: `Local site "${newSite.name}" created and started. Now link it to your WP Engine environment and pull via the Local UI.`
      };

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      localLogger.error("[NexusAI] Pull to local failed:", errorMsg, errorStack);
      return { success: false, error: errorMsg };
    }
  });

}
