/**
 * IPC Handlers
 *
 * All Electron IPC handlers for the Nexus AI addon, extracted from index.ts
 * to keep the main entry point focused on initialization.
 */
import { IPC_CHANNELS } from '../common/constants';
import type { IndexRegistry } from './content/IndexRegistry';
import type { EmbeddingService } from './embeddings/EmbeddingService';
import type { McpServer } from './mcp/McpServer';
import type { LocalServicesBridge } from './mcp/local-services-bridge';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcMain } = require('electron');

export interface IpcHandlerDeps {
  siteData: any;
  localServicesBridge: LocalServicesBridge;
  indexRegistry: IndexRegistry;
  embeddingService: EmbeddingService;
  localLogger: any;
  getMcpServer: () => McpServer | null;
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { siteData, localServicesBridge, indexRegistry, embeddingService, localLogger, getMcpServer } = deps;

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
}
