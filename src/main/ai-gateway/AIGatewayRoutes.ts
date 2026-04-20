/**
 * AI Gateway Routes
 *
 * HTTP routes for the AI Gateway that routes AI requests from WordPress
 * to provider APIs (Anthropic, OpenAI, Google) with tracking and rate limiting.
 *
 * Endpoints:
 *   POST /ai-gateway/v1/chat/completions  — text generation (all providers)
 *   POST /ai-gateway/v1/images/generations — image generation (OpenAI)
 *   GET  /ai-gateway/v1/models             — list available models
 */

import * as http from 'http';
import type { RegistryStorage } from '../content/IndexRegistry';
import { STORAGE_KEYS } from '../../common/constants';
import { KeyVault } from '../security/KeyVault';
import { getSiteIdFromToken } from './token-manager';
import { translateToAnthropic, translateFromAnthropic } from './format-translator';
import { callAnthropicAPI, calculateAnthropicCost } from './anthropic-client';
import { callOpenAIAPI, calculateOpenAICost } from './openai-client';
import { callGoogleAPI, calculateGoogleCost, callGoogleImageAPI, calculateGoogleImageCost, GOOGLE_IMAGE_MODELS } from './google-client';
import { callImageAPI, calculateImageCost, IMAGE_MODELS, ImageGenerationRequest } from './image-client';
import { checkRateLimit } from './rate-limiter';
import {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  GatewayUsageRecord,
} from './types';

type ChatProvider = 'anthropic' | 'openai' | 'google';

/**
 * Maps known model IDs to their chat provider.
 * Falls back to the globally configured provider for unknown models.
 */
const MODEL_PROVIDER_MAP: Record<string, ChatProvider> = {
  // Anthropic — current models
  'claude-opus-4-6':            'anthropic',
  'claude-sonnet-4-6':          'anthropic',
  'claude-haiku-4-5-20251001':  'anthropic',
  'claude-haiku-4-5':           'anthropic',
  // Anthropic — legacy (still available)
  'claude-sonnet-4-5-20250929': 'anthropic',
  'claude-opus-4-5-20251101':   'anthropic',
  'claude-sonnet-4-20250514':   'anthropic',
  'claude-opus-4-20250514':     'anthropic',

  // OpenAI — GPT-4.1 family
  'gpt-4.1':          'openai',
  'gpt-4.1-mini':     'openai',
  'gpt-4.1-nano':     'openai',
  // OpenAI — GPT-4o family
  'gpt-4o':           'openai',
  'gpt-4o-mini':      'openai',
  // OpenAI — reasoning models
  'o4-mini':          'openai',
  'o3':               'openai',
  'o3-mini':          'openai',
  'o1':               'openai',
  'o1-mini':          'openai',

  // Google — Gemini 2.x
  'gemini-2.5-pro':          'google',
  'gemini-2.5-flash':        'google',
  'gemini-2.0-flash':        'google',
  'gemini-2.0-flash-lite':   'google',
  // Google — Gemini 1.5
  'gemini-1.5-pro':          'google',
  'gemini-1.5-flash':        'google',
  'gemini-1.5-flash-8b':     'google',
};

/** Models surfaced in /models by provider */
const CATALOG = {
  anthropic: [
    { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6',   tier: 'powerful' },
    { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', tier: 'balanced' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  tier: 'fast'     },
  ],
  openai: [
    { id: 'gpt-4.1',       label: 'GPT-4.1',       tier: 'powerful' },
    { id: 'gpt-4.1-mini',  label: 'GPT-4.1 Mini',  tier: 'balanced' },
    { id: 'gpt-4.1-nano',  label: 'GPT-4.1 Nano',  tier: 'fast'     },
    { id: 'gpt-4o',        label: 'GPT-4o',         tier: 'powerful' },
    { id: 'gpt-4o-mini',   label: 'GPT-4o Mini',    tier: 'balanced' },
    { id: 'o4-mini',       label: 'o4-mini',         tier: 'reasoning' },
    { id: 'o3',            label: 'o3',               tier: 'reasoning' },
    { id: 'o3-mini',       label: 'o3-mini',          tier: 'reasoning' },
    { id: 'o1',            label: 'o1',               tier: 'reasoning' },
    { id: 'o1-mini',       label: 'o1-mini',          tier: 'reasoning' },
  ],
  openai_image: [
    { id: 'gpt-image-1',      label: 'GPT Image 1',      tier: 'image' },
    { id: 'gpt-image-1.5',    label: 'GPT Image 1.5',    tier: 'image' },
    { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', tier: 'image' },
    { id: 'dall-e-3',         label: 'DALL·E 3',          tier: 'image' },
    { id: 'dall-e-2',         label: 'DALL·E 2',          tier: 'image' },
  ],
  google: [
    { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',        tier: 'powerful' },
    { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      tier: 'balanced' },
    { id: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash',      tier: 'balanced' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', tier: 'fast'     },
    { id: 'gemini-1.5-pro',        label: 'Gemini 1.5 Pro',        tier: 'powerful' },
    { id: 'gemini-1.5-flash',      label: 'Gemini 1.5 Flash',      tier: 'balanced' },
  ],
  google_image: [
    { id: 'imagen-4.0-generate-001',       label: 'Imagen 4',       tier: 'image' },
    { id: 'imagen-4.0-ultra-generate-001', label: 'Imagen 4 Ultra', tier: 'image' },
    { id: 'imagen-4.0-fast-generate-001',  label: 'Imagen 4 Fast',  tier: 'image' },
  ],
};

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
  private keyVault: KeyVault;

  constructor(options: AIGatewayRoutesOptions) {
    this.storage = options.storage;
    this.logger = options.logger;
    this.onUsageRecorded = options.onUsageRecorded;
    this.keyVault = new KeyVault(options.storage, STORAGE_KEYS.API_KEYS);
  }

  /**
   * Handle /ai-gateway/v1/chat/completions endpoint
   */
  async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const siteId = this.authenticateRequest(req, res);
    if (!siteId) return;

    const body = await this.readBody(req);
    let openAIRequest: OpenAIChatCompletionRequest;
    try {
      openAIRequest = JSON.parse(body);
    } catch {
      this.sendError(res, 400, 'Invalid JSON in request body');
      return;
    }

    if (!openAIRequest.model || !openAIRequest.messages) {
      this.sendError(res, 400, 'Missing required fields: model, messages');
      return;
    }

    this.logger.info(
      `[AIGateway] Chat request from site ${siteId}: model=${openAIRequest.model}, messages=${openAIRequest.messages.length}`,
    );

    const rateLimitStatus = checkRateLimit(this.storage, siteId);
    if (!rateLimitStatus.allowed) {
      this.logger.warn(`[AIGateway] Rate limit exceeded for site ${siteId}: ${rateLimitStatus.reason}`);
      this.sendError(res, 429, rateLimitStatus.reason || 'Rate limit exceeded');
      return;
    }

    const settings = (this.storage.get(STORAGE_KEYS.SETTINGS) ?? {}) as Record<string, any>;
    const model = openAIRequest.model;
    const globalProvider: ChatProvider = (settings.aiProvider ?? 'anthropic') as ChatProvider;
    const resolvedProvider: ChatProvider = (MODEL_PROVIDER_MAP[model] ?? globalProvider) as ChatProvider;

    const startTime = Date.now();
    let openAIResponse: any;
    let promptTokens: number;
    let completionTokens: number;
    let responseId: string;
    let actualProvider: string;
    let costUsd: number;

    if (resolvedProvider === 'anthropic') {
      const anthropicKey = this.keyVault.getKey('anthropic');
      if (!anthropicKey) { this.sendError(res, 503, 'Anthropic API key not configured in Local'); return; }

      const anthropicRequest = translateToAnthropic(openAIRequest);
      let anthropicResponse;
      try {
        anthropicResponse = await callAnthropicAPI(anthropicRequest, { apiKey: anthropicKey, logger: this.logger });
      } catch (err) {
        this.logger.error('[AIGateway] Anthropic API call failed:', err);
        this.sendError(res, 502, `Anthropic API error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
      }

      openAIResponse    = translateFromAnthropic(anthropicResponse);
      promptTokens      = anthropicResponse.usage.input_tokens;
      completionTokens  = anthropicResponse.usage.output_tokens;
      responseId        = anthropicResponse.id;
      actualProvider    = 'anthropic';
      costUsd           = calculateAnthropicCost(model, promptTokens, completionTokens);

    } else if (resolvedProvider === 'openai') {
      const openaiKey = this.keyVault.getKey('openai');
      if (!openaiKey) { this.sendError(res, 503, 'OpenAI API key not configured in Local'); return; }

      let openaiResponse;
      try {
        openaiResponse = await callOpenAIAPI(openAIRequest, { apiKey: openaiKey, logger: this.logger });
      } catch (err) {
        this.logger.error('[AIGateway] OpenAI API call failed:', err);
        this.sendError(res, 502, `OpenAI API error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
      }

      openAIResponse    = openaiResponse;
      promptTokens      = openaiResponse.usage?.prompt_tokens ?? 0;
      completionTokens  = openaiResponse.usage?.completion_tokens ?? 0;
      responseId        = openaiResponse.id ?? `chatcmpl-${Date.now()}`;
      actualProvider    = 'openai';
      costUsd           = calculateOpenAICost(model, promptTokens, completionTokens);

    } else if (resolvedProvider === 'google') {
      const googleKey = this.keyVault.getKey('google');
      if (!googleKey) { this.sendError(res, 503, 'Google API key not configured in Local'); return; }

      let googleResponse;
      try {
        googleResponse = await callGoogleAPI(openAIRequest, { apiKey: googleKey, logger: this.logger });
      } catch (err) {
        this.logger.error('[AIGateway] Google API call failed:', err);
        this.sendError(res, 502, `Google API error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
      }

      openAIResponse    = googleResponse;
      promptTokens      = googleResponse.usage?.prompt_tokens ?? 0;
      completionTokens  = googleResponse.usage?.completion_tokens ?? 0;
      responseId        = googleResponse.id ?? `chatcmpl-google-${Date.now()}`;
      actualProvider    = 'google';
      costUsd           = calculateGoogleCost(model, promptTokens, completionTokens);

    } else {
      this.sendError(res, 503, `No API key configured for model: ${model}`);
      return;
    }

    this.recordAndRespond(req, res, siteId, model, actualProvider, openAIResponse,
      promptTokens, completionTokens, responseId, costUsd, Date.now() - startTime);
  }

  /**
   * Handle /ai-gateway/v1/images/generations endpoint (OpenAI-compatible).
   */
  async handleImageGenerations(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const siteId = this.authenticateRequest(req, res);
    if (!siteId) return;

    const body = await this.readBody(req);
    let imageRequest: ImageGenerationRequest;
    try {
      imageRequest = JSON.parse(body);
    } catch {
      this.sendError(res, 400, 'Invalid JSON in request body');
      return;
    }

    if (!imageRequest.model || !imageRequest.prompt) {
      this.sendError(res, 400, 'Missing required fields: model, prompt');
      return;
    }

    const isGoogleImage = GOOGLE_IMAGE_MODELS.has(imageRequest.model);
    const isOpenAIImage = IMAGE_MODELS.has(imageRequest.model);

    if (!isGoogleImage && !isOpenAIImage) {
      const all = [...IMAGE_MODELS, ...GOOGLE_IMAGE_MODELS].join(', ');
      this.sendError(res, 400, `Unsupported image model: ${imageRequest.model}. Supported: ${all}`);
      return;
    }

    this.logger.info(
      `[AIGateway] Image request from site ${siteId}: model=${imageRequest.model}, prompt="${imageRequest.prompt.substring(0, 60)}..."`,
    );

    const startTime = Date.now();
    let imageResponse;
    let costUsd: number;

    if (isGoogleImage) {
      const googleKey = this.keyVault.getKey('google');
      if (!googleKey) {
        this.sendError(res, 503, 'Google API key not configured in Local (required for Imagen)');
        return;
      }
      try {
        imageResponse = await callGoogleImageAPI(imageRequest, { apiKey: googleKey, logger: this.logger });
      } catch (err) {
        this.logger.error('[AIGateway] Imagen API call failed:', err);
        this.sendError(res, 502, `Imagen API error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
      }
      costUsd = calculateGoogleImageCost(imageRequest.model, imageRequest.n ?? 1);
    } else {
      const openaiKey = this.keyVault.getKey('openai');
      if (!openaiKey) {
        this.sendError(res, 503, 'OpenAI API key not configured in Local (required for image generation)');
        return;
      }
      try {
        imageResponse = await callImageAPI(imageRequest, { apiKey: openaiKey, logger: this.logger });
      } catch (err) {
        this.logger.error('[AIGateway] Image API call failed:', err);
        this.sendError(res, 502, `Image API error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
      }
      costUsd = calculateImageCost(imageRequest.model, imageRequest.n ?? 1, imageRequest.size ?? '1024x1024');
    }

    const durationMs = Date.now() - startTime;

    this.logger.info(
      `[AIGateway] Image success: site=${siteId}, model=${imageRequest.model}, n=${imageRequest.n ?? 1}, cost=$${costUsd.toFixed(4)}, duration=${durationMs}ms`,
    );

    // Record usage (no token counts for image gen)
    const usageRecord: GatewayUsageRecord = {
      id: `img-${Date.now()}`,
      siteId,
      siteName: this.getSiteName(siteId),
      model: imageRequest.model,
      provider: 'openai',
      timestamp: Date.now(),
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd,
      durationMs,
    };
    this.storeUsageRecord(usageRecord);
    if (this.onUsageRecorded) this.onUsageRecorded(usageRecord);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(imageResponse));
  }

  /**
   * Handle /ai-gateway/v1/models endpoint.
   *
   * Returns ONLY models for the globally configured provider — this ensures
   * WordPress plugins surface the right model list and don't accidentally pick
   * a model from a different provider than what the user configured.
   */
  handleModels(_req: http.IncomingMessage, res: http.ServerResponse): void {
    const settings = (this.storage.get(STORAGE_KEYS.SETTINGS) ?? {}) as Record<string, any>;
    const globalProvider: string = settings.aiProvider || 'anthropic';

    const models: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
    const ts = 1700000000;

    switch (globalProvider) {
      case 'openai':
        if (this.keyVault.hasKey('openai')) {
          for (const m of [...CATALOG.openai, ...CATALOG.openai_image]) {
            models.push({ id: m.id, object: 'model', created: ts, owned_by: 'openai' });
          }
        }
        break;
      case 'google':
        if (this.keyVault.hasKey('google')) {
          for (const m of [...CATALOG.google, ...CATALOG.google_image]) {
            models.push({ id: m.id, object: 'model', created: ts, owned_by: 'google' });
          }
        }
        break;
      case 'anthropic':
      default:
        if (this.keyVault.hasKey('anthropic')) {
          for (const m of CATALOG.anthropic) {
            models.push({ id: m.id, object: 'model', created: ts, owned_by: 'anthropic' });
          }
        }
        break;
    }

    // Fallback: no key for global provider — return that provider's catalog anyway
    // so the plugin at least sees what models are expected (user needs to add the key)
    if (models.length === 0) {
      const fallback = globalProvider === 'openai' ? CATALOG.openai
        : globalProvider === 'google' ? CATALOG.google
        : CATALOG.anthropic;
      for (const m of fallback) {
        models.push({ id: m.id, object: 'model', created: ts, owned_by: globalProvider });
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: models }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate X-Auth-Token and return siteId, or send 401 and return null.
   */
  private authenticateRequest(req: http.IncomingMessage, res: http.ServerResponse): string | null {
    const authToken = req.headers['x-auth-token'] as string | undefined;
    if (!authToken) { this.sendError(res, 401, 'Missing X-Auth-Token header'); return null; }

    let siteId = getSiteIdFromToken(this.storage, authToken);
    if (!siteId) {
      const webhookInfo = this.storage.get('http_webhook_info') as { authToken?: string } | null;
      const webhookToken = webhookInfo?.authToken;
      if (webhookToken && authToken === webhookToken) {
        const headerSiteId = req.headers['x-wp-site-id'] as string | undefined;
        if (headerSiteId) {
          const indexRegistry = this.storage.get(STORAGE_KEYS.INDEX_REGISTRY) as Record<string, unknown> | null;
          if (indexRegistry && Object.prototype.hasOwnProperty.call(indexRegistry, headerSiteId)) {
            siteId = headerSiteId;
          }
        }
      }
    }
    if (!siteId) { this.sendError(res, 401, 'Invalid authentication token'); return null; }
    return siteId;
  }

  private recordAndRespond(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    siteId: string,
    model: string,
    actualProvider: string,
    openAIResponse: any,
    promptTokens: number,
    completionTokens: number,
    responseId: string,
    costUsd: number,
    durationMs: number,
  ): void {
    const callerPlugin   = req.headers['x-wp-caller-plugin'] as string | undefined;
    const callerTheme    = req.headers['x-wp-caller-theme'] as string | undefined;
    const callerFeature  = req.headers['x-wp-caller-feature'] as string | undefined;
    const callerSource   = req.headers['x-wp-caller-source'] as string | undefined;
    const callerUserId   = req.headers['x-wp-user-id'] as string | undefined;
    const callerUserRole = req.headers['x-wp-user-role'] as string | undefined;

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

    const callerDesc = callerPlugin
      ? `plugin:${callerPlugin}${callerFeature ? `/${callerFeature}` : ''}`
      : callerTheme ? `theme:${callerTheme}`
      : callerSource ? `core:${callerFeature || callerSource}`
      : 'unknown';

    this.logger.info(
      `[AIGateway] Success: site=${siteId}, provider=${actualProvider}, caller=${callerDesc}, model=${model}, ` +
      `tokens=${usageRecord.totalTokens} (${promptTokens}+${completionTokens}), ` +
      `cost=$${costUsd.toFixed(4)}, duration=${durationMs}ms`,
    );

    this.storeUsageRecord(usageRecord);
    if (this.onUsageRecorded) this.onUsageRecorded(usageRecord);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(openAIResponse));
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => resolve(body));
      req.on('error', (err) => reject(err));
    });
  }

  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'invalid_request_error' } }));
  }

  private getSiteName(siteId: string): string {
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
    if (records.length > 1000) records.splice(0, records.length - 1000);
    this.storage.set(USAGE_KEY, records);
  }
}
