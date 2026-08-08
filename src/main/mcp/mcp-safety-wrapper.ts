import { ToolRegistry } from './tool-registry';
import { McpToolResult, NexusServices } from './types';
import { getToolSafety, ConfirmationManager, isConfirmationValidationError } from './safety';
import { createLogger } from '../logging/Logger';

const logger = createLogger('McpSafetyWrapper');

/**
 * MCP Safety Wrapper
 *
 * Wraps the tool registry with MCP-specific safety enforcement:
 * - Audit logging for all tool executions
 * - Rate limiting (future)
 *
 * The Tier 3 confirmation token flow itself now lives in
 * `ToolRegistry.call()` (see `checkTierThreeConfirmation` in `safety.ts`), so
 * it cannot be bypassed by a caller that reaches the registry directly. This
 * wrapper only adds MCP-specific audit logging on top of that shared gate.
 *
 * This layer is ONLY used by the MCP server for Claude chat interactions.
 * GraphQL/CLI call `ToolRegistry.call()` directly and are gated by the same
 * shared Tier 3 confirmation check inside it — they are not exempt from it,
 * and do not re-implement their own confirmation logic; a CLI terminal
 * prompt, when one exists, is layered on top of (not instead of) that gate.
 */
export class McpSafetyWrapper {
  constructor(private registry: ToolRegistry) {}

  /**
   * Execute a tool with MCP-specific safety enforcement.
   *
   * - Tier 1: Execute immediately
   * - Tier 2: Execute and audit-log
   * - Tier 3: Require confirmation token (generate → validate → execute) —
   *   enforced inside `ToolRegistry.call()`, detected here from the response
   *   shape so the audit log can still record 'confirmation_required'.
   */
  async callWithSafety(
    name: string,
    args: Record<string, unknown>,
    services: NexusServices,
  ): Promise<McpToolResult> {
    logger.debug(`callWithSafety: name="${name}"`, { args });
    const safety = getToolSafety(name);
    const startTime = Date.now();

    // Call tool registry (which calls the handler). Pass the ORIGINAL args
    // (with _confirmationToken still present, if any) — call() needs to see
    // it to run the tier-3 gate itself.
    const result = await this.registry.call(name, args, services, 'mcp');

    // Only audit log if tool executed (not unknown/unavailable)
    const errorMessage = result.content[0]?.text || '';
    const isUnknownOrUnavailable = errorMessage.startsWith('Unknown tool:') || errorMessage.startsWith('Tool "') && errorMessage.includes('not currently available');

    if (isUnknownOrUnavailable) {
      return result;
    }

    // Detect the "please confirm" shape checkTierThreeConfirmation() returns,
    // so this still logs 'confirmation_required' instead of 'success'/'error'.
    // Gated on tier === 3: only a Tier-3 tool can ever produce this response
    // shape for real, so a Tier 1/2 tool that coincidentally returns JSON
    // shaped like { requiresConfirmation: true, ... } (e.g. echoing back an
    // argument) can't be misfiled as a confirmation prompt.
    if (safety.tier === 3 && !result.isError) {
      const text = result.content[0]?.text;
      if (typeof text === 'string') {
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.requiresConfirmation === true) {
            this.auditLog(services, name, safety.tier, args, null, 'confirmation_required', undefined, Date.now() - startTime);
            return result;
          }
        } catch {
          // Not JSON — a normal tool result, fall through to success logging.
        }
      }
    }

    if (result.isError) {
      // A Tier-3 error is NOT always "confirmed then the handler failed" --
      // checkTierThreeConfirmation() also returns isError: true when the gate
      // itself rejects the token (invalid/expired/mismatched params). That
      // case must log confirmed: false, not true, or the audit trail records
      // a rejected confirmation attempt as if it had succeeded.
      const confirmed = safety.tier === 3
        ? (isConfirmationValidationError(errorMessage) ? false : true)
        : null;
      this.auditLog(services, name, safety.tier, args, confirmed, 'error', errorMessage, Date.now() - startTime);
    } else {
      this.auditLog(services, name, safety.tier, args, safety.tier === 3 ? true : null, 'success', undefined, Date.now() - startTime);
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
    // In-memory trail (live introspection via getEntries()).
    // The durable Tier >= 2 trail is NOT written here: callWithSafety() calls
    // this.registry.call(...) below, and ToolRegistry.call() is the true
    // single funnel for all dispatch surfaces (MCP, CLI/GraphQL, chat), so it
    // owns the durable write. Writing it here too would double-log every
    // MCP-routed tool call.
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

  /**
   * Public access to ConfirmationManager for ChatService tier 3 approval flow.
   * Passthrough to the registry's instance — this is the SAME ConfirmationManager
   * `ToolRegistry.call()` uses internally, so a token generated on one dispatch
   * path (e.g. an agent tool in McpServer.dispatch) validates on the other
   * (a builtin MCP tool routed through this wrapper), and vice versa.
   */
  get confirmationManager(): ConfirmationManager {
    return this.registry.confirmationManager;
  }
}
