import type { McpToolDefinition, NexusServices } from '../mcp/types';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { ProviderToolDefinition } from './providers/types';

/**
 * Convert ToolRegistry definitions to provider-agnostic tool definitions.
 * Strips _confirmationToken from schemas — chat UI handles tier 3 approval separately.
 * Also includes contributed agent tools from ContributedToolRegistry when present.
 */
export function adaptToolsForChat(
  registry: ToolRegistry,
  services: NexusServices,
): ProviderToolDefinition[] {
  const mcpTools: McpToolDefinition[] = registry.list(services);

  // Append contributed agent tools (agent__<name>__<tool>) from ContributedToolRegistry
  const contributedDefs = (services as any).contributedRegistry?.toMcpDefinitions() ?? [];
  const allTools: McpToolDefinition[] = [
    ...mcpTools,
    ...contributedDefs.map((t: { name: string; description: string; inputSchema?: Record<string, unknown> }) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      isAvailable: () => true,
    })),
  ];

  return allTools.map((tool) => {
    // Deep-clone the schema to avoid mutating the original
    const parameters = JSON.parse(JSON.stringify(tool.inputSchema));

    // Remove _confirmationToken from properties if present
    if (parameters.properties?._confirmationToken) {
      delete parameters.properties._confirmationToken;
    }

    // Remove from required array if present
    if (Array.isArray(parameters.required)) {
      parameters.required = parameters.required.filter(
        (r: string) => r !== '_confirmationToken',
      );
      if (parameters.required.length === 0) {
        delete parameters.required;
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters,
    };
  });
}
