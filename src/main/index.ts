import * as path from 'path';
import * as os from 'os';
import { safeStorage } from 'electron';
import { IPC_CHANNELS, OLLAMA_POLL_INTERVAL_MS, STORAGE_KEYS, EMBEDDING_MODELS } from '../common/constants';
import { OperationTracker } from './operation-tracker';
import { SqliteVecStore } from './vector-store/index';
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
import { registerSentinelScanTools } from './mcp/modules/sentinel-scan/index';
import { registerWpConnectorTools } from './mcp/modules/wp-connector/index';
import { registerFleetIntelligenceTools } from './mcp/modules/fleet-intelligence/index';
import { registerIwTools } from './mcp/modules/iw/index';
import { registerTelemetryTools } from './mcp/modules/telemetry-tools';
import { getGatewayUsageHandler } from './mcp/modules/ai-gateway/get-gateway-usage';
import { registerTelemetryControlTools } from './mcp/modules/telemetry-control-tools';
import { registerNexusSettingsTools } from './mcp/modules/nexus-settings';
import { createSearchToolsHandler } from './mcp/modules/search-tools';
import { registerTestTools } from './mcp/modules/test-tools';
import { saveConnectionInfo, loadConnectionInfo, deleteConnectionInfo } from './mcp/connection-info';
import { registerLifecycleHooks } from './content/lifecycle-hooks';
import { createLocalServicesBridge } from './mcp/local-services-bridge';
import { createAuditLogger } from './mcp/audit';
import { InstructionRegistry, registerAllInstructions } from './mcp/instructions';
import { registerIpcHandlers, getAgentSetting, canAutoRun, seedAgentDefaultsIfMissing } from './ipc-handlers';
import { initializeProviders } from './chat/providers/index';
import { ChatService } from './chat/ChatService';
import { registerChatIpcHandlers } from './chat/chat-ipc-handlers';
import { createSessionTables, pruneSessions } from './ipc/chat-sessions';
import { GraphService } from './events/GraphService';
import { runOrphanSweep } from './fleet/collectFleetCounts';
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
import { ExternalRefreshScheduler } from './startup/ExternalRefreshScheduler';
import { ExternalContentIndexScheduler } from './startup/ExternalContentIndexScheduler';
import { ExternalContentIndexService } from './events/ExternalContentIndexService';
import { SiteDigitalTwinService } from './twin/SiteDigitalTwinService';
import { SmartSearchHandler } from './smart-search/SmartSearchHandler';
import { SynonymStore } from './smart-search/SynonymStore';
import { SemanticConfig } from './smart-search/SemanticConfig';
import { TrackerStore } from './smart-search/TrackerStore';
import { OpportunisticScheduler } from './scheduler/OpportunisticScheduler';
import type { StartupStatus } from '../common/types';
import { AgentStateStore } from './agent-runtime/AgentStateStore';
import { AgentRegistry, AGENTS_DIR } from './agent-runtime/AgentRegistry';
import { AgentRunner } from './agent-runtime/AgentRunner';
import { AgentScheduler } from './agent-runtime/AgentScheduler';
import { DaemonManager } from './agent-runtime/DaemonManager';
import { ContributedToolRegistry } from './agent-runtime/ContributedToolRegistry';
import { AgentDispatcher } from './agent-runtime/AgentDispatcher';
import { AgentDbManager } from './agent-runtime/AgentDbManager';
import { AgentEventBus } from './agent-event-bus/AgentEventBus';
import { InboxStore } from './inbox/InboxStore';
import { CredentialManager } from './credentials/CredentialManager';
import type { CredentialEvent } from './credentials/types';
import { registerLocalLifecycleBridge } from './agent-event-bus/bridges/local-lifecycle-bridge';
import { createWpEventsBridgeHandler } from './agent-event-bus/bridges/wp-events-bridge';
import { getAIProvider } from './ai/getAIProvider';
import { refreshProviderWhenEncryptionReady } from './ai/refreshProviderWhenEncryptionReady';
import type { Unsubscribe, AgentDefinition } from './agent-sdk/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LocalMain = require('@getflywheel/local/main');
const { ipcMain, BrowserWindow } = require('electron');

let mcpServer: McpServer | null = null;

/**
 * Push a partial NexusState patch to all open renderer windows.
 * Components subscribe to nexusStore instead of polling — this is the
 * single write point that feeds the entire UI.
 */
function emitNexusState(patch: Record<string, unknown>): void {
  try {
    const windows = BrowserWindow.getAllWindows?.() ?? [];
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.NEXUS_STATE_UPDATE, patch);
      }
    }
  } catch {
    // Non-fatal — renderer may not be ready yet
  }
}

// Startup lifecycle state, exposed to the renderer via GET_STARTUP_STATUS so
// the dashboard can surface a real error instead of an indefinite "waiting"
// banner when a service fails to boot. The phase string is updated as each
// await in the async init IIFE advances, so if we catch we know where.
let currentStartupPhase: string | null = null;
let startupStatus: StartupStatus = {
  ready: false,
  phase: null,
  error: null,
};

function setStartupPhase(phase: string): void {
  currentStartupPhase = phase;
  startupStatus = { ...startupStatus, phase };
}

/**
 * Map recognizable runtime errors to a user-actionable hint. Today we handle
 * the NODE_MODULE_VERSION mismatch that happens when `npm install` is run
 * outside Local (rebuilding native modules for system Node instead of Electron
 * Node) — see docs/NATIVE_MODULES.md. Extend as we see other recurring
 * failure modes.
 */
function hintForError(err: unknown): string | null {
  const message = (err as Error)?.message ?? '';
  if (message.includes('NODE_MODULE_VERSION')) {
    return 'Native module was built for a different Node ABI than Electron. Run `npm run rebuild` in the addon directory, then restart Local.';
  }
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT' && message.includes('all-MiniLM')) {
    return 'Embedding model files are missing. Ensure `models/all-MiniLM-L6-v2-quantized/` is present in the addon directory.';
  }
  return null;
}

export default function main(context: any): void {
  console.log('[NexusAI] 🟢🟢🟢 MAIN ENTRY POINT CALLED');
  const serviceContainer = LocalMain.getServiceContainer().cradle;
  const { localLogger, userData, siteData, graphql } = serviceContainer;
  console.log('[NexusAI] 🟢 Service container loaded');

  localLogger.info('[NexusAI] Addon loading...');

  // Build adapter for IndexRegistry persistence via Local's userData.
  // Settings are written with a shadow backup key so we can recover them if
  // the primary key is lost due to a force-quit / OS crash during an atomic write.
  // Keys that get shadowed to a backup to survive force-quit data loss.
  // Both settings and IndexRegistry are critical — losing either reverts the UI to defaults.
  const RESILIENT_KEYS = new Set<string>([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.INDEX_REGISTRY]);
  const registryStorage: RegistryStorage = {
    get: (key: string) => {
      const value = userData.get(key) ?? null;
      if (value === null && RESILIENT_KEYS.has(key)) {
        const backup = userData.get(`${key}_backup`) ?? null;
        if (backup) localLogger.info(`[NexusAI] ${key} recovered from backup`);
        return backup;
      }
      return value;
    },
    set: (key: string, value: any) => {
      userData.set(key, value);
      if (RESILIENT_KEYS.has(key)) {
        userData.set(`${key}_backup`, value);
      }
    },
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
  // Read embedding model setting
  const settings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { embeddingModel?: 'minilm' | 'bge-small' } | null;
  const embeddingModelKey = settings?.embeddingModel ?? 'minilm';
  const modelConfig = EMBEDDING_MODELS[embeddingModelKey];
  const modelsDir = path.join(addonDir, 'models', modelConfig.dir);

  const localDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
  const vectorDbPath = path.join(localDataDir, 'nexus-ai', 'vectors.db');
  const graphDbPath = path.join(localDataDir, 'nexus-ai', 'graph.db');

  // Phase 1: Initialize foundation services (async)
  const vectorStore = new SqliteVecStore(vectorDbPath);
  const embeddingService = new EmbeddingService(
    modelsDir,
    modelConfig.dimensions,
    modelConfig.contextWindow
  );
  const fileScanner = new FileScanner();
  const mysqlExtractor = new MySQLExtractor();
  const indexRegistry = new IndexRegistry(registryStorage);
  const graphService = new GraphService(graphDbPath, localLogger);

  // Initialize GraphDB early — SQLite is lightweight and independent of the vector store.
  // This ensures session tables are ready before any chat IPC fires, even if the
  // VectorStore/EmbeddingService chain fails or is still in progress.
  (async () => {
    try {
      await graphService.initialize();
      const db = graphService.getDb();
      if (db) {
        createSessionTables(db);
        pruneSessions(db);
      }
      localLogger.info('[NexusAI] GraphService (early init) ready');
    } catch (err) {
      localLogger.error('[NexusAI] GraphService early init failed:', (err as Error).message);
    }
  })();

  // auditLogger + operationAuditLog — constructed here (before the before-quit
  // handler below) so the handler's closure can reference them without a TDZ
  // ReferenceError at quit time; they used to be constructed further down
  // (near Phase 3) which sat AFTER this handler in source order.
  const auditLogger = createAuditLogger(
    path.join(localDataDir, 'nexus-ai', 'audit.log'),
  );
  const { OperationAuditLog, defaultAuditLogPath } = require('./audit/OperationAuditLog');
  const operationAuditLog = new OperationAuditLog(defaultAuditLogPath());

  // Checkpoint WAL on clean shutdown so committed writes survive a restart.
  // Also run a passive checkpoint every 5 minutes to keep WAL size bounded.
  const { app } = require('electron');
  app.on('before-quit', () => {
    agentScheduler?.stop();
    daemonManager?.stopAll().catch(() => {});
    graphService.close().catch(() => {});
    auditLogger?.flush().catch(() => {});   // was never called — entries were lost on every exit
  });

  // Periodic flush so a hard kill (SIGKILL, crash) loses at most 5 minutes.
  setInterval(() => { auditLogger?.flush().catch(() => {}); }, 5 * 60 * 1000);

  setInterval(() => {
    try { graphService.getDb()?.pragma('wal_checkpoint(PASSIVE)'); } catch {}
  }, 5 * 60 * 1000);

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
  const sendToRenderer = (channel: string, ...args: unknown[]) => {
    try {
      const { BrowserWindow } = require('electron');
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, ...args);
      }
    } catch { /* renderer not ready */ }
  };
  registerLifecycleHooks(context, contentPipeline, indexRegistry, localLogger, readyPromise, registryStorage, localServicesBridge, metadataCache, sendToRenderer, graphService, mysqlExtractor);

  // Phase 3: Boot MCP server (async — does not block addon load)
  // (auditLogger + operationAuditLog are constructed earlier — see the
  // before-quit handler above — so they aren't re-declared here.)

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
    // Forward-ref: _wpEventsBridgeCallback is set once AgentEventBus is ready
    onEvent: (siteId, eventType, payload) => { _wpEventsBridgeCallback?.(siteId, eventType, payload); },
  });

  // Initialize WPE sync service (Phase 1-2)
  const remoteContentExtractor = new RemoteContentExtractor({
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
    indexRegistry,
    emitIndexProgress: (siteId, data) => {
      try { ipcMain?.emit?.(IPC_CHANNELS.INDEX_PROGRESS, null, { siteId, ...data }); } catch { /* renderer may not be ready */ }
    },
    onSyncProgress: (progress) => {
      emitNexusState({ wpeSyncProgress: progress });
    },
  });

  // Start operation tracker — intercepts Local's IPC events for push/pull/export
  const operationTracker = new OperationTracker();
  operationTracker.start();

  // Credential manager — owns OAuth connection lifecycle, token refresh, PKCE flows
  const credentialManager = new CredentialManager({
    storage: registryStorage,
    emitNexusState,
    emitCredentialEvent: (event: CredentialEvent) => {
      const windows = BrowserWindow.getAllWindows?.() ?? [];
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.CREDENTIAL_EVENT, event);
        }
      }
    },
  });

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
    operationAuditLog,
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
    credentialManager,
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
  registerSentinelScanTools(registry);
  registerWpConnectorTools(registry);
  registerFleetIntelligenceTools(registry);
  registerIwTools(registry);
  registerTelemetryTools(registry);
  registry.register(getGatewayUsageHandler);
  registerTelemetryControlTools(registry);
  registerNexusSettingsTools(registry);
  // search_tools registered last so it can search all other tools.
  // Pass a late-bound getter for ContributedToolRegistry so contributed tools
  // are searchable even though the registry is populated after startup wiring.
  registry.register(createSearchToolsHandler(registry, () => (nexusServices as any).contributedRegistry));
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

  // Opportunistic local-site indexer — fires a bulk reindex on a configurable
  // interval. Declared before the async IIFE so closures inside can capture it.
  // Started after async init resolves (nexusServices.bulkOpManager is set by then).
  const opportunisticScheduler = new OpportunisticScheduler();

  // Halted-site refresh and WPE refresh schedulers — declared before the async IIFE
  // so the onSettingsUpdated closure (registered outside the IIFE) can capture them.
  // Assigned inside the IIFE once their dependencies are available.
  //
  // Typed `| undefined` deliberately: onSettingsUpdated is now reachable from the
  // GraphQL mutation as well as IPC, and registerIpcHandlers (which sets
  // bulkOpManager, the old de-facto readiness guard) runs synchronously *before*
  // the async IIFE that assigns these. A settings write landing in that window
  // must be a no-op for the not-yet-created scheduler, not a TypeError.
  let haltedRefreshScheduler: HaltedSiteRefreshScheduler | undefined;
  let wpeRefreshScheduler: WpeRefreshScheduler | undefined;
  let externalRefreshScheduler: ExternalRefreshScheduler | undefined;
  let externalContentIndexScheduler: ExternalContentIndexScheduler | undefined;

  // Agent platform: scheduler and daemon manager declared here so the before-quit
  // handler and onSettingsUpdated closure can reach them. Assigned inside the IIFE.
  let agentScheduler: AgentScheduler | undefined;
  let daemonManager: DaemonManager | undefined;

  // Forward reference for the wp-events bridge callback — set once AgentEventBus
  // is initialized inside the async IIFE. The HttpEventInterface constructor is
  // called before the IIFE, so we use a late-binding closure.
  let _wpEventsBridgeCallback: ((siteId: string, eventType: string, payload: Record<string, unknown>) => void) | undefined;

  // WPE content index timer — inline interval-based scheduler for indexAllWpeContent.
  // Declared here so the onSettingsUpdated closure can restart/stop it reactively.
  let wpeContentIndexTimer: ReturnType<typeof setInterval> | null = null;
  const startWpeContentIndexScheduler = (hours: number) => {
    if (wpeContentIndexTimer) clearInterval(wpeContentIndexTimer);
    wpeContentIndexTimer = setInterval(async () => {
      if (!wpeSyncService) return;
      localLogger.info(`[NexusAI] WPE content index scheduler running (every ${hours}h)`);
      try { await wpeSyncService.indexAllWpeContent(); } catch (e: any) {
        localLogger.warn('[NexusAI] WPE content index scheduler failed:', e?.message);
      }
    }, hours * 60 * 60 * 1000);
  };

  const getSchedulerSettings = () =>
    (registryStorage.get(STORAGE_KEYS.SETTINGS) as import('../common/types').NexusSettings) ??
    ({ autoIndex: true, excludedSiteIds: [] } as any);

  const buildSiteNamesLocal = (ids: string[]) => {
    const sites = siteDataAccessor.getSites();
    const names: Record<string, string> = {};
    ids.forEach(id => { names[id] = sites[id]?.name ?? id; });
    return names;
  };

  /**
   * Re-read settings and restart/stop every settings-driven scheduler.
   *
   * Two callers, deliberately:
   *   1. the IPC UPDATE_SETTINGS handler (`ipc-handlers.ts`), the renderer path;
   *   2. the GraphQL `nexusUpdateSettings` mutation, the path `nexus settings set`
   *      uses — reached via `nexusServices.onSettingsUpdated`, assigned below.
   *
   * Before (2) existed, `nexus settings set externalRefreshAutoEnabled true`
   * wrote the value and returned success while no scheduler ever started, so the
   * only way to enable external host refresh was to restart Local. A renderer
   * UI row for `externalRefreshAutoEnabled` exists (SettingsTab.tsx); the CLI
   * is the only way to set `externalContentIndexAutoEnabled`, which has no
   * renderer row.
   *
   * Each scheduler is guarded: this can now be invoked before the async init IIFE
   * has constructed them.
   */
  const onSettingsUpdated = () => {
    if (nexusServices?.bulkOpManager) {
      opportunisticScheduler.restart({
        bulkOpManager: nexusServices.bulkOpManager,
        siteData: siteDataAccessor,
        getSettings: getSchedulerSettings,
        buildSiteNames: buildSiteNamesLocal,
        logger: localLogger,
      });
    }

    // Restart halted-site refresh scheduler with updated interval from settings.
    const newHaltedIntervalHours = (registryStorage.get(STORAGE_KEYS.SETTINGS) as { haltedSiteRefreshIntervalHours?: number } | null)?.haltedSiteRefreshIntervalHours ?? 24;
    haltedRefreshScheduler?.restart(newHaltedIntervalHours * 60 * 60 * 1000);

    // Restart (or stop) WPE refresh scheduler based on updated settings.
    const updatedWpeSettings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeRefreshIntervalHours?: number; wpeRefreshAutoEnabled?: boolean } | null;
    const newWpeRefreshHours = updatedWpeSettings?.wpeRefreshIntervalHours ?? 24;
    const newWpeRefreshEnabled = updatedWpeSettings?.wpeRefreshAutoEnabled === true;
    if (newWpeRefreshEnabled) {
      wpeRefreshScheduler?.restart(newWpeRefreshHours * 60 * 60 * 1000);
    } else {
      wpeRefreshScheduler?.stop();
    }

    // Restart (or stop) the external SSH host refresh scheduler.
    const updatedExternal = registryStorage.get(STORAGE_KEYS.SETTINGS) as
      { externalRefreshIntervalHours?: number; externalRefreshAutoEnabled?: boolean } | null;
    const newExternalHours = updatedExternal?.externalRefreshIntervalHours ?? 24;
    if (updatedExternal?.externalRefreshAutoEnabled === true) {
      externalRefreshScheduler?.restart(newExternalHours * 60 * 60 * 1000);
      localLogger.info(`[NexusAI] External SSH host refresh enabled by preference (every ${newExternalHours}h)`);
    } else {
      externalRefreshScheduler?.stop();
      localLogger.info('[NexusAI] External SSH host refresh disabled by preference — scheduler stopped');
    }

    // Restart (or stop) the external SSH content-index scheduler.
    const updatedContentIndex = registryStorage.get(STORAGE_KEYS.SETTINGS) as
      { externalContentIndexIntervalHours?: number; externalContentIndexAutoEnabled?: boolean } | null;
    const newContentIndexHours = updatedContentIndex?.externalContentIndexIntervalHours ?? 24;
    if (updatedContentIndex?.externalContentIndexAutoEnabled === true) {
      externalContentIndexScheduler?.restart(newContentIndexHours * 60 * 60 * 1000);
      localLogger.info(`[NexusAI] External SSH content indexing enabled by preference (every ${newContentIndexHours}h)`);
    } else {
      externalContentIndexScheduler?.stop();
      localLogger.info('[NexusAI] External SSH content indexing disabled by preference — scheduler stopped');
    }

    // Restart (or stop) WPE content index scheduler based on updated settings.
    const newContentSettings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeContentIndexAutoEnabled?: boolean; wpeContentIndexIntervalHours?: number } | null;
    const newContentEnabled = newContentSettings?.wpeContentIndexAutoEnabled === true;
    const newContentHours = newContentSettings?.wpeContentIndexIntervalHours ?? 24;
    if (wpeContentIndexTimer) clearInterval(wpeContentIndexTimer);
    wpeContentIndexTimer = null;
    if (newContentEnabled) startWpeContentIndexScheduler(newContentHours);

    // Re-resolve agent provider when settings change (API key rotation, provider switch).
    // agentRunner/dispatcher are stored on nexusServices so they're accessible here even
    // though both were declared in the conditional if (agentDb) block above. Both need this:
    // AgentRunner.run() (the "Run Now" / scheduled path) and AgentDispatcher.dispatch() (the
    // contributed-tool path, e.g. security-sentinel's Tier-3-gated `scan` MCP tool) each hold
    // their own independent snapshot from construction time.
    if (nexusServices.agentRunner || nexusServices.dispatcher) {
      const updatedSettings = registryStorage.get(STORAGE_KEYS.SETTINGS) as import('../common/types').NexusSettings | null;
      const updatedProvider = getAIProvider(registryStorage, updatedSettings);
      nexusServices.agentRunner?.setProvider(updatedProvider);
      nexusServices.dispatcher?.setProvider(updatedProvider);
    }
  };

  // Exposed on the service container so the GraphQL resolver module — which
  // receives only { registry, services } — can reach it. nexusServices is
  // captured by reference by createResolvers above, so a late assignment is
  // visible there (the same pattern the Sprint 2/3 services use).
  nexusServices.onSettingsUpdated = onSettingsUpdated;

  // Async initialization
  (async () => {
    try {
      setStartupPhase('VectorStore');
      await vectorStore.initialize();
      localLogger.info('[NexusAI] VectorStore initialized');

      setStartupPhase('EmbeddingService');
      await embeddingService.initialize();
      localLogger.info('[NexusAI] EmbeddingService initialized');

      setStartupPhase('GraphService');
      await graphService.initialize();
      localLogger.info('[NexusAI] GraphService initialized');

      // Deleted local sites leave their graph row at is_active = 1 forever — nothing
      // else reconciles them. Measured 2026-08-09: 22 of 56 active local rows were
      // sandbox sites that no longer existed. runOrphanSweep owns its own try/catch
      // (a sweep failure must never block startup) and the empty-store circuit
      // breaker lives inside sweepOrphanedLocalRows — see collectFleetCounts.ts.
      runOrphanSweep({
        getSites: () => siteDataAccessor.getSites() as Record<string, unknown>,
        getDb: () => graphService.getDb() as never,
        logger: localLogger,
      });

      // Wire SmartSearch stores + handler into the HTTP interface
      const graphDb = graphService.getDb();
      if (graphDb) {
        createSessionTables(graphDb);
        pruneSessions(graphDb);

        const synonymStore = new SynonymStore(graphDb);
        synonymStore.initialize();
        const semanticConfig = new SemanticConfig(graphDb);
        semanticConfig.initialize();
        const trackerStore = new TrackerStore(graphDb);
        trackerStore.initialize();
        trackerStore.cleanup(); // purge tracker events older than 7 days

        const smartSearchHandler = new SmartSearchHandler(
          vectorStore,
          embeddingService,
          synonymStore,
          semanticConfig,
          trackerStore,
        );
        httpEventInterface.setSmartSearchHandler(smartSearchHandler);
        localLogger.info('[NexusAI] SmartSearchHandler wired to /smart-search/graphql');
      } else {
        localLogger.warn('[NexusAI] GraphDB not available — SmartSearch disabled');
      }

      // Agent Platform initialization — requires GraphDB (same connection as SmartSearch)
      // contributedRegistry and dispatcher are hoisted so McpServer can consume them
      // even when agentDb is unavailable (they'll simply be empty/unused).
      let contributedRegistry: ContributedToolRegistry | undefined;
      let dispatcher: AgentDispatcher | undefined;

      const agentDb = graphService.getDb();
      if (agentDb) {
        const agentEventBus = new AgentEventBus(agentDb);
        agentEventBus.pruneOldEvents(30); // prune events older than 30 days on startup

        const agentStateStore = new AgentStateStore(agentDb);
        const inboxStore = new InboxStore(agentDb);

        const resolvedAgentProvider = getAIProvider(
          registryStorage,
          registryStorage.get(STORAGE_KEYS.SETTINGS) as import('../common/types').NexusSettings | null,
        );

        contributedRegistry = new ContributedToolRegistry();
        const agentDbManager = new AgentDbManager(AGENTS_DIR);
        dispatcher = new AgentDispatcher(
          contributedRegistry,
          registry,
          nexusServices as any,
          AGENTS_DIR,
          resolvedAgentProvider,
          agentStateStore,
          agentDbManager,
        );
        const agentRegistry = new AgentRegistry(AGENTS_DIR, contributedRegistry, dispatcher, agentDbManager);

        // AgentRunner constructs a per-agent NexusToolProvider in run() to enforce tool scope
        const agentRunner = new AgentRunner(agentStateStore, registry, nexusServices as any, resolvedAgentProvider, agentDbManager);
        agentScheduler = new AgentScheduler(agentRunner);
        daemonManager = new DaemonManager(agentEventBus);

        // Wire the wp-events bridge (releases the forward reference set at construction time)
        _wpEventsBridgeCallback = createWpEventsBridgeHandler(agentEventBus);

        // Wire local lifecycle bridge into Local's hook system
        registerLocalLifecycleBridge(agentEventBus, context.hooks);

        // Track event-bus subscriptions per agent for hot-reload cleanup
        const agentUnsubs = new Map<string, Unsubscribe[]>();

        function wireAgentTriggers(agent: AgentDefinition): void {
          // New agents must not auto-run — seed scheduleEnabled/eventsEnabled to false
          // (opt-in) before any cron/event trigger below is registered. Never overwrites
          // an agent that already has persisted settings.
          seedAgentDefaultsIfMissing([agent.name]);

          const unsubs: Unsubscribe[] = [];
          for (const trigger of agent.triggers) {
            if (trigger.type === 'cron') {
              agentScheduler!.register(agent);
            } else if (trigger.type === 'event') {
              unsubs.push(
                agentEventBus.subscribe(trigger.pattern, async (event) => {
                  // `enabled` too — see canAutoRun. A disabled agent must not run on an event.
                  if (!canAutoRun(agent.name, 'event')) return;
                  await agentRunner.run(agent, event).catch((err: Error) => {
                    localLogger.error(`[NexusAI] Agent "${agent.name}" event trigger failed: ${err.message}`);
                  });
                }),
              );
            } else if (trigger.type === 'webhook') {
              unsubs.push(
                agentEventBus.subscribe(`webhook:${trigger.path ?? '*'}`, async (event) => {
                  await agentRunner.run(agent, event).catch((err: Error) => {
                    localLogger.error(`[NexusAI] Agent "${agent.name}" webhook trigger failed: ${err.message}`);
                  });
                }),
              );
            } else if (trigger.type === 'stream') {
              try {
                daemonManager!.start(agent);
              } catch (err: any) {
                localLogger.warn(`[NexusAI] Failed to start daemon for "${agent.name}": ${err.message}`);
              }
            }
          }
          if (unsubs.length > 0) agentUnsubs.set(agent.name, unsubs);
        }

        await agentRegistry.load();
        for (const agent of agentRegistry.list()) {
          wireAgentTriggers(agent);
        }
        agentScheduler.start();

        // Hot reload — fs.watch fires onUnload/onReload for file changes in agents dir
        agentRegistry.watch(
          (name) => {
            // Unsubscribe event-bus listeners
            const unsubs = agentUnsubs.get(name) ?? [];
            for (const unsub of unsubs) unsub();
            agentUnsubs.delete(name);
            // Unregister scheduler
            agentScheduler!.unregister(name);
            // Stop daemon if running
            daemonManager!.stop(name);
            localLogger.info(`[NexusAI] Agent "${name}" unloaded for hot reload`);
          },
          (def) => {
            try {
              wireAgentTriggers(def);
            } catch (err: any) {
              localLogger.warn(`[NexusAI] Failed to wire agent triggers for "${def.name}" during reload: ${err.message}`);
            }
            localLogger.info(`[NexusAI] Agent "${def.name}" reloaded`);
          },
        );

        // Expose agentReload for GraphQL mutation and nexus agent install
        const agentReload = async (): Promise<void> => {
          // Unload all agents
          for (const agent of agentRegistry.list()) {
            const unsubs = agentUnsubs.get(agent.name) ?? [];
            for (const unsub of unsubs) unsub();
            agentUnsubs.delete(agent.name);
            agentScheduler!.unregister(agent.name);
            daemonManager!.stop(agent.name);
          }
          await agentRegistry.load();
          for (const agent of agentRegistry.list()) {
            wireAgentTriggers(agent);
          }
          localLogger.info(`[NexusAI] All agents reloaded: ${agentRegistry.list().length} loaded`);
        };

        // Expose agent platform on services so GraphQL resolvers can access it
        nexusServices.agentRegistry = agentRegistry;
        nexusServices.agentRunner = agentRunner;
        nexusServices.agentEventBus = agentEventBus;
        nexusServices.agentStateStore = agentStateStore;
        nexusServices.inboxStore = inboxStore;
        nexusServices.agentReload = agentReload;
        nexusServices.contributedRegistry = contributedRegistry;
        nexusServices.dispatcher = dispatcher;

        // safeStorage.isEncryptionAvailable() can still be false this early in Local's addon
        // startup (confirmed live: false at the exact moment getAIProvider() ran above). When
        // that happens, KeyVault.decrypt() takes its "already plaintext" fallback and hands back
        // the still-encrypted ciphertext as if it were the real key — resolvedAgentProvider then
        // caches that wrong value on AgentRunner/AgentDispatcher for the rest of the process's
        // life, so every agent LLM call 401s ("invalid or expired token") while chat (which
        // decrypts fresh per message, well after startup) works fine with the identical stored
        // key. A restart doesn't help because it reproduces the same early-timing race every time.
        refreshProviderWhenEncryptionReady({
          isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
          resolveProvider: () => getAIProvider(registryStorage, registryStorage.get(STORAGE_KEYS.SETTINGS) as import('../common/types').NexusSettings | null),
          setProviders: (freshProvider) => {
            nexusServices.agentRunner?.setProvider(freshProvider);
            nexusServices.dispatcher?.setProvider(freshProvider);
            localLogger.info('[NexusAI] safeStorage became available after startup — re-resolved agent AI provider');
          },
          onGiveUp: () => localLogger.warn('[NexusAI] safeStorage never became available within 30s of startup — agent AI calls may use an undecrypted key'),
        });

        localLogger.info(`[NexusAI] Agent platform initialized: ${agentRegistry.list().length} agent(s) loaded`);
      } else {
        localLogger.warn('[NexusAI] GraphDB not available — agent platform disabled');
      }

      setStartupPhase('EventProcessor');
      await eventProcessor.initialize();
      localLogger.info('[NexusAI] EventProcessor initialized');

      setStartupPhase('HttpEventInterface');
      const httpInfo = await httpEventInterface.start();
      localLogger.info(`[NexusAI] HTTP Event Interface running on ${httpInfo.url}`);
      localLogger.info(`[NexusAI] WordPress webhook endpoint: ${httpInfo.url}/wp-events`);
      localLogger.info(`[NexusAI] Auth token: ${httpInfo.authToken.substring(0, 16)}...`);

      // Store connection info for WordPress plugin configuration.
      // Persist auth token so it survives Local restarts — avoids MU plugin staleness.
      registryStorage.set('http_webhook_auth_token', httpInfo.authToken);
      registryStorage.set('http_webhook_info', httpInfo);

      // Expose gateway URL and auth token on nexusServices so agent AI calls
      // can route through the gateway (same credential model as WP site AI).
      nexusServices.gatewayUrl = httpInfo.url;
      nexusServices.gatewayAuthToken = httpInfo.authToken;

      // Signal readiness — lifecycle hooks waiting to index can now proceed
      resolveReady!();

      // Start opportunistic local-site indexer now that bulkOpManager is wired
      if (nexusServices?.bulkOpManager) {
        opportunisticScheduler.start({
          bulkOpManager: nexusServices.bulkOpManager,
          siteData: siteDataAccessor,
          getSettings: getSchedulerSettings,
          buildSiteNames: buildSiteNamesLocal,
          logger: localLogger,
        });
      }

      const instructionRegistry = new InstructionRegistry();
      registerAllInstructions(instructionRegistry, registryStorage, graphService);

      // Load previous run's token/port before clearing — reused for config stability.
      // Delete first so the file only exists when a server is actually bound.
      const previousConnectionInfo = loadConnectionInfo();
      deleteConnectionInfo();
      setStartupPhase('McpServer');
      mcpServer = new McpServer({
        services: nexusServices,
        registry,
        instructionRegistry,
        registryStorage,
        existingToken: previousConnectionInfo?.authToken,
        preferredPort: previousConnectionInfo?.port,
        contributedRegistry,
        dispatcher,
        isAgentEnabled: (agentName: string) => getAgentSetting(agentName, 'enabled') !== false,
      });
      const connectionInfo = await mcpServer.start();
      saveConnectionInfo(connectionInfo);

      localLogger.info(`[NexusAI] MCP server running on ${connectionInfo.url}`);
      localLogger.info(`[NexusAI] Tools: ${connectionInfo.tools.join(', ')}`);

      setStartupPhase('AiProxyServer');
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
        return settings?.wpeSyncAutoEnabled === true; // default: false (opt-in)
      };

      const runWpeAutoSyncIncremental = async (reason: string) => {
        if (!wpeSyncService || !localServicesBridge.isCAPIAvailable()) return;
        const hours = getWpeSyncIntervalHours();
        localLogger.info(`[NexusAI] WPE incremental sync triggered: ${reason} (threshold: ${hours}h)`);
        // Signal sync started so UI shows active state immediately
        emitNexusState({ wpeSyncProgress: { active: true, current: 0, total: 0, currentSite: '', phase: 'metadata' } });
        try {
          const result = await wpeSyncService.syncAllWPESites(undefined, hours);
          localLogger.info(
            `[NexusAI] WPE sync done: ${result.synced} synced, ${result.skipped} skipped (fresh), ${result.failed} failed`
          );
          // Clear progress and push fresh wpeStatus
          emitNexusState({ wpeSyncProgress: null });
        } catch (err) {
          localLogger.error('[NexusAI] WPE auto-sync failed:', (err as Error).message);
          emitNexusState({ wpeSyncProgress: null });
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
      const haltedIntervalHours = (registryStorage.get(STORAGE_KEYS.SETTINGS) as { haltedSiteRefreshIntervalHours?: number } | null)?.haltedSiteRefreshIntervalHours ?? 24;
      haltedRefreshScheduler = new HaltedSiteRefreshScheduler({
        scanner: startupScanner,
        metadataCache,
        siteData: siteDataAccessor,
        isSiteRunning: (siteId: string) => {
          const statuses = localServicesBridge.getAllSiteStatuses() as Record<string, string>;
          return statuses[siteId] === 'running';
        },
        intervalMs: haltedIntervalHours * 60 * 60 * 1000,
        logger: localLogger,
      });
      haltedRefreshScheduler.start();

      // Phase 5: Scheduled SSH WP-CLI refresh for stale WPE installs.
      // Runs once every 24h; updates plugins, themes, site URL, admin email,
      // post count, and active theme for installs not refreshed recently.
      const wpeRefreshSettings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeRefreshIntervalHours?: number; wpeRefreshAutoEnabled?: boolean } | null;
      const wpeRefreshHours = wpeRefreshSettings?.wpeRefreshIntervalHours ?? 24;
      const wpeRefreshEnabled = wpeRefreshSettings?.wpeRefreshAutoEnabled === true; // default: false (opt-in)
      wpeRefreshScheduler = new WpeRefreshScheduler({
        graphService,
        localServices: localServicesBridge,
        intervalMs: wpeRefreshHours * 60 * 60 * 1000,
        agentEventBus: nexusServices.agentEventBus,
        getAccountFilter: () => {
          const s = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeAccountFilter?: string[] | null } | null;
          return s?.wpeAccountFilter ?? null;
        },
        logger: localLogger,
      });
      if (wpeRefreshEnabled) {
        wpeRefreshScheduler.start();
      } else {
        localLogger.info('[NexusAI] WPE SSH refresh auto-run disabled by preference — scheduler not started');
      }

      // Scheduled SSH refresh for registered external (non-WPE, non-Local) hosts.
      // Opt-in, off by default — Nexus does not connect to a third party's server
      // on a timer unless the user asked.
      const externalRefreshSettings = registryStorage.get(STORAGE_KEYS.SETTINGS) as
        { externalRefreshIntervalHours?: number; externalRefreshAutoEnabled?: boolean } | null;
      const externalRefreshHours = externalRefreshSettings?.externalRefreshIntervalHours ?? 24;
      const externalRefreshEnabled = externalRefreshSettings?.externalRefreshAutoEnabled === true; // opt-in
      externalRefreshScheduler = new ExternalRefreshScheduler({
        graphService: graphService as any,
        services: nexusServices,
        intervalMs: externalRefreshHours * 60 * 60 * 1000,
        logger: localLogger,
      });
      if (externalRefreshEnabled) {
        externalRefreshScheduler.start();
      } else {
        localLogger.info('[NexusAI] External SSH host refresh auto-run disabled by preference — scheduler not started');
      }

      // Scheduled content indexing for registered external (non-WPE, non-Local) hosts.
      // Opt-in, off by default — Nexus does not connect to a third party's server
      // on a timer unless the user asked.
      const externalContentIndexSettings = registryStorage.get(STORAGE_KEYS.SETTINGS) as
        { externalContentIndexIntervalHours?: number; externalContentIndexAutoEnabled?: boolean } | null;
      const externalContentIndexHours = externalContentIndexSettings?.externalContentIndexIntervalHours ?? 24;
      const externalContentIndexEnabled = externalContentIndexSettings?.externalContentIndexAutoEnabled === true; // opt-in
      const externalContentIndexService = new ExternalContentIndexService({
        graphService,
        embeddingService,
        vectorStore,
        indexRegistry,
        logger: localLogger,
      });
      externalContentIndexScheduler = new ExternalContentIndexScheduler({
        graphService: graphService as any,
        services: nexusServices,
        indexService: externalContentIndexService,
        intervalMs: externalContentIndexHours * 60 * 60 * 1000,
        logger: localLogger,
      });
      if (externalContentIndexEnabled) {
        externalContentIndexScheduler.start();
      } else {
        localLogger.info('[NexusAI] External SSH content indexing auto-run disabled by preference — scheduler not started');
      }

      // WPE content index scheduler — interval-based, triggers indexAllWpeContent.
      const wpeContentIndexSettings = registryStorage.get(STORAGE_KEYS.SETTINGS) as { wpeContentIndexAutoEnabled?: boolean; wpeContentIndexIntervalHours?: number } | null;
      const wpeContentIndexEnabled = wpeContentIndexSettings?.wpeContentIndexAutoEnabled === true;
      const wpeContentIndexHours = wpeContentIndexSettings?.wpeContentIndexIntervalHours ?? 24;
      if (wpeContentIndexEnabled) {
        startWpeContentIndexScheduler(wpeContentIndexHours);
      } else {
        localLogger.info('[NexusAI] WPE content index auto-run disabled — scheduler not started');
      }

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

      startupStatus = { ready: true, phase: null, error: null };

      // Push initial state to NexusStateManager so components have data
      // immediately on first render without waiting for their first poll.
      setTimeout(async () => {
        try {
          const settings = registryStorage.get(STORAGE_KEYS.SETTINGS);
          emitNexusState({ settings: settings ?? {} });
        } catch { /* non-fatal */ }
      }, 2000);
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

      startupStatus = {
        ready: false,
        phase: currentStartupPhase,
        error: {
          message: errorDetails.message,
          name: errorDetails.name,
          code: error?.code ?? null,
          phase: currentStartupPhase ?? 'unknown',
          hint: hintForError(err),
        },
      };

      localLogger.error(
        `[NexusAI] Startup failed in phase '${currentStartupPhase ?? 'unknown'}': ${errorDetails.message}`,
        errorDetails,
      );
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
    getStartupStatus: () => startupStatus,
    graphService,
    eventProcessor,
    vectorDbPath,
    serviceContainer,
    nexusServices,
    wpeSyncService,
    metadataCache,
    onSettingsUpdated,
    emitNexusState,
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
    // A key saved or rotated here never touches STORAGE_KEYS.SETTINGS, so it never reached this
    // handler before — the agent runtime's cached provider (resolvedAgentProvider, resolved
    // once at startup) kept using whatever key existed at Local's last launch. Reproduced live:
    // chat worked immediately with a rotated Power key (it reads the key fresh every request),
    // while the security-sentinel agent's specialist calls 401'd with "invalid or expired
    // token" using the stale one, in the same running process.
    onSettingsUpdated,
  });

  localLogger.info('[NexusAI] Addon loaded');
}
