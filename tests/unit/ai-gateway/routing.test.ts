/**
 * Unit tests for AI Gateway multi-provider routing.
 *
 * Verifies that MODEL_PROVIDER_MAP correctly routes requests to the right
 * provider, that the fallback to global settings works, and that missing
 * API keys produce a clean 503 rather than a crash.
 */

import * as http from 'http';

// --- Mocks (must come before imports that use them) ---

const mockCallAnthropicAPI = jest.fn();
const mockCallOpenAIAPI = jest.fn();
const mockTranslateToAnthropic = jest.fn((req: any) => ({ ...req, _translated: 'anthropic' }));
const mockTranslateFromAnthropic = jest.fn((resp: any) => ({ ...resp, _from: 'anthropic', choices: [] }));
const mockCheckRateLimit = jest.fn().mockReturnValue({ allowed: true });
const mockGetSiteIdFromToken = jest.fn();
const mockCalculateAnthropicCost = jest.fn().mockReturnValue(0.001);
const mockCalculateOpenAICost = jest.fn().mockReturnValue(0.001);

jest.mock('../../../src/main/ai-gateway/anthropic-client', () => ({
  callAnthropicAPI: mockCallAnthropicAPI,
  calculateAnthropicCost: mockCalculateAnthropicCost,
}));

jest.mock('../../../src/main/ai-gateway/openai-client', () => ({
  callOpenAIAPI: mockCallOpenAIAPI,
  calculateOpenAICost: mockCalculateOpenAICost,
}));

jest.mock('../../../src/main/ai-gateway/format-translator', () => ({
  translateToAnthropic: mockTranslateToAnthropic,
  translateFromAnthropic: mockTranslateFromAnthropic,
}));

jest.mock('../../../src/main/ai-gateway/rate-limiter', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

jest.mock('../../../src/main/ai-gateway/token-manager', () => ({
  getSiteIdFromToken: mockGetSiteIdFromToken,
}));

import { AIGatewayRoutes } from '../../../src/main/ai-gateway/AIGatewayRoutes';
import { STORAGE_KEYS } from '../../../src/common/constants';

// --- Helpers ---

function createMockStorage(data: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(data));
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => store.set(key, value),
  };
}

function createMockLogger() {
  return { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
}

function buildRequest(body: object, headers: Record<string, string> = {}): http.IncomingMessage {
  const json = JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-auth-token': 'test-webhook-token',
      'x-wp-site-id': 'site-1',
      ...headers,
    },
    on: jest.fn((event: string, cb: Function) => {
      if (event === 'data') cb(Buffer.from(json));
      if (event === 'end') cb();
      return req;
    }),
  } as unknown as http.IncomingMessage;
  return req;
}

function buildResponse() {
  const res = {
    statusCode: 0,
    body: '',
    writeHead: jest.fn((code: number) => { res.statusCode = code; }),
    end: jest.fn((data: string) => { res.body = data; }),
  } as unknown as http.ServerResponse & { statusCode: number; body: string };
  return res;
}

const BASE_STORAGE = {
  'http_webhook_info': { url: 'http://127.0.0.1:13000', authToken: 'test-webhook-token' },
  [STORAGE_KEYS.INDEX_REGISTRY]: { 'site-1': { siteName: 'Test Site' } },
  [STORAGE_KEYS.API_KEYS]: { anthropic: 'sk-ant-test', openai: 'sk-openai-test' },
};

const ANTHROPIC_RESPONSE = {
  id: 'msg-123',
  content: [{ type: 'text', text: 'Hello' }],
  usage: { input_tokens: 10, output_tokens: 5 },
};

const OPENAI_RESPONSE = {
  id: 'chatcmpl-123',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

// --- Tests ---

describe('AIGatewayRoutes — provider routing', () => {
  let routes: AIGatewayRoutes;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: site ID resolved via index registry fallback (webhook token)
    mockGetSiteIdFromToken.mockReturnValue(null);
    mockCallAnthropicAPI.mockResolvedValue(ANTHROPIC_RESPONSE);
    mockCallOpenAIAPI.mockResolvedValue(OPENAI_RESPONSE);
    mockTranslateFromAnthropic.mockReturnValue({
      id: 'msg-123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'claude-haiku-4-5-20251001',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
    });
  });

  it('routes claude-* models to Anthropic regardless of global provider', async () => {
    routes = new AIGatewayRoutes({
      storage: createMockStorage({ ...BASE_STORAGE, [STORAGE_KEYS.SETTINGS]: { aiProvider: 'openai' } }),
      logger: createMockLogger(),
    });

    const req = buildRequest({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'hi' }] });
    const res = buildResponse();

    await routes.handleChatCompletions(req, res);

    expect(mockCallAnthropicAPI).toHaveBeenCalled();
    expect(mockCallOpenAIAPI).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('routes gpt-* models to OpenAI regardless of global provider', async () => {
    routes = new AIGatewayRoutes({
      storage: createMockStorage({ ...BASE_STORAGE, [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic' } }),
      logger: createMockLogger(),
    });

    const req = buildRequest({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
    const res = buildResponse();

    await routes.handleChatCompletions(req, res);

    expect(mockCallOpenAIAPI).toHaveBeenCalled();
    expect(mockCallAnthropicAPI).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('falls back to global provider (anthropic) for unknown model names', async () => {
    routes = new AIGatewayRoutes({
      storage: createMockStorage({ ...BASE_STORAGE, [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic' } }),
      logger: createMockLogger(),
    });

    const req = buildRequest({ model: 'some-unknown-model-v1', messages: [{ role: 'user', content: 'hi' }] });
    const res = buildResponse();

    await routes.handleChatCompletions(req, res);

    expect(mockCallAnthropicAPI).toHaveBeenCalled();
    expect(mockCallOpenAIAPI).not.toHaveBeenCalled();
  });

  it('falls back to global provider (openai) for unknown model names', async () => {
    routes = new AIGatewayRoutes({
      storage: createMockStorage({ ...BASE_STORAGE, [STORAGE_KEYS.SETTINGS]: { aiProvider: 'openai' } }),
      logger: createMockLogger(),
    });

    const req = buildRequest({ model: 'some-unknown-model-v1', messages: [{ role: 'user', content: 'hi' }] });
    const res = buildResponse();

    await routes.handleChatCompletions(req, res);

    expect(mockCallOpenAIAPI).toHaveBeenCalled();
    expect(mockCallAnthropicAPI).not.toHaveBeenCalled();
  });

  it('returns 503 when Anthropic API key is not configured', async () => {
    routes = new AIGatewayRoutes({
      storage: createMockStorage({
        ...BASE_STORAGE,
        [STORAGE_KEYS.API_KEYS]: { openai: 'sk-openai-test' }, // no anthropic key
        [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic' },
      }),
      logger: createMockLogger(),
    });

    const req = buildRequest({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'hi' }] });
    const res = buildResponse();

    await routes.handleChatCompletions(req, res);

    expect(res.statusCode).toBe(503);
    expect(mockCallAnthropicAPI).not.toHaveBeenCalled();
  });

  it('returns 503 when OpenAI API key is not configured', async () => {
    routes = new AIGatewayRoutes({
      storage: createMockStorage({
        ...BASE_STORAGE,
        [STORAGE_KEYS.API_KEYS]: { anthropic: 'sk-ant-test' }, // no openai key
        [STORAGE_KEYS.SETTINGS]: { aiProvider: 'openai' },
      }),
      logger: createMockLogger(),
    });

    const req = buildRequest({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
    const res = buildResponse();

    await routes.handleChatCompletions(req, res);

    expect(res.statusCode).toBe(503);
    expect(mockCallOpenAIAPI).not.toHaveBeenCalled();
  });

  it('returns 401 when X-WP-Site-ID is not a known site', async () => {
    routes = new AIGatewayRoutes({
      storage: createMockStorage({
        ...BASE_STORAGE,
        [STORAGE_KEYS.INDEX_REGISTRY]: { 'site-1': { siteName: 'Test Site' } }, // only site-1 known
        [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic' },
      }),
      logger: createMockLogger(),
    });

    // Attacker tries to attribute request to a different site they don't own
    const req = buildRequest(
      { model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'hi' }] },
      { 'x-wp-site-id': 'site-victim-999' }, // not in index registry
    );
    const res = buildResponse();

    await routes.handleChatCompletions(req, res);

    expect(res.statusCode).toBe(401);
    expect(mockCallAnthropicAPI).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Auth-Token is missing', async () => {
    routes = new AIGatewayRoutes({
      storage: createMockStorage({ ...BASE_STORAGE, [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic' } }),
      logger: createMockLogger(),
    });

    const req = buildRequest({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'hi' }] });
    // Remove auth token
    (req.headers as any)['x-auth-token'] = undefined;

    const res = buildResponse();
    await routes.handleChatCompletions(req, res);

    expect(res.statusCode).toBe(401);
  });

  describe('handleModels', () => {
    it('returns Anthropic models when global provider is anthropic', () => {
      routes = new AIGatewayRoutes({
        storage: createMockStorage({ ...BASE_STORAGE, [STORAGE_KEYS.SETTINGS]: { aiProvider: 'anthropic' } }),
        logger: createMockLogger(),
      });

      const req = { headers: {} } as http.IncomingMessage;
      const res = buildResponse();

      routes.handleModels(req, res);

      const body = JSON.parse(res.body);
      expect(body.data.some((m: any) => m.id.startsWith('claude'))).toBe(true);
      expect(body.data.every((m: any) => m.owned_by === 'anthropic')).toBe(true);
    });

    it('returns OpenAI models when global provider is openai', () => {
      routes = new AIGatewayRoutes({
        storage: createMockStorage({ ...BASE_STORAGE, [STORAGE_KEYS.SETTINGS]: { aiProvider: 'openai' } }),
        logger: createMockLogger(),
      });

      const req = { headers: {} } as http.IncomingMessage;
      const res = buildResponse();

      routes.handleModels(req, res);

      const body = JSON.parse(res.body);
      expect(body.data.some((m: any) => m.id.startsWith('gpt'))).toBe(true);
      expect(body.data.every((m: any) => m.owned_by === 'openai')).toBe(true);
    });
  });
});
