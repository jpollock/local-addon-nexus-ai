/**
 * Anthropic API client for AI Gateway
 */

import * as https from 'https';
import { AnthropicMessagesRequest, AnthropicMessagesResponse } from './types';

export interface AnthropicClientOptions {
  apiKey: string;
  logger?: {
    info: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
  };
}

/**
 * Call Anthropic Messages API
 */
export async function callAnthropicAPI(
  request: AnthropicMessagesRequest,
  options: AnthropicClientOptions,
): Promise<AnthropicMessagesResponse> {
  const { apiKey, logger } = options;

  const body = JSON.stringify(request);

  const requestOptions = {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
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
            `[AnthropicClient] API error: HTTP ${res.statusCode} (${duration}ms)`,
            responseBody.substring(0, 500),
          );

          // Try to parse error response
          try {
            const errorData = JSON.parse(responseBody);
            reject(
              new Error(
                `Anthropic API error: ${errorData.error?.message || res.statusCode}`,
              ),
            );
          } catch {
            reject(new Error(`Anthropic API error: HTTP ${res.statusCode}`));
          }
          return;
        }

        try {
          const response = JSON.parse(responseBody) as AnthropicMessagesResponse;
          logger?.info(
            `[AnthropicClient] Success: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out (${duration}ms)`,
          );
          resolve(response);
        } catch (err) {
          logger?.error('[AnthropicClient] Failed to parse response:', err);
          reject(new Error('Failed to parse Anthropic API response'));
        }
      });
    });

    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      logger?.error(`[AnthropicClient] Request error (${duration}ms):`, err);
      reject(err);
    });

    req.on('timeout', () => {
      const duration = Date.now() - startTime;
      logger?.error(`[AnthropicClient] Request timeout (${duration}ms)`);
      req.destroy();
      reject(new Error('Anthropic API request timeout'));
    });

    // 30 second timeout
    req.setTimeout(30000);

    req.write(body);
    req.end();
  });
}

/**
 * Calculate cost for Anthropic API usage
 *
 * Pricing (as of March 2025):
 * - Claude Haiku 4.5: $0.80/1M input, $4.00/1M output
 * - Claude Sonnet 4.5: $3.00/1M input, $15.00/1M output
 * - Claude Opus 4.6: $15.00/1M input, $75.00/1M output
 */
export function calculateAnthropicCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  let inputCostPer1M = 0.8;
  let outputCostPer1M = 4.0;

  if (model.includes('sonnet')) {
    inputCostPer1M = 3.0;
    outputCostPer1M = 15.0;
  } else if (model.includes('opus')) {
    inputCostPer1M = 15.0;
    outputCostPer1M = 75.0;
  }

  const inputCost = (inputTokens / 1_000_000) * inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * outputCostPer1M;

  return inputCost + outputCost;
}
