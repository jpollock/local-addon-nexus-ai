import { McpToolHandler, McpToolDefinition, McpToolResult, NexusServices } from './types';
import { createLogger } from '../logging/Logger';

const logger = createLogger('ToolRegistry');

/**
 * Central registry for MCP tools. Modules register handlers during startup.
 * The registry is a dumb router: it validates prerequisites and dispatches to handlers.
 *
 * Safety enforcement (Tier 3 confirmations, audit logging) is handled by:
 * - McpSafetyWrapper: For MCP server (chat interface)
 * - CLI commands: For terminal interface (sync.ts, etc)
 * - GraphQL resolvers: Call registry directly (no safety wrapper)
 */
export class ToolRegistry {
  private handlers = new Map<string, McpToolHandler>();

  register(handler: McpToolHandler): void {
    if (this.handlers.has(handler.definition.name)) {
      throw new Error(`Tool "${handler.definition.name}" is already registered`);
    }
    this.handlers.set(handler.definition.name, handler);
  }

  /**
   * Return tool definitions for tools whose prerequisites are currently met.
   */
  list(services: NexusServices): McpToolDefinition[] {
    const available: McpToolDefinition[] = [];
    for (const handler of this.handlers.values()) {
      const { isAvailable } = handler.definition;
      if (!isAvailable || isAvailable(services)) {
        available.push(handler.definition);
      }
    }
    return available;
  }

  /**
   * List all registered tool names (regardless of prerequisites).
   */
  allToolNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Execute a tool by name. No safety enforcement — just route to handler.
   *
   * Safety enforcement happens at the interface layer:
   * - MCP Server: Uses McpSafetyWrapper
   * - CLI: Handles confirmations in CLI commands
   * - GraphQL: Calls this directly (no confirmations needed)
   */
  async call(
    name: string,
    args: Record<string, unknown>,
    services: NexusServices,
  ): Promise<McpToolResult> {
    logger.debug(`call: name="${name}"`, { args });
    const handler = this.handlers.get(name);
    if (!handler) {
      logger.error(`Unknown tool: "${name}"`);
      return {
        content: [{ type: 'text', text: `Unknown tool: "${name}"` }],
        isError: true,
      };
    }

    const { isAvailable } = handler.definition;
    if (isAvailable && !isAvailable(services)) {
      logger.warn(`Tool "${name}" prerequisites not met`);
      return {
        content: [{ type: 'text', text: `Tool "${name}" is not currently available (prerequisites not met)` }],
        isError: true,
      };
    }

    // Execute handler directly (no safety checks)
    try {
      logger.debug(`Executing handler for "${name}"`);
      const result = await handler.execute(args, services);
      logger.debug(`Handler "${name}" completed`, { isError: result.isError });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Error in handler "${name}"`, { message, stack: err instanceof Error ? err.stack : undefined });
      return {
        content: [{ type: 'text', text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  }
}
