import { McpToolHandler, McpToolDefinition, McpToolResult, NexusServices } from './types';
import { createLogger } from '../logging/Logger';
import { getMetrics } from '../telemetry/MetricsCollector';
import { getToolSafety } from './safety';

const logger = createLogger('ToolRegistry');
const metrics = getMetrics();

/**
 * Record an external host in the fleet after a successful command against it.
 *
 * With registration deferred to Plan B2, this is how an external site first
 * appears: use it once and it joins. Only successful calls qualify, so a
 * typo'd alias does not litter the fleet with unreachable hosts.
 *
 * Never throws. Persistence is a side benefit of a command the user already
 * got the answer to; a storage fault must not turn a successful call into a
 * failed one. Same discipline as the audit write beside it.
 */
export async function maybeUpsertExternalSite(
  args: Record<string, unknown>,
  succeeded: boolean,
  registryStorage: { get(k: string): unknown; set(k: string, v: unknown): void } | null | undefined,
  graphService: { upsertSite(site: any): Promise<void> } | null | undefined,
): Promise<void> {
  try {
    if (!succeeded) return;
    const sshTarget = typeof args.ssh_target === 'string' ? args.ssh_target : undefined;
    if (!sshTarget || !registryStorage || !graphService) return;

    const { parseTarget } = require('../../common/target');
    const parsed = parseTarget(sshTarget);
    if (parsed.type !== 'external' || !parsed.alias) return;

    const { externalSiteId, upsertExternalProfile } = require('../external/externalSiteStore');
    const now = Date.now();
    const wpPath = typeof args.wp_path === 'string' ? args.wp_path : undefined;

    upsertExternalProfile(registryStorage, {
      alias: parsed.alias,
      wpPath,
      environment: parsed.environment,
      firstSeenAt: now,
      lastSeenAt: now,
    });

    await graphService.upsertSite({
      id: externalSiteId(parsed.alias),
      name: parsed.alias,
      // No domain is known without querying the site; the alias is the stable
      // human-facing identifier until B2's registration probe can fill it in.
      domain: parsed.alias,
      source: 'external',
      host: 'external',
      environment: parsed.environment,
      is_active: true,
      created_at: now,
      updated_at: now,
      last_sync_at: now,
    });
  } catch {
    // Deliberately swallowed — see the docblock.
  }
}

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

      // Durable trail — Tier 2 (modifying) and Tier 3 (destructive) only. Tier
      // 1 is read-only and would swamp the file with no compliance value.
      // This is the single funnel every dispatch surface routes through
      // (McpSafetyWrapper, CLI/GraphQL resolvers, ChatService, and
      // agent-internal tool calls via NexusToolProvider), so it is the one
      // place that owns the durable write — do not duplicate it upstream.
      // Wrapped: a throw here would convert a *successful* tool call into an
      // error result via the catch below. Auditing must never change outcomes.
      // `content` is optional-chained — a handler may return `{ isError: true }`
      // with no content array at all.
      try {
        const tier = getToolSafety(name).tier;
        if (tier >= 2) {
          services.operationAuditLog?.log({
            operation: name,
            target: String(args.site ?? args.install_id ?? args.install_name ?? args.ssh_target ?? 'unknown'),
            parameters: { ...args, _tier: tier, _durationMs: duration, _accessMethod: accessMethod ?? 'unknown' },
            outcome: result.isError ? 'failure' : 'success',
            error: result.isError ? (result.content?.[0]?.text || 'Unknown error') : undefined,
          });
        }
      } catch { /* never throw from an audit path */ }

      await maybeUpsertExternalSite(
        args as Record<string, unknown>,
        true,
        (services as any).registryStorage,
        (services as any).graphService,
      );

      logger.debug(`Handler "${name}" completed in ${duration}ms`, { isError: result.isError });
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      // Record error metrics
      metrics.recordToolCall(name, duration, true, accessMethod);

      // Durable trail for unhandled exceptions. A Tier 2/3 operation that
      // throws mid-execution (an unhandled exception in a WPE API client, a
      // handler bug) must still leave a trace — this is the case an operator
      // investigating an incident needs most, and it was silently uncovered
      // by the success-path-only write above. Mirrors that write exactly,
      // using the thrown error's message.
      //
      // Wrapped: this sits in the catch branch, so a throw here escapes call()
      // and rejects the promise instead of returning the error result the
      // caller expects.
      try {
        const tier = getToolSafety(name).tier;
        if (tier >= 2) {
          services.operationAuditLog?.log({
            operation: name,
            target: String(args.site ?? args.install_id ?? args.install_name ?? args.ssh_target ?? 'unknown'),
            parameters: { ...args, _tier: tier, _durationMs: duration, _accessMethod: accessMethod ?? 'unknown' },
            outcome: 'failure',
            error: message,
          });
        }
      } catch { /* never throw from an audit path */ }

      logger.error(`Error in handler "${name}"`, { message, stack: err instanceof Error ? err.stack : undefined });
      return {
        content: [{ type: 'text', text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  }
}
