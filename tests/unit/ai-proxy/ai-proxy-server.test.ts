/**
 * Unit tests for AiProxyServer — Core + Passthrough Tool Calling
 */
import * as http from 'http';
import { AiProxyServer } from '../../../src/main/ai-proxy/AiProxyServer';

// Mock the http-utils module to avoid real Ollama calls
jest.mock('../../../src/main/chat/providers/http-utils', () => ({
  apiRequest: jest.fn(),
  streamingRequest: jest.fn(),
}));

import { apiRequest, streamingRequest } from '../../../src/main/chat/providers/http-utils';
const mockedApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockedStreamingRequest = streamingRequest as jest.MockedFunction<typeof streamingRequest>;

const logger = { info: jest.fn(), error: jest.fn() };

function createServer() {
  return new AiProxyServer({
    logger,
    port: 0, // auto-assign
    authToken: 'test-token-123',
  });
}

function makeRequest(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string; noAuth?: boolean },
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (!options.noAuth) {
      headers['Authorization'] = 'Bearer test-token-123';
    }
    Object.assign(headers, options.headers ?? {});

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method ?? 'GET',
        headers,
        agent: false, // Disable keep-alive to avoid stale connections between tests
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

describe('AiProxyServer', () => {
  let server: AiProxyServer;
  let port: number;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: Ollama is available with one model
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
          message: { role: 'assistant', content: 'Hello from Ollama!' },
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

  // 1. Auth rejects requests without Bearer token (401)
  it('should reject requests without auth token', async () => {
    const res = await makeRequest(port, {
      path: '/v1/models',
      noAuth: true,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('auth_error');
  });

  // 2. Auth rejects invalid token (401)
  it('should reject requests with invalid token', async () => {
    const res = await makeRequest(port, {
      path: '/v1/models',
      noAuth: true,
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  // 3. Models endpoint returns OpenAI-format model list with toolCapable flag
  it('should list models with toolCapable flag', async () => {
    const res = await makeRequest(port, { path: '/v1/models' });
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('llama3.1');
    expect(res.body.data[0].object).toBe('model');
    expect(res.body.data[0].toolCapable).toBe(true);
  });

  // 4. Health endpoint returns status with Ollama availability
  it('should return health status', async () => {
    // Health doesn't require auth
    const res = await makeRequest(port, {
      path: '/health',
      noAuth: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.ollama).toBe(true);
  });

  // 5. Rate limiter rejects excess requests (429)
  it('should rate limit excessive requests', async () => {
    // Exhaust the bucket (60 tokens)
    const promises = [];
    for (let i = 0; i < 65; i++) {
      promises.push(makeRequest(port, { path: '/v1/models' }));
    }
    const results = await Promise.all(promises);
    const rateLimited = results.filter((r) => r.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });

  // 6. Returns 503 when Ollama unavailable
  it('should return 503 when Ollama is not available', async () => {
    // Override mock to make /api/tags fail (Ollama down)
    mockedApiRequest.mockImplementation(async (opts: any) => {
      if (opts.url?.includes('/api/tags')) {
        throw new Error('Connection refused');
      }
      throw new Error('Connection refused');
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });
    expect(res.status).toBe(503);
    expect(res.body.error.type).toBe('service_unavailable');
  });

  // 7. Passthrough: forwards tools to Ollama, returns tool_calls with stringified arguments
  it('should passthrough tools and translate tool_calls arguments to JSON strings', async () => {
    // Mock Ollama returning a tool call with object arguments
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
              function: {
                name: 'get_weather',
                arguments: { city: 'Seattle', units: 'fahrenheit' },
              },
            }],
          },
          done: true,
          prompt_eval_count: 20,
          eval_count: 3,
        });
      }
      return '{}';
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [{ role: 'user', content: 'What is the weather in Seattle?' }],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' }, units: { type: 'string' } },
              required: ['city'],
            },
          },
        }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].finish_reason).toBe('tool_calls');
    expect(res.body.choices[0].message.tool_calls).toHaveLength(1);

    const tc = res.body.choices[0].message.tool_calls[0];
    expect(tc.type).toBe('function');
    expect(tc.function.name).toBe('get_weather');
    // Key assertion: arguments is a JSON STRING, not an object
    expect(typeof tc.function.arguments).toBe('string');
    expect(JSON.parse(tc.function.arguments)).toEqual({ city: 'Seattle', units: 'fahrenheit' });
    // Must have an id
    expect(tc.id).toMatch(/^call_/);
  });

  // 8. Passthrough: role:"tool" messages pass through correctly
  it('should pass through tool result messages', async () => {
    mockedApiRequest.mockImplementation(async (opts: any) => {
      if (opts.url?.includes('/api/tags')) {
        return JSON.stringify({ models: [{ name: 'llama3.1' }] });
      }
      if (opts.url?.includes('/api/show')) {
        return JSON.stringify({ template: '{{- if .Tools }}yes{{- end }}' });
      }
      if (opts.url?.includes('/api/chat')) {
        // Verify the tool message was forwarded correctly
        const body = JSON.parse(opts.body);
        const toolMsg = body.messages.find((m: any) => m.role === 'tool');
        if (toolMsg && toolMsg.content === '72F and sunny') {
          return JSON.stringify({
            model: 'llama3.1',
            message: { role: 'assistant', content: 'The weather in Seattle is 72F and sunny!' },
            done: true,
          });
        }
        return JSON.stringify({
          model: 'llama3.1',
          message: { role: 'assistant', content: 'I could not process that.' },
          done: true,
        });
      }
      return '{}';
    });

    const res = await makeRequest(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [
          { role: 'user', content: 'Weather in Seattle?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_abc123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"Seattle"}' },
            }],
          },
          { role: 'tool', content: '72F and sunny', tool_call_id: 'call_abc123' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toContain('72F and sunny');
  });
});
