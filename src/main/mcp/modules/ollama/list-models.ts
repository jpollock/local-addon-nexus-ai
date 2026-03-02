import * as http from 'http';
import * as os from 'os';
import { McpToolHandler, McpToolResult } from '../../types';
import { OLLAMA_BASE_URL } from '../../../../common/constants';
import { getOllamaStatus } from './ask-ollama';
import { recommendModel } from './model-recommender';

export const listOllamaModelsHandler: McpToolHandler = {
  definition: {
    name: 'list_ollama_models',
    description:
      'List available Ollama models on the local machine. Returns model names, sizes, and ' +
      'parameter counts. Requires Ollama to be installed and running.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isAvailable: () => getOllamaStatus().available,
  },

  async execute(_args, _services): Promise<McpToolResult> {
    try {
      const url = new URL('/api/tags', OLLAMA_BASE_URL);
      const response = await httpGet(url);
      const data = JSON.parse(response);
      const models = data.models ?? [];

      const totalMemGB = Math.round(os.totalmem() / (1024 ** 3));
      const modelNames = (models as any[]).map((m: any) => m.name as string);
      const recommendation = recommendModel(totalMemGB, modelNames);

      if (models.length === 0) {
        return ok(
          `No Ollama models installed.\n\n` +
          `## System Info\n` +
          `- Total RAM: ${totalMemGB} GB\n` +
          `- Suggested: \`ollama pull ${recommendation.model}\` (${recommendation.reason})`,
        );
      }

      const lines = ['## Available Ollama Models\n'];
      for (const model of models) {
        const sizeGB = model.size ? `${(model.size / 1e9).toFixed(1)} GB` : 'unknown';
        const paramSize = model.details?.parameter_size ?? '';
        const quant = model.details?.quantization_level ?? '';
        const family = model.details?.family ?? '';

        lines.push(
          `- **${model.name}** — ${sizeGB}` +
          (paramSize ? `, ${paramSize}` : '') +
          (quant ? ` (${quant})` : '') +
          (family ? ` [${family}]` : ''),
        );
      }

      lines.push('');
      lines.push('## System Info');
      lines.push(`- Total RAM: ${totalMemGB} GB`);
      lines.push(`- Recommended: ${recommendation.model} (${recommendation.installed ? 'installed' : 'not installed'})`);
      if (!recommendation.installed) {
        lines.push(`- To install: \`ollama pull ${recommendation.model}\``);
      }

      return ok(lines.join('\n'));
    } catch (err) {
      return error(`Failed to list Ollama models: ${(err as Error).message}`);
    }
  },
};

function httpGet(url: URL): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: url.hostname, port: url.port, path: url.pathname, timeout: 5000 },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
