/**
 * AI Gateway Routes
 *
 * HTTP routes for the AI Gateway that routes AI requests from WordPress
 * to provider APIs (Anthropic, OpenAI, etc.) with tracking and rate limiting.
 */

import * as http from 'http';
import type { RegistryStorage } from '../content/IndexRegistry';
import { STORAGE_KEYS } from '../../common/constants';
import { getSiteIdFromToken } from './token-manager';
import { translateToAnthropic, translateFromAnthropic } from './format-translator';
import { callAnthropicAPI, calculateAnthropicCost } from './anthropic-client';
import { checkRateLimit } from './rate-limiter';
import {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  GatewayUsageRecord,
} from './types';

export interface AIGatewayRoutesOptions {
  storage: RegistryStorage;
  logger: {
    info: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
    warn: (msg: string) => void;
  };
  onUsageRecorded?: (record: GatewayUsageRecord) => void;
}

export class AIGatewayRoutes {
  private storage: RegistryStorage;
  private logger: any;
  private onUsageRecorded?: (record: GatewayUsageRecord) => void;

  constructor(options: AIGatewayRoutesOptions) {
    this.storage = options.storage;
    this.logger = options.logger;
    this.onUsageRecorded = options.onUsageRecorded;
  }

  /**
   * Handle /ai-gateway/v1/chat/completions endpoint
   */
  async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // 1. Validate X-Auth-Token header
    const authToken = req.headers['x-auth-token'] as string | undefined;
    if (!authToken) {
      this.sendError(res, 401, 'Missing X-Auth-Token header');
      return;
    }

    // 2. Lookup site ID from token
    const siteId = getSiteIdFromToken(this.storage, authToken);
    if (!siteId) {
      this.sendError(res, 401, 'Invalid authentication token');
      return;
    }

    // 3. Parse request body
    const body = await this.readBody(req);
    let openAIRequest: OpenAIChatCompletionRequest;
    try {
      openAIRequest = JSON.parse(body);
    } catch (err) {
      this.sendError(res, 400, 'Invalid JSON in request body');
      return;
    }

    // Validate required fields
    if (!openAIRequest.model || !openAIRequest.messages) {
      this.sendError(res, 400, 'Missing required fields: model, messages');
      return;
    }

    this.logger.info(
      `[AIGateway] Request from site ${siteId}: model=${openAIRequest.model}, messages=${openAIRequest.messages.length}`,
    );

    // 4. Check rate limits
    const rateLimitStatus = checkRateLimit(this.storage, siteId);
    if (!rateLimitStatus.allowed) {
      this.logger.warn(
        `[AIGateway] Rate limit exceeded for site ${siteId}: ${rateLimitStatus.reason}`,
      );
      this.sendError(res, 429, rateLimitStatus.reason || 'Rate limit exceeded');
      return;
    }

    // 5. Get Anthropic API key from storage
    const apiKeys = (this.storage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<
      string,
      string
    >;
    const anthropicKey = apiKeys.anthropic;

    if (!anthropicKey) {
      this.sendError(res, 503, 'Anthropic API key not configured in Local');
      return;
    }

    // 6. Translate OpenAI request to Anthropic format
    const anthropicRequest = translateToAnthropic(openAIRequest);

    // 7. Call Anthropic API
    const startTime = Date.now();
    let anthropicResponse;
    try {
      anthropicResponse = await callAnthropicAPI(anthropicRequest, {
        apiKey: anthropicKey,
        logger: this.logger,
      });
    } catch (err) {
      this.logger.error('[AIGateway] Anthropic API call failed:', err);
      this.sendError(
        res,
        502,
        `Anthropic API error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      return;
    }
    const durationMs = Date.now() - startTime;

    // 8. Translate response back to OpenAI format
    const openAIResponse = translateFromAnthropic(anthropicResponse);

    // 9. Calculate cost
    const costUsd = calculateAnthropicCost(
      openAIRequest.model,
      anthropicResponse.usage.input_tokens,
      anthropicResponse.usage.output_tokens,
    );

    // 10. Log usage
    const usageRecord: GatewayUsageRecord = {
      id: anthropicResponse.id,
      siteId,
      siteName: this.getSiteName(siteId),
      model: openAIRequest.model,
      provider: 'anthropic',
      timestamp: Date.now(),
      promptTokens: anthropicResponse.usage.input_tokens,
      completionTokens: anthropicResponse.usage.output_tokens,
      totalTokens:
        anthropicResponse.usage.input_tokens + anthropicResponse.usage.output_tokens,
      costUsd,
      durationMs,
    };

    this.logger.info(
      `[AIGateway] Success: site=${siteId}, model=${openAIRequest.model}, ` +
        `tokens=${usageRecord.totalTokens} (${usageRecord.promptTokens}+${usageRecord.completionTokens}), ` +
        `cost=$${costUsd.toFixed(4)}, duration=${durationMs}ms`,
    );

    // Store usage record
    this.storeUsageRecord(usageRecord);

    // Notify listeners
    if (this.onUsageRecorded) {
      this.onUsageRecorded(usageRecord);
    }

    // 11. Return response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(openAIResponse));
  }

  /**
   * Handle /ai-gateway/v1/models endpoint (list available models)
   */
  handleModels(req: http.IncomingMessage, res: http.ServerResponse): void {
    const models = [
      {
        id: 'claude-haiku-4-5-20251001',
        object: 'model',
        created: 1700000000,
        owned_by: 'anthropic',
      },
      {
        id: 'claude-sonnet-4-5-20250514',
        object: 'model',
        created: 1700000000,
        owned_by: 'anthropic',
      },
      {
        id: 'claude-opus-4-6-20251015',
        object: 'model',
        created: 1700000000,
        owned_by: 'anthropic',
      },
    ];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: models }));
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => resolve(body));
      req.on('error', (err) => reject(err));
    });
  }

  private sendError(
    res: http.ServerResponse,
    statusCode: number,
    message: string,
  ): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'invalid_request_error' } }));
  }

  private getSiteName(siteId: string): string {
    // Try to get site name from token storage
    const tokens = this.storage.get('nexus_ai_gateway_tokens') as Record<
      string,
      { siteId: string; siteName: string }
    >;
    if (tokens) {
      for (const tokenData of Object.values(tokens)) {
        if (tokenData.siteId === siteId) {
          return tokenData.siteName;
        }
      }
    }
    return siteId; // Fallback to ID
  }

  private storeUsageRecord(record: GatewayUsageRecord): void {
    const USAGE_KEY = 'nexus_ai_gateway_usage';
    const records = (this.storage.get(USAGE_KEY) ?? []) as GatewayUsageRecord[];

    records.push(record);

    // Keep last 1000 records (prevent unbounded growth)
    if (records.length > 1000) {
      records.splice(0, records.length - 1000);
    }

    this.storage.set(USAGE_KEY, records);
  }
}
