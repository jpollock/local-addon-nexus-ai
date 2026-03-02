import type { McpToolDefinition, NexusServices } from '../mcp/types';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { ProviderToolDefinition } from './providers/types';

/**
 * Convert ToolRegistry definitions to provider-agnostic tool definitions.
 * Strips _confirmationToken from schemas — chat UI handles tier 3 approval separately.
 */
export function adaptToolsForChat(
  registry: ToolRegistry,
  services: NexusServices,
): ProviderToolDefinition[] {
  const mcpTools: McpToolDefinition[] = registry.list(services);

  return mcpTools.map((tool) => {
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
