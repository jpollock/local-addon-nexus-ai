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
      http.get(url.toString(), (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        res.on('error', reject);
      }).on('error', reject);
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
        },
        (res) => {
          let resBody = '';
          res.on('data', (chunk) => (resBody += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: resBody }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
