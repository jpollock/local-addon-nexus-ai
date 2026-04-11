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
import { callOpenAIAPI, calculateOpenAICost } from './openai-client';
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

    // 2. Lookup site ID from token.
    // Primary: per-site token registered via storeSiteToken() (nexus_ai_gateway_tokens).
    // Fallback: validate token against the webhook auth token (http_webhook_info.authToken),
    //   which is stable and shared with the MU plugin as NEXUS_AI_AUTH_TOKEN.
    //   In that case, get the site ID from the X-WP-Site-ID header.
    let siteId = getSiteIdFromToken(this.storage, authToken);
    if (!siteId) {
      const webhookInfo = this.storage.get('http_webhook_info') as { authToken?: string } | null;
      const webhookToken = webhookInfo?.authToken;
      if (webhookToken && authToken === webhookToken) {
        const headerSiteId = req.headers['x-wp-site-id'] as string | undefined;
        siteId = headerSiteId || null;
      }
    }
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

    // 5. Determine which provider to use based on model ID.
    //    Claude models → Anthropic. GPT/o-series → OpenAI.
    //    Falls back to the globally configured provider for ambiguous models.
    const apiKeys = (this.storage.get(STORAGE_KEYS.API_KEYS) ?? {}) as Record<string, string>;
    const settings = (this.storage.get(STORAGE_KEYS.SETTINGS) ?? {}) as Record<string, any>;
    const model = openAIRequest.model;

    const isClaudeModel = model.startsWith('claude');
    const isOpenAIModel = model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3');
    const globalProvider: string = settings.aiProvider ?? 'anthropic';

    const useAnthropic = isClaudeModel || (!isOpenAIModel && globalProvider === 'anthropic');
    const useOpenAI   = isOpenAIModel  || (!isClaudeModel && globalProvider === 'openai');

    const startTime = Date.now();
    let openAIResponse: any;
    let promptTokens: number;
    let completionTokens: number;
    let responseId: string;
    let actualProvider: string;
    let costUsd: number;

    if (useAnthropic) {
      const anthropicKey = apiKeys.anthropic;
      if (!anthropicKey) {
        this.sendError(res, 503, 'Anthropic API key not configured in Local');
        return;
      }

      // 6a. Translate → Anthropic format → call → translate back
      const anthropicRequest = translateToAnthropic(openAIRequest);
      let anthropicResponse;
      try {
        anthropicResponse = await callAnthropicAPI(anthropicRequest, { apiKey: anthropicKey, logger: this.logger });
      } catch (err) {
        this.logger.error('[AIGateway] Anthropic API call failed:', err);
        this.sendError(res, 502, `Anthropic API error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
      }

      openAIResponse = translateFromAnthropic(anthropicResponse);
      promptTokens    = anthropicResponse.usage.input_tokens;
      completionTokens = anthropicResponse.usage.output_tokens;
      responseId      = anthropicResponse.id;
      actualProvider  = 'anthropic';
      costUsd         = calculateAnthropicCost(model, promptTokens, completionTokens);

    } else if (useOpenAI) {
      const openaiKey = apiKeys.openai;
      if (!openaiKey) {
        this.sendError(res, 503, 'OpenAI API key not configured in Local');
        return;
      }

      // 6b. OpenAI format is already correct — pass through directly
      let openaiResponse;
      try {
        openaiResponse = await callOpenAIAPI(openAIRequest, { apiKey: openaiKey, logger: this.logger });
      } catch (err) {
        this.logger.error('[AIGateway] OpenAI API call failed:', err);
        this.sendError(res, 502, `OpenAI API error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
      }

      openAIResponse   = openaiResponse;
      promptTokens     = openaiResponse.usage?.prompt_tokens ?? 0;
      completionTokens = openaiResponse.usage?.completion_tokens ?? 0;
      responseId       = openaiResponse.id ?? `chatcmpl-${Date.now()}`;
      actualProvider   = 'openai';
      costUsd          = calculateOpenAICost(model, promptTokens, completionTokens);

    } else {
      this.sendError(res, 503, `No API key configured for model: ${model}`);
      return;
    }

    const durationMs = Date.now() - startTime;

    // 7. Extract caller information from headers
    const callerPlugin   = req.headers['x-wp-caller-plugin'] as string | undefined;
    const callerTheme    = req.headers['x-wp-caller-theme'] as string | undefined;
    const callerFeature  = req.headers['x-wp-caller-feature'] as string | undefined;
    const callerSource   = req.headers['x-wp-caller-source'] as string | undefined;
    const callerUserId   = req.headers['x-wp-user-id'] as string | undefined;
    const callerUserRole = req.headers['x-wp-user-role'] as string | undefined;

    // 8. Log usage
    const usageRecord: GatewayUsageRecord = {
      id: responseId,
      siteId,
      siteName: this.getSiteName(siteId),
      model,
      provider: actualProvider,
      timestamp: Date.now(),
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      durationMs,
      callerPlugin,
      callerTheme,
      callerFeature,
      callerSource,
      callerUserId: callerUserId ? parseInt(callerUserId, 10) : undefined,
      callerUserRole,
    };

    // Build caller description for logging
    const callerDesc = callerPlugin
      ? `plugin:${callerPlugin}${callerFeature ? `/${callerFeature}` : ''}`
      : callerTheme
      ? `theme:${callerTheme}`
      : callerSource
      ? `core:${callerFeature || callerSource}`
      : 'unknown';

    this.logger.info(
      `[AIGateway] Success: site=${siteId}, provider=${actualProvider}, caller=${callerDesc}, model=${model}, ` +
        `tokens=${usageRecord.totalTokens} (${usageRecord.promptTokens}+${usageRecord.completionTokens}), ` +
        `cost=$${costUsd.toFixed(4)}, duration=${durationMs}ms`,
    );

    // 12. Store usage record
    this.storeUsageRecord(usageRecord);

    // Notify listeners
    if (this.onUsageRecorded) {
      this.onUsageRecorded(usageRecord);
    }

    // 13. Return response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(openAIResponse));
  }

  /**
   * Handle /ai-gateway/v1/models endpoint.
   * Returns models for the currently configured global provider.
   */
  handleModels(req: http.IncomingMessage, res: http.ServerResponse): void {
    const settings = (this.storage.get(STORAGE_KEYS.SETTINGS) ?? {}) as Record<string, any>;
    const provider: string = settings.aiProvider ?? 'anthropic';

    const anthropicModels = [
      { id: 'claude-haiku-4-5-20251001',  object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-sonnet-4-5-20250514', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-opus-4-6-20251015',   object: 'model', created: 1700000000, owned_by: 'anthropic' },
    ];

    const openaiModels = [
      { id: 'gpt-4o-mini', object: 'model', created: 1700000000, owned_by: 'openai' },
      { id: 'gpt-4o',      object: 'model', created: 1700000000, owned_by: 'openai' },
      { id: 'gpt-4.1',     object: 'model', created: 1700000000, owned_by: 'openai' },
    ];

    const models = provider === 'openai' ? openaiModels : anthropicModels;

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
    // Look up from index registry — populated by content indexing on site start
    const indexRegistry = this.storage.get(STORAGE_KEYS.INDEX_REGISTRY) as Record<string, { siteName?: string }> | null;
    if (indexRegistry && indexRegistry[siteId]?.siteName) {
      return indexRegistry[siteId].siteName!;
    }
    return siteId;
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
