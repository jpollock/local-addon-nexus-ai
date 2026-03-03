import * as path from 'path';
import * as os from 'os';
import { IPC_CHANNELS, OLLAMA_POLL_INTERVAL_MS } from '../common/constants';
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
import { registerOllamaTools, refreshOllamaStatus } from './mcp/modules/ollama/index';
import { registerFleetTools } from './mcp/modules/fleet/index';
import { registerSiteManagementTools } from './mcp/modules/site-management/index';
import { registerWpCliTools } from './mcp/modules/wp-cli/index';
import { registerWpeTools } from './mcp/modules/wpe/index';
import { registerCompositeTools } from './mcp/modules/composite/index';
import { registerWpConnectorTools } from './mcp/modules/wp-connector/index';
import { saveConnectionInfo, deleteConnectionInfo } from './mcp/connection-info';
import { registerLifecycleHooks } from './content/lifecycle-hooks';
import { createLocalServicesBridge } from './mcp/local-services-bridge';
import { createAuditLogger } from './mcp/audit';
import { InstructionRegistry, registerAllInstructions } from './mcp/instructions';
import { registerIpcHandlers } from './ipc-handlers';
import { initializeProviders } from './chat/providers/index';
import { ChatService } from './chat/ChatService';
import { registerChatIpcHandlers } from './chat/chat-ipc-handlers';

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
        ipcMain?.emit?.(IPC_CHANNELS.STATUS_CHANGE, siteId, status);
      } catch {
        // Renderer may not be ready
      }
    },
  });

  // Readiness gate: resolves when VectorStore + EmbeddingService are initialized.
  // Lifecycle hooks await this before indexing to avoid race conditions.
  let resolveReady: () => void;
  let rejectReady: (err: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  // Phase 2: Register lifecycle hooks (pass readyPromise so they wait for init)
  const localServicesBridge = createLocalServicesBridge(serviceContainer);
  registerLifecycleHooks(context, contentPipeline, indexRegistry, localLogger, readyPromise, registryStorage, localServicesBridge);

  // Phase 3: Boot MCP server (async — does not block addon load)
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
    registryStorage,
  };

  const registry = new ToolRegistry();
  registerContentTools(registry);
  registerSiteContextTools(registry);
  registerOllamaTools(registry);
  registerFleetTools(registry);
  registerSiteManagementTools(registry);
  registerWpCliTools(registry);
  registerWpeTools(registry);
  registerCompositeTools(registry);
  registerWpConnectorTools(registry);

  // Phase 3b: Chat providers + service
  initializeProviders();

  const chatService = new ChatService({
    registry,
    services: nexusServices,
    sendToRenderer: (channel: string, ...args: unknown[]) => {
      try {
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          win.webContents.send(channel, ...args);
        }
      } catch {
        // Renderer may not be ready
      }
    },
  });

  // Async initialization
  (async () => {
    try {
      await vectorStore.initialize();
      localLogger.info('[NexusAI] VectorStore initialized');

      await embeddingService.initialize();
      localLogger.info('[NexusAI] EmbeddingService initialized');

      // Signal readiness — lifecycle hooks waiting to index can now proceed
      resolveReady!();

      const instructionRegistry = new InstructionRegistry();
      registerAllInstructions(instructionRegistry);

      mcpServer = new McpServer({ services: nexusServices, registry, instructionRegistry });
      const connectionInfo = await mcpServer.start();
      saveConnectionInfo(connectionInfo);

      localLogger.info(`[NexusAI] MCP server running on ${connectionInfo.url}`);
      localLogger.info(`[NexusAI] Tools: ${connectionInfo.tools.join(', ')}`);

      // Start Ollama availability polling
      refreshOllamaStatus();
      setInterval(() => refreshOllamaStatus(), OLLAMA_POLL_INTERVAL_MS);
    } catch (err) {
      rejectReady!(err as Error);
      localLogger.error('[NexusAI] Failed to start:', (err as Error).message, (err as Error).stack);
    }
  })();

  // Phase 4: IPC handlers
  registerIpcHandlers({
    siteData,
    localServicesBridge,
    indexRegistry,
    embeddingService,
    contentPipeline,
    vectorStore,
    registryStorage,
    localLogger,
    getMcpServer: () => mcpServer,
  });

  registerChatIpcHandlers({
    chatService,
    registryStorage,
    localLogger,
  });

  localLogger.info('[NexusAI] Addon loaded');
}
