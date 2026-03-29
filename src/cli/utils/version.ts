/**
 * Version checking and update notifications
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LATEST_VERSION_URL = 'https://releases.elasticapi.io/nexus-ai/latest.json';
const UPDATE_CHECK_FILE = path.join(os.homedir(), '.nexus-update-check');
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateCheckCache {
  lastCheck: number;
  latestVersion: string | null;
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
 * Fetch latest version from npm registry
 */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(LATEST_VERSION_URL, {
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const data = (await response.json()) as { version: string };
      return data.version;
    }
  } catch {
    // Network error, silently ignore
  }
  return null;
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

/**
 * Check for updates (uses cache to avoid frequent checks)
 */
export async function checkForUpdates(): Promise<void> {
  const cache = readUpdateCache();
  const now = Date.now();
  const currentVersion = getCurrentVersion();

  // Skip if checked recently
  if (cache && now - cache.lastCheck < UPDATE_CHECK_INTERVAL) {
    if (cache.latestVersion && isNewerVersion(cache.latestVersion, currentVersion)) {
      console.log(`\n\x1b[33mUpdate available: ${currentVersion} → ${cache.latestVersion}\x1b[0m`);
      console.log(`Run: \x1b[36mnexus update\x1b[0m\n`);
    }
    return;
  }

  // Fetch latest version (non-blocking, fire and forget for cache)
  fetchLatestVersion()
    .then((latestVersion) => {
      writeUpdateCache({ lastCheck: now, latestVersion });

      if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
        console.log(`\n\x1b[33mUpdate available: ${currentVersion} → ${latestVersion}\x1b[0m`);
        console.log(`Run: \x1b[36mnexus update\x1b[0m\n`);
      }
    })
    .catch(() => {
      // Silently ignore update check failures
    });
}
