import { ToolRegistry } from './tool-registry';
import { McpToolResult, NexusServices } from './types';
import { getToolSafety, ConfirmationManager } from './safety';
import { createLogger } from '../logging/Logger';

const logger = createLogger('McpSafetyWrapper');

/**
 * MCP Safety Wrapper
 *
 * Wraps the tool registry with MCP-specific safety enforcement:
 * - Tier 3 confirmation token flow (async, chat-friendly)
 * - Audit logging for all tool executions
 * - Rate limiting (future)
 *
 * This layer is ONLY used by the MCP server for Claude chat interactions.
 * GraphQL/CLI calls the tool registry directly and handles confirmations
 * at their own interface layer (e.g., terminal prompts in CLI).
 */
export class McpSafetyWrapper {
  private confirmations = new ConfirmationManager();

  constructor(private registry: ToolRegistry) {}

  /**
   * Execute a tool with MCP-specific safety enforcement.
   *
   * - Tier 1: Execute immediately
   * - Tier 2: Execute and audit-log
   * - Tier 3: Require confirmation token (generate → validate → execute)
   */
  async callWithSafety(
    name: string,
    args: Record<string, unknown>,
    services: NexusServices,
  ): Promise<McpToolResult> {
    logger.debug(`callWithSafety: name="${name}"`, { args });
    const safety = getToolSafety(name);
    const startTime = Date.now();

    // Tier 3: MCP confirmation token flow
    if (safety.tier === 3) {
      const token = args._confirmationToken as string | undefined;

      if (!token) {
        // Generate confirmation token
        const confirmationToken = this.confirmations.generate(name, args);
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
      const validationError = this.confirmations.validate(token, name, validationParams);
      if (validationError) {
        this.auditLog(services, name, safety.tier, args, false, 'error', validationError, Date.now() - startTime);
        return {
          content: [{ type: 'text', text: validationError }],
          isError: true,
        };
      }
    }

    // Strip confirmation token before calling tool
    const handlerArgs = { ...args };
    delete handlerArgs._confirmationToken;

    // Call tool registry (which calls the handler)
    // Mark as 'mcp' access since this is the MCP server path
    const result = await this.registry.call(name, handlerArgs, services, 'mcp');

    // Only audit log if tool executed (not unknown/unavailable)
    const errorMessage = result.content[0]?.text || '';
    const isUnknownOrUnavailable = errorMessage.startsWith('Unknown tool:') || errorMessage.startsWith('Tool "') && errorMessage.includes('not currently available');

    if (!isUnknownOrUnavailable) {
      if (result.isError) {
        this.auditLog(services, name, safety.tier, args, safety.tier === 3 ? true : null, 'error', errorMessage, Date.now() - startTime);
      } else {
        this.auditLog(services, name, safety.tier, args, safety.tier === 3 ? true : null, 'success', undefined, Date.now() - startTime);
      }
    }

    return result;
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

  /** Public access to ConfirmationManager for ChatService tier 3 approval flow */
  get confirmationManager(): ConfirmationManager {
    return this.confirmations;
  }
}
