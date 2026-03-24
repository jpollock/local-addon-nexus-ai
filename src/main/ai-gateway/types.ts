/**
 * Types for AI Gateway
 */

/**
 * Site authentication token mapping
 */
export interface SiteToken {
  siteId: string;
  siteName: string;
  token: string; // UUID
  createdAt: number;
}

/**
 * OpenAI Chat Completions API request format
 * This is what WordPress sends to the gateway
 */
export interface OpenAIChatCompletionRequest {
  model: string; // "claude-haiku-4-5-20251001"
  messages: OpenAIChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * OpenAI Chat Completions API response format
 * This is what the gateway returns to WordPress
 */
export interface OpenAIChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIChatChoice {
  index: number;
  message: OpenAIChatMessage;
  finish_reason: 'stop' | 'length' | 'content_filter';
}

/**
 * Anthropic Messages API request format
 * This is what the gateway sends to Anthropic
 */
export interface AnthropicMessagesRequest {
  model: string; // "claude-haiku-4-5-20251001"
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Anthropic Messages API response format
 */
export interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicContentBlock {
  type: 'text';
  text: string;
}

/**
 * AI Gateway usage record
 */
export interface GatewayUsageRecord {
  id: string;
  siteId: string;
  siteName: string;
  model: string;
  provider: string; // 'anthropic', 'openai', etc.
  timestamp: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  requestsPerHour?: number;
  requestsPerDay?: number;
  costPerDayUsd?: number;
}

/**
 * Rate limit status
 */
export interface RateLimitStatus {
  allowed: boolean;
  reason?: string;
  requestsThisHour: number;
  requestsThisDay: number;
  costThisDayUsd: number;
  limits: RateLimitConfig;
}
