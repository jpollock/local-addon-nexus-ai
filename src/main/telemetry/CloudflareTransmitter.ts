/**
 * Cloudflare Telemetry Transmitter
 *
 * Transmits anonymous usage data to Cloudflare Workers for analytics.
 * Pattern based on lwp CLI analytics with HMAC-SHA256 authentication.
 *
 * Privacy:
 * - Only transmits anonymous metrics (tool names, durations, success/error)
 * - Never transmits: site names, domains, WordPress data, arguments, PII
 * - Uses installation ID (random UUID), not user identity
 * - HMAC-signed requests for authentication
 * - Fire-and-forget: never blocks addon operation
 */

import * as crypto from 'crypto';
import {
  isTelemetryEnabled,
  getInstallationId,
  getSecretKey,
  isRegistered,
  markAsRegistered,
  getAnalyticsEndpoint,
  appendEvent,
} from './telemetry-config';
import { createLogger } from '../logging/Logger';

const logger = createLogger('CloudflareTransmitter');

// ============================================================================
// Types
// ============================================================================

export interface TelemetryEvent {
  // Identity
  installation_id: string;      // Random UUID (not user ID)
  session_id: string;            // Per-Local-restart UUID

  // System info
  addon_version: string;         // Nexus AI version
  local_version?: string;        // Local app version
  os: string;                    // 'darwin', 'win32', 'linux'
  node_version: string;          // Node runtime version

  // Event data
  event_type: string;            // 'tool_call', 'health_check', 'error'
  timestamp: string;             // ISO 8601

  // Tool call metrics (if event_type='tool_call')
  tool_name?: string;            // 'wp_plugin_list', 'search_site_content'
  access_method?: 'mcp' | 'cli'; // How was tool invoked
  success?: boolean;             // Did it succeed?
  duration_ms?: number;          // How long did it take?
  error_category?: string;       // 'site_not_found', 'timeout', etc.

  // Health metrics (if event_type='health_check')
  memory_mb?: number;            // RSS memory usage
  health_status?: string;        // 'healthy', 'degraded', 'unhealthy'
  active_sites?: number;         // Number of indexed sites

  // Performance metrics (if event_type='performance')
  operation?: string;            // 'fleet_summary', 'search'
  operation_duration_ms?: number;
}

export type ErrorCategory =
  | 'site_not_found'
  | 'site_not_running'
  | 'timeout'
  | 'network_error'
  | 'validation_error'
  | 'unknown';

// ============================================================================
// Constants
// ============================================================================

const TRANSMISSION_TIMEOUT = 5000; // 5 seconds
const ADDON_VERSION = require('../../../package.json').version;

// Event exclusions (privacy-sensitive operations)
const EXCLUDED_PREFIXES = [
  'wpe_',             // WP Engine CAPI calls (may contain account info)
  'wp_db_',           // Database operations (privacy)
  'wp_search_replace', // May contain site data
  'wp_user_',         // User operations (privacy)
];

// Session ID generated once per addon load
let SESSION_ID: string | null = null;

function getSessionId(): string {
  if (!SESSION_ID) {
    SESSION_ID = crypto.randomUUID();
  }
  return SESSION_ID;
}

// ============================================================================
// HMAC Signing
// ============================================================================

/**
 * Sign data with HMAC-SHA256
 *
 * Pattern from lwp CLI:
 * - secretKey is base64-encoded 32 random bytes
 * - Convert to buffer before HMAC
 * - Output hex digest
 */
function signData(data: string, secretKey: string): string {
  const key = Buffer.from(secretKey, 'base64');
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

// ============================================================================
// Event Filtering
// ============================================================================

function isEventExcluded(event: TelemetryEvent): boolean {
  // Check if tool name matches excluded prefixes
  if (event.event_type === 'tool_call' && event.tool_name) {
    return EXCLUDED_PREFIXES.some((prefix) => event.tool_name!.startsWith(prefix));
  }
  return false;
}

// ============================================================================
// Event Transmission
// ============================================================================

/**
 * Transmit event to Cloudflare Worker with HMAC signature
 *
 * Fire-and-forget: never blocks or throws errors.
 * On first request, sends secretKey via X-Secret-Key header for server storage.
 * Subsequent requests use X-Signature for HMAC verification.
 */
async function transmitEvent(event: TelemetryEvent): Promise<void> {
  try {
    const installationId = getInstallationId();
    const secretKey = getSecretKey();
    const firstRequest = !isRegistered();

    const body = JSON.stringify(event);
    const signature = signData(body, secretKey);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Installation-Id': installationId,
      'X-Signature': signature,
    };

    // On first request, send secretKey so server can store it
    if (firstRequest) {
      headers['X-Secret-Key'] = secretKey;
      logger.debug('First telemetry request - sending secret key');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSMISSION_TIMEOUT);

    const endpoint = getAnalyticsEndpoint();
    logger.debug('Transmitting telemetry event', {
      endpoint,
      event_type: event.event_type,
      tool_name: event.tool_name,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // If successful and this was first request, mark as registered
    if (response.ok && firstRequest) {
      markAsRegistered();
      logger.info('Telemetry registration successful');
    }

    if (!response.ok) {
      logger.warn('Telemetry transmission failed', {
        status: response.status,
        statusText: response.statusText,
      });
    }
  } catch (err: any) {
    // Silently ignore transmission errors - never block addon
    logger.debug('Telemetry transmission error (ignored)', {
      error: err.message,
    });
  }
}

// ============================================================================
// Public API
// ============================================================================

export class CloudflareTransmitter {
  /**
   * Record and transmit a telemetry event
   *
   * Event is:
   * 1. Checked against enabled flag
   * 2. Checked against exclusion list
   * 3. Appended to local queue (JSONL file)
   * 4. Transmitted to Cloudflare (fire-and-forget)
   *
   * Never throws or blocks addon operation.
   */
  static recordEvent(event: Partial<TelemetryEvent>): void {
    try {
      // Check if telemetry is enabled
      if (!isTelemetryEnabled()) {
        return;
      }

      // Build complete event
      const fullEvent: TelemetryEvent = {
        installation_id: getInstallationId(),
        session_id: getSessionId(),
        addon_version: ADDON_VERSION,
        os: process.platform,
        node_version: process.version,
        timestamp: new Date().toISOString(),
        event_type: event.event_type || 'unknown',
        ...event,
      };

      // Check exclusions
      if (isEventExcluded(fullEvent)) {
        logger.debug('Telemetry event excluded', { tool_name: fullEvent.tool_name });
        return;
      }

      // Append to local queue
      appendEvent(fullEvent);

      // Transmit to server (fire-and-forget)
      transmitEvent(fullEvent).catch(() => {
        // Ignore transmission errors
      });
    } catch (err: any) {
      // Never let telemetry errors affect addon operation
      logger.debug('Telemetry error (ignored)', { error: err.message });
    }
  }

  /**
   * Record a tool call event
   */
  static recordToolCall(
    toolName: string,
    durationMs: number,
    success: boolean,
    accessMethod?: 'mcp' | 'cli',
    errorCategory?: ErrorCategory,
  ): void {
    this.recordEvent({
      event_type: 'tool_call',
      tool_name: toolName,
      access_method: accessMethod,
      duration_ms: durationMs,
      success,
      error_category: errorCategory,
    });
  }

  /**
   * Record a health check event
   */
  static recordHealthCheck(
    memoryMb: number,
    healthStatus: 'healthy' | 'degraded' | 'unhealthy',
    activeSites: number,
  ): void {
    this.recordEvent({
      event_type: 'health_check',
      memory_mb: memoryMb,
      health_status: healthStatus,
      active_sites: activeSites,
    });
  }

  /**
   * Record a performance event
   */
  static recordPerformance(operation: string, durationMs: number): void {
    this.recordEvent({
      event_type: 'performance',
      operation,
      operation_duration_ms: durationMs,
    });
  }

  /**
   * Record an error event
   */
  static recordError(errorCategory: ErrorCategory, toolName?: string): void {
    this.recordEvent({
      event_type: 'error',
      tool_name: toolName,
      success: false,
      error_category: errorCategory,
    });
  }
}
