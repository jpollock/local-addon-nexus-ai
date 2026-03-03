import { VectorStore } from '../vector-store/VectorStore';
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
 * Services available to all MCP tool handlers.
 * Injected during module registration.
 */
export interface NexusServices {
  vectorStore: VectorStore;
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
}
