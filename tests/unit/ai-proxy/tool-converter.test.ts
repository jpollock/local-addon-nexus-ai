/**
 * Unit tests for tool-converter — MCP to OpenAI tool format conversion
 */
import { convertMcpToolsToOpenAI, MAX_PROXY_TOOLS } from '../../../src/main/ai-proxy/tool-converter';

// Mock safety module
jest.mock('../../../src/main/mcp/safety', () => ({
  getToolSafety: jest.fn().mockImplementation((name: string) => {
    if (name === 'destructive_tool') return { tier: 3 };
    return { tier: 1 };
  }),
}));

function createMockRegistry(tools: Array<{ name: string; description: string; inputSchema?: any; available?: boolean }>) {
  return {
    list: jest.fn().mockImplementation(() =>
      tools
        .filter((t) => t.available !== false)
        .map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? { type: 'object', properties: {}, required: [] },
        })),
    ),
    allToolNames: jest.fn().mockReturnValue(tools.map((t) => t.name)),
  } as any;
}

const mockServices = {} as any;

describe('convertMcpToolsToOpenAI', () => {
  // 1. Converts MCP inputSchema to OpenAI parameters format
  it('should convert MCP tools to OpenAI format', () => {
    const registry = createMockRegistry([
      {
        name: 'content_search',
        description: 'Search site content',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            siteId: { type: 'string' },
          },
          required: ['query'],
        },
      },
    ]);

    const result = convertMcpToolsToOpenAI(registry, mockServices);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('content_search');
    expect(result[0].function.description).toBe('Search site content');
    expect(result[0].function.parameters).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        siteId: { type: 'string' },
      },
      required: ['query'],
    });
  });

  // 2. Filters out unavailable tools (registry.list already handles this)
  it('should only include available tools from registry.list()', () => {
    const registry = createMockRegistry([
      { name: 'tool_a', description: 'A', available: true },
      { name: 'tool_b', description: 'B', available: false },
    ]);

    const result = convertMcpToolsToOpenAI(registry, mockServices);

    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe('tool_a');
  });

  // 3. Filters out Tier 3 tools when excludeDestructive=true
  it('should exclude Tier 3 destructive tools by default', () => {
    const registry = createMockRegistry([
      { name: 'safe_tool', description: 'Safe' },
      { name: 'destructive_tool', description: 'Destructive' },
    ]);

    const result = convertMcpToolsToOpenAI(registry, mockServices);

    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe('safe_tool');
  });

  // 4. Includes Tier 3 tools when excludeDestructive=false
  it('should include Tier 3 tools when excludeDestructive is false', () => {
    const registry = createMockRegistry([
      { name: 'safe_tool', description: 'Safe' },
      { name: 'destructive_tool', description: 'Destructive' },
    ]);

    const result = convertMcpToolsToOpenAI(registry, mockServices, { excludeDestructive: false });

    expect(result).toHaveLength(2);
  });

  // 5. Limits output to MAX_PROXY_TOOLS
  it('should cap output at MAX_PROXY_TOOLS', () => {
    const tools = Array.from({ length: 30 }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool ${i}`,
    }));
    const registry = createMockRegistry(tools);

    const result = convertMcpToolsToOpenAI(registry, mockServices);

    expect(result).toHaveLength(MAX_PROXY_TOOLS);
  });
});
