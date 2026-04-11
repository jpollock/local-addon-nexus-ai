/**
 * OpenAI API client for AI Gateway
 *
 * The gateway receives requests already in OpenAI chat-completion format,
 * so for OpenAI routing we can pass through with minimal transformation.
 */

import * as https from 'https';
import { OpenAIChatCompletionRequest, OpenAIChatCompletionResponse } from './types';

export interface OpenAIClientOptions {
  apiKey: string;
  logger?: {
    info: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
  };
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Call OpenAI Chat Completions API.
 * Returns the raw OpenAI response (already in the right format for the gateway response).
 */
export async function callOpenAIAPI(
  request: OpenAIChatCompletionRequest,
  options: OpenAIClientOptions,
): Promise<OpenAIChatCompletionResponse & { usage: OpenAIUsage }> {
  const { apiKey, logger } = options;

  const body = JSON.stringify(request);

  const requestOptions = {
    hostname: 'api.openai.com',
    port: 443,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const req = https.request(requestOptions, (res) => {
      let responseBody = '';

      res.on('data', (chunk: Buffer) => {
        responseBody += chunk.toString();
      });

      res.on('end', () => {
        const duration = Date.now() - startTime;

        if (res.statusCode !== 200) {
          logger?.error(
            `[OpenAIClient] API error: HTTP ${res.statusCode} (${duration}ms)`,
            responseBody.substring(0, 500),
          );
          try {
            const errorData = JSON.parse(responseBody);
            reject(new Error(`OpenAI API error: ${errorData.error?.message || res.statusCode}`));
          } catch {
            reject(new Error(`OpenAI API error: HTTP ${res.statusCode}`));
          }
          return;
        }

        try {
          const response = JSON.parse(responseBody);
          const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
          logger?.info(
            `[OpenAIClient] Success: ${usage.prompt_tokens} in, ${usage.completion_tokens} out (${duration}ms)`,
          );
          resolve(response);
        } catch (err) {
          logger?.error('[OpenAIClient] Failed to parse response:', err);
          reject(new Error('Failed to parse OpenAI API response'));
        }
      });
    });

    req.on('error', (err) => {
      logger?.error('[OpenAIClient] Request error:', err);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OpenAI API request timeout'));
    });

    req.setTimeout(30000);
    req.write(body);
    req.end();
  });
}

/**
 * Calculate cost for OpenAI API usage.
 * Pricing as of April 2025.
 */
export function calculateOpenAICost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Prices per 1M tokens (input / output)
  let inputCostPer1M = 0.15;   // gpt-4o-mini default
  let outputCostPer1M = 0.60;

  if (model.includes('gpt-4o') && !model.includes('mini')) {
    inputCostPer1M = 2.50;
    outputCostPer1M = 10.00;
  } else if (model.includes('gpt-4.1') && !model.includes('mini')) {
    inputCostPer1M = 2.00;
    outputCostPer1M = 8.00;
  } else if (model.includes('gpt-4.1-mini') || model.includes('gpt-4o-mini')) {
    inputCostPer1M = 0.40;
    outputCostPer1M = 1.60;
  } else if (model.includes('o1') || model.includes('o3')) {
    inputCostPer1M = 15.00;
    outputCostPer1M = 60.00;
  }

  return (inputTokens / 1_000_000) * inputCostPer1M +
         (outputTokens / 1_000_000) * outputCostPer1M;
}
