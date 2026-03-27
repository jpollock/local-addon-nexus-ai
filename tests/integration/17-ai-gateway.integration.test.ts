/**
 * AI Gateway Integration Tests
 *
 * Tests the AI Gateway server infrastructure:
 * - Token generation and authentication
 * - OpenAI ↔ Anthropic format translation
 * - Rate limiting enforcement
 * - Usage and cost tracking
 * - Error handling
 */

import * as http from 'http';
import { AIGatewayRoutes } from '../../src/main/ai-gateway/AIGatewayRoutes';
import { generateToken, getOrCreateSiteToken, getSiteIdFromToken } from '../../src/main/ai-gateway/token-manager';
import { translateToAnthropic, translateFromAnthropic } from '../../src/main/ai-gateway/format-translator';
import { getRateLimit, setRateLimit, checkRateLimit } from '../../src/main/ai-gateway/rate-limiter';
import { calculateAnthropicCost } from '../../src/main/ai-gateway/anthropic-client';
import { STORAGE_KEYS } from '../../src/common/constants';

describe('AI Gateway Integration', () => {
  let mockStorage: Map<string, any>;

  beforeEach(() => {
    mockStorage = new Map();
  });

  const createMockStorage = () => ({
    get: (key: string) => mockStorage.get(key),
    set: (key: string, value: any) => mockStorage.set(key, value),
    delete: (key: string) => mockStorage.delete(key),
    has: (key: string) => mockStorage.has(key),
  });

  describe('Token Management', () => {
    it('generates unique tokens', () => {
      const token1 = generateToken();
      const token2 = generateToken();

      expect(token1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(token2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(token1).not.toBe(token2);
    });

    it('creates and retrieves site tokens', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-123';
      const siteName = 'Test Site';

      const token1 = getOrCreateSiteToken(storage, siteId, siteName);
      const token2 = getOrCreateSiteToken(storage, siteId, siteName);

      expect(token1).toBe(token2); // Same token on subsequent calls
      expect(token1).toMatch(/^[0-9a-f-]+$/i);
    });

    it('retrieves site ID from token', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-456';
      const siteName = 'Another Site';

      const token = getOrCreateSiteToken(storage, siteId, siteName);
      const retrievedSiteId = getSiteIdFromToken(storage, token);

      expect(retrievedSiteId).toBe(siteId);
    });

    it('returns null for invalid token', () => {
      const storage = createMockStorage();
      const siteId = getSiteIdFromToken(storage, 'invalid-token-12345');

      expect(siteId).toBeNull();
    });

    it('stores site name in token metadata', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-789';
      const siteName = 'Third Site';

      getOrCreateSiteToken(storage, siteId, siteName);

      const tokens = storage.get('nexus_ai_gateway_tokens') as Record<string, any>;
      const tokenData = Object.values(tokens)[0];

      expect(tokenData.siteId).toBe(siteId);
      expect(tokenData.siteName).toBe(siteName);
    });
  });

  describe('Format Translation', () => {
    it('translates OpenAI request to Anthropic format', () => {
      const openAIRequest = {
        model: 'claude-haiku-4-5-20251001',
        messages: [
          { role: 'system' as const, content: 'You are a helpful assistant.' },
          { role: 'user' as const, content: 'Hello!' },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      };

      const anthropicRequest = translateToAnthropic(openAIRequest);

      expect(anthropicRequest.model).toBe('claude-haiku-4-5-20251001');
      expect(anthropicRequest.max_tokens).toBe(1024);
      expect(anthropicRequest.temperature).toBe(0.7);
      expect(anthropicRequest.system).toBe('You are a helpful assistant.');
      expect(anthropicRequest.messages).toEqual([
        { role: 'user', content: 'Hello!' },
      ]);
    });

    it('handles requests without system message', () => {
      const openAIRequest = {
        model: 'claude-sonnet-4-5-20250514',
        messages: [
          { role: 'user' as const, content: 'What is 2+2?' },
          { role: 'assistant' as const, content: '4' },
          { role: 'user' as const, content: 'And 3+3?' },
        ],
      };

      const anthropicRequest = translateToAnthropic(openAIRequest);

      expect(anthropicRequest.system).toBeUndefined();
      expect(anthropicRequest.messages).toHaveLength(3);
    });

    it('translates Anthropic response to OpenAI format', () => {
      const anthropicResponse = {
        id: 'msg_123abc',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Hello! How can I help you?' }],
        model: 'claude-sonnet-4-5-20250514',
        stop_reason: 'end_turn' as const,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
      };

      const openAIResponse = translateFromAnthropic(anthropicResponse);

      expect(openAIResponse.id).toBe('msg_123abc');
      expect(openAIResponse.model).toBe('claude-sonnet-4-5-20250514');
      expect(openAIResponse.choices).toHaveLength(1);
      expect(openAIResponse.choices[0].message.role).toBe('assistant');
      expect(openAIResponse.choices[0].message.content).toBe('Hello! How can I help you?');
      expect(openAIResponse.choices[0].finish_reason).toBe('stop');
      expect(openAIResponse.usage.prompt_tokens).toBe(10);
      expect(openAIResponse.usage.completion_tokens).toBe(20);
      expect(openAIResponse.usage.total_tokens).toBe(30);
    });

    it('handles multi-part content in response', () => {
      const anthropicResponse = {
        id: 'msg_456def',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [
          { type: 'text' as const, text: 'Part 1. ' },
          { type: 'text' as const, text: 'Part 2.' },
        ],
        model: 'claude-opus-4-6-20251015',
        stop_reason: 'end_turn' as const,
        usage: {
          input_tokens: 15,
          output_tokens: 25,
        },
      };

      const openAIResponse = translateFromAnthropic(anthropicResponse);

      expect(openAIResponse.choices[0].message.content).toBe('Part 1. Part 2.');
    });
  });

  describe('Rate Limiting', () => {
    it('allows requests within limits', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-rate-1';

      const status = checkRateLimit(storage, siteId);

      expect(status.allowed).toBe(true);
      expect(status.requestsThisHour).toBe(0);
      expect(status.requestsThisDay).toBe(0);
      expect(status.costThisDayUsd).toBe(0);
    });

    it('enforces hourly request limit', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-rate-2';

      // Set low hourly limit
      setRateLimit(storage, siteId, {
        requestsPerHour: 2,
        requestsPerDay: 1000,
        costPerDayUsd: 100,
      });

      // Simulate 2 requests in the last hour
      const now = Date.now();
      storage.set('nexus_ai_gateway_usage', [
        { siteId, timestamp: now - 1000, costUsd: 0.01 },
        { siteId, timestamp: now - 2000, costUsd: 0.01 },
      ]);

      const status = checkRateLimit(storage, siteId);

      expect(status.allowed).toBe(false);
      expect(status.reason).toContain('2 requests in the last hour');
      expect(status.requestsThisHour).toBe(2);
    });

    it('enforces daily request limit', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-rate-3';

      setRateLimit(storage, siteId, {
        requestsPerHour: 1000,
        requestsPerDay: 3,
        costPerDayUsd: 100,
      });

      // Simulate 3 requests in the last day
      const now = Date.now();
      storage.set('nexus_ai_gateway_usage', [
        { siteId, timestamp: now - 1000, costUsd: 0.01 },
        { siteId, timestamp: now - 60 * 60 * 1000, costUsd: 0.01 },
        { siteId, timestamp: now - 12 * 60 * 60 * 1000, costUsd: 0.01 },
      ]);

      const status = checkRateLimit(storage, siteId);

      expect(status.allowed).toBe(false);
      expect(status.reason).toContain('3 requests in the last day');
      expect(status.requestsThisDay).toBe(3);
    });

    it('enforces daily cost limit', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-rate-4';

      setRateLimit(storage, siteId, {
        requestsPerHour: 1000,
        requestsPerDay: 1000,
        costPerDayUsd: 1.0,
      });

      // Simulate requests totaling $1.50 in the last day
      const now = Date.now();
      storage.set('nexus_ai_gateway_usage', [
        { siteId, timestamp: now - 1000, costUsd: 0.75 },
        { siteId, timestamp: now - 60 * 60 * 1000, costUsd: 0.50 },
        { siteId, timestamp: now - 12 * 60 * 60 * 1000, costUsd: 0.25 },
      ]);

      const status = checkRateLimit(storage, siteId);

      expect(status.allowed).toBe(false);
      expect(status.reason).toContain('$1.5000 in the last day');
      expect(status.costThisDayUsd).toBe(1.5);
    });

    it('ignores requests outside rolling window', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-rate-5';

      setRateLimit(storage, siteId, {
        requestsPerHour: 5,
        requestsPerDay: 50,
        costPerDayUsd: 10,
      });

      // Simulate old requests (outside windows)
      const now = Date.now();
      storage.set('nexus_ai_gateway_usage', [
        { siteId, timestamp: now - 2 * 60 * 60 * 1000, costUsd: 0.01 }, // 2 hours ago (outside hour window, but within day)
        { siteId, timestamp: now - 30 * 60 * 60 * 1000, costUsd: 0.01 }, // 30 hours ago (outside both windows)
      ]);

      const status = checkRateLimit(storage, siteId);

      expect(status.allowed).toBe(true);
      expect(status.requestsThisHour).toBe(0); // Both requests are > 1 hour old
      expect(status.requestsThisDay).toBe(1); // One request is < 24 hours old
    });

    it('retrieves default limits when not set', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-rate-6';

      const limits = getRateLimit(storage, siteId);

      expect(limits.requestsPerHour).toBe(100);
      expect(limits.requestsPerDay).toBe(500);
      expect(limits.costPerDayUsd).toBe(10.0);
    });
  });

  describe('Cost Calculation', () => {
    it('calculates Haiku cost correctly', () => {
      const cost = calculateAnthropicCost('claude-haiku-4-5-20251001', 1000, 500);
      // Haiku: $0.80 per 1M input, $4 per 1M output
      // (1000 * 0.80 + 500 * 4) / 1,000,000 = 0.0028
      expect(cost).toBeCloseTo(0.0028, 4);
    });

    it('calculates Sonnet cost correctly', () => {
      const cost = calculateAnthropicCost('claude-sonnet-4-5-20250514', 2000, 1000);
      // Sonnet: $3 per 1M input, $15 per 1M output
      // (2000 * 3 + 1000 * 15) / 1,000,000 = 0.021
      expect(cost).toBeCloseTo(0.021, 4);
    });

    it('calculates Opus cost correctly', () => {
      const cost = calculateAnthropicCost('claude-opus-4-6-20251015', 500, 500);
      // Opus: $15 per 1M input, $75 per 1M output
      // (500 * 15 + 500 * 75) / 1,000,000 = 0.045
      expect(cost).toBeCloseTo(0.045, 4);
    });

    it('handles unknown model by defaulting to Haiku pricing', () => {
      const cost = calculateAnthropicCost('unknown-model', 1000, 500);
      expect(cost).toBeCloseTo(0.0028, 4); // Same as Haiku
    });
  });

  describe('Usage Tracking', () => {
    it('stores usage records', () => {
      const storage = createMockStorage();
      const siteId = 'test-site-usage-1';

      const mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const routes = new AIGatewayRoutes({
        storage: createMockStorage(),
        logger: mockLogger,
      });

      const usageRecord = {
        id: 'msg_test_123',
        siteId,
        siteName: 'Test Site',
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic' as const,
        timestamp: Date.now(),
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        costUsd: 0.0014,
        durationMs: 1234,
      };

      // Access private method via reflection (testing internal behavior)
      (routes as any).storeUsageRecord(usageRecord);

      const records = (routes as any).storage.get('nexus_ai_gateway_usage');
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('msg_test_123');
      expect(records[0].totalTokens).toBe(150);
    });

    it('limits usage record storage to 1000 entries', () => {
      const storage = createMockStorage();
      const mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const routes = new AIGatewayRoutes({
        storage: createMockStorage(),
        logger: mockLogger,
      });

      // Pre-fill with 1000 records
      const existingRecords = Array.from({ length: 1000 }, (_, i) => ({
        id: `msg_old_${i}`,
        siteId: 'old-site',
        siteName: 'Old Site',
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic' as const,
        timestamp: Date.now() - i * 1000,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        costUsd: 0.0001,
        durationMs: 100,
      }));

      (routes as any).storage.set('nexus_ai_gateway_usage', existingRecords);

      // Add new record
      const newRecord = {
        id: 'msg_new_123',
        siteId: 'new-site',
        siteName: 'New Site',
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic' as const,
        timestamp: Date.now(),
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        costUsd: 0.0014,
        durationMs: 1234,
      };

      (routes as any).storeUsageRecord(newRecord);

      const records = (routes as any).storage.get('nexus_ai_gateway_usage');
      expect(records).toHaveLength(1000); // Still 1000
      expect(records[999].id).toBe('msg_new_123'); // Newest at end
      expect(records[0].id).toBe('msg_old_1'); // First kept (oldest dropped was msg_old_0)
    });
  });

  describe('Error Handling', () => {
    it('returns 401 when X-Auth-Token header is missing', async () => {
      const storage = createMockStorage();
      const mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const routes = new AIGatewayRoutes({
        storage: createMockStorage(),
        logger: mockLogger,
      });

      const req = {
        headers: {},
        on: jest.fn(),
      } as any;

      const res = {
        writeHead: jest.fn(),
        end: jest.fn(),
      } as any;

      await routes.handleChatCompletions(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
      expect(res.end).toHaveBeenCalled();
      const errorResponse = JSON.parse(res.end.mock.calls[0][0]);
      expect(errorResponse.error.message).toContain('Missing X-Auth-Token');
    });

    it('returns 401 when X-Auth-Token is invalid', async () => {
      const storage = createMockStorage();
      const mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const routes = new AIGatewayRoutes({
        storage: createMockStorage(),
        logger: mockLogger,
      });

      const req = {
        headers: { 'x-auth-token': 'invalid-token-xyz' },
        on: jest.fn(),
      } as any;

      const res = {
        writeHead: jest.fn(),
        end: jest.fn(),
      } as any;

      await routes.handleChatCompletions(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
      const errorResponse = JSON.parse(res.end.mock.calls[0][0]);
      expect(errorResponse.error.message).toContain('Invalid authentication token');
    });

    it('returns 400 when request body is invalid JSON', async () => {
      const storage = createMockStorage();
      const siteId = 'test-site-error';
      const token = getOrCreateSiteToken(storage, siteId, 'Test Site');

      const mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const routes = new AIGatewayRoutes({
        storage,
        logger: mockLogger,
      });

      const req = {
        headers: { 'x-auth-token': token },
        on: jest.fn((event, handler) => {
          if (event === 'data') handler(Buffer.from('{ invalid json }'));
          if (event === 'end') handler();
        }),
      } as any;

      const res = {
        writeHead: jest.fn(),
        end: jest.fn(),
      } as any;

      await routes.handleChatCompletions(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      const errorResponse = JSON.parse(res.end.mock.calls[0][0]);
      expect(errorResponse.error.message).toContain('Invalid JSON');
    });

    it('returns 400 when required fields are missing', async () => {
      const storage = createMockStorage();
      const siteId = 'test-site-error-2';
      const token = getOrCreateSiteToken(storage, siteId, 'Test Site');

      const mockLogger = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      const routes = new AIGatewayRoutes({
        storage,
        logger: mockLogger,
      });

      const req = {
        headers: { 'x-auth-token': token },
        on: jest.fn((event, handler) => {
          if (event === 'data') handler(Buffer.from(JSON.stringify({ model: 'claude-haiku-4-5-20251001' })));
          if (event === 'end') handler();
        }),
      } as any;

      const res = {
        writeHead: jest.fn(),
        end: jest.fn(),
      } as any;

      await routes.handleChatCompletions(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
      const errorResponse = JSON.parse(res.end.mock.calls[0][0]);
      expect(errorResponse.error.message).toContain('Missing required fields');
    });
  });
});
