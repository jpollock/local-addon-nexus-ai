/**
 * Unit tests for AI Proxy — Inject Mode, Agentic Mode, Streaming, Embeddings
 */
import * as http from 'http';
import { AiProxyServer } from '../../../src/main/ai-proxy/AiProxyServer';

// Mock http-utils
jest.mock('../../../src/main/chat/providers/http-utils', () => ({
  apiRequest: jest.fn(),
  streamingRequest: jest.fn(),
}));

// Mock tool-converter
jest.mock('../../../src/main/ai-proxy/tool-converter', () => ({
  convertMcpToolsToOpenAI: jest.fn().mockReturnValue([
    {
      type: 'function',
      function: {
        name: 'fleet_health',
        description: 'Check fleet health',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'content_search',
        description: 'Search content',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    },
  ]),
  MAX_PROXY_TOOLS: 20,
}));

import { apiRequest, streamingRequest } from '../../../src/main/chat/providers/http-utils';
const mockedApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockedStreamingRequest = streamingRequest as jest.MockedFunction<typeof streamingRequest>;

const logger = { info: jest.fn(), error: jest.fn() };

// Mock tool registry
function createMockRegistry() {
  return {
    list: jest.fn().mockReturnValue([]),
    allToolNames: jest.fn().mockReturnValue(['fleet_health', 'content_search']),
    call: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"status":"healthy","sites":5}' }],
    }),
  } as any;
}

// Mock NexusServices
const mockServices = {} as any;

function createServer(overrides?: any) {
  return new AiProxyServer({
    logger,
    port: 0,
    authToken: 'test-token-123',
    toolRegistry: createMockRegistry(),
    nexusServices: mockServices,
    ...overrides,
  });
}

function makeRequest(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token-123',
    };
    Object.assign(headers, options.headers ?? {});

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method ?? 'GET',
        headers,
        agent: false,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk.toString()));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode!, body: parsed, raw: data });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function makeStreamingRequest(
  port: number,
  body: string,
  headers?: Record<string, string>,
): Promise<{ status: number; events: string[] }> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token-123',
      ...(headers ?? {}),
    };

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: reqHeaders,
        agent: false,
      },
      (res) => {
        const events: string[] = [];
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              events.push(line.slice(6));
            }
          }
        });
        res.on('end', () => {
          if (buffer.startsWith('data: ')) {
            events.push(buffer.slice(6));
          }
          resolve({ status: res.statusCode!, events });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('AiProxyServer — Inject, Agentic, Streaming, Embeddings', () => {
  let server: AiProxyServer;
  let port: number;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: Ollama available with tool-capable model
    mockedApiRequest.mockImplementation(async (opts: any) => {
      if (opts.url?.includes('/api/tags')) {
        return JSON.stringify({ models: [{ name: 'llama3.1' }] });
      }
      if (opts.url?.includes('/api/show')) {
        return JSON.stringify({ template: '{{- if .Tools }}tools here{{- end }}' });
      }
      if (opts.url?.includes('/api/chat')) {
        return JSON.stringify({
          model: 'llama3.1',
          message: { role: 'assistant', content: 'Hello!' },
          done: true,
          prompt_eval_count: 10,
          eval_count: 5,
        });
      }
      return '{}';
    });

    server = createServer();
    const info = await server.start();
    port = info.port;
  });

  afterEach(async () => {
    await server.stop();
  });

  // 1. Inject mode: merges MCP tools with WordPress tools
  it('should merge MCP tools in inject mode', async () => {
    // Mock Ollama to return the tool list it received for verification
    mockedApiRequest.mockImplementation(async (opts: any) => {
      if (opts.url?.includes('/api/tags')) {
        return JSON.stringify({ models: [{ name: 'llama3.1' }] });
      }
      if (opts.url?.includes('/api/show')) {
        return JSON.stringify({ template: '{{- if .Tools }}yes{{- end }}' });
      }
      if (opts.url?.includes('/api/chat')) {
        const body = JSON.parse(opts.body);
        // Return the tool count as the response content for verification
        const toolCount = body.tools?.length ?? 0;
        return JSON.stringify({
          model: 'llama3.1',
          message: { role: 'assistant', content: `Received ${toolCount} tools` },
          done: true,
        });
      }
      return '{}';
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { 'X-Nexus-Tools': 'inject' },
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [{ role: 'user', content: 'test' }],
        tools: [{
          type: 'function',
          function: { name: 'wp_tool', description: 'WP tool', parameters: {} },
        }],
      }),
    });

    expect(res.status).toBe(200);
    // Should have merged: 1 WP tool + 2 MCP tools = 3 tools
    expect(res.body.choices[0].message.content).toBe('Received 3 tools');
  });

  // 2. Inject mode: caps at 20 tools total
  it('should cap merged tools at 20 in inject mode', async () => {
    mockedApiRequest.mockImplementation(async (opts: any) => {
      if (opts.url?.includes('/api/tags')) {
        return JSON.stringify({ models: [{ name: 'llama3.1' }] });
      }
      if (opts.url?.includes('/api/show')) {
        return JSON.stringify({ template: '{{- if .Tools }}yes{{- end }}' });
      }
      if (opts.url?.includes('/api/chat')) {
        const body = JSON.parse(opts.body);
        const toolCount = body.tools?.length ?? 0;
        return JSON.stringify({
          model: 'llama3.1',
          message: { role: 'assistant', content: `Received ${toolCount} tools` },
          done: true,
        });
      }
      return '{}';
    });

    // Send 19 WP tools + 2 MCP tools = should cap at 20
    const wpTools = Array.from({ length: 19 }, (_, i) => ({
      type: 'function',
      function: { name: `wp_tool_${i}`, description: `WP tool ${i}`, parameters: {} },
    }));

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { 'X-Nexus-Tools': 'inject' },
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [{ role: 'user', content: 'test' }],
        tools: wpTools,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toBe('Received 20 tools');
  });

  // 3. Agentic mode: executes MCP tool call, feeds result back, returns final text
  it('should execute MCP tool calls server-side in agentic mode', async () => {
    let callCount = 0;
    mockedApiRequest.mockImplementation(async (opts: any) => {
      if (opts.url?.includes('/api/tags')) {
        return JSON.stringify({ models: [{ name: 'llama3.1' }] });
      }
      if (opts.url?.includes('/api/show')) {
        return JSON.stringify({ template: '{{- if .Tools }}yes{{- end }}' });
      }
      if (opts.url?.includes('/api/chat')) {
        callCount++;
        if (callCount <= 1) {
          // First call: return a tool call for fleet_health
          return JSON.stringify({
            model: 'llama3.1',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                function: { name: 'fleet_health', arguments: {} },
              }],
            },
            done: true,
          });
        }
        // Second call (after tool result): return final text
        return JSON.stringify({
          model: 'llama3.1',
          message: { role: 'assistant', content: 'Your fleet is healthy with 5 sites.' },
          done: true,
        });
      }
      return '{}';
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { 'X-Nexus-Tools': 'agentic' },
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [{ role: 'user', content: 'How is my fleet?' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toBe('Your fleet is healthy with 5 sites.');
    expect(res.body.choices[0].finish_reason).toBe('stop');
    // Ollama should have been called twice (initial + after tool result)
    const chatCalls = mockedApiRequest.mock.calls.filter(
      (c) => (c[0] as any).url?.includes('/api/chat'),
    );
    expect(chatCalls.length).toBe(2);
  });

  // 4. Agentic mode: max 5 rounds prevents infinite loop
  it('should stop after MAX_AGENTIC_ROUNDS in agentic mode', async () => {
    // Always return tool calls — should stop after 5 rounds
    mockedApiRequest.mockImplementation(async (opts: any) => {
      if (opts.url?.includes('/api/tags')) {
        return JSON.stringify({ models: [{ name: 'llama3.1' }] });
      }
      if (opts.url?.includes('/api/show')) {
        return JSON.stringify({ template: '{{- if .Tools }}yes{{- end }}' });
      }
      if (opts.url?.includes('/api/chat')) {
        return JSON.stringify({
          model: 'llama3.1',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              function: { name: 'fleet_health', arguments: {} },
            }],
          },
          done: true,
        });
      }
      return '{}';
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { 'X-Nexus-Tools': 'agentic' },
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [{ role: 'user', content: 'test' }],
      }),
    });

    expect(res.status).toBe(200);
    // Should have 5 rounds + 1 final call = 6 chat API calls
    const chatCalls = mockedApiRequest.mock.calls.filter(
      (c) => (c[0] as any).url?.includes('/api/chat'),
    );
    expect(chatCalls.length).toBe(6); // 5 rounds + 1 final
  });

  // 5. Agentic mode: WordPress tool calls returned without execution
  it('should return WordPress tool calls without execution in agentic mode', async () => {
    mockedApiRequest.mockImplementation(async (opts: any) => {
      if (opts.url?.includes('/api/tags')) {
        return JSON.stringify({ models: [{ name: 'llama3.1' }] });
      }
      if (opts.url?.includes('/api/show')) {
        return JSON.stringify({ template: '{{- if .Tools }}yes{{- end }}' });
      }
      if (opts.url?.includes('/api/chat')) {
        // Return a WordPress tool call (not in MCP tools)
        return JSON.stringify({
          model: 'llama3.1',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              function: { name: 'wp_get_posts', arguments: { count: 5 } },
            }],
          },
          done: true,
        });
      }
      return '{}';
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { 'X-Nexus-Tools': 'agentic' },
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [{ role: 'user', content: 'Get posts' }],
        tools: [{
          type: 'function',
          function: { name: 'wp_get_posts', description: 'Get posts', parameters: {} },
        }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].finish_reason).toBe('tool_calls');
    expect(res.body.choices[0].message.tool_calls[0].function.name).toBe('wp_get_posts');
  });

  // 6. Streaming (no tools): SSE events in OpenAI delta format with [DONE]
  it('should stream SSE events in OpenAI format', async () => {
    // Mock streamingRequest to return an async iterable
    const lines = [
      JSON.stringify({ model: 'llama3.1', message: { role: 'assistant', content: 'Hello' }, done: false }),
      JSON.stringify({ model: 'llama3.1', message: { role: 'assistant', content: ' world' }, done: false }),
      JSON.stringify({ model: 'llama3.1', message: { role: 'assistant', content: '' }, done: true }),
    ];

    mockedStreamingRequest.mockReturnValue((async function* () {
      for (const line of lines) {
        yield line;
      }
    })() as any);

    const { status, events } = await makeStreamingRequest(port, JSON.stringify({
      model: 'llama3.1',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    }));

    expect(status).toBe(200);

    // Parse SSE events
    const parsed = events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e));

    // Should have content deltas
    const contentEvents = parsed.filter((e) => e.choices?.[0]?.delta?.content);
    expect(contentEvents.length).toBeGreaterThanOrEqual(1);
    expect(contentEvents[0].choices[0].delta.content).toBe('Hello');

    // Should have [DONE] at the end
    expect(events[events.length - 1]).toBe('[DONE]');

    // Should have finish_reason in last chunk
    const lastParsed = parsed[parsed.length - 1];
    expect(lastParsed.choices[0].finish_reason).toBe('stop');
  });

  // 7. Embeddings: returns vectors in OpenAI format
  it('should return embeddings in OpenAI format', async () => {
    const mockEmbedding = new Float32Array(384).fill(0.1);
    const embeddingService = {
      embed: jest.fn().mockResolvedValue(mockEmbedding),
    };

    await server.stop();
    server = createServer({ embeddingService });
    const info = await server.start();
    port = info.port;

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/embeddings',
      body: JSON.stringify({ input: 'Hello world' }),
    });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].object).toBe('embedding');
    expect(res.body.data[0].embedding).toHaveLength(384);
    expect(res.body.model).toBe('all-MiniLM-L6-v2');
  });

  // 8. Passthrough mode (default): does not merge MCP tools
  it('should not merge MCP tools in passthrough mode', async () => {
    mockedApiRequest.mockImplementation(async (opts: any) => {
      if (opts.url?.includes('/api/tags')) {
        return JSON.stringify({ models: [{ name: 'llama3.1' }] });
      }
      if (opts.url?.includes('/api/show')) {
        return JSON.stringify({ template: '{{- if .Tools }}yes{{- end }}' });
      }
      if (opts.url?.includes('/api/chat')) {
        const body = JSON.parse(opts.body);
        const toolCount = body.tools?.length ?? 0;
        return JSON.stringify({
          model: 'llama3.1',
          message: { role: 'assistant', content: `Received ${toolCount} tools` },
          done: true,
        });
      }
      return '{}';
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      // No X-Nexus-Tools header = passthrough
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [{ role: 'user', content: 'test' }],
        tools: [{
          type: 'function',
          function: { name: 'wp_tool', description: 'WP tool', parameters: {} },
        }],
      }),
    });

    expect(res.status).toBe(200);
    // Should only have the 1 WP tool (no MCP tools merged)
    expect(res.body.choices[0].message.content).toBe('Received 1 tools');
  });
});
