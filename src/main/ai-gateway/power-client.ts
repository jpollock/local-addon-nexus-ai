/**
 * WP Engine Power client for AI Gateway.
 *
 * Power is an OpenAI-compatible proxy (see src/main/chat/providers/power.ts, which this
 * mirrors for the non-streaming gateway path) — same request/response shape as OpenAI's own
 * chat-completions endpoint, so the gateway can pass the request through with minimal
 * transformation, same as the OpenAI client. Auth is a portal `wpe_` key via
 * `Authorization: Bearer`; no `WPEngine-Project` header (see power.ts's file header —
 * inference resolves to the account server-side without it).
 */

import * as https from 'https';
import { OpenAIChatCompletionRequest, OpenAIChatCompletionResponse } from './types';

const POWER_HOST = 'api.ai.wpengine.com';
const POWER_PATH = '/v1/chat/completions';

export interface PowerClientOptions {
  apiKey: string;
  logger?: {
    info: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
  };
}

export interface PowerUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Call WP Engine Power's chat-completions endpoint (non-streaming).
 * Returns the raw response — already OpenAI-shaped, so no translation needed.
 */
export async function callPowerAPI(
  request: OpenAIChatCompletionRequest,
  options: PowerClientOptions,
): Promise<OpenAIChatCompletionResponse & { usage: PowerUsage }> {
  const { apiKey, logger } = options;

  // Power expects stream explicitly false for a single JSON response — the gateway's
  // non-streaming callers never set request.stream themselves.
  const body = JSON.stringify({ ...request, stream: false });

  const requestOptions = {
    hostname: POWER_HOST,
    port: 443,
    path: POWER_PATH,
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
            `[PowerClient] API error: HTTP ${res.statusCode} (${duration}ms)`,
            responseBody.substring(0, 500),
          );
          try {
            const errorData = JSON.parse(responseBody);
            reject(new Error(`WP Engine Power API error: ${errorData.error?.message || res.statusCode}`));
          } catch {
            reject(new Error(`WP Engine Power API error: HTTP ${res.statusCode}`));
          }
          return;
        }

        try {
          const response = JSON.parse(responseBody);
          const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
          logger?.info(
            `[PowerClient] Success: ${usage.prompt_tokens} in, ${usage.completion_tokens} out (${duration}ms)`,
          );
          resolve(response);
        } catch (err) {
          logger?.error('[PowerClient] Failed to parse response:', err);
          reject(new Error('Failed to parse WP Engine Power API response'));
        }
      });
    });

    req.on('error', (err) => {
      logger?.error('[PowerClient] Request error:', err);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('WP Engine Power API request timeout'));
    });

    req.setTimeout(30000);
    req.write(body);
    req.end();
  });
}

/**
 * Power's own pricing for its managed proxy is not published anywhere this codebase can read,
 * and it need not match the underlying vendor's (Anthropic/OpenAI/Google) rates — Power is a
 * billing layer WP Engine controls, not a pass-through. Returning an invented number here would
 * be the exact "never default an unknown input to a plausible value" mistake this codebase has
 * already been burned by elsewhere (the fabricated PHP version, the fabricated autoload
 * vocabulary). 0 is the honest answer until a real source for this exists.
 */
export function calculatePowerCost(_model: string, _inputTokens: number, _outputTokens: number): number {
  return 0;
}
