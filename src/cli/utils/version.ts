/**
 * Version checking and update notifications
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { evaluateReleasePolicy, ReleasePolicy } from '../../common/releasePolicy';

const LATEST_VERSION_URL = 'https://releases.elasticapi.io/nexus-ai/latest.json';
const UPDATE_CHECK_FILE = path.join(os.homedir(), '.nexus-update-check');
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateCheckCache {
  lastCheck: number;
  latestVersion: string | null;
  /** T-KILLSWITCH: cached block reason so the warning persists across the 24h check window. */
  blockReason?: string | null;
}

/**
 * Read update check cache
 */
function readUpdateCache(): UpdateCheckCache | null {
  try {
    if (fs.existsSync(UPDATE_CHECK_FILE)) {
      return JSON.parse(fs.readFileSync(UPDATE_CHECK_FILE, 'utf-8'));
    }
  } catch {
    // Ignore cache read errors
  }
  return null;
}

/**
 * Write update check cache
 */
function writeUpdateCache(cache: UpdateCheckCache): void {
  try {
    fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(cache));
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Fetch the full release policy from latest.json (version + kill-switch fields). Returns null on
 * any network/parse error — the caller must treat null as "no policy" (fail-safe).
 */
export async function fetchReleasePolicy(): Promise<ReleasePolicy | null> {
  try {
    const response = await fetch(LATEST_VERSION_URL, {
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      return (await response.json()) as ReleasePolicy;
    }
  } catch {
    // Network error, silently ignore
  }
  return null;
}

/**
 * Fetch latest version from the release channel.
 */
export async function fetchLatestVersion(): Promise<string | null> {
  const policy = await fetchReleasePolicy();
  return policy?.version ?? null;
}

/**
 * Compare semver versions (simple comparison)
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if ((latestParts[i] || 0) > (currentParts[i] || 0)) return true;
    if ((latestParts[i] || 0) < (currentParts[i] || 0)) return false;
  }
  return false;
}

/**
 * Get current version from package.json
 */
export function getCurrentVersion(): string {
  try {
    const packagePath = path.resolve(__dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

function printUpdateAvailable(currentVersion: string, latestVersion: string): void {
  console.error(`\n\x1b[33mUpdate available: ${currentVersion} → ${latestVersion}\x1b[0m`);
  console.error(`Run: \x1b[36mnexus update\x1b[0m\n`);
}

/** T-KILLSWITCH: a prominent, hard-to-miss notice that the running version is blocked/unsupported. */
function printBlockWarning(reason: string): void {
  console.error(`\n\x1b[31m⚠ This version of Nexus AI is unsupported: ${reason}.\x1b[0m`);
  console.error(`\x1b[31m  Update now:\x1b[0m \x1b[36mnexus update\x1b[0m\n`);
}

/**
 * Check for updates (uses cache to avoid frequent checks). Also surfaces the release-policy kill
 * switch: a version-blocked install is warned prominently. Agent-disable is enforced separately in
 * the main process — this CLI path only informs the user. Fail-safe: an unreachable/garbled policy
 * warns about nothing.
 */
export async function checkForUpdates(): Promise<void> {
  const cache = readUpdateCache();
  const now = Date.now();
  const currentVersion = getCurrentVersion();

  // Skip network if checked recently — but still surface a cached block warning.
  if (cache && now - cache.lastCheck < UPDATE_CHECK_INTERVAL) {
    if (cache.blockReason) printBlockWarning(cache.blockReason);
    if (cache.latestVersion && isNewerVersion(cache.latestVersion, currentVersion)) {
      printUpdateAvailable(currentVersion, cache.latestVersion);
    }
    return;
  }

  // Fetch the policy (non-blocking, fire and forget for cache).
  fetchReleasePolicy()
    .then((policy) => {
      const verdict = evaluateReleasePolicy(policy, currentVersion);
      const blockReason = verdict.versionBlocked ? verdict.reason ?? 'this version is blocked' : null;
      const latestVersion = policy?.version ?? null;
      writeUpdateCache({ lastCheck: now, latestVersion, blockReason });

      if (blockReason) printBlockWarning(blockReason);
      if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
        printUpdateAvailable(currentVersion, latestVersion);
      }
    })
    .catch(() => {
      // Silently ignore update check failures
    });
}
