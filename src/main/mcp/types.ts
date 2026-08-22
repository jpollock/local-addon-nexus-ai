import type { IVectorStore } from '../vector-store/IVectorStore';
import { EmbeddingService } from '../embeddings/EmbeddingService';
import { ContentPipeline } from '../content/ContentPipeline';
import { IndexRegistry } from '../content/IndexRegistry';
import { FileScanner } from '../content/FileScanner';
import type { LocalServicesBridge } from './local-services-bridge';
import type { AuditLogger } from './audit';
import type { RegistryStorage } from '../content/IndexRegistry';

// ---------------------------------------------------------------------------
// MCP JSON-RPC
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// MCP Protocol
// ---------------------------------------------------------------------------

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpCapabilities {
  tools?: Record<string, never>;
  resources?: Record<string, never>;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: McpCapabilities;
  serverInfo: McpServerInfo;
  instructions?: string;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

export interface McpResource extends McpResourceDefinition {
  read: () => Promise<{ text: string; mimeType: string }>;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  read: (uri: string) => Promise<{ text: string; mimeType: string }>;
}

// ---------------------------------------------------------------------------
// Tool System
// ---------------------------------------------------------------------------

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Returns true when this tool's prerequisites are met. Omit for always-available tools. */
  isAvailable?: (services: NexusServices) => boolean;
  /** MCP tool annotations (title, readOnlyHint, etc.) */
  annotations?: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpToolHandler {
  definition: McpToolDefinition;
  execute: (args: Record<string, unknown>, services: NexusServices) => Promise<McpToolResult>;
}

// ---------------------------------------------------------------------------
// Service Dependencies
// ---------------------------------------------------------------------------

/**
 * The WP Engine sync surface MCP tools reach.
 *
 * Structural rather than the concrete `WPESyncService` on purpose: the class
 * takes a dozen constructor dependencies (CAPI bridge, embedding service,
 * vector store, extractor…), and a tool test that needs four methods should
 * not have to build all of them. `WPESyncService` satisfies this by shape, so
 * `src/main/index.ts` assigns it directly with no adapter.
 *
 * WP-61: added so `wpe_sync_sites` can exist. Eight error strings named that
 * tool as the remedy while the registry carried no such name, and the reason
 * it carried none is that the service reaching it was never on this interface.
 */
export interface WpeSyncAccessor {
  /** Fleet metadata sync. DISCOVERS installs from CAPI, so it is the only path
   *  that can fix "no WP Engine installs found in graph". Skips installs synced
   *  within `staleThresholdHours` (default 8). */
  syncAllWPESites(
    limit?: number,
    staleThresholdHours?: number,
    accountFilter?: string[] | null,
  ): Promise<{
    success: boolean;
    synced: number;
    skipped: number;
    failed: number;
    errors: Array<{ installId: string; error: string }>;
  }>;
  /** One install's metadata, by CAPI install id — not by name. Ignores staleness. */
  syncSingleSite(installId: string): Promise<void>;
  /** Fleet content index. Reads the graph's existing `wpe` rows; cannot add one. */
  indexAllWpeContent(): Promise<{ indexed: number; errors: number }>;
  /** One install's content index. Throws on missing dependencies where the
   *  fleet-wide version warns and returns zero. */
  indexOneWpeContent(siteId: string, installName: string): Promise<void>;
}

/**
 * Services available to all MCP tool handlers.
 * Injected during module registration.
 */
export interface NexusServices {
  vectorStore: IVectorStore;
  embeddingService: EmbeddingService;
  contentPipeline: ContentPipeline;
  indexRegistry: IndexRegistry;
  fileScanner: FileScanner;
  /** Local's site data — getSite(id), getSites() */
  siteData: SiteDataAccessor;
  /** Local's logger */
  logger: { info(...args: unknown[]): void; error(...args: unknown[]): void };
  /** Typed bridge over Local's service container. Optional for backward compat. */
  localServices?: LocalServicesBridge;
  /** Audit logger for operation tracking. Optional for backward compat. */
  auditLogger?: AuditLogger;
  /** Key-value storage for addon settings (API keys, preferences). Optional for backward compat. */
  registryStorage?: RegistryStorage;
  /** Knowledge graph service. Optional for backward compat. */
  graphService?: any;
  /** WP Engine sync service — backs `wpe_sync_sites`. Optional: absent in tests
   *  and on a build where WPE integration failed to start. */
  wpeSyncService?: WpeSyncAccessor;
  /** Event processor. Optional for backward compat. */
  eventProcessor?: any;
  /** Fleet assembler. Optional for backward compat. */
  fleetAssembler?: import('../fleet/FleetAssembler').FleetAssembler;
  /** Site link resolver. Optional for backward compat. */
  siteLinkResolver?: import('../fleet/SiteLinkResolver').SiteLinkResolver;
  /** HTTP event interface. Optional for backward compat. */
  httpEventInterface?: any;
  /** Sprint 2+3 services (optional for backward compat) */
  searchService?: any;
  healthCalculator?: any;
  filterEngine?: any;
  bulkOpManager?: any;
  groupStorage?: any;
  /** Tracks push/pull/export operations by intercepting Local's IPC events */
  operationTracker?: import('../operation-tracker').OperationTracker;
  /** Digital twin metadata cache — site metadata populated at startup and on site start */
  metadataCache?: import('../metadata/SiteMetadataCache').SiteMetadataCache;
  /** Digital twin service — assembles unified site snapshots from all stores */
  twinService?: import('../twin/SiteDigitalTwinService').SiteDigitalTwinService;
  /** Phase 3: Append-only file-based audit log for Tier 2/3 operations */
  operationAuditLog?: import('../audit/OperationAuditLog').OperationAuditLog;
  /** Agent platform runtime components */
  agentRegistry?: import('../agent-runtime/AgentRegistry').AgentRegistry;
  agentRunner?: import('../agent-runtime/AgentRunner').AgentRunner;
  agentEventBus?: import('../agent-event-bus/AgentEventBus').AgentEventBus;
  agentStateStore?: import('../agent-runtime/AgentStateStore').AgentStateStore;
  inboxStore?: import('../inbox/InboxStore').InboxStore;
  /** Cron scheduler. Exposed so AGENT_SETTINGS_UPDATE can re-register an agent the moment its
   *  cadence changes — a schedule that only takes effect after a restart is the same class of
   *  dead setting as the cadence picker that nothing read. */
  agentScheduler?: import('../agent-runtime/AgentScheduler').AgentScheduler;
  agentReload?: () => Promise<void>;
  /** Contributed tool registry — tracks tools registered by installed agents */
  contributedRegistry?: import('../agent-runtime/ContributedToolRegistry').ContributedToolRegistry;
  /** Agent dispatcher — routes contributed tool calls to agent handlers */
  dispatcher?: import('../agent-runtime/AgentDispatcher').AgentDispatcher;
  /** Process-wide structured run log — shared by AgentRunner and (later) the IPC gate wrapper so
   *  both write to the same file rather than each constructing their own EventLog instance. */
  eventLog?: import('../logging/eventLog').EventLog;
  gatewayUrl?: string;
  gatewayAuthToken?: string;
  /** Credential manager for OAuth flows. Added in Task 9 — optional for backward compat. */
  credentialManager?: import('../credentials/CredentialManager').CredentialManager;
  /**
   * Re-read settings and restart/stop every settings-driven scheduler. Assigned in
   * `src/main/index.ts`; the same closure the IPC UPDATE_SETTINGS handler gets. Exposed
   * here so the GraphQL `nexusUpdateSettings` mutation (the `nexus settings set` path,
   * which has no access to IpcHandlerDeps) is settings-reactive too — without it a CLI
   * settings write only took effect after Local was restarted. Mirrored in
   * `src/main/types/nexus-services.ts`, which declares the same container.
   */
  onSettingsUpdated?: () => void;
}

/**
 * Minimal interface for accessing Local's site data.
 * Addons access this via the service container.
 */
export interface SiteDataAccessor {
  getSite(id: string): LocalSiteInfo | null;
  getSites(): Record<string, LocalSiteInfo>;
}

/**
 * Minimal site info needed by MCP tools.
 * Maps to the relevant fields from Local's Site type.
 */
export interface LocalSiteInfo {
  id: string;
  name: string;
  path: string;
  domain?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Connection Info
// ---------------------------------------------------------------------------

export interface ConnectionInfo {
  url: string;
  authToken: string;
  port: number;
  version: string;
  tools: string[];
  /** Absolute path to bin/mcp-stdio.js — used to generate correct agent setup configs */
  stdioPath: string;
}
