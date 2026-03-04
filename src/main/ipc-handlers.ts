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
import { setupSiteForAI } from './mcp/modules/wp-connector/setup-ai';

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
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const {
    siteData, localServicesBridge, indexRegistry, embeddingService,
    contentPipeline, vectorStore, registryStorage, localLogger, getMcpServer,
  } = deps;

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
}
