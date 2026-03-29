/**
 * Platform-specific paths for Local
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

export interface LocalPaths {
  /** Local application data directory */
  dataDir: string;
  /** Addons installation directory */
  addonsDir: string;
  /** enabled-addons.json file path */
  enabledAddonsFile: string;
  /** GraphQL connection info file path */
  graphqlConnectionInfoFile: string;
  /** Local application executable path */
  appExecutable: string;
  /** Local application name (for process detection) */
  appName: string;
}

/** Common Linux install locations for Local */
const LINUX_PATHS = [
  '/usr/bin/Local',
  '/usr/bin/local',
  '/opt/Local/local',
  '/usr/local/bin/local',
];

/** Get CLI config path */
function getConfigPath(): string {
  return path.join(os.homedir(), '.nexus', 'config.json');
}

/** Read custom Local path from config */
function getCustomLocalPath(): string | null {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.localExecutablePath && fs.existsSync(config.localExecutablePath)) {
        return config.localExecutablePath;
      }
    }
  } catch {
    // Ignore config read errors
  }
  return null;
}

/** Save custom Local path to config */
function saveCustomLocalPath(executablePath: string): void {
  try {
    const configPath = getConfigPath();
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    config.localExecutablePath = executablePath;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Ignore config write errors
  }
}

/** Prompt user for Local executable path */
async function promptForLocalPath(): Promise<string | null> {
  if (!process.stdin.isTTY) {
    return null;
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Local application not found');
  console.log('');
  console.log('If Local is installed, please enter the path to the executable.');
  console.log('If not installed, download it from: https://localwp.com');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Path to Local executable (or press Enter to skip): ', (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed && fs.existsSync(trimmed)) {
        saveCustomLocalPath(trimmed);
        console.log(`Saved: ${trimmed}`);
        resolve(trimmed);
      } else if (trimmed) {
        console.log(`File not found: ${trimmed}`);
        resolve(null);
      } else {
        resolve(null);
      }
    });
  });
}

/** Find Local executable on Linux */
function findLinuxExecutable(): string | null {
  // Check custom path first
  const customPath = getCustomLocalPath();
  if (customPath) {
    return customPath;
  }
  // Check common locations
  return LINUX_PATHS.find((p) => fs.existsSync(p)) || null;
}

/** Check if Local executable exists and prompt if not found (async version for Linux) */
export async function ensureLocalExecutable(): Promise<string | null> {
  if (process.platform !== 'linux') {
    return getLocalPaths().appExecutable;
  }

  const found = findLinuxExecutable();
  if (found) {
    return found;
  }

  // Prompt user for path
  return promptForLocalPath();
}

/**
 * Get platform-specific paths for Local
 */
export function getLocalPaths(): LocalPaths {
  const platform = process.platform;
  const home = os.homedir();

  switch (platform) {
    case 'darwin': {
      const dataDir = path.join(home, 'Library', 'Application Support', 'Local');
      return {
        dataDir,
        addonsDir: path.join(dataDir, 'addons'),
        enabledAddonsFile: path.join(dataDir, 'enabled-addons.json'),
        graphqlConnectionInfoFile: path.join(dataDir, 'graphql-connection-info.json'),
        appExecutable: '/Applications/Local.app',
        appName: 'Local',
      };
    }

    case 'win32': {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const dataDir = path.join(appData, 'Local');
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      return {
        dataDir,
        addonsDir: path.join(dataDir, 'addons'),
        enabledAddonsFile: path.join(dataDir, 'enabled-addons.json'),
        graphqlConnectionInfoFile: path.join(dataDir, 'graphql-connection-info.json'),
        appExecutable: path.join(programFiles, 'Local', 'Local.exe'),
        appName: 'Local.exe',
      };
    }

    case 'linux': {
      const dataDir = path.join(home, '.config', 'Local');
      const appExecutable = findLinuxExecutable() || '/opt/Local/local';
      return {
        dataDir,
        addonsDir: path.join(dataDir, 'addons'),
        enabledAddonsFile: path.join(dataDir, 'enabled-addons.json'),
        graphqlConnectionInfoFile: path.join(dataDir, 'graphql-connection-info.json'),
        appExecutable,
        appName: 'local',
      };
    }

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Get the addon package name (used in enabled-addons.json)
 * Must match the "name" field in package.json exactly — Local uses this as the key.
 */
export const ADDON_PACKAGE_NAME = '@local-labs-jpollock/local-addon-nexus-ai';

/**
 * Get the addon directory name (used in addons/ folder)
 */
export const ADDON_DIR_NAME = 'local-addon-nexus-ai';
