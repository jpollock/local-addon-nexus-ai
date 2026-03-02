import * as http from 'http';
import { McpToolHandler, McpToolResult, NexusServices } from '../../types';
import { OLLAMA_BASE_URL } from '../../../../common/constants';
import { resolveSite } from '../../site-resolver';
import { SiteStructure } from '../../../../common/types';

export const askOllamaHandler: McpToolHandler = {
  definition: {
    name: 'ask_ollama',
    description:
      'Send a prompt to a locally running Ollama instance. Requires Ollama to be installed and running. ' +
      'Supports optional model selection, system prompts, and site context injection.',
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
        site: {
          type: 'string',
          description: 'Site name/ID — injects site structure and relevant content as context',
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

    let systemPrompt = (args.system as string | undefined) ?? '';

    // Site context injection
    if (args.site) {
      const siteContext = await buildSiteContext(args.site as string, args.prompt as string, services);
      if (siteContext.error) {
        return error(siteContext.error);
      }
      if (siteContext.context) {
        systemPrompt = siteContext.context + (systemPrompt ? '\n\n' + systemPrompt : '');
      }
    }

    const body = JSON.stringify({
      model,
      prompt: args.prompt as string,
      system: systemPrompt || undefined,
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
// Site context builder
// ---------------------------------------------------------------------------

interface SiteContextResult {
  context?: string;
  error?: string;
}

async function buildSiteContext(
  siteQuery: string,
  prompt: string,
  services: NexusServices,
): Promise<SiteContextResult> {
  const site = resolveSite(siteQuery, services.siteData);
  if (!site) {
    return { error: `Site not found: "${siteQuery}"` };
  }

  // Try to get structure from index registry first, then file scanner
  let structure: SiteStructure | null = null;
  const indexEntry = services.indexRegistry.get(site.id);
  if (indexEntry?.structure) {
    structure = indexEntry.structure;
  } else {
    try {
      structure = await services.fileScanner.scan(site.path);
    } catch {
      // Site may not be running — skip structure
    }
  }

  if (!structure) {
    // No structure available — skip context entirely
    return {};
  }

  // Build context header
  const activeTheme = structure.themes.find((t) => t.isActive);
  const activePlugins = structure.plugins.filter((p) => p.isActive);
  const lines = [
    `You are an AI assistant with knowledge about the WordPress site "${site.name}".`,
    '',
    `Site: ${site.name}${site.domain ? ` (${site.domain})` : ''}`,
    `WordPress: ${structure.wpVersion} | PHP: ${structure.phpVersion}`,
    `Active theme: ${activeTheme?.name ?? 'unknown'}`,
    `Active plugins: ${activePlugins.map((p) => p.name).join(', ') || 'none'}`,
  ];

  // Try to inject relevant content via vector search
  try {
    const vector = await services.embeddingService.embed(prompt);
    const results = await services.vectorStore.search(site.id, vector, { limit: 3 });
    if (results.length > 0) {
      lines.push('');
      lines.push('Relevant content from this site:');
      for (const result of results) {
        const excerpt = result.content.length > 300
          ? result.content.slice(0, 300) + '...'
          : result.content;
        lines.push('---');
        lines.push(`${result.title}: ${excerpt}`);
      }
    }
  } catch {
    // Site not indexed — skip content search, structure-only context is still useful
  }

  return { context: lines.join('\n') };
}

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
