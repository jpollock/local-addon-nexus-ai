import { McpToolHandler, McpToolDefinition, McpToolResult, NexusServices } from './types';
import { createLogger } from '../logging/Logger';
import { getMetrics } from '../telemetry/MetricsCollector';

const logger = createLogger('ToolRegistry');
const metrics = getMetrics();

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
   *
   * @param accessMethod - 'mcp' if called from MCP server, 'cli' if called from CLI/GraphQL
   */
  async call(
    name: string,
    args: Record<string, unknown>,
    services: NexusServices,
    accessMethod?: 'mcp' | 'cli',
  ): Promise<McpToolResult> {
    const startTime = Date.now();
    logger.debug(`call: name="${name}" via ${accessMethod || 'unknown'}`, { args });

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
      const duration = Date.now() - startTime;

      // Record metrics with access method
      metrics.recordToolCall(name, duration, result.isError || false, accessMethod);

      logger.debug(`Handler "${name}" completed in ${duration}ms`, { isError: result.isError });
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      // Record error metrics
      metrics.recordToolCall(name, duration, true, accessMethod);

      logger.error(`Error in handler "${name}"`, { message, stack: err instanceof Error ? err.stack : undefined });
      return {
        content: [{ type: 'text', text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  }
}
