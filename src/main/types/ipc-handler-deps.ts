/**
 * IpcHandlerDeps — typed dependencies injected into registerIpcHandlers().
 *
 * This replaces the previous `IpcHandlerDeps` interface defined inline in
 * ipc-handlers.ts, which left `siteData`, `localLogger`, `serviceContainer`,
 * and `nexusServices` untyped.
 *
 * Import this in ipc-handlers.ts (or any future decomposed handler module)
 * instead of defining a local interface.
 */

import type { IndexRegistry, RegistryStorage } from '../content/IndexRegistry';
import type { ContentPipeline } from '../content/ContentPipeline';
import type { EmbeddingService } from '../embeddings/EmbeddingService';
import type { VectorStore } from '../vector-store/VectorStore';
import type { McpServer } from '../mcp/McpServer';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { GraphService } from '../events/GraphService';
import type { EventProcessor } from '../events/EventProcessor';
import type { WPESyncService } from '../events/WPESyncService';
import type { SiteMetadataCache } from '../metadata/SiteMetadataCache';
import type { LocalSiteDataAccessor } from './site-data';
import type { NexusServices, NexusLogger } from './nexus-services';

// ---------------------------------------------------------------------------
// Local service container — the raw object from Local's DI system
// ---------------------------------------------------------------------------

/**
 * Minimal typed surface for Local's internal service container.
 *
 * Only the properties actually accessed in ipc-handlers.ts are listed.
 * The real container has many more members; they remain unknown intentionally
 * to prevent accidental coupling to Local internals.
 */
export interface LocalServiceContainer {
  /** Navigate the Local UI to a route. */
  sendIPCEvent?: (event: string, ...args: unknown[]) => void;

  /** Site groups / organization service. */
  sitesOrganization?: {
    getSiteGroups?: () => Array<{ id: string; name: string }>;
    moveSitesToGroup?: (siteIds: string[], groupId: string, refetch?: boolean) => void;
  };

  /**
   * WPE OAuth service — present only on Local versions that ship WPE integration.
   * Access via optional chaining; may be absent.
   */
  wpeOAuth?: {
    authenticate(): Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// IpcHandlerDeps
// ---------------------------------------------------------------------------

/**
 * All dependencies injected into `registerIpcHandlers()`.
 *
 * Core fields are always required. Optional fields are services that are
 * only available when the corresponding feature is enabled or when running
 * on a Local version that ships the service.
 */
export interface IpcHandlerDeps {
  // ── Site data ────────────────────────────────────────────────────────────

  /** Local's site data accessor — getSite(id), getSites() */
  siteData: LocalSiteDataAccessor;

  // ── Service bridges ──────────────────────────────────────────────────────

  /** Typed bridge over Local's WP-CLI and site management APIs. */
  localServicesBridge: LocalServicesBridge;

  // ── Core addon services ──────────────────────────────────────────────────

  indexRegistry: IndexRegistry;
  embeddingService: EmbeddingService;
  contentPipeline: ContentPipeline;
  vectorStore: VectorStore;
  registryStorage: RegistryStorage;

  /** Addon logger (delegates to Local's internal logger). */
  localLogger: NexusLogger;

  /** Returns the live McpServer instance, or null if not yet started. */
  getMcpServer: () => McpServer | null;

  /** Knowledge graph service. */
  graphService: GraphService;

  /** Event processor for the graph event queue. */
  eventProcessor: EventProcessor;

  /** Absolute path to the LanceDB vector store directory. */
  vectorDbPath: string;

  // ── Optional services ────────────────────────────────────────────────────

  /**
   * Local's raw service container.
   * Use only for operations not yet wrapped by LocalServicesBridge:
   *   - sendIPCEvent (UI navigation)
   *   - sitesOrganization (group refresh)
   *   - wpeOAuth (WPE login flow)
   */
  serviceContainer?: LocalServiceContainer;

  /**
   * The shared NexusServices object.
   * Mutated in registerIpcHandlers to add Sprint 2/3 services after creation.
   */
  nexusServices?: NexusServices;

  /** WPE site sync service (Phase 1). */
  wpeSyncService?: WPESyncService;

  /** Site metadata cache (Digital Twin). */
  metadataCache?: SiteMetadataCache;
}
