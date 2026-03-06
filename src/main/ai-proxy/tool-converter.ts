/**
 * Tool Converter — Convert MCP tool definitions to OpenAI function tool format.
 *
 * Used by AI Proxy inject/agentic modes to merge Local's MCP tools with
 * WordPress tools before sending to Ollama.
 */
import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices, McpToolDefinition } from '../mcp/types';
import { getToolSafety } from '../mcp/safety';
import type { OpenAITool } from './types';

/** Max tools to send to Ollama — local models struggle with too many */
export const MAX_PROXY_TOOLS = 20;

/** Priority order for selecting which MCP tools to include */
const MODULE_PRIORITY: string[] = [
  'fleet-intelligence',
  'content',
  'site-context',
  'fleet',
  'wp-cli',
  'site-management',
  'composite',
];

/**
 * Convert MCP tool definitions from the registry to OpenAI function tool format.
 *
 * @param registry - The tool registry with all registered MCP tools
 * @param services - NexusServices for availability checks
 * @param options.excludeDestructive - If true, exclude Tier 3 tools (default: true)
 * @param options.maxTools - Max tools to return (default: MAX_PROXY_TOOLS)
 */
export function convertMcpToolsToOpenAI(
  registry: ToolRegistry,
  services: NexusServices,
  options?: { excludeDestructive?: boolean; maxTools?: number },
): OpenAITool[] {
  const excludeDestructive = options?.excludeDestructive ?? true;
  const maxTools = options?.maxTools ?? MAX_PROXY_TOOLS;

  // Get available tools
  const available = registry.list(services);

  // Filter out Tier 3 if requested
  const filtered = excludeDestructive
    ? available.filter((t) => getToolSafety(t.name).tier < 3)
    : available;

  // Sort by module priority (tools named with module prefix get priority)
  const sorted = [...filtered].sort((a, b) => {
    const aPri = getModulePriority(a.name);
    const bPri = getModulePriority(b.name);
    return aPri - bPri;
  });

  // Cap at maxTools
  const capped = sorted.slice(0, maxTools);

  // Convert to OpenAI format
  return capped.map(mcpToOpenAI);
}

function mcpToOpenAI(def: McpToolDefinition): OpenAITool {
  // MCP inputSchema is already JSON Schema — map to OpenAI parameters
  const schema = def.inputSchema as Record<string, unknown>;
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: {
        type: schema.type ?? 'object',
        properties: schema.properties ?? {},
        required: schema.required ?? [],
      },
    },
  };
}

function getModulePriority(toolName: string): number {
  for (let i = 0; i < MODULE_PRIORITY.length; i++) {
    // Tools are typically named like "module_action" or "module-name_action"
    const prefix = MODULE_PRIORITY[i].replace(/-/g, '_');
    if (toolName.startsWith(prefix + '_') || toolName.startsWith(prefix)) {
      return i;
    }
  }
  return MODULE_PRIORITY.length; // Unknown module — lowest priority
}
