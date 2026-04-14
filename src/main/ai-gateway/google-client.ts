/**
 * Google Gemini API client for AI Gateway
 *
 * Translates OpenAI chat-completion format → Gemini generateContent format → back.
 */

import * as https from 'https';
import { OpenAIChatCompletionRequest, OpenAIChatCompletionResponse } from './types';

export interface GoogleClientOptions {
  apiKey: string;
  logger?: {
    info: (msg: string) => void;
    error: (msg: string, ...args: any[]) => void;
  };
}

/**
 * Call Google Gemini generateContent API.
 * Converts OpenAI-format request → Gemini format → OpenAI-format response.
 */
export async function callGoogleAPI(
  request: OpenAIChatCompletionRequest,
  options: GoogleClientOptions,
): Promise<OpenAIChatCompletionResponse & { usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
  const { apiKey, logger } = options;

  // Translate OpenAI messages → Gemini contents
  const systemMessage = request.messages.find((m) => m.role === 'system');
  const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

  const contents = nonSystemMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const geminiBody: any = { contents };
  if (systemMessage) {
    geminiBody.systemInstruction = { parts: [{ text: systemMessage.content }] };
  }
  if (request.max_tokens) {
    geminiBody.generationConfig = { maxOutputTokens: request.max_tokens };
  }
  if (request.temperature !== undefined) {
    geminiBody.generationConfig = { ...geminiBody.generationConfig, temperature: request.temperature };
  }

  const body = JSON.stringify(geminiBody);
  const model = request.model;
  const path = `/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestOptions = {
    hostname: 'generativelanguage.googleapis.com',
    port: 443,
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
            `[GoogleClient] API error: HTTP ${res.statusCode} (${duration}ms)`,
            responseBody.substring(0, 500),
          );
          try {
            const errorData = JSON.parse(responseBody);
            reject(new Error(`Google API error: ${errorData.error?.message || res.statusCode}`));
          } catch {
            reject(new Error(`Google API error: HTTP ${res.statusCode}`));
          }
          return;
        }

        try {
          const geminiResponse = JSON.parse(responseBody);
          const candidate = geminiResponse.candidates?.[0];
          const text = candidate?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
          const usage = geminiResponse.usageMetadata ?? {};
          const promptTokens = usage.promptTokenCount ?? 0;
          const completionTokens = usage.candidatesTokenCount ?? 0;

          logger?.info(
            `[GoogleClient] Success: ${promptTokens} in, ${completionTokens} out (${duration}ms)`,
          );

          // Translate back to OpenAI format
          const openAIResponse: OpenAIChatCompletionResponse & { usage: any } = {
            id: `chatcmpl-google-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop',
            }],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            },
          };

          resolve(openAIResponse);
        } catch (err) {
          logger?.error('[GoogleClient] Failed to parse response:', err);
          reject(new Error('Failed to parse Google API response'));
        }
      });
    });

    req.on('error', (err) => { logger?.error('[GoogleClient] Request error:', err); reject(err); });
    req.on('timeout', () => { req.destroy(); reject(new Error('Google API request timeout')); });
    req.setTimeout(60000);
    req.write(body);
    req.end();
  });
}

/**
 * Calculate cost for Google Gemini API usage.
 * Pricing as of April 2025.
 */
export function calculateGoogleCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Prices per 1M tokens (input / output)
  let inputCostPer1M = 0.10;   // gemini-2.0-flash default
  let outputCostPer1M = 0.40;

  if (model.includes('2.5-pro') || model.includes('gemini-2.5-pro')) {
    inputCostPer1M = 1.25;
    outputCostPer1M = 10.00;
  } else if (model.includes('2.5-flash') || model.includes('gemini-2.5-flash')) {
    inputCostPer1M = 0.15;
    outputCostPer1M = 0.60;
  } else if (model.includes('1.5-pro')) {
    inputCostPer1M = 1.25;
    outputCostPer1M = 5.00;
  } else if (model.includes('1.5-flash')) {
    inputCostPer1M = 0.075;
    outputCostPer1M = 0.30;
  } else if (model.includes('flash-lite') || model.includes('flash-8b')) {
    inputCostPer1M = 0.075;
    outputCostPer1M = 0.30;
  }

  return (inputTokens / 1_000_000) * inputCostPer1M +
         (outputTokens / 1_000_000) * outputCostPer1M;
}
