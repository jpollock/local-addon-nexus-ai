/**
 * Image Generation client for AI Gateway
 *
 * Routes image generation requests to OpenAI's /images/generations endpoint.
 * Supports: gpt-image-1, gpt-image-1.5, gpt-image-1-mini, dall-e-3, dall-e-2
 */

import * as https from 'https';

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  response_format?: 'url' | 'b64_json';
  style?: string;         // dall-e-3 only
  output_format?: string; // gpt-image-1 only
}

export interface ImageGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

export interface ImageClientOptions {
  apiKey: string;
  logger?: {
    info: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
  };
}

/** All image generation models supported through the gateway */
export const IMAGE_MODELS = new Set([
  'gpt-image-1',
  'gpt-image-1.5',
  'gpt-image-1-mini',
  'dall-e-3',
  'dall-e-2',
]);

/**
 * Call OpenAI Images API.
 */
export async function callImageAPI(
  request: ImageGenerationRequest,
  options: ImageClientOptions,
): Promise<ImageGenerationResponse> {
  const { apiKey, logger } = options;
  const body = JSON.stringify(request);

  const requestOptions = {
    hostname: 'api.openai.com',
    port: 443,
    path: '/v1/images/generations',
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
      res.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
      res.on('end', () => {
        const duration = Date.now() - startTime;

        if (res.statusCode !== 200) {
          logger?.error(
            `[ImageClient] API error: HTTP ${res.statusCode} (${duration}ms)`,
            responseBody.substring(0, 500),
          );
          try {
            const errorData = JSON.parse(responseBody);
            reject(new Error(`OpenAI Images API error: ${errorData.error?.message || res.statusCode}`));
          } catch {
            reject(new Error(`OpenAI Images API error: HTTP ${res.statusCode}`));
          }
          return;
        }

        try {
          const response = JSON.parse(responseBody) as ImageGenerationResponse;
          logger?.info(`[ImageClient] Success: model=${request.model}, n=${request.n ?? 1} (${duration}ms)`);
          resolve(response);
        } catch (err) {
          logger?.error('[ImageClient] Failed to parse response:', err);
          reject(new Error('Failed to parse OpenAI Images API response'));
        }
      });
    });

    req.on('error', (err) => { logger?.error('[ImageClient] Request error:', err); reject(err); });
    req.on('timeout', () => { req.destroy(); reject(new Error('Image API request timeout')); });
    req.setTimeout(120000); // Image gen can be slow
    req.write(body);
    req.end();
  });
}

/**
 * Estimate cost for image generation.
 * Pricing as of April 2025.
 */
export function calculateImageCost(model: string, n: number = 1, size: string = '1024x1024'): number {
  // gpt-image-1: ~$0.04 per image (standard quality, 1024x1024)
  if (model.startsWith('gpt-image-1')) {
    return 0.04 * n;
  }
  // dall-e-3
  if (model === 'dall-e-3') {
    return (size === '1024x1792' || size === '1792x1024') ? 0.12 * n : 0.04 * n;
  }
  // dall-e-2
  if (model === 'dall-e-2') {
    return 0.018 * n;
  }
  return 0.04 * n;
}
