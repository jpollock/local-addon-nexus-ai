import * as path from 'path';
import * as os from 'os';
import { VectorStore } from './vector-store/VectorStore';
import { EmbeddingService } from './embeddings/EmbeddingService';
import { ContentPipeline } from './content/ContentPipeline';
import { MySQLExtractor } from './content/MySQLExtractor';
import { FileScanner } from './content/FileScanner';
import { IndexRegistry, RegistryStorage } from './content/IndexRegistry';
import { ToolRegistry } from './mcp/tool-registry';
import { McpServer } from './mcp/McpServer';
import { NexusServices, SiteDataAccessor, LocalSiteInfo } from './mcp/types';
import { registerContentTools } from './mcp/modules/content/index';
import { registerSiteContextTools } from './mcp/modules/site-context/index';
import { registerOllamaTools } from './mcp/modules/ollama/index';
import { registerFleetTools } from './mcp/modules/fleet/index';
import { registerSiteManagementTools } from './mcp/modules/site-management/index';
import { registerWpCliTools } from './mcp/modules/wp-cli/index';
import { registerWpeTools } from './mcp/modules/wpe/index';
import { saveConnectionInfo, deleteConnectionInfo } from './mcp/connection-info';
import { registerLifecycleHooks } from './content/lifecycle-hooks';
import { createLocalServicesBridge } from './mcp/local-services-bridge';
import { createAuditLogger } from './mcp/audit';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LocalMain = require('@getflywheel/local/main');
const { ipcMain } = require('electron');

let mcpServer: McpServer | null = null;

export default function main(context: any): void {
  const serviceContainer = LocalMain.getServiceContainer().cradle;
  const { localLogger, userData, siteData } = serviceContainer;

  localLogger.info('[NexusAI] Addon loading...');

  // Build adapter for IndexRegistry persistence via Local's userData
  const registryStorage: RegistryStorage = {
    get: (key: string) => userData.get(key) ?? null,
    set: (key: string, value: any) => userData.set(key, value),
  };

  // Build SiteDataAccessor from Local's siteData service
  const siteDataAccessor: SiteDataAccessor = {
    getSite: (id: string): LocalSiteInfo | null => {
      const site = siteData.getSite(id);
      if (!site) return null;
      return { id: site.id, name: site.name, path: site.path, domain: site.domain };
    },
    getSites: (): Record<string, LocalSiteInfo> => {
      const all = siteData.getSites();
      const result: Record<string, LocalSiteInfo> = {};
      for (const [id, site] of Object.entries(all) as [string, any][]) {
        result[id] = { id: site.id, name: site.name, path: site.path, domain: site.domain };
      }
      return result;
    },
  };

  // Resolve paths — __dirname is lib/main/, so go up two levels to addon root
  const addonDir = path.resolve(__dirname, '..', '..');
  const modelsDir = path.join(addonDir, 'models', 'all-MiniLM-L6-v2-quantized');
  const localDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  const vectorDbDir = path.join(localDataDir, 'nexus-ai', 'vectors');

  // Phase 1: Initialize foundation services (async)
  const vectorStore = new VectorStore(vectorDbDir);
  const embeddingService = new EmbeddingService(modelsDir);
  const fileScanner = new FileScanner();
  const mysqlExtractor = new MySQLExtractor();
  const indexRegistry = new IndexRegistry(registryStorage);

  const contentPipeline = new ContentPipeline({
    vectorStore,
    embeddingService,
    mysqlExtractor,
    fileScanner,
    indexRegistry,
    onStatusChange: (siteId, status) => {
      // Broadcast to renderer for UI updates
      if (status.state === 'indexing') {
        localLogger.info(`[NexusAI] Indexing ${siteId}: ${status.message} (${status.progress}%)`);
      }
      try {
        ipcMain?.emit?.('nexus-ai:status-change', siteId, status);
      } catch {
        // Renderer may not be ready
      }
    },
  });

  // Phase 2: Register lifecycle hooks
  registerLifecycleHooks(context, contentPipeline, indexRegistry, localLogger);

  // Phase 3: Boot MCP server (async — does not block addon load)
  const localServicesBridge = createLocalServicesBridge(serviceContainer);
  const auditLogger = createAuditLogger(
    path.join(localDataDir, 'nexus-ai', 'audit.log'),
  );

  const nexusServices: NexusServices = {
    vectorStore,
    embeddingService,
    contentPipeline,
    indexRegistry,
    fileScanner,
    siteData: siteDataAccessor,
    logger: localLogger,
    localServices: localServicesBridge,
    auditLogger,
  };

  const registry = new ToolRegistry();
  registerContentTools(registry);
  registerSiteContextTools(registry);
  registerOllamaTools(registry);
  registerFleetTools(registry);
  registerSiteManagementTools(registry);
  registerWpCliTools(registry);
  registerWpeTools(registry);

  // Async initialization
  (async () => {
    try {
      await vectorStore.initialize();
      localLogger.info('[NexusAI] VectorStore initialized');

      await embeddingService.initialize();
      localLogger.info('[NexusAI] EmbeddingService initialized');

      mcpServer = new McpServer({ services: nexusServices, registry });
      const connectionInfo = await mcpServer.start();
      saveConnectionInfo(connectionInfo);

      localLogger.info(`[NexusAI] MCP server running on ${connectionInfo.url}`);
      localLogger.info(`[NexusAI] Tools: ${connectionInfo.tools.join(', ')}`);
    } catch (err) {
      localLogger.error('[NexusAI] Failed to start:', (err as Error).message, (err as Error).stack);
    }
  })();

  // Phase 4: IPC handlers (for future UI)
  ipcMain.handle('nexus-ai:get-mcp-info', () => {
    return mcpServer?.getConnectionInfo() ?? null;
  });

  ipcMain.handle('nexus-ai:get-fleet-status', () => {
    return indexRegistry.listAll();
  });

  localLogger.info('[NexusAI] Addon loaded');
}
