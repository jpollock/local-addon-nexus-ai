/**
 * Ollama HTTP Client
 *
 * Shared HTTP client for Ollama API calls.
 * Used by both GraphQL resolvers (for structured data) and MCP tools (for markdown output).
 */

import * as http from 'http';
import { OLLAMA_BASE_URL } from '../../common/constants';

export interface OllamaModel {
  name: string;
  size: number;
  modified: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

export interface OllamaModelsResponse {
  models: OllamaModel[];
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
}

export interface OllamaGenerateResponse {
  response: string;
  model: string;
  created_at: string;
  done: boolean;
}

/**
 * Make HTTP request to Ollama API
 */
function ollamaRequest(
  path: string,
  body: string | null,
  method = 'POST',
): Promise<string> {
  const url = new URL(path, OLLAMA_BASE_URL);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        timeout: 60_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Ollama HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
      },
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * List available Ollama models
 */
export async function listModels(): Promise<OllamaModel[]> {
  try {
    const response = await ollamaRequest('/api/tags', null, 'GET');
    const data: OllamaModelsResponse = JSON.parse(response);
    return data.models || [];
  } catch (error) {
    throw new Error(`Failed to list Ollama models: ${(error as Error).message}`);
  }
}

/**
 * Generate text using Ollama
 */
export async function generate(request: OllamaGenerateRequest): Promise<string> {
  try {
    const body = JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      system: request.system,
      stream: false,
    });

    const response = await ollamaRequest('/api/generate', body);
    const data: OllamaGenerateResponse = JSON.parse(response);
    return data.response || '';
  } catch (error) {
    throw new Error(`Ollama generate failed: ${(error as Error).message}`);
  }
}

/**
 * Check if Ollama is running
 */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    await ollamaRequest('/api/tags', null, 'GET');
    return true;
  } catch {
    return false;
  }
}
