/**
 * NexusServices — complete typed interface for the service container.
 *
 * This interface describes every property that MCP tool handlers and GraphQL
 * resolvers pull off `services`. It replaces the `services: any` annotation
 * in `ResolverContext` and the `nexusServices?: any` field in `IpcHandlerDeps`.
 *
 * Optional fields use `?` because services are registered incrementally:
 * some are wired in at startup, others are added later in registerIpcHandlers.
 *
 * Import from here when typing `services` in resolver context, MCP tools, or
 * any other code that receives the full service container.
 */

import type { VectorStore } from '../vector-store/VectorStore';
import type { EmbeddingService } from '../embeddings/EmbeddingService';
import type { ContentPipeline } from '../content/ContentPipeline';
import type { IndexRegistry, RegistryStorage } from '../content/IndexRegistry';
import type { FileScanner } from '../content/FileScanner';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { AuditLogger } from '../mcp/audit';
import type { GraphService } from '../events/GraphService';
import type { EventProcessor } from '../events/EventProcessor';
import type { SearchService } from '../search/SearchService';
import type { HealthScoreCalculator } from '../health/HealthScoreCalculator';
import type { FilterEngine } from '../search/FilterEngine';
import type { BulkOperationManager } from '../bulk/BulkOperationManager';
import type { SiteMetadataCache } from '../metadata/SiteMetadataCache';
import type { SiteDigitalTwinService } from '../twin/SiteDigitalTwinService';
import type { OperationTracker } from '../operation-tracker';
import type { LocalSiteDataAccessor } from './site-data';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { OperationAuditLog } from '../audit/OperationAuditLog';
import type { WebhookEmitter } from '../webhooks/WebhookEmitter';

// ---------------------------------------------------------------------------
// Minimal logger shape (matches Local's logger API)
// ---------------------------------------------------------------------------

export interface NexusLogger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// HTTP event interface minimal surface
// ---------------------------------------------------------------------------

export interface HttpEventInterface {
  port: number;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// NexusServices
// ---------------------------------------------------------------------------

/**
 * The full service container passed to MCP tools and GraphQL resolvers.
 *
 * Core services (always present at runtime after initialization):
 *   vectorStore, embeddingService, contentPipeline, indexRegistry,
 *   fileScanner, siteData, logger
 *
 * Optional services (added later or only when configured):
 *   localServices, auditLogger, registryStorage, graphService,
 *   eventProcessor, httpEventInterface, searchService, healthCalculator,
 *   filterEngine, bulkOpManager, groupStorage, operationTracker,
 *   metadataCache, twinService
 */
export interface NexusServices {
  // ── Core services ──────────────────────────────────────────────────────

  vectorStore: VectorStore;
  embeddingService: EmbeddingService;
  contentPipeline: ContentPipeline;
  indexRegistry: IndexRegistry;
  fileScanner: FileScanner;

  /** Local's site data accessor — getSite(id), getSites() */
  siteData: LocalSiteDataAccessor;

  /** Logger — always present */
  logger: NexusLogger;

  // ── Optional services ──────────────────────────────────────────────────

  /** Typed bridge over Local's service container. */
  localServices?: LocalServicesBridge;

  /** Audit logger for operation tracking. */
  auditLogger?: AuditLogger;

  /** Key-value storage for addon settings and API keys. */
  registryStorage?: RegistryStorage;

  /** Knowledge graph service (SQLite-backed). */
  graphService?: GraphService;

  /** Event processor for the graph event queue. */
  eventProcessor?: EventProcessor;

  /** HTTP event interface (the real AI gateway server). */
  httpEventInterface?: HttpEventInterface;

  // ── MCP tool registry ───────────────────────────────────────────────────

  /**
   * MCP tool registry — allows IPC handlers to invoke registered tools.
   * Accessed as `nexusServices.registry.call(...)`.
   */
  registry?: ToolRegistry;

  // ── Sprint 2/3 services (wired in registerIpcHandlers) ─────────────────

  /** Semantic + structured search across the fleet. */
  searchService?: SearchService;

  /** Per-site health score computation. */
  healthCalculator?: HealthScoreCalculator;

  /** Smart filter evaluation across the fleet. */
  filterEngine?: FilterEngine;

  /** Queues and executes bulk operations with concurrency limiting. */
  bulkOpManager?: BulkOperationManager;

  /**
   * Alias for bulkOpManager — some IPC handlers use this name.
   * Both refer to the same BulkOperationManager instance.
   */
  bulkOperationManager?: BulkOperationManager;

  /**
   * Group storage — deprecated. Groups now come from Local's native siteData.
   * Kept for backward compatibility; may be undefined in all environments.
   */
  groupStorage?: unknown;

  // ── Digital twin services ───────────────────────────────────────────────

  /** Tracks push/pull/export operations by intercepting Local's IPC events. */
  operationTracker?: OperationTracker;

  /** Site metadata cache — populated at startup and on site start events. */
  metadataCache?: SiteMetadataCache;

  /** Digital twin service — assembles unified site snapshots from all stores. */
  twinService?: SiteDigitalTwinService;

  // ── Phase 3 services ────────────────────────────────────────────────────

  /**
   * Append-only file-based audit log for Tier 2/3 operations.
   * Written to ~/Library/Application Support/Local/nexus-ai/operation-audit.log
   */
  operationAuditLog?: OperationAuditLog;

  /**
   * Webhook emitter — delivers event payloads to configured HTTP endpoints.
   */
  webhookEmitter?: WebhookEmitter;
}
