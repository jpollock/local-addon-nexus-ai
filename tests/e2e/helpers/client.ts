import * as http from 'http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ResourceInfo {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface HealthResponse {
  status: string;
  port: number;
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

/**
 * Thin HTTP client that talks to the running addon's MCP server.
 * All E2E tests go through this client — no direct tool registry calls.
 */
export class McpClient {
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly authToken: string,
  ) {}

  /**
   * GET /health — no auth required.
   */
  async health(): Promise<HealthResponse> {
    const res = await this.httpGet('/health');
    return JSON.parse(res.body);
  }

  /**
   * JSON-RPC initialize handshake.
   */
  async initialize(): Promise<unknown> {
    const res = await this.sendJsonRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nexus-e2e-tests', version: '1.0.0' },
    });
    if (res.error) {
      throw new Error(`initialize failed: ${res.error.message}`);
    }
    return res.result;
  }

  /**
   * JSON-RPC tools/list.
   */
  async listTools(): Promise<ToolInfo[]> {
    const res = await this.sendJsonRpc('tools/list', {});
    if (res.error) {
      throw new Error(`tools/list failed: ${res.error.message}`);
    }
    const result = res.result as { tools: ToolInfo[] };
    return result.tools;
  }

  /**
   * JSON-RPC tools/call — returns the parsed McpToolResult.
   * Throws if the JSON-RPC response itself is an error (not the tool result).
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const res = await this.callToolRaw(name, args);
    if (res.error) {
      throw new Error(`tools/call ${name} failed: ${res.error.message}`);
    }
    return res.result as McpToolResult;
  }

  /**
   * JSON-RPC tools/call — returns raw JsonRpcResponse for tests that need
   * to inspect error codes or other protocol-level fields.
   */
  async callToolRaw(name: string, args: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
    return this.sendJsonRpc('tools/call', { name, arguments: args });
  }

  /**
   * JSON-RPC resources/list.
   */
  async listResources(): Promise<ResourceInfo[]> {
    const res = await this.sendJsonRpc('resources/list', {});
    if (res.error) {
      throw new Error(`resources/list failed: ${res.error.message}`);
    }
    const result = res.result as { resources: ResourceInfo[] };
    return result.resources;
  }

  /**
   * JSON-RPC resources/read — returns raw response for flexible assertions.
   */
  async readResource(uri: string): Promise<JsonRpcResponse> {
    return this.sendJsonRpc('resources/read', { uri });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async sendJsonRpc(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    } as JsonRpcRequest);

    const res = await this.httpPost('/mcp/messages', body, {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.authToken}`,
    });

    return JSON.parse(res.body) as JsonRpcResponse;
  }

  private httpGet(path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.url);
      const req = http.get(url.toString(), { timeout: 300000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout after 5 minutes'));
      });
    });
  }

  private httpPost(
    path: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.url);
      const req = http.request(
        url.toString(),
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(body).toString(),
          },
          // 5 minute timeout for long operations (site start, bulk operations)
          timeout: 300000,
        },
        (res) => {
          let resBody = '';
          res.on('data', (chunk) => (resBody += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: resBody }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout after 5 minutes'));
      });
      req.write(body);
      req.end();
    });
  }
}
