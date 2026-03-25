/**
 * Audit Logger
 *
 * Tracks all remote operations (WPE CAPI, remote WP-CLI) for security auditing.
 * Provides accountability for destructive operations on production sites.
 */

import type { RegistryStorage } from '../content/IndexRegistry';

export interface AuditLog {
  timestamp: number;
  operation: string;
  target: string; // site ID, install ID, install name, or resource identifier
  targetType: 'local_site' | 'wpe_install' | 'wpe_site' | 'wpe_account' | 'bulk_operation' | 'database' | 'registry';
  params: Record<string, any>;
  result: 'success' | 'failure' | 'started' | 'in_progress';
  error?: string;
  duration?: number; // milliseconds
  durationMs?: number; // alias for duration (milliseconds)
}

export interface AuditLogFilters {
  operation?: string;
  target?: string;
  targetType?: AuditLog['targetType'];
  result?: 'success' | 'failure';
  since?: number; // timestamp
  until?: number; // timestamp
}

export class AuditLogger {
  private static readonly STORAGE_KEY = 'nexus_audit_logs';
  private static readonly MAX_LOGS = 1000;

  constructor(private storage: RegistryStorage) {}

  /**
   * Log an operation.
   *
   * @param entry - Audit log entry (timestamp added automatically)
   */
  log(entry: Omit<AuditLog, 'timestamp'>): void {
    const logs = this.getLogs();

    const fullEntry: AuditLog = {
      ...entry,
      timestamp: Date.now(),
    };

    logs.push(fullEntry);

    // Keep last MAX_LOGS entries
    if (logs.length > AuditLogger.MAX_LOGS) {
      logs.splice(0, logs.length - AuditLogger.MAX_LOGS);
    }

    this.storage.set(AuditLogger.STORAGE_KEY, logs);
  }

  /**
   * Log a successful operation.
   */
  logSuccess(
    operation: string,
    target: string,
    targetType: AuditLog['targetType'],
    params: Record<string, any> = {},
    duration?: number,
  ): void {
    this.log({
      operation,
      target,
      targetType,
      params,
      result: 'success',
      duration,
    });
  }

  /**
   * Log a failed operation.
   */
  logFailure(
    operation: string,
    target: string,
    targetType: AuditLog['targetType'],
    error: string,
    params: Record<string, any> = {},
    duration?: number,
  ): void {
    this.log({
      operation,
      target,
      targetType,
      params,
      result: 'failure',
      error,
      duration,
    });
  }

  /**
   * Get all audit logs (optionally filtered).
   */
  getLogs(filters?: AuditLogFilters): AuditLog[] {
    const allLogs = (this.storage.get(AuditLogger.STORAGE_KEY) as AuditLog[]) ?? [];

    if (!filters) {
      return allLogs;
    }

    return allLogs.filter((log) => {
      if (filters.operation && log.operation !== filters.operation) {
        return false;
      }

      if (filters.target && log.target !== filters.target) {
        return false;
      }

      if (filters.targetType && log.targetType !== filters.targetType) {
        return false;
      }

      if (filters.result && log.result !== filters.result) {
        return false;
      }

      if (filters.since && log.timestamp < filters.since) {
        return false;
      }

      if (filters.until && log.timestamp > filters.until) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get recent audit logs (last N entries).
   */
  getRecentLogs(count: number = 50): AuditLog[] {
    const logs = this.getLogs();
    return logs.slice(-count);
  }

  /**
   * Get audit logs for a specific target.
   */
  getLogsForTarget(target: string): AuditLog[] {
    return this.getLogs({ target });
  }

  /**
   * Get failed operations (for debugging).
   */
  getFailedOperations(since?: number): AuditLog[] {
    return this.getLogs({ result: 'failure', since });
  }

  /**
   * Clear all audit logs.
   * WARNING: Use only for testing or explicit user request.
   */
  clearLogs(): void {
    this.storage.set(AuditLogger.STORAGE_KEY, []);
  }

  /**
   * Get audit log statistics.
   */
  getStats(): {
    total: number;
    successful: number;
    failed: number;
    byOperation: Record<string, number>;
    byTargetType: Record<string, number>;
  } {
    const logs = this.getLogs();

    const stats = {
      total: logs.length,
      successful: logs.filter((l) => l.result === 'success').length,
      failed: logs.filter((l) => l.result === 'failure').length,
      byOperation: {} as Record<string, number>,
      byTargetType: {} as Record<string, number>,
    };

    for (const log of logs) {
      stats.byOperation[log.operation] = (stats.byOperation[log.operation] || 0) + 1;
      stats.byTargetType[log.targetType] = (stats.byTargetType[log.targetType] || 0) + 1;
    }

    return stats;
  }
}

/**
 * Audit log operations that should always be logged.
 */
export const AUDITED_OPERATIONS = {
  // WPE CAPI - Destructive
  WPE_DELETE_INSTALL: 'wpe_delete_install',
  WPE_DELETE_SITE: 'wpe_delete_site',
  WPE_COPY_INSTALL: 'wpe_copy_install',
  WPE_CREATE_INSTALL: 'wpe_create_install',
  WPE_CREATE_SITE: 'wpe_create_site',

  // WPE CAPI - Sensitive
  WPE_UPDATE_INSTALL: 'wpe_update_install',
  WPE_CREATE_DOMAIN: 'wpe_create_domain',
  WPE_DELETE_DOMAIN: 'wpe_delete_domain',
  WPE_REQUEST_SSL: 'wpe_request_ssl_certificate',

  // Remote WP-CLI
  REMOTE_PLUGIN_INSTALL: 'remote_wp_plugin_install',
  REMOTE_PLUGIN_ACTIVATE: 'remote_wp_plugin_activate',
  REMOTE_PLUGIN_DEACTIVATE: 'remote_wp_plugin_deactivate',
  REMOTE_PLUGIN_UPDATE: 'remote_wp_plugin_update',
  REMOTE_DB_EXPORT: 'remote_wp_db_export',

  // Bulk Operations
  BULK_SETUP_AI: 'bulk_setup_ai',
  BULK_SYNC_CREDENTIALS: 'bulk_sync_credentials',
  BULK_PLUGIN_INSTALL: 'bulk_plugin_install',
} as const;
