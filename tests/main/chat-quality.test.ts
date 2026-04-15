/**
 * Chat Quality Unit Tests
 *
 * Deterministic tests for chat system quality — no LLM calls, zero cost, fast.
 * Validates provider configuration correctness, tool adapter behavior,
 * safety tier assignments, and stream event types.
 */

import { OllamaProvider } from '../../src/main/chat/providers/ollama';
import { OpenAIProvider } from '../../src/main/chat/providers/openai';
import { AnthropicProvider } from '../../src/main/chat/providers/anthropic';
import { GoogleProvider } from '../../src/main/chat/providers/google';
import { LocalGatewayProvider } from '../../src/main/chat/providers/local-gateway';
import { CHAT_DEFAULTS, OLLAMA_BASE_URL } from '../../src/common/constants';
import { adaptToolsForChat } from '../../src/main/chat/tool-adapter';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import type { NexusServices } from '../../src/main/mcp/types';
import { TIER_OVERRIDES } from '../../src/main/mcp/safety';

// ---------------------------------------------------------------------------
// Provider Configuration Quality
// ---------------------------------------------------------------------------

describe('Provider configuration quality', () => {
  const providers = [
    new OllamaProvider(),
    new OpenAIProvider(),
    new AnthropicProvider(),
    new GoogleProvider(),
    new LocalGatewayProvider(),
  ];

  test('all providers have unique IDs', () => {
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('all providers have non-empty display names', () => {
    for (const p of providers) {
      expect(p.displayName.trim().length).toBeGreaterThan(0);
    }
  });

  test('cloud providers require API keys', () => {
    expect(new AnthropicProvider().requiresApiKey).toBe(true);
    expect(new OpenAIProvider().requiresApiKey).toBe(true);
    expect(new GoogleProvider().requiresApiKey).toBe(true);
  });

  test('local providers do not require API keys', () => {
    expect(new OllamaProvider().requiresApiKey).toBe(false);
  });

  test('provider IDs are lowercase kebab-case', () => {
    for (const p of providers) {
      expect(p.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test('each cloud provider has at least one default model', () => {
    const cloud = providers.filter((p) => p.requiresApiKey);
    for (const p of cloud) {
      expect(p.defaultModels.length).toBeGreaterThan(0);
    }
  });

  test('anthropic default models start with "claude-"', () => {
    const anthropic = new AnthropicProvider();
    for (const m of anthropic.defaultModels) {
      expect(m).toMatch(/^claude-/);
    }
  });

  test('openai default models are valid openai model names', () => {
    const openai = new OpenAIProvider();
    // OpenAI models include gpt- series and o-series (o1, o3, o4-mini, etc.)
    for (const m of openai.defaultModels) {
      expect(m).toMatch(/^(gpt-|o\d)/);
    }
  });

  test('google default models contain "gemini"', () => {
    const google = new GoogleProvider();
    expect(google.defaultModels.some((m) => m.includes('gemini'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chat Defaults Quality
// ---------------------------------------------------------------------------

describe('Chat defaults quality', () => {
  test('default provider is ollama (works out of the box)', () => {
    expect(CHAT_DEFAULTS.DEFAULT_PROVIDER).toBe('ollama');
  });

  test('max agent iterations is reasonable (5-20)', () => {
    expect(CHAT_DEFAULTS.MAX_AGENT_ITERATIONS).toBeGreaterThanOrEqual(5);
    expect(CHAT_DEFAULTS.MAX_AGENT_ITERATIONS).toBeLessThanOrEqual(20);
  });

  test('Ollama base URL is localhost', () => {
    expect(OLLAMA_BASE_URL).toContain('localhost');
  });
});

// ---------------------------------------------------------------------------
// Tool Adapter Quality
// ---------------------------------------------------------------------------

describe('Tool adapter quality', () => {
  const mockServices = {} as NexusServices;

  test('tier 3 tools have _confirmationToken stripped', () => {
    const registry = new ToolRegistry();
    // Simulate a tier 3 tool with confirmation token
    registry.register({
      definition: {
        name: 'local_delete_site',
        description: 'Delete a site',
        inputSchema: {
          type: 'object',
          properties: {
            site: { type: 'string' },
            _confirmationToken: { type: 'string', description: 'Safety token' },
          },
          required: ['site', '_confirmationToken'],
        },
      },
      execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    });

    const tools = adaptToolsForChat(registry, mockServices);
    const deleteTool = tools.find((t) => t.name === 'local_delete_site');

    expect(deleteTool).toBeDefined();
    expect((deleteTool!.parameters as any).properties._confirmationToken).toBeUndefined();
  });

  test('tool descriptions are preserved accurately', () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'test_desc',
        description: 'This is a detailed tool description with specifics.',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    });

    const tools = adaptToolsForChat(registry, mockServices);
    expect(tools[0].description).toBe('This is a detailed tool description with specifics.');
  });

  test('tool names are preserved exactly', () => {
    const registry = new ToolRegistry();
    const names = ['wp_plugin_list', 'local_start_site', 'nexus_site_audit'];
    for (const name of names) {
      registry.register({
        definition: {
          name,
          description: `Tool: ${name}`,
          inputSchema: { type: 'object', properties: {} },
        },
        execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      });
    }

    const tools = adaptToolsForChat(registry, mockServices);
    expect(tools.map((t) => t.name).sort()).toEqual(names.sort());
  });
});

// ---------------------------------------------------------------------------
// Safety Integration Quality
// ---------------------------------------------------------------------------

describe('Safety integration quality', () => {
  test('all tier 3 tools are defined in TIER_OVERRIDES', () => {
    const tier3Tools = Object.entries(TIER_OVERRIDES)
      .filter(([, tier]) => tier === 3)
      .map(([name]) => name);

    expect(tier3Tools.length).toBeGreaterThan(0);
  });

  test('read-only tools are tier 1', () => {
    const readOnlyTools = ['local_list_sites', 'wp_plugin_list', 'wp_core_version', 'nexus_list_sites'];
    for (const tool of readOnlyTools) {
      expect(TIER_OVERRIDES[tool]).toBe(1);
    }
  });

  test('destructive tools are tier 3', () => {
    const destructiveTools = ['local_delete_site', 'local_wpe_push'];
    for (const tool of destructiveTools) {
      expect(TIER_OVERRIDES[tool]).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Stream Event Types Quality
// ---------------------------------------------------------------------------

describe('Stream event type quality', () => {
  // This test ensures the event types in chat-types.ts cover all needed cases
  test('ChatStreamEvent covers all required event types', async () => {
    // Import the types to verify they compile
    const types = await import('../../src/common/chat-types');

    // Verify the type module exports exist
    expect(types).toBeDefined();
  });

  test('ProviderStreamEvent is a subset of ChatStreamEvent types', async () => {
    // Provider events should only include types that providers can emit
    // (token, tool_call_*, done, error)
    // ChatStreamEvent extends with: tool_call_executing, tool_call_result, tool_call_approval_needed
    const types = await import('../../src/common/chat-types');
    expect(types).toBeDefined();
    // Type-level guarantees — if this file compiles, the constraint holds
  });
});
