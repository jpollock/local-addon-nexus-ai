import { McpToolHandler, McpToolDefinition, McpToolResult, NexusServices } from './types';
import { getToolSafety, ConfirmationManager } from './safety';

/**
 * Central registry for MCP tools. Modules register handlers during startup.
 * The registry handles prerequisite filtering, safety enforcement, and dispatch.
 */
export class ToolRegistry {
  private handlers = new Map<string, McpToolHandler>();
  private _confirmations = new ConfirmationManager();

  /** Public access to the ConfirmationManager for ChatService tier 3 approval flow. */
  get confirmations(): ConfirmationManager {
    return this._confirmations;
  }

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
   * Execute a tool by name with safety enforcement.
   *
   * - Tier 1: Execute immediately
   * - Tier 2: Execute and audit-log
   * - Tier 3: Require confirmation token (generate → validate → execute)
   */
  async call(
    name: string,
    args: Record<string, unknown>,
    services: NexusServices,
  ): Promise<McpToolResult> {
    const handler = this.handlers.get(name);
    if (!handler) {
      return {
        content: [{ type: 'text', text: `Unknown tool: "${name}"` }],
        isError: true,
      };
    }

    const { isAvailable } = handler.definition;
    if (isAvailable && !isAvailable(services)) {
      return {
        content: [{ type: 'text', text: `Tool "${name}" is not currently available (prerequisites not met)` }],
        isError: true,
      };
    }

    const safety = getToolSafety(name);
    const startTime = Date.now();

    // Tier 3: confirmation token flow
    if (safety.tier === 3) {
      const token = args._confirmationToken as string | undefined;

      if (!token) {
        // Generate confirmation token
        const confirmationToken = this._confirmations.generate(name, args);
        this.auditLog(services, name, safety.tier, args, null, 'confirmation_required', undefined, Date.now() - startTime);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              requiresConfirmation: true,
              tier: 3,
              action: safety.confirmationMessage,
              warning: 'This action may not be reversible.',
              howToConfirm: `To proceed, call ${name} again with the same arguments plus _confirmationToken set to the value below.`,
              preChecks: safety.preChecks,
              confirmationToken,
            }, null, 2),
          }],
        };
      }

      // Validate confirmation token
      const validationParams = { ...args };
      delete validationParams._confirmationToken;
      const error = this._confirmations.validate(token, name, validationParams);
      if (error) {
        this.auditLog(services, name, safety.tier, args, false, 'error', error, Date.now() - startTime);
        return {
          content: [{ type: 'text', text: error }],
          isError: true,
        };
      }
    }

    // Execute the handler
    const handlerArgs = { ...args };
    delete handlerArgs._confirmationToken;

    try {
      const result = await handler.execute(handlerArgs, services);
      this.auditLog(services, name, safety.tier, args, safety.tier === 3 ? true : null, 'success', undefined, Date.now() - startTime);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.auditLog(services, name, safety.tier, args, safety.tier === 3 ? true : null, 'error', message, Date.now() - startTime);
      return {
        content: [{ type: 'text', text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  }

  private auditLog(
    services: NexusServices,
    toolName: string,
    tier: number,
    params: Record<string, unknown>,
    confirmed: boolean | null,
    result: 'success' | 'error' | 'confirmation_required',
    error: string | undefined,
    duration_ms: number,
  ): void {
    services.auditLogger?.log({
      timestamp: new Date().toISOString(),
      toolName,
      tier: tier as 1 | 2 | 3,
      params,
      confirmed,
      result,
      error,
      duration_ms,
    });
  }
}
