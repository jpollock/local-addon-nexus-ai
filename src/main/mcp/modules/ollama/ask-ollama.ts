import * as http from 'http';
import { McpToolHandler, McpToolResult, NexusServices } from '../../types';
import { OLLAMA_BASE_URL } from '../../../../common/constants';

export const askOllamaHandler: McpToolHandler = {
  definition: {
    name: 'ask_ollama',
    description:
      'Send a prompt to a locally running Ollama instance. Requires Ollama to be installed and running. ' +
      'Supports optional model selection and system prompts.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The prompt to send to the model',
        },
        model: {
          type: 'string',
          description: 'Ollama model name (default: auto-detected best available)',
        },
        system: {
          type: 'string',
          description: 'System prompt to set context for the model',
        },
      },
      required: ['prompt'],
    },
    isAvailable: () => isOllamaRunning,
  },

  async execute(args, services): Promise<McpToolResult> {
    const model = (args.model as string) || await getDefaultModel();
    if (!model) {
      return error('No Ollama models available. Pull a model first: ollama pull llama3.2');
    }

    const body = JSON.stringify({
      model,
      prompt: args.prompt as string,
      system: args.system as string | undefined,
      stream: false,
    });

    try {
      const response = await ollamaRequest('/api/generate', body);
      const data = JSON.parse(response);
      return ok(data.response ?? 'No response from model.');
    } catch (err) {
      return error(`Ollama request failed: ${(err as Error).message}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Ollama availability tracking
// ---------------------------------------------------------------------------

let isOllamaRunning = false;
let cachedModels: string[] = [];

/** Probe Ollama availability. Called periodically by the addon. */
export async function refreshOllamaStatus(): Promise<boolean> {
  try {
    const response = await ollamaRequest('/api/tags', null, 'GET');
    const data = JSON.parse(response);
    cachedModels = (data.models ?? []).map((m: any) => m.name as string);
    isOllamaRunning = true;
  } catch {
    isOllamaRunning = false;
    cachedModels = [];
  }
  return isOllamaRunning;
}

async function getDefaultModel(): Promise<string | null> {
  if (cachedModels.length === 0) await refreshOllamaStatus();
  return cachedModels[0] ?? null;
}

export function getOllamaStatus() {
  return { available: isOllamaRunning, models: cachedModels };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

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
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timed out'));
    });

    if (body) req.write(body);
    req.end();
  });
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
