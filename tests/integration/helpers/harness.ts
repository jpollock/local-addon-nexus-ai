import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { VectorStore } from '../../../src/main/vector-store/VectorStore';
import { EmbeddingService } from '../../../src/main/embeddings/EmbeddingService';
import { ContentPipeline } from '../../../src/main/content/ContentPipeline';
import { MySQLExtractor } from '../../../src/main/content/MySQLExtractor';
import { FileScanner } from '../../../src/main/content/FileScanner';
import { IndexRegistry, RegistryStorage } from '../../../src/main/content/IndexRegistry';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { McpSafetyWrapper } from '../../../src/main/mcp/mcp-safety-wrapper';
import { McpServer } from '../../../src/main/mcp/McpServer';
import { createAuditLogger } from '../../../src/main/mcp/audit';
import { registerContentTools } from '../../../src/main/mcp/modules/content/index';
import { registerSiteContextTools } from '../../../src/main/mcp/modules/site-context/index';
import { registerOllamaTools } from '../../../src/main/mcp/modules/ollama/index';
import { registerFleetTools } from '../../../src/main/mcp/modules/fleet/index';
import { registerSiteManagementTools } from '../../../src/main/mcp/modules/site-management/index';
import { registerWpCliTools } from '../../../src/main/mcp/modules/wp-cli/index';
import { registerWpeTools } from '../../../src/main/mcp/modules/wpe/index';
import { registerWpConnectorTools } from '../../../src/main/mcp/modules/wp-connector/index';
import type { NexusServices, McpToolResult, ConnectionInfo, JsonRpcResponse, SiteDataAccessor, LocalSiteInfo } from '../../../src/main/mcp/types';
import type { ExtractedPost, IndexResult } from '../../../src/common/types';
import { createStubBridge, StubBridgeConfig } from './stub-bridge';
import { loadSiteData } from './fixtures';

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'models', 'all-MiniLM-L6-v2-quantized');

export interface HarnessOptions {
  /** Skip starting MCP HTTP server (faster for non-HTTP tests) */
  skipServer?: boolean;
  /** Attach a stub LocalServicesBridge */
  withLocalServices?: boolean;
  /** Configuration for the stub bridge */
  localServicesConfig?: StubBridgeConfig;
  /** Use real sites.json from Local app */
  useSitesJson?: boolean;
  /** Custom site data to use */
  siteData?: SiteDataAccessor;
}

/**
 * In-memory RegistryStorage for tests.
 */
function createMemoryStorage(): RegistryStorage {
  const store = new Map<string, any>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => { store.set(key, value); },
  };
}

/**
 * Integration test harness. Boots real ONNX embeddings, real LanceDB vector store,
 * real MCP server, and real tool registry — no mocks for the core pipeline.
 */
export class TestHarness {
  embeddingService!: EmbeddingService;
  vectorStore!: VectorStore;
  contentPipeline!: ContentPipeline;
  indexRegistry!: IndexRegistry;
  registry!: ToolRegistry;
  safetyWrapper!: McpSafetyWrapper;
  services!: NexusServices;
  server: McpServer | null = null;
  connectionInfo: ConnectionInfo | null = null;

  private tmpDir!: string;
  private cleanupFns: Array<() => Promise<void>> = [];

  /**
   * Create and initialize a fully-wired test harness.
   */
  static async create(opts: HarnessOptions = {}): Promise<TestHarness> {
    const harness = new TestHarness();
    await harness.init(opts);
    return harness;
  }

  private async init(opts: HarnessOptions): Promise<void> {
    // Create unique temp directory for this harness instance
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-integration-'));

    // Initialize real services
    const vectorDbPath = path.join(this.tmpDir, 'vectors');
    this.vectorStore = new VectorStore(vectorDbPath);
    await this.vectorStore.initialize();

    this.embeddingService = new EmbeddingService(MODELS_DIR);
    await this.embeddingService.initialize();

    const fileScanner = new FileScanner();
    const mysqlExtractor = new MySQLExtractor();
    this.indexRegistry = new IndexRegistry(createMemoryStorage());

    this.contentPipeline = new ContentPipeline({
      vectorStore: this.vectorStore,
      embeddingService: this.embeddingService,
      mysqlExtractor,
      fileScanner,
      indexRegistry: this.indexRegistry,
    });

    // Build site data
    let siteData: SiteDataAccessor;
    if (opts.siteData) {
      siteData = opts.siteData;
    } else if (opts.useSitesJson) {
      siteData = loadSiteData('local-sites-json');
    } else {
      // Default: empty fixture
      siteData = {
        getSite: () => null,
        getSites: () => ({}),
      };
    }

    const logger = {
      info: (..._args: unknown[]) => { /* silent in tests */ },
      error: (..._args: unknown[]) => { /* silent in tests */ },
    };

    const auditLogger = createAuditLogger();

    // Build NexusServices
    this.services = {
      vectorStore: this.vectorStore,
      embeddingService: this.embeddingService,
      contentPipeline: this.contentPipeline,
      indexRegistry: this.indexRegistry,
      fileScanner,
      siteData,
      logger,
      auditLogger,
    };

    // Optionally attach localServices stub
    if (opts.withLocalServices || opts.localServicesConfig) {
      this.services.localServices = createStubBridge(
        siteData,
        opts.localServicesConfig,
      );
    }

    // Register all tools
    this.registry = new ToolRegistry();
    registerContentTools(this.registry);
    registerSiteContextTools(this.registry);
    registerOllamaTools(this.registry);
    registerFleetTools(this.registry);
    registerSiteManagementTools(this.registry);
    registerWpCliTools(this.registry);
    registerWpeTools(this.registry);
    registerWpConnectorTools(this.registry);

    // Create safety wrapper for tier 3 confirmation flow
    this.safetyWrapper = new McpSafetyWrapper(this.registry);

    // Optionally start MCP server
    if (!opts.skipServer) {
      this.server = new McpServer({
        services: this.services,
        registry: this.registry,
        port: 0, // random port
      });
      this.connectionInfo = await this.server.start();
    }
  }

  /**
   * Index fixture posts through the real chunking + embedding pipeline.
   * Bypasses MySQL extraction by directly feeding ExtractedPost[] data.
   */
  async indexFixturePosts(
    siteId: string,
    siteName: string,
    posts: ExtractedPost[],
  ): Promise<IndexResult> {
    // Add site to siteData if not already present
    const existingSites = this.services.siteData.getSites();
    if (!existingSites[siteId]) {
      const sites: Record<string, LocalSiteInfo> = { ...existingSites };
      sites[siteId] = {
        id: siteId,
        name: siteName,
        path: path.join(this.tmpDir, 'sites', siteId),
        domain: `${siteName.toLowerCase().replace(/\s+/g, '-')}.local`,
      };
      this.services.siteData = {
        getSite: (id: string) => sites[id] ?? null,
        getSites: () => sites,
      };
    }

    // Use the content pipeline's internal chunking + embedding
    // by directly calling indexSite with a mock extractor
    const pipeline = this.contentPipeline as any;
    const chunks = pipeline.chunkPosts(siteId, posts);

    const BATCH_SIZE = 16;
    const embeddedDocs: any[] = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c: any) => c.textForEmbedding);
      const vectors = await this.embeddingService.embedBatch(texts);
      for (let j = 0; j < batch.length; j++) {
        embeddedDocs.push({ ...batch[j].doc, vector: vectors[j] });
      }
    }

    await this.vectorStore.upsert(siteId, embeddedDocs);

    const uniquePostIds = new Set(embeddedDocs.map((d) => d.postId));

    // Update index registry
    this.indexRegistry.update(siteId, {
      siteName,
      lastIndexed: Date.now(),
      documentCount: uniquePostIds.size,
      chunkCount: embeddedDocs.length,
      durationMs: 0,
      structure: null,
      state: 'indexed',
    });

    return {
      siteId,
      documentsIndexed: uniquePostIds.size,
      chunksIndexed: embeddedDocs.length,
      durationMs: 0,
      errors: [],
    };
  }

  /**
   * Send a raw JSON-RPC request to the MCP server via HTTP.
   */
  async sendJsonRpc(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    if (!this.connectionInfo) {
      throw new Error('MCP server not started. Create harness without skipServer.');
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    });

    const response = await fetch(`${this.connectionInfo.url}/mcp/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.connectionInfo.authToken}`,
      },
      body,
    });

    return response.json() as Promise<JsonRpcResponse>;
  }

  /**
   * Call a tool through the McpSafetyWrapper (includes tier 3 confirmation flow).
   * For tests that don't need safety enforcement, use registry.call() directly.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    return this.safetyWrapper.callWithSafety(name, args, this.services);
  }

  /**
   * Make an HTTP request to the MCP server (for auth/transport tests).
   */
  async httpRequest(
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    if (!this.connectionInfo) {
      throw new Error('MCP server not started.');
    }

    const response = await fetch(`${this.connectionInfo.url}${path}`, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      headers,
      body: await response.text(),
    };
  }

  /**
   * Clean up all resources.
   */
  async cleanup(): Promise<void> {
    if (this.server) {
      await this.server.stop();
    }

    for (const fn of this.cleanupFns) {
      await fn();
    }

    // Clean up temp directory
    if (this.tmpDir && fs.existsSync(this.tmpDir)) {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
    }
  }
}
