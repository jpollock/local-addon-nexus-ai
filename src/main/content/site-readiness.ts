/**
 * Site Readiness Check
 *
 * Centralized validation that a Local site is truly ready for automatic work
 * (indexing, setup-ai, etc). Prevents "Access denied" MySQL errors by validating
 * site exists, status=running, path exists, and MySQL accepts connections.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LocalServicesBridge } from '../mcp/local-services-bridge';
import type { MySQLExtractor } from './MySQLExtractor';

export interface ReadinessResult {
  ready: boolean;
  reason?: string;
}

/**
 * Check if a site is ready for automatic operations.
 *
 * Validates in fail-fast order:
 * 1. Site exists in Local state
 * 2. Site status is 'running'
 * 3. Site path exists on filesystem
 * 4. MySQL connection works (if mysqlExtractor provided)
 *
 * @param siteId Local site ID
 * @param localServices Local services bridge
 * @param mysqlExtractor Optional MySQL extractor for connection testing
 * @returns Ready status with reason if not ready
 */
export async function isSiteReady(
  siteId: string,
  localServices: LocalServicesBridge,
  mysqlExtractor?: MySQLExtractor,
): Promise<ReadinessResult> {
  // 1. Site exists check
  const site = localServices.getSite(siteId);
  if (!site) {
    return {
      ready: false,
      reason: 'Site not found in Local state',
    };
  }

  // 2. Status check - only 'running' is accepted
  if (site.status !== 'running') {
    return {
      ready: false,
      reason: `Site status: ${site.status}`,
    };
  }

  // 3. Filesystem check
  if (!fs.existsSync(site.path)) {
    return {
      ready: false,
      reason: 'Site path does not exist',
    };
  }

  // 4. MySQL connection test (if extractor provided)
  if (mysqlExtractor) {
    // Check socket exists first
    if (!mysqlExtractor.isAvailable(siteId)) {
      return {
        ready: false,
        reason: 'MySQL socket does not exist',
      };
    }

    // Attempt actual connection with wp-config.php from site path
    const wpConfigPath = path.join(site.path, 'app', 'public', 'wp-config.php');
    const connected = await mysqlExtractor.testConnection(siteId, wpConfigPath);
    if (!connected) {
      return {
        ready: false,
        reason: 'MySQL not accepting connections',
      };
    }
  }

  // All checks passed
  return { ready: true };
}
