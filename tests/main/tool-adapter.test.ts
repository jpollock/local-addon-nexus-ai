import { adaptToolsForChat } from '../../src/main/chat/tool-adapter';
import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import type { McpToolHandler, NexusServices } from '../../src/main/mcp/types';

const mockServices = {} as NexusServices;

function makeTool(name: string, schema: Record<string, unknown>): McpToolHandler {
  return {
    definition: {
      name,
      description: `Tool: ${name}`,
      inputSchema: schema,
    },
    execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
  };
}

describe('adaptToolsForChat', () => {
  test('converts registry tools to ProviderToolDefinition[]', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('my_tool', {
      type: 'object',
      properties: { site: { type: 'string' } },
      required: ['site'],
    }));

    const tools = adaptToolsForChat(registry, mockServices);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('my_tool');
    expect(tools[0].description).toBe('Tool: my_tool');
    expect(tools[0].parameters).toEqual({
      type: 'object',
      properties: { site: { type: 'string' } },
      required: ['site'],
    });
  });

  test('strips _confirmationToken from properties', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('tier3_tool', {
      type: 'object',
      properties: {
        site: { type: 'string' },
        _confirmationToken: { type: 'string' },
      },
      required: ['site', '_confirmationToken'],
    }));

    const tools = adaptToolsForChat(registry, mockServices);

    expect(tools[0].parameters).toEqual({
      type: 'object',
      properties: { site: { type: 'string' } },
      required: ['site'],
    });
    expect((tools[0].parameters as any).properties._confirmationToken).toBeUndefined();
  });

  test('removes empty required array after stripping _confirmationToken', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('no_required', {
      type: 'object',
      properties: {
        _confirmationToken: { type: 'string' },
      },
      required: ['_confirmationToken'],
    }));

    const tools = adaptToolsForChat(registry, mockServices);

    expect((tools[0].parameters as any).required).toBeUndefined();
  });

  test('does not mutate the original schema', () => {
    const schema = {
      type: 'object',
      properties: {
        site: { type: 'string' },
        _confirmationToken: { type: 'string' },
      },
      required: ['site', '_confirmationToken'],
    };
    const registry = new ToolRegistry();
    registry.register(makeTool('immutable_test', schema));

    adaptToolsForChat(registry, mockServices);

    // Original should still have _confirmationToken
    expect(schema.properties._confirmationToken).toBeDefined();
    expect(schema.required).toContain('_confirmationToken');
  });

  test('filters out unavailable tools', () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'available_tool',
        description: 'Available',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    });
    registry.register({
      definition: {
        name: 'gated_tool',
        description: 'Gated',
        inputSchema: { type: 'object', properties: {} },
        isAvailable: () => false,
      },
      execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    });

    const tools = adaptToolsForChat(registry, mockServices);
    const names = tools.map((t) => t.name);

    expect(names).toContain('available_tool');
    expect(names).not.toContain('gated_tool');
  });

  test('handles tool with no properties', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('empty_tool', { type: 'object' }));

    const tools = adaptToolsForChat(registry, mockServices);

    expect(tools[0].parameters).toEqual({ type: 'object' });
  });

  test('converts multiple tools preserving order', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('alpha', { type: 'object', properties: {} }));
    registry.register(makeTool('beta', { type: 'object', properties: {} }));
    registry.register(makeTool('gamma', { type: 'object', properties: {} }));

    const tools = adaptToolsForChat(registry, mockServices);

    expect(tools.map((t) => t.name)).toEqual(['alpha', 'beta', 'gamma']);
  });
});
