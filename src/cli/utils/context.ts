/**
 * CLI Context - Global state for CLI execution
 *
 * Stores bootstrap result and provides access to connection info
 */

import type { ConnectionInfo } from '../bootstrap/graphql';
import type { BootstrapResult } from '../bootstrap';

let bootstrapResult: BootstrapResult | null = null;

/**
 * Set the bootstrap result (called by main CLI after bootstrap)
 */
export function setBootstrapResult(result: BootstrapResult): void {
  bootstrapResult = result;
}

/**
 * Get the bootstrap result
 */
export function getBootstrapResult(): BootstrapResult {
  if (!bootstrapResult) {
    throw new Error('CLI not initialized. Bootstrap has not been run.');
  }
  return bootstrapResult;
}

/**
 * Get connection info from bootstrap
 */
export function getConnectionInfo(): ConnectionInfo {
  const result = getBootstrapResult();
  if (!result.connectionInfo) {
    throw new Error('Connection info not available. Bootstrap may have failed.');
  }
  return result.connectionInfo;
}
