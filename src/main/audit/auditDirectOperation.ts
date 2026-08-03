/**
 * auditDirectOperation — the durable-audit entry point for mutating code paths
 * that do NOT route through a dispatch chokepoint.
 *
 * The two chokepoints (`ToolRegistry.call()` and `AgentDispatcher.dispatch()`)
 * cover every MCP tool call. They do not cover the GraphQL resolvers and IPC
 * handlers that call `services.localServices` directly — that is roughly thirty
 * mutating paths, including arbitrary WP-CLI against production WP Engine
 * installs and `DELETE /installs/{id}`.
 *
 * This helper exists so those sites share ONE implementation. Hand-rolling an
 * entry at each site is exactly the per-call-site drift the chokepoint design
 * was built to prevent, and drift is how the original "audit never recorded
 * anything" bug survived. Its value is uniformity, not logic — keep it thin.
 *
 * Redaction (parameters AND error) happens inside `OperationAuditLog.log()`, so
 * no caller can leak a credential by forgetting to redact.
 *
 * Naming: `operation` uses `<surface>.<resource>.<action>`, lowercase and
 * dot-separated — `cli.wp.command`, `wpe.install.delete`, `wpe.user.create`,
 * `ipc.wp.plugin.deactivate`, `bulk.plugin.update`. `target` identifies what
 * was acted on (install name, site id, resource id).
 *
 * No tier gate: only call this for operations that mutate, which makes them
 * Tier 2/3 by nature. Read-only resolvers must not be audited — they would
 * swamp the file with no compliance value.
 */

import type { OperationAuditLog } from './OperationAuditLog';

export interface DirectOperationEntry {
  /** `<surface>.<resource>.<action>` — e.g. `wpe.install.delete`. */
  operation: string;
  /** What was acted on: install name, site id, or other resource identifier. */
  target: string;
  parameters: Record<string, unknown>;
  outcome: 'success' | 'failure';
  error?: string;
}

export interface AuditCapableServices {
  operationAuditLog?: OperationAuditLog;
}

/**
 * Write one durable audit entry for a direct (non-chokepoint) operation.
 * Never throws — a failed audit write must not break the audited operation.
 */
export function auditDirectOperation(
  services: AuditCapableServices | undefined | null,
  entry: DirectOperationEntry,
): void {
  try {
    services?.operationAuditLog?.log(entry);
  } catch {
    // Fail open. `log()` already swallows its own I/O errors; this guards the
    // case where `services` is an exotic proxy or `log` is not a function.
  }
}
