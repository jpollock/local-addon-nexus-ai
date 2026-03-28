/**
 * CLI Telemetry
 *
 * Records anonymous usage data for CLI commands and transmits to the same
 * Cloudflare Worker as the addon's MCP telemetry — unified analytics with
 * access_method: 'cli' to distinguish CLI from MCP invocations.
 *
 * Shares config.json with the addon so both CLI and MCP use the same
 * installationId — correlating usage from the same machine.
 *
 * Pattern: startTracking() before command, finishTracking() after.
 * Both are called from index.ts — no per-command boilerplate needed.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Shared config location (same as addon main process)
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const ENDPOINT = (process.env.NEXUS_ANALYTICS_ENDPOINT?.replace(/\/$/, '') || 'https://analytics.elasticapi.io') + '/v1/events';
const TIMEOUT_MS = 5000;
const SESSION_ID = crypto.randomUUID();
const ADDON_VERSION: string = require('../../../package.json').version;

const CI_ENV_VARS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'TRAVIS', 'CIRCLECI', 'BUILDKITE'];

// ============================================================================
// Config (read once per transmit — prevents inconsistent IDs across calls)
// ============================================================================

interface TelemetryConfig {
  installationId?: string;
  secretKey?: string;
  registeredAt?: string;
  telemetry?: { enabled: boolean };
}

function readConfig(): TelemetryConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (raw.installationId && raw.secretKey) return raw;
    }
  } catch { /* corrupted — fall through */ }
  return {};
}

function isEnabled(): boolean {
  if (process.env.NEXUS_TELEMETRY === '0') return false;
  if (process.env.NEXUS_TELEMETRY === '1') return true;
  if (CI_ENV_VARS.some((v) => process.env[v])) return false;
  return readConfig().telemetry?.enabled !== false; // default: enabled
}

// ============================================================================
// HMAC signing (same algorithm as addon and Cloudflare Worker)
// ============================================================================

function signData(data: string, secretKey: string): string {
  const key = Buffer.from(secretKey, 'base64');
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

// ============================================================================
// Transmission
// ============================================================================

async function transmit(commandName: string, durationMs: number, success: boolean, errorCategory?: string): Promise<void> {
  // Read config once — consistent installationId + secretKey throughout
  const config = readConfig();
  if (!config.installationId || !config.secretKey) return; // no config yet — skip

  const event = {
    installation_id: config.installationId,
    session_id: SESSION_ID,
    addon_version: ADDON_VERSION,
    os: process.platform,
    node_version: process.version,
    event_type: 'tool_call',
    timestamp: new Date().toISOString(),
    tool_name: commandName,
    access_method: 'cli' as const,
    success,
    duration_ms: Math.round(durationMs),
    ...(errorCategory ? { error_category: errorCategory } : {}),
  };

  const body = JSON.stringify(event);
  const signature = signData(body, config.secretKey);
  const isFirstRequest = !config.registeredAt;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Installation-Id': config.installationId,
    'X-Signature': signature,
  };
  if (isFirstRequest) {
    headers['X-Secret-Key'] = config.secretKey;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, { method: 'POST', headers, body, signal: controller.signal });
    if (response.ok && isFirstRequest) {
      // Mark registered so we stop sending X-Secret-Key
      try {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        raw.registeredAt = new Date().toISOString();
        const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf-8');
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, CONFIG_PATH);
      } catch { /* best-effort */ }
    }
  } catch { /* never block CLI */ } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Public API — startTracking / finishTracking
// ============================================================================

let _startTime: number | null = null;
let _commandName: string | null = null;

/** Call before program.parseAsync() with the derived command name. */
export function startTracking(commandName: string): void {
  _startTime = Date.now();
  _commandName = commandName;
}

/**
 * Call after program.parseAsync() — records and transmits the event.
 * Awaiting this ensures the HTTP request completes before process exit.
 */
export async function finishTracking(success: boolean, errorCategory?: string): Promise<void> {
  if (!isEnabled() || !_startTime || !_commandName) return;
  const duration = Date.now() - _startTime;
  await transmit(_commandName, duration, success, errorCategory).catch(() => {});
  _startTime = null;
  _commandName = null;
}

/**
 * Derive a clean command name from process.argv.
 * ['nexus', 'ai', 'config', '--gateway', 'on'] → 'ai.config'
 * ['nexus', 'sites', 'list'] → 'sites.list'
 */
export function deriveCommandName(): string {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  return args.slice(0, 2).join('.') || 'unknown';
}
