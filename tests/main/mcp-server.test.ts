import * as http from 'http';
import { McpServer } from '../../src/main/mcp/McpServer';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { NexusServices, JsonRpcRequest } from '../../src/main/mcp/types';

function createMockServices(): NexusServices {
  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: { listAll: () => [], get: () => null } as any,
    fileScanner: {} as any,
    siteData: { getSite: () => null, getSites: () => ({}) },
    logger: { info: jest.fn(), error: jest.fn() },
  };
}

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: object,
  token?: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('McpServer', () => {
  let server: McpServer;
  let port: number;
  let token: string;

  beforeAll(async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async () => ({ content: [{ type: 'text', text: 'test result' }] }),
    });

    server = new McpServer({
      services: createMockServices(),
      registry,
      port: 0, // Let the server find a port
    });

    const info = await server.start();
    port = info.port;
    token = info.authToken;
  });

  afterAll(async () => {
    await server.stop();
  });

  test('health check returns ok (no auth)', async () => {
    const res = await httpRequest(port, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('rejects requests without auth', async () => {
    const res = await httpRequest(port, 'POST', '/mcp/messages', { jsonrpc: '2.0', method: 'ping' });
    expect(res.status).toBe(401);
  });

  test('rejects requests with wrong token', async () => {
    const res = await httpRequest(port, 'POST', '/mcp/messages', { jsonrpc: '2.0', method: 'ping' }, 'wrong');
    expect(res.status).toBe(401);
  });

  test('initialize returns server info', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/mcp/messages',
      { jsonrpc: '2.0', id: 1, method: 'initialize' } as JsonRpcRequest,
      token,
    );
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe('nexus-ai');
    expect(res.body.result.protocolVersion).toBe('2024-11-05');
  });

  test('ping returns empty result', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/mcp/messages',
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      token,
    );
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({});
  });

  test('tools/list returns registered tools', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/mcp/messages',
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      token,
    );
    expect(res.status).toBe(200);
    const tools = res.body.result.tools;
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('test_tool');
  });

  test('tools/call executes a tool', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/mcp/messages',
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'test_tool', arguments: {} },
      },
      token,
    );
    expect(res.status).toBe(200);
    expect(res.body.result.content[0].text).toBe('test result');
  });

  test('unknown method returns error', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/mcp/messages',
      { jsonrpc: '2.0', id: 5, method: 'unknown/method' },
      token,
    );
    expect(res.status).toBe(200);
    expect(res.body.error.code).toBe(-32601);
  });

  test('404 for unknown path', async () => {
    const res = await httpRequest(port, 'GET', '/unknown', undefined, token);
    expect(res.status).toBe(404);
  });

  test('connection info contains expected fields', () => {
    const info = server.getConnectionInfo();
    expect(info.url).toContain('127.0.0.1');
    expect(info.authToken).toBeTruthy();
    expect(info.tools).toContain('test_tool');
    expect(info.version).toBe('0.1.0');
  });
});
