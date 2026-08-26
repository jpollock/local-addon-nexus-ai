import { McpToolHandler, McpToolDefinition, McpToolResult, NexusServices } from './types';
import { createLogger } from '../logging/Logger';
import { getMetrics } from '../telemetry/MetricsCollector';
import { CloudflareTransmitter, ErrorCategory } from '../telemetry/CloudflareTransmitter';
import { getToolSafety, ConfirmationManager, checkTierThreeConfirmation } from './safety';
import { recordGatedAction } from '../intelligence-host/actionProducer';
import { checkCheckpointSequence } from '../intelligence-host/sequenceGuard';
import { parseTarget } from '../../common/target';
import { findExternalSites } from './site-resolver';
import { upsertExternalProfile } from '../external/externalSiteStore';

const logger = createLogger('ToolRegistry');
const metrics = getMetrics();

/**
 * Map a tool failure to a coarse telemetry category (P1-7). Category-only, never the message —
 * so no PII/secret reaches telemetry — turning previously-invisible tool failures into a signal
 * a maintainer can see. `CloudflareTransmitter.recordError` no-ops when telemetry is disabled.
 */
export function categorizeToolError(message: string): ErrorCategory {
  const m = message.toLowerCase();
  if (m.includes('not found')) return 'site_not_found';
  if (m.includes('not running')) return 'site_not_running';
  if (m.includes('timed out') || m.includes('timeout')) return 'timeout';
  if (m.includes('econn') || m.includes('enotfound') || m.includes('network')) return 'network_error';
  if (m.includes('invalid') || m.includes('required') || m.includes('validation')) return 'validation_error';
  return 'unknown';
}

function recordToolError(name: string, message: string): void {
  try {
    CloudflareTransmitter.recordError(categorizeToolError(message), name);
  } catch { /* telemetry must never affect the tool path */ }
}

/**
 * Refresh an external site's freshness after a successful command against it.
 *
 * This is a SIGHTING, not registration: `resolveTransport` already proved the
 * alias/site pair exists and is permitted before the command it gated on ever
 * ran, so by the time this runs there is nothing left to decide — only a
 * lookup of the row that must already be there. If it isn't (a race, or a
 * caller that bypassed `resolveTransport`), there is nothing to sight, and
 * creating one here would be exactly the silent auto-registration this
 * function used to do and no longer may. Registering a *new* host is the
 * explicit picker's job, not a side effect of a read.
 *
 * Never throws. Persistence is a side benefit of a command the user already
 * got the answer to; a storage fault must not turn a successful call into a
 * failed one. Same discipline as the audit write beside it.
 */
export async function maybeUpsertExternalSite(
  args: Record<string, unknown>,
  succeeded: boolean,
  registryStorage: { get(k: string): unknown; set(k: string, v: unknown): void } | null | undefined,
  graphService: { upsertSite(site: any): Promise<void>; getDb?: () => any } | null | undefined,
): Promise<void> {
  try {
    if (!succeeded) return;
    const sshTarget = typeof args.ssh_target === 'string' ? args.ssh_target : undefined;
    if (!sshTarget || !registryStorage || !graphService) return;

    const parsed = parseTarget(sshTarget);
    if (parsed.type !== 'external' || !parsed.alias) return;

    const db = graphService.getDb?.();
    // A successful call already proves the site resolved in resolveTransport,
    // so this is a lookup of something that must already exist — not a guess.
    // If it comes back empty (a race, or a call bypassing resolveTransport),
    // there is nothing to sight: creating a row here is exactly the silent
    // auto-registration this function used to do and no longer should.
    const sites = findExternalSites(db, parsed.alias, parsed.site, 'id, name, domain, environment');
    if (sites.length !== 1) return;
    const site = sites[0];

    const now = Date.now();

    // Preserve the existing domain — a sighting has nothing better than what
    // registration already discovered.
    let domain = site.domain;
    if (!domain) domain = site.name;

    await graphService.upsertSite({
      id: site.id,
      name: site.name,
      domain,
      source: 'external',
      host: 'external',
      account_id: parsed.alias,
      environment: site.environment,
      is_active: true,
      created_at: now,
      updated_at: now,
      last_sync_at: now,
    });

    // Connection-level freshness — this alias is still reachable.
    upsertExternalProfile(registryStorage, {
      alias: parsed.alias,
      firstSeenAt: now,
      lastSeenAt: now,
    } as any);
  } catch {
    // Never let a sighting failure affect the caller's actual result.
  }
}

/**
 * Central registry for MCP tools. Modules register handlers during startup.
 *
 * `call()` IS the safety chokepoint: Tier 3 confirmation gating
 * (`checkTierThreeConfirmation`) and durable audit logging to
 * `operation-audit.log` both live inside it, on both the success and catch
 * paths. Every caller goes through the same gate:
 * - MCP server (chat interface) via `McpSafetyWrapper`, which calls `call()`
 *   underneath it (and only logs in-memory itself, to avoid double-logging)
 * - CLI commands (sync.ts, etc)
 * - GraphQL resolvers — these call `registry.call()` directly, and are gated
 *   the same as every other caller, not exempt from it
 */
export class ToolRegistry {
  private handlers = new Map<string, McpToolHandler>();
  readonly confirmationManager = new ConfirmationManager();

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
   * Execute a tool by name.
   *
   * Enforces the Tier-3 confirmation gate itself (see `checkTierThreeConfirmation`
   * in `safety.ts`) so it cannot be bypassed by a caller that reaches the
   * registry directly — this used to be delegated entirely to the interface
   * layer (McpSafetyWrapper for MCP; CLI commands and GraphQL resolvers
   * handling it themselves, or not at all), which meant a Tier-3 tool invoked
   * through a caller that forgot the wrapper executed with zero confirmation
   * check. Callers that already obtained a human confirmation through some
   * other channel (a CLI y/n prompt, a chat UI approval click) pass
   * `requireConfirmation: false` to skip the gate rather than re-confirming.
   *
   * @param accessMethod - 'mcp' if called from MCP server, 'cli' if called from CLI/GraphQL, 'agent' if called from an agent tool loop (NexusToolProvider, AiProxyServer)
   * @param requireConfirmation - defaults to true; pass false only when the caller has already obtained an equivalent human confirmation through its own interface (see checkTierThreeConfirmation's doc comment for the residual gap this leaves for accessMethod: 'agent')
   * @param runId - optional agent run identifier, joins operation-audit.log to the diagnostic log
   * @param task - optional task moment (WP-19): the turn's TaskId becomes the ledger
   *   `correlation`, and `causation` chains this act to the approval that authorised it. An
   *   OBJECT rather than two more positional strings, because two adjacent optional strings
   *   after a boolean gate is a transposition waiting to happen.
   */
  async call(
    name: string,
    args: Record<string, unknown>,
    services: NexusServices,
    accessMethod?: 'mcp' | 'cli' | 'agent' | 'chat',
    // Position 5 stays the confirmation gate: two callers already pass it positionally, and
    // demoting a safety parameter below an optional diagnostic id invites passing a runId
    // where a `false` was meant. runId is appended instead.
    requireConfirmation: boolean = true,
    runId?: string,
    /**
     * WP-57 · the caller's task moment, and — when the caller knows it — WHO
     * is acting. The actor rides HERE rather than as a new positional
     * parameter, because this file is audit chokepoint one and widening an
     * object it already accepts is the smallest change that closes the
     * collapsed-actor gap.
     */
    task?: { id?: string; causation?: string; actor?: { id: string; kind: 'agent' } },
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

    const safety = getToolSafety(name);
    let handlerArgs = args;
    if (requireConfirmation) {
      const gate = checkTierThreeConfirmation(name, args, safety.tier, safety.confirmationMessage, safety.preChecks, this.confirmationManager);
      if (gate.blocked) {
        // Durable trail for a blocked Tier-3 attempt -- this matters most for
        // the callers that reach call() directly (GraphQL resolvers, agent
        // tool loops, AiProxyServer): without this, a Tier-3 tool invoked
        // through one of them with no/invalid confirmation left no record at
        // all. Mirrors nexusWpCommand's convention of auditing a refusal as
        // outcome: 'failure'.
        try {
          const blockedText = gate.response?.content?.[0]?.text;
          services.operationAuditLog?.log({
            operation: name,
            target: String(args.site ?? args.install_id ?? args.install_name ?? args.ssh_target ?? 'unknown'),
            parameters: { ...args, _tier: safety.tier, _accessMethod: accessMethod ?? 'unknown' },
            outcome: 'failure',
            error: gate.response?.isError
              ? (blockedText || 'confirmation rejected')
              : 'blocked: tier-3 confirmation required, no valid _confirmationToken provided',
          });
        } catch { /* never throw from an audit path */ }
        return gate.response!;
      }
      handlerArgs = gate.cleanedArgs!;
    }

    // WP-20d · the checkpoint sequence gate, for a tool an ARMED STRICT runbook
    // claims. Placed with the Tier-3 gate and before execution, because it is a
    // gate: the gate blocks, the audit records, and the order between them is
    // the doctrine WP-19 wrote down. Returns null for every call on every
    // surface until a capability is armed, so the unarmed path below is
    // instruction-for-instruction what it was.
    const sequence = checkCheckpointSequence(name, task?.id);
    if (sequence) {
      // Same convention as the blocked Tier-3 attempt above: a refused gated
      // call leaves a durable trail, or the compliance record shows only the
      // calls that were allowed to happen.
      try {
        services.operationAuditLog?.log({
          operation: name,
          target: String(args.site ?? args.install_id ?? args.install_name ?? args.ssh_target ?? 'unknown'),
          parameters: { ...args, _tier: safety.tier, _accessMethod: accessMethod ?? 'unknown' },
          outcome: 'failure',
          error: sequence.message,
        });
      } catch { /* never throw from an audit path */ }
      // Deliberately NO `task.action.executed`: the call did not execute, and
      // WP-19's producer says a refusal is not an act.
      return { content: [{ type: 'text', text: sequence.message }], isError: true };
    }

    // Execute handler (Tier 3 confirmation, if required, already gated above)
    try {
      logger.debug(`Executing handler for "${name}"`);
      const result = await handler.execute(handlerArgs, services);
      const duration = Date.now() - startTime;

      // Record metrics with access method
      metrics.recordToolCall(name, duration, result.isError || false, accessMethod);
      if (result.isError) {
        recordToolError(name, result.content?.[0]?.text || 'Unknown error');
      }

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
            runId,
          });
        }
      } catch { /* never throw from an audit path */ }

      // WP-19 · the same act, on the episodic spine. Deliberately AFTER the
      // execution and after the audit write, and with its own internal
      // guarding: the gate blocks, the audit records. An emission that could
      // prevent or alter a call would have inverted that order.
      recordGatedAction({
        toolName: name,
        args,
        services,
        accessMethod,
        dispatch: 'registry',
        taskId: task?.id,
        causation: task?.causation,
        // WP-57 · absent for every caller that does not know, which is the
        // parity floor: `actorFor` falls back to its existing inference.
        actor: task?.actor,
        outcome: result.isError ? 'failure' : 'success',
        error: result.isError ? (result.content?.[0]?.text || 'Unknown error') : undefined,
        durationMs: duration,
      });

      await maybeUpsertExternalSite(
        args as Record<string, unknown>,
        !result.isError,
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
      recordToolError(name, message);

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
            runId,
          });
        }
      } catch { /* never throw from an audit path */ }

      // WP-19 · the failure side. An act that threw mid-execution is the case
      // an incident review needs most, and it is the one a success-path-only
      // producer would silently omit — the same defect the audit write above
      // was extended to cover.
      recordGatedAction({
        toolName: name,
        args,
        services,
        accessMethod,
        dispatch: 'registry',
        taskId: task?.id,
        causation: task?.causation,
        // WP-57 · absent for every caller that does not know, which is the
        // parity floor: `actorFor` falls back to its existing inference.
        actor: task?.actor,
        outcome: 'failure',
        error: message,
        durationMs: duration,
      });

      logger.error(`Error in handler "${name}"`, { message, stack: err instanceof Error ? err.stack : undefined });
      return {
        content: [{ type: 'text', text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  }
}
