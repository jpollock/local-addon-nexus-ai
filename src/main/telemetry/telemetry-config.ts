/**
 * Telemetry Configuration Management
 *
 * Manages installation ID, secret key, and telemetry opt-in status.
 * Pattern based on lwp CLI analytics configuration.
 *
 * Privacy:
 * - installationId: Random UUID (not tied to user identity)
 * - secretKey: Random 32 bytes for HMAC signing (never transmitted after registration)
 * - All config files stored with 0600 permissions (user read/write only)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface TelemetryConfig {
  installationId: string;     // Random UUID identifies this installation
  secretKey: string;          // Random 32 bytes (base64) for HMAC signing
  registeredAt?: string;      // When first synced to Cloudflare server
  telemetry: {
    enabled: boolean;         // Default: true (opt-out model)
    promptedAt: string | null;
  };
}

// ============================================================================
// Constants
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const EVENTS_DIR = path.join(CONFIG_DIR, 'telemetry');
const EVENTS_PATH = path.join(EVENTS_DIR, 'events.jsonl');

// Environment variable overrides
const ENV_TELEMETRY = process.env.NEXUS_TELEMETRY; // '0' or '1'
const ENV_ENDPOINT = process.env.NEXUS_ANALYTICS_ENDPOINT;

// CI environments where telemetry is auto-disabled
const CI_ENV_VARS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'JENKINS_URL',
  'TRAVIS',
  'CIRCLECI',
  'BUILDKITE',
];

// ============================================================================
// Path Accessors (for testability)
// ============================================================================

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getEventsDir(): string {
  return EVENTS_DIR;
}

export function getEventsPath(): string {
  return EVENTS_PATH;
}

export function getAnalyticsEndpoint(): string {
  const base = ENV_ENDPOINT || 'https://nexus-analytics.jeremy7746.workers.dev';
  return base.replace(/\/$/, '') + '/v1/events';
}

// ============================================================================
// Directory Management
// ============================================================================

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

// ============================================================================
// ID and Key Generation
// ============================================================================

export function generateInstallationId(): string {
  return crypto.randomUUID();
}

export function generateSecretKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

// ============================================================================
// Config Read/Write
// ============================================================================

export function readConfig(): TelemetryConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(data);

      // Validate structure
      if (typeof config.telemetry?.enabled === 'boolean') {
        let needsWrite = false;

        // Ensure installationId exists (migrate from old configs)
        if (!config.installationId) {
          config.installationId = generateInstallationId();
          needsWrite = true;
        }

        // Ensure secretKey exists
        if (!config.secretKey) {
          config.secretKey = generateSecretKey();
          needsWrite = true;
        }

        if (needsWrite) {
          writeConfig(config);
        }

        return config;
      }
    }
  } catch {
    // Corrupted config, will regenerate
  }

  // Default: enabled (opt-out model) with new credentials
  return {
    installationId: generateInstallationId(),
    secretKey: generateSecretKey(),
    telemetry: { enabled: true, promptedAt: null },
  };
}

export function writeConfig(config: TelemetryConfig): void {
  ensureDir(CONFIG_DIR);

  // Atomic write: temp file + rename
  const tempPath = `${CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8');
  fs.chmodSync(tempPath, 0o600); // User read/write only
  fs.renameSync(tempPath, CONFIG_PATH);
}

// ============================================================================
// Config Accessors
// ============================================================================

export function getInstallationId(): string {
  return readConfig().installationId;
}

export function getSecretKey(): string {
  return readConfig().secretKey;
}

export function markAsRegistered(): void {
  const config = readConfig();
  config.registeredAt = new Date().toISOString();
  writeConfig(config);
}

export function isRegistered(): boolean {
  return !!readConfig().registeredAt;
}

// ============================================================================
// Telemetry Enabled/Disabled
// ============================================================================

export function isTelemetryEnabled(): boolean {
  // Environment variable override
  if (ENV_TELEMETRY === '0') return false;
  if (ENV_TELEMETRY === '1') return true;

  // Auto-disable in CI environments
  if (CI_ENV_VARS.some((v) => process.env[v])) return false;

  // Use config value
  return readConfig().telemetry.enabled;
}

export function setTelemetryEnabled(enabled: boolean): void {
  const config = readConfig();
  config.telemetry.enabled = enabled;
  config.telemetry.promptedAt = config.telemetry.promptedAt || new Date().toISOString();
  writeConfig(config);
}

export function hasBeenPrompted(): boolean {
  return readConfig().telemetry.promptedAt !== null;
}

// ============================================================================
// Events File Management
// ============================================================================

export const MAX_EVENTS = 10000;

export function ensureEventsDir(): void {
  ensureDir(EVENTS_DIR);
}

export function rotateEventsIfNeeded(): void {
  const eventsPath = getEventsPath();
  if (!fs.existsSync(eventsPath)) return;

  const content = fs.readFileSync(eventsPath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  if (lines.length >= MAX_EVENTS) {
    // Keep newest 80%
    const keepCount = Math.floor(MAX_EVENTS * 0.8);
    const toKeep = lines.slice(-keepCount);
    fs.writeFileSync(eventsPath, toKeep.join('\n') + '\n', 'utf-8');
    fs.chmodSync(eventsPath, 0o600);
  }
}

export function appendEvent(event: any): void {
  ensureEventsDir();
  rotateEventsIfNeeded();

  const line = JSON.stringify(event) + '\n';
  fs.appendFileSync(getEventsPath(), line, 'utf-8');
  fs.chmodSync(getEventsPath(), 0o600);
}

export function readEvents(): any[] {
  try {
    const eventsPath = getEventsPath();
    if (!fs.existsSync(eventsPath)) return [];

    const content = fs.readFileSync(eventsPath, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function clearEvents(): void {
  try {
    const eventsPath = getEventsPath();
    if (fs.existsSync(eventsPath)) {
      fs.unlinkSync(eventsPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Reset Analytics
// ============================================================================

export function resetAnalytics(): void {
  clearEvents();
  const config = readConfig();
  config.installationId = generateInstallationId();
  config.secretKey = generateSecretKey();
  delete config.registeredAt; // Will need to re-register
  config.telemetry.enabled = false;
  writeConfig(config);
}
