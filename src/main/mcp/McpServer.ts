import * as http from 'http';
import * as crypto from 'crypto';
import { McpAuth } from './McpAuth';
import { ToolRegistry } from './tool-registry';
import { InstructionRegistry } from './instructions';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  McpInitializeResult,
  NexusServices,
  ConnectionInfo,
} from './types';
import {
  MCP_PORT_RANGE_START,
  MCP_PORT_RANGE_END,
  MCP_PROTOCOL_VERSION,
  MCP_CONNECTION_INFO_FILE,
} from '../../common/constants';

export interface McpServerOptions {
  services: NexusServices;
  registry: ToolRegistry;
  /** Instruction, prompt, and resource registry */
  instructionRegistry?: InstructionRegistry;
  /** Pre-existing auth token to reuse across restarts */
  existingToken?: string;
  /** Override port for testing */
  port?: number;
}

/**
 * MCP-compliant HTTP/SSE server.
 *
 * Endpoints:
 *   GET  /health       — health check (no auth)
 *   GET  /mcp/sse      — SSE stream for MCP handshake
 *   POST /mcp/messages — JSON-RPC 2.0 for MCP requests
 */
export class McpServer {
  private server: http.Server | null = null;
  private auth: McpAuth;
  private registry: ToolRegistry;
  private instructionRegistry: InstructionRegistry;
  private services: NexusServices;
  private port = 0;
  private sseClients = new Map<string, http.ServerResponse>();

  constructor(options: McpServerOptions) {
    this.auth = new McpAuth(options.existingToken);
    this.registry = options.registry;
    this.instructionRegistry = options.instructionRegistry ?? new InstructionRegistry();
    this.services = options.services;
    if (options.port) this.port = options.port;
  }

  async start(): Promise<ConnectionInfo> {
    const port = this.port || await this.findPort();
    this.port = port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(port, '127.0.0.1', () => {
        const info = this.getConnectionInfo();
        this.services.logger.info(`[NexusAI MCP] Server listening on http://127.0.0.1:${port}`);
        resolve(info);
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    // Close all SSE connections
    for (const [, res] of this.sseClients) {
      res.end();
    }
    this.sseClients.clear();

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      url: `http://127.0.0.1:${this.port}`,
      authToken: this.auth.getToken(),
      port: this.port,
      version: '0.1.0',
      tools: this.registry.allToolNames(),
    };
  }

  getPort(): number {
    return this.port;
  }

  private async findPort(): Promise<number> {
    for (let port = MCP_PORT_RANGE_START; port <= MCP_PORT_RANGE_END; port++) {
      const available = await this.isPortAvailable(port);
      if (available) return port;
    }
    throw new Error(`No available port in range ${MCP_PORT_RANGE_START}-${MCP_PORT_RANGE_END}`);
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = http.createServer();
      tester.once('error', () => resolve(false));
      tester.listen(port, '127.0.0.1', () => {
        tester.close(() => resolve(true));
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';

    // Health check — no auth
    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port: this.port }));
      return;
    }

    // All other endpoints require auth
    const authError = this.auth.validate(req);
    if (authError) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: authError }));
      return;
    }

    if (url === '/mcp/sse' && req.method === 'GET') {
      this.handleSse(req, res);
    } else if (url === '/mcp/messages' && req.method === 'POST') {
      this.handleMessages(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private handleSse(req: http.IncomingMessage, res: http.ServerResponse): void {
    const clientId = crypto.randomUUID();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send the messages endpoint as the first event
    res.write(`event: endpoint\ndata: /mcp/messages?sessionId=${clientId}\n\n`);

    this.sseClients.set(clientId, res);

    req.on('close', () => {
      this.sseClients.delete(clientId);
    });
  }

  private handleMessages(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const request = JSON.parse(body) as JsonRpcRequest;
        const response = await this.dispatch(request);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
        }));
      }
    });
  }

  private async dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, id, params } = request;

    const instructions = this.instructionRegistry.getInstructions();

    switch (method) {
      case 'initialize': {
        const result: McpInitializeResult = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'nexus-ai', version: '0.2.0' },
        };
        if (instructions) result.instructions = instructions;
        return this.jsonRpcResult(id, result);
      }

      case 'ping':
        return this.jsonRpcResult(id, {});

      case 'notifications/initialized':
        // Client acknowledgement — no response needed for notifications
        return this.jsonRpcResult(id, {});

      // --- Tools ---

      case 'tools/list':
        return this.jsonRpcResult(id, {
          tools: this.registry.list(this.services),
        });

      case 'tools/call': {
        const toolName = (params as any)?.name as string;
        const toolArgs = ((params as any)?.arguments ?? {}) as Record<string, unknown>;
        const result = await this.registry.call(toolName, toolArgs, this.services);
        return this.jsonRpcResult(id, result);
      }

      // --- Resources ---

      case 'resources/list':
        return this.jsonRpcResult(id, {
          resources: this.instructionRegistry.listResources(),
        });

      case 'resources/read': {
        const uri = (params as any)?.uri as string;
        const resource = await this.instructionRegistry.readResource(uri);
        if (!resource) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Resource not found: ${uri}` },
          };
        }
        return this.jsonRpcResult(id, {
          contents: [{ uri, mimeType: resource.mimeType, text: resource.text }],
        });
      }

      case 'resources/templates/list':
        return this.jsonRpcResult(id, {
          resourceTemplates: this.instructionRegistry.listResourceTemplates(),
        });

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }

  private jsonRpcResult(id: string | number | undefined, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }
}
