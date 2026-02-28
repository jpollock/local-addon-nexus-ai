import { ToolRegistry } from '../../src/main/mcp/tool-registry';
import { McpToolHandler, McpToolResult, NexusServices } from '../../src/main/mcp/types';

const mockServices = {} as NexusServices;

function makeTool(name: string, available?: boolean): McpToolHandler {
  return {
    definition: {
      name,
      description: `Test tool: ${name}`,
      inputSchema: { type: 'object', properties: {} },
      ...(available !== undefined ? { isAvailable: () => available } : {}),
    },
    execute: async (args) => ({
      content: [{ type: 'text' as const, text: `executed ${name} with ${JSON.stringify(args)}` }],
    }),
  };
}

describe('ToolRegistry', () => {
  test('registers and lists tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('tool_a'));
    registry.register(makeTool('tool_b'));

    const tools = registry.list(mockServices);
    expect(tools.map((t) => t.name).sort()).toEqual(['tool_a', 'tool_b']);
  });

  test('rejects duplicate registration', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('tool_a'));
    expect(() => registry.register(makeTool('tool_a'))).toThrow('already registered');
  });

  test('filters tools by isAvailable', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('always_on'));
    registry.register(makeTool('gated_on', true));
    registry.register(makeTool('gated_off', false));

    const tools = registry.list(mockServices);
    const names = tools.map((t) => t.name);

    expect(names).toContain('always_on');
    expect(names).toContain('gated_on');
    expect(names).not.toContain('gated_off');
  });

  test('calls a tool by name', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('my_tool'));

    const result = await registry.call('my_tool', { foo: 'bar' }, mockServices);
    expect(result.content[0].text).toContain('executed my_tool');
    expect(result.content[0].text).toContain('"foo":"bar"');
  });

  test('returns error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await registry.call('nonexistent', {}, mockServices);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  test('returns error when prerequisites not met', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('unavailable_tool', false));

    const result = await registry.call('unavailable_tool', {}, mockServices);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not currently available');
  });

  test('allToolNames returns all names regardless of availability', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('on'));
    registry.register(makeTool('off', false));

    expect(registry.allToolNames().sort()).toEqual(['off', 'on']);
  });
});
