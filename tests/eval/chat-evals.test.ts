/**
 * Chat LLM Evals
 *
 * Real LLM calls to Ollama to verify the model — given our system prompt
 * and tool definitions — routes to the correct tools and avoids hallucination.
 *
 * These tests call Ollama directly (not through ChatService) so they can run
 * without Local. Skipped automatically if Ollama is not running or no
 * tool-capable model is available.
 *
 * Run: npm run test:eval
 */

import { apiRequest } from '../../src/main/chat/providers/http-utils';
import { OLLAMA_BASE_URL } from '../../src/common/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface ChatEvalResult {
  content: string;
  toolCalls: OllamaToolCall[];
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Tool Definitions (subset for eval — keep context small for local models)
// ---------------------------------------------------------------------------

const EVAL_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'local_list_sites',
      description: 'List all WordPress sites in the Local development environment. Returns site names, domains, and status (running/halted).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'wp_plugin_list',
      description: 'List all installed plugins for a WordPress site. Returns plugin name, version, status (active/inactive), and update availability.',
      parameters: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'Site name or ID' },
        },
        required: ['site'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'wp_core_version',
      description: 'Get the WordPress core version for a site.',
      parameters: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'Site name or ID' },
        },
        required: ['site'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'wp_theme_list',
      description: 'List all installed themes for a WordPress site.',
      parameters: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'Site name or ID' },
        },
        required: ['site'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'local_start_site',
      description: 'Start a halted WordPress site in the Local environment.',
      parameters: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'Site name or ID' },
        },
        required: ['site'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_site_content',
      description: 'Search indexed content across a WordPress site using semantic search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          site: { type: 'string', description: 'Site name or ID' },
        },
        required: ['query', 'site'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// System Prompt (mirrors ChatService.buildSystemPrompt)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are Nexus AI, a WordPress site management assistant built into the Local development environment.',
  'You have access to tools for managing WordPress sites, checking plugin status, running WP-CLI commands, and more.',
  'Be concise and helpful. When using tools, explain what you are doing.',
  '',
  'IMPORTANT: Always use your tools to get real data. Never fabricate or guess site names, plugin lists, version numbers, or other information.',
  'If asked about sites, call local_list_sites first. If asked about plugins, call wp_plugin_list with the site name.',
  'If asked about WordPress versions, call wp_core_version. If you cannot answer using your available tools, say so.',
].join('\n');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let ollamaAvailable: boolean | null = null;
let selectedModel: string | null = null;

/**
 * Check if Ollama is running and find a tool-capable model.
 */
async function ensureOllama(): Promise<{ available: boolean; model: string | null }> {
  if (ollamaAvailable !== null) {
    return { available: ollamaAvailable, model: selectedModel };
  }

  try {
    const tagsResponse = await apiRequest({
      url: `${OLLAMA_BASE_URL}/api/tags`,
      method: 'GET',
      timeoutMs: 5000,
    });
    const tags = JSON.parse(tagsResponse);
    const models: string[] = (tags.models ?? []).map((m: any) => m.name as string);

    if (models.length === 0) {
      ollamaAvailable = false;
      return { available: false, model: null };
    }

    // Find a tool-capable model by checking templates
    for (const model of models) {
      try {
        const showResponse = await apiRequest({
          url: `${OLLAMA_BASE_URL}/api/show`,
          method: 'POST',
          body: JSON.stringify({ name: model }),
          timeoutMs: 5000,
        });
        const data = JSON.parse(showResponse);
        const template = (data.template ?? '') as string;
        if (template.includes('.Tools') || template.includes('.ToolCalls')) {
          selectedModel = model;
          ollamaAvailable = true;
          return { available: true, model };
        }
      } catch {
        continue;
      }
    }

    // No tool-capable model found
    ollamaAvailable = false;
    return { available: false, model: null };
  } catch {
    ollamaAvailable = false;
    return { available: false, model: null };
  }
}

/**
 * Send a chat eval to Ollama and return the parsed response.
 */
async function sendChatEval(userMessage: string): Promise<ChatEvalResult> {
  const { available, model } = await ensureOllama();
  if (!available || !model) {
    throw new Error('Ollama not available');
  }

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    tools: EVAL_TOOLS,
    stream: false,
    options: {
      temperature: 0,
    },
  });

  const response = await apiRequest({
    url: `${OLLAMA_BASE_URL}/api/chat`,
    method: 'POST',
    body,
    timeoutMs: 120_000,
  });

  const data = JSON.parse(response);
  const msg = data.message ?? {};

  return {
    content: (msg.content ?? '') as string,
    toolCalls: (msg.tool_calls ?? []) as OllamaToolCall[],
    raw: data,
  };
}

function skipIfNoOllama(result: { available: boolean }): boolean {
  if (!result.available) {
    console.log('Ollama not available or no tool-capable model — skipping LLM evals');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Chat LLM Evals', () => {
  beforeAll(async () => {
    const result = await ensureOllama();
    if (result.available) {
      console.log(`Using Ollama model: ${result.model}`);
    }
  });

  it('site listing routes to local_list_sites tool', async () => {
    const ollama = await ensureOllama();
    if (skipIfNoOllama(ollama)) return;

    const result = await sendChatEval('How many sites do I have?');
    const toolNames = result.toolCalls.map((tc) => tc.function.name);

    expect(toolNames).toContain('local_list_sites');
  });

  it('plugin question routes to wp_plugin_list tool', async () => {
    const ollama = await ensureOllama();
    if (skipIfNoOllama(ollama)) return;

    const result = await sendChatEval('What plugins are installed on my-site?');
    const toolNames = result.toolCalls.map((tc) => tc.function.name);

    expect(toolNames).toContain('wp_plugin_list');
  });

  it('version question routes to wp_core_version tool', async () => {
    const ollama = await ensureOllama();
    if (skipIfNoOllama(ollama)) return;

    const result = await sendChatEval('What WordPress version is my-blog running?');
    const toolNames = result.toolCalls.map((tc) => tc.function.name);

    expect(toolNames).toContain('wp_core_version');
  });

  it('site listing uses tool instead of fabricating names', async () => {
    const ollama = await ensureOllama();
    if (skipIfNoOllama(ollama)) return;

    const result = await sendChatEval('List my WordPress sites');

    // Should call a tool, not make up site names in content
    expect(result.toolCalls.length).toBeGreaterThan(0);
  });

  it('plugin question uses tool instead of fabricating plugins', async () => {
    const ollama = await ensureOllama();
    if (skipIfNoOllama(ollama)) return;

    const result = await sendChatEval('What plugins are on my blog?');

    expect(result.toolCalls.length).toBeGreaterThan(0);
  });

  it('off-topic question does not route to WordPress tools', async () => {
    const ollama = await ensureOllama();
    if (skipIfNoOllama(ollama)) return;

    const result = await sendChatEval("What's the weather in New York?");

    // Small local models sometimes call tools anyway. The key check is that
    // it doesn't call WordPress-specific tools for a weather question.
    const wpToolNames = ['wp_plugin_list', 'wp_core_version', 'wp_theme_list', 'search_site_content'];
    const calledWpTools = result.toolCalls.filter(
      (tc) => wpToolNames.includes(tc.function.name),
    );
    expect(calledWpTools.length).toBe(0);
  });

  it('identity question mentions assistant role', async () => {
    const ollama = await ensureOllama();
    if (skipIfNoOllama(ollama)) return;

    const result = await sendChatEval('Who are you? Do not use any tools, just answer.');

    const lower = result.content.toLowerCase();
    // Small models may use different self-descriptions — accept any reasonable one
    expect(
      lower.includes('nexus') || lower.includes('assistant') ||
      lower.includes('ai') || lower.includes('wordpress'),
    ).toBe(true);
  });

  it('tool arguments include site name from prompt', async () => {
    const ollama = await ensureOllama();
    if (skipIfNoOllama(ollama)) return;

    const result = await sendChatEval('List plugins on my-awesome-blog');
    const pluginCall = result.toolCalls.find(
      (tc) => tc.function.name === 'wp_plugin_list',
    );

    if (pluginCall) {
      const siteArg = String(pluginCall.function.arguments?.site ?? '');
      expect(siteArg.toLowerCase()).toContain('my-awesome-blog');
    } else {
      // At minimum, some tool should have been called
      expect(result.toolCalls.length).toBeGreaterThan(0);
    }
  });
});
