import { TestHarness } from './helpers/harness';
import { createSiteData } from './helpers/fixtures';

describe('MCP Server HTTP Transport', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    const siteData = createSiteData({
      'site-abc123': {
        id: 'site-abc123',
        name: 'Dev Blog',
        path: '/tmp/nexus-test/dev-blog',
        domain: 'dev-blog.local',
      },
    });

    harness = await TestHarness.create({ siteData });
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  // --- Health Check ---

  test('GET /health returns 200 without auth', async () => {
    const res = await harness.httpRequest('/health');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.port).toBeGreaterThan(0);
  });

  // --- Auth Tests ---

  test('POST /mcp/messages returns 401 without auth header', async () => {
    const res = await harness.httpRequest('/mcp/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(res.status).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Missing Authorization header');
  });

  test('POST /mcp/messages returns 401 with wrong token', async () => {
    const res = await harness.httpRequest('/mcp/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong-token-value',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(res.status).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Invalid authentication token');
  });

  test('POST /mcp/messages returns 401 with empty Authorization', async () => {
    const res = await harness.httpRequest('/mcp/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': '',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(res.status).toBe(401);
  });

  // --- JSON-RPC Protocol ---

  test('initialize returns correct protocol version and server info', async () => {
    const response = await harness.sendJsonRpc('initialize');
    expect(response.result).toBeDefined();
    const result = response.result as any;
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo.name).toBe('nexus-ai');
    expect(result.capabilities.tools).toBeDefined();
  });

  test('tools/list returns registered tools', async () => {
    const response = await harness.sendJsonRpc('tools/list');
    expect(response.result).toBeDefined();
    const result = response.result as any;
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBeGreaterThan(0);

    // Content tools should always be present (no isAvailable gate)
    const names = result.tools.map((t: any) => t.name);
    expect(names).toContain('search_site_content');
    expect(names).toContain('search_across_sites');
  });

  test('unknown method returns -32601', async () => {
    const response = await harness.sendJsonRpc('foo/bar');
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32601);
    expect(response.error!.message).toContain('Method not found');
  });

  test('malformed JSON returns parse error', async () => {
    const res = await harness.httpRequest('/mcp/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${harness.connectionInfo!.authToken}`,
      },
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe(-32700);
    expect(body.error.message).toBe('Parse error');
  });

  // --- CORS ---

  test('CORS headers are set on all responses', async () => {
    const res = await harness.httpRequest('/health');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  test('OPTIONS request returns 204 (CORS preflight)', async () => {
    const res = await harness.httpRequest('/mcp/messages', {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
  });

  // --- Routing ---

  test('404 for unknown path with valid auth', async () => {
    const res = await harness.httpRequest('/nonexistent', {
      headers: {
        'Authorization': `Bearer ${harness.connectionInfo!.authToken}`,
      },
    });
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Not found');
  });

  // --- SSE ---

  test('GET /mcp/sse returns event stream', async () => {
    const url = `${harness.connectionInfo!.url}/mcp/sse`;
    const controller = new AbortController();

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${harness.connectionInfo!.authToken}`,
      },
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    // Read the first chunk which should contain the endpoint event
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain('event: endpoint');
    expect(text).toContain('/mcp/messages?sessionId=');

    controller.abort();
  });
});
