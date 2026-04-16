import * as path from 'path';
import * as os from 'os';
import { IPC_CHANNELS, OLLAMA_POLL_INTERVAL_MS, STORAGE_KEYS } from '../common/constants';
import { OperationTracker } from './operation-tracker';
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
import { registerDbScannerTools } from './mcp/modules/db-scanner/index';
import { registerWpConnectorTools } from './mcp/modules/wp-connector/index';
import { registerFleetIntelligenceTools } from './mcp/modules/fleet-intelligence/index';
import { registerTelemetryTools } from './mcp/modules/telemetry-tools';
import { registerTelemetryControlTools } from './mcp/modules/telemetry-control-tools';
import { createSearchToolsHandler } from './mcp/modules/search-tools';
import { registerTestTools } from './mcp/modules/test-tools';
import { saveConnectionInfo, loadConnectionInfo, deleteConnectionInfo } from './mcp/connection-info';
import { registerLifecycleHooks } from './content/lifecycle-hooks';
import { createLocalServicesBridge } from './mcp/local-services-bridge';
import { createAuditLogger } from './mcp/audit';
import { InstructionRegistry, registerAllInstructions } from './mcp/instructions';
import { registerIpcHandlers } from './ipc-handlers';
import { initializeProviders } from './chat/providers/index';
import { ChatService } from './chat/ChatService';
import { registerChatIpcHandlers } from './chat/chat-ipc-handlers';
import { GraphService } from './events/GraphService';
import { EventProcessor } from './events/EventProcessor';
import { HttpEventInterface } from './events/HttpEventInterface';
import { CredentialSyncBroadcaster } from './credentials/CredentialSyncBroadcaster';
import { WPESyncService } from './events/WPESyncService';
import { RemoteContentExtractor } from './content/RemoteContentExtractor';
import { AiProxyServer } from './ai-proxy/AiProxyServer';
import { typeDefs } from './graphql/schema';
import { createResolvers } from './graphql/resolvers';
import { SiteMetadataCache } from './metadata/SiteMetadataCache';
import { StartupSiteScanner } from './startup/StartupSiteScanner';
import { HaltedSiteRefreshScheduler } from './startup/HaltedSiteRefreshScheduler';
import { WpeRefreshScheduler } from './startup/WpeRefreshScheduler';
import { SiteDigitalTwinService } from './twin/SiteDigitalTwinService';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LocalMain = require('@getflywheel/local/main');
const { ipcMain } = require('electron');

let mcpServer: McpServer | null = null;

export default function main(context: any): void {
  console.log('[NexusAI] 🟢🟢🟢 MAIN ENTRY POINT CALLED');
  const serviceContainer = LocalMain.getServiceContainer().cradle;
  const { localLogger, userData, siteData, graphql } = serviceContainer;
  console.log('[NexusAI] 🟢 Service container loaded');

  localLogger.info('[NexusAI] Addon loading...');

  // Build adapter for IndexRegistry persistence via Local's userData
  const registryStorage: RegistryStorage = {
    get: (key: string) => userData.get(key) ?? null,
    set: (key: string, value: any) => userData.set(key, value),
  };

  // Digital Twin: Site metadata cache (created early for lifecycle hooks)
  const metadataCache = new SiteMetadataCache(registryStorage);

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
  const graphDbPath = path.join(localDataDir, 'nexus-ai', 'graph.db');

  // Phase 1: Initialize foundation services (async)
  const vectorStore = new VectorStore(vectorDbDir);
  const embeddingService = new EmbeddingService(modelsDir);
  const fileScanner = new FileScanner();
  const mysqlExtractor = new MySQLExtractor();
  const indexRegistry = new IndexRegistry(registryStorage);
  const graphService = new GraphService(graphDbPath, localLogger);

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
  registerLifecycleHooks(context, contentPipeline, indexRegistry, localLogger, readyPromise, registryStorage, localServicesBridge, metadataCache);

  // Phase 3: Boot MCP server (async — does not block addon load)
  const auditLogger = createAuditLogger(
    path.join(localDataDir, 'nexus-ai', 'audit.log'),
  );

  // Initialize event processor
  const eventProcessor = new EventProcessor({
    graphService,
    vectorStore,
    embeddingService,
    logger: localLogger,
  });

  // Initialize HTTP event interface.
  // Reuse the same auth token across restarts so MU plugin credentials stay valid.
  const savedWebhookToken = registryStorage.get('http_webhook_auth_token') as string | null;
  const httpEventInterface = new HttpEventInterface({
    eventProcessor,
    logger: localLogger,
    storage: registryStorage,
    authToken: savedWebhookToken ?? undefined,
  });

  // Initialize WPE sync service (Phase 1-2)
  const remoteContentExtractor = new RemoteContentExtractor({
    localServices: localServicesBridge,
    logger: localLogger,
  });
  const wpeSyncService = new WPESyncService({
    graphService,
    localServices: localServicesBridge,
    remoteContentExtractor,
    embeddingService,
    vectorStore,
    logger: localLogger,
    registryStorage,
  });

  // Start operation tracker — intercepts Local's IPC events for push/pull/export
  const operationTracker = new OperationTracker();
  operationTracker.start();

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
    graphService: graphService as any,
    eventProcessor: eventProcessor as any,
    httpEventInterface: httpEventInterface as any,
    operationTracker,
    metadataCache,
    twinService: new SiteDigitalTwinService({
      siteData: siteDataAccessor,
      metadataCache,
      indexRegistry,
      graphService,
    }),
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
  registerDbScannerTools(registry);
  registerWpConnectorTools(registry);
  registerFleetIntelligenceTools(registry);
  registerTelemetryTools(registry);
  registerTelemetryControlTools(registry);
  // search_tools registered last so it can search all other tools
  registry.register(createSearchToolsHandler(registry));
  if (process.env.NEXUS_E2E_MODE === '1') {
    registerTestTools(registry);
    localLogger.info('[NexusAI] Test tools registered (NEXUS_E2E_MODE=1)');
  }

  // Phase 3a: Register GraphQL schema for Nexus CLI
  if (graphql) {
    try {
      const resolvers = createResolvers({
        registry,
        services: nexusServices as any,
      });
      graphql.registerGraphQLService('nexus-ai', typeDefs, resolvers);
      localLogger.info('[NexusAI] Registered GraphQL: 5 CLI mutations (POC)');
    } catch (error: any) {
      localLogger.error('[NexusAI] Failed to register GraphQL:', error);
    }
  } else {
    localLogger.warn('[NexusAI] GraphQL service not available - CLI will not work');
  }

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

      await graphService.initialize();
      localLogger.info('[NexusAI] GraphService initialized');

      await eventProcessor.initialize();
      localLogger.info('[NexusAI] EventProcessor initialized');

      const httpInfo = await httpEventInterface.start();
      localLogger.info(`[NexusAI] HTTP Event Interface running on ${httpInfo.url}`);
      localLogger.info(`[NexusAI] WordPress webhook endpoint: ${httpInfo.url}/wp-events`);
      localLogger.info(`[NexusAI] Auth token: ${httpInfo.authToken.substring(0, 16)}...`);

      // Store connection info for WordPress plugin configuration.
      // Persist auth token so it survives Local restarts — avoids MU plugin staleness.
      registryStorage.set('http_webhook_auth_token', httpInfo.authToken);
      registryStorage.set('http_webhook_info', httpInfo);

      // Signal readiness — lifecycle hooks waiting to index can now proceed
      resolveReady!();

      const instructionRegistry = new InstructionRegistry();
      registerAllInstructions(instructionRegistry, registryStorage);

      // Reuse token and preferred port from previous run so HTTP configs stay stable
      const previousConnectionInfo = loadConnectionInfo();
      mcpServer = new McpServer({
        services: nexusServices,
        registry,
        instructionRegistry,
        registryStorage,
        existingToken: previousConnectionInfo?.authToken,
        preferredPort: previousConnectionInfo?.port,
      });
      const connectionInfo = await mcpServer.start();
      saveConnectionInfo(connectionInfo);

      localLogger.info(`[NexusAI] MCP server running on ${connectionInfo.url}`);
      localLogger.info(`[NexusAI] Tools: ${connectionInfo.tools.join(', ')}`);

      // Start AI Proxy Server (OpenAI-compatible endpoint backed by Ollama)
      const aiProxyServer = new AiProxyServer({
        logger: localLogger,
        embeddingService,
        toolRegistry: registry,
        nexusServices,
      });
      try {
        const proxyInfo = await aiProxyServer.start();
        registryStorage.set('ai_proxy_info', proxyInfo);
        localLogger.info(`[NexusAI] AI Proxy running on ${proxyInfo.url} (${proxyInfo.models.length} models)`);
      } catch (proxyErr) {
        localLogger.error('[NexusAI] AI Proxy failed to start:', (proxyErr as Error).message);
      }

      // Start Ollama availability polling
      refreshOllamaStatus();
      setInterval(() => refreshOllamaStatus(), OLLAMA_POLL_INTERVAL_MS);

      // WPE auto-sync: startup check + scheduled interval
      const getWpeSyncIntervalHours = () => {
        const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeSyncIntervalHours?: number } | null;
        return settings?.wpeSyncIntervalHours ?? 8;
      };

      const isWpeSyncAutoEnabled = () => {
        const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeSyncAutoEnabled?: boolean } | null;
        return settings?.wpeSyncAutoEnabled !== false; // default: true
      };

      const runWpeAutoSyncIncremental = async (reason: string) => {
        if (!wpeSyncService || !localServicesBridge.isCAPIAvailable()) return;
        const hours = getWpeSyncIntervalHours();
        localLogger.info(`[NexusAI] WPE incremental sync triggered: ${reason} (threshold: ${hours}h)`);
        try {
          const result = await wpeSyncService.syncAllWPESites(undefined, hours);
          localLogger.info(
            `[NexusAI] WPE sync done: ${result.synced} synced, ${result.skipped} skipped (fresh), ${result.failed} failed`
          );
        } catch (err) {
          localLogger.error('[NexusAI] WPE auto-sync failed:', (err as Error).message);
        }
      };

      // Startup: scan all Local sites (filesystem + WP-CLI for running ones)
      // Runs at 5s so the readyPromise has settled and services are live.
      const startupScanner = new StartupSiteScanner({
        getAllSites: () => {
          const all = siteData.getSites() as Record<string, any>;
          return Object.values(all).map((s: any) => ({
            id: s.id,
            name: s.name,
            path: s.path,
            phpVersion: s.phpVersion,
          }));
        },
        getRunningSiteIds: () => {
          const statuses = localServicesBridge.getAllSiteStatuses() as Record<string, string>;
          return Object.entries(statuses)
            .filter(([, status]) => status === 'running')
            .map(([id]) => id);
        },
        localServices: localServicesBridge,
        metadataCache,
        logger: localLogger,
      });

      setTimeout(() => {
        startupScanner.scan().catch((err) => {
          localLogger.warn('[NexusAI] Startup site scan failed (non-fatal):', (err as Error).message);
        });
      }, 5000);

      // Phase 3.2: Scheduled filesystem refresh for halted sites.
      // Re-runs the filesystem scan on halted sites whose twin is stale (>24h).
      // Running sites are handled by the lifecycle hook on site-start — skip them.
      const haltedRefreshScheduler = new HaltedSiteRefreshScheduler({
        scanner: startupScanner,
        metadataCache,
        siteData: siteDataAccessor,
        isSiteRunning: (siteId: string) => {
          const statuses = localServicesBridge.getAllSiteStatuses() as Record<string, string>;
          return statuses[siteId] === 'running';
        },
        logger: localLogger,
      });
      haltedRefreshScheduler.start();

      // Phase 5: Scheduled SSH WP-CLI refresh for stale WPE installs.
      // Runs once every 24h; updates plugins, themes, site URL, admin email,
      // post count, and active theme for installs not refreshed recently.
      const wpeRefreshScheduler = new WpeRefreshScheduler({
        graphService,
        localServices: localServicesBridge,
        logger: localLogger,
      });
      wpeRefreshScheduler.start();

      // Startup: Tier 1 CAPI-only sync (fast, every startup when authenticated)
      // then Tier 2 SSH sync (slow, only if stale)
      setTimeout(async () => {
        if (!localServicesBridge.isCAPIAvailable()) return;
        try {
          // Tier 1: always run — updates account/PHP/domain data from CAPI, detects new installs
          const capiResult = await wpeSyncService.syncFromCAPI();
          if (capiResult.newInstalls.length > 0) {
            localLogger.info(
              `[NexusAI] CAPI sync: ${capiResult.newInstalls.length} new installs detected: ${capiResult.newInstalls.slice(0, 5).join(', ')}${capiResult.newInstalls.length > 5 ? '...' : ''}`
            );
          }
        } catch (err) {
          localLogger.warn('[NexusAI] CAPI-only sync failed (non-fatal):', (err as Error).message);
        }

        // Tier 2: SSH sync only if auto-sync enabled and data is stale
        try {
          if (!isWpeSyncAutoEnabled()) {
            localLogger.info('[NexusAI] WPE auto-sync disabled — skipping SSH sync');
            return;
          }
          const hours = getWpeSyncIntervalHours();
          const stale = await wpeSyncService.isStale(hours);
          if (stale) {
            await runWpeAutoSyncIncremental('startup — stale sites detected');
          } else {
            localLogger.info('[NexusAI] All WPE sites fresh — skipping SSH sync');
          }
        } catch { /* non-fatal */ }
        // Tier 3: usage data — persist to SQLite on startup
        try {
          await wpeSyncService.syncUsageData();
        } catch { /* non-fatal */ }
      }, 10000);

      // Scheduled hourly: Tier 1 CAPI (always) + Tier 2 SSH (if stale) + usage sync
      setInterval(async () => {
        if (!localServicesBridge.isCAPIAvailable()) return;
        // Tier 1: always — keeps account/PHP/domain data fresh, detects new installs
        try {
          await wpeSyncService.syncFromCAPI();
        } catch { /* non-fatal */ }
        // Tier 2: SSH only if enabled and data is stale
        try {
          if (!isWpeSyncAutoEnabled()) return;
          const hours = getWpeSyncIntervalHours();
          const stale = await wpeSyncService.isStale(hours);
          if (stale) await runWpeAutoSyncIncremental('scheduled interval');
        } catch { /* non-fatal */ }
        // Tier 3: usage data (bandwidth/visits/storage) — persisted to SQLite
        try {
          await wpeSyncService.syncUsageData();
        } catch { /* non-fatal */ }
      }, 60 * 60 * 1000);

      // Start periodic health check transmission (every hour)
      // Transmits anonymous health metrics to Cloudflare for analytics
      const { getHealthMonitor } = require('./telemetry/HealthMonitor');
      setInterval(() => {
        try {
          const healthMonitor = getHealthMonitor();
          const activeSites = indexRegistry.listAll().length;
          healthMonitor.transmitHealthCheck(activeSites);
        } catch {
          // Ignore telemetry errors
        }
      }, 3600000); // 1 hour
    } catch (err) {
      const error = err as any;
      rejectReady!(err as Error);

      // Log detailed error info for debugging
      const errorDetails = {
        message: error?.message || 'Unknown error',
        code: error?.code || 'NO_CODE',
        stack: error?.stack || 'No stack trace',
        name: error?.name || 'Unknown',
      };

      localLogger.error('[NexusAI] Failed to start:', errorDetails);
      console.error('[NexusAI] Startup error details:', errorDetails);
    }
  })();

  console.log('[NexusAI] 🟢 About to call registerIpcHandlers()');

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
    graphService,
    eventProcessor,
    vectorDbPath: vectorDbDir,
    serviceContainer,
    nexusServices,
    wpeSyncService,
    metadataCache,
  });

  // Sprint 4: Credential sync broadcaster
  const credentialBroadcaster = new CredentialSyncBroadcaster({
    localServices: localServicesBridge,
    registryStorage,
    siteData: siteDataAccessor,
    logger: localLogger,
  });

  registerChatIpcHandlers({
    chatService,
    registryStorage,
    localLogger,
    credentialBroadcaster,
  });

  localLogger.info('[NexusAI] Addon loaded');
}
