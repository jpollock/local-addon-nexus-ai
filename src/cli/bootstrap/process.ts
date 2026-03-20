/**
 * Process detection and lifecycle management for Local
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getLocalPaths, ensureLocalExecutable } from './paths';

const execAsync = promisify(exec);

/**
 * Check if we can start GUI apps (have a display)
 */
function hasDisplay(): boolean {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return true;
  }
  // Linux: check for DISPLAY or WAYLAND_DISPLAY
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/**
 * Check if Local is currently running
 */
export async function isLocalRunning(): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      // Use pgrep with -f to match any process containing "Local"
      const { stdout } = await execAsync(`pgrep -f "Local.app"`);
      return stdout.trim().length > 0;
    } else if (process.platform === 'win32') {
      const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq Local.exe"`);
      return stdout.includes('Local.exe');
    } else {
      // Linux: check for Local (case-insensitive) or check connection info
      try {
        const { stdout } = await execAsync(`pgrep -fi "local"`);
        return stdout.trim().length > 0;
      } catch {
        // pgrep -i might not be supported, try both cases
        try {
          const { stdout: stdout1 } = await execAsync(`pgrep -f "Local"`);
          if (stdout1.trim().length > 0) return true;
        } catch {
          // Continue to lowercase check
        }
        const { stdout: stdout2 } = await execAsync(`pgrep -f "local"`);
        return stdout2.trim().length > 0;
      }
    }
  } catch {
    // pgrep returns non-zero if no processes found
    return false;
  }
}

/**
 * Start Local application
 */
export async function startLocal(): Promise<void> {
  const paths = getLocalPaths();

  try {
    if (process.platform === 'darwin') {
      // Just activate Local - don't try to hide it (requires accessibility permissions)
      await execAsync(`open -a "Local"`);
    } else if (process.platform === 'win32') {
      // /MIN = start minimized
      await execAsync(`start /MIN "" "${paths.appExecutable}"`);
    } else {
      // Linux: check for display (SSH sessions won't have one)
      if (!hasDisplay()) {
        console.error('Cannot start Local: no display available (SSH session?)');
        console.error('Please start Local from the desktop before connecting via SSH.');
        return;
      }
      // Linux: ensure we have a valid executable path
      const executable = await ensureLocalExecutable();
      if (!executable) {
        console.error('Cannot start Local: executable not found');
        console.error('Download Local from: https://localwp.com');
        return;
      }
      await execAsync(`${executable} &`);
    }
  } catch {
    // Ignore errors - Local might already be running
  }
}

/**
 * Stop Local application
 */
export async function stopLocal(): Promise<void> {
  try {
    if (process.platform === 'darwin') {
      await execAsync(`osascript -e 'quit app "Local"'`);
    } else if (process.platform === 'win32') {
      await execAsync(`taskkill /IM Local.exe /F`);
    } else {
      // Use -i for case-insensitive match (Local or local)
      await execAsync(`pkill -fi "local"`);
    }
  } catch {
    // Ignore errors - Local might not be running
  }
}

/**
 * Restart Local application
 */
export async function restartLocal(): Promise<void> {
  await stopLocal();
  // Wait a bit for the process to fully stop
  await delay(2000);
  await startLocal();
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if Local is installed
 */
export function isLocalInstalled(): boolean {
  const paths = getLocalPaths();

  try {
    if (process.platform === 'darwin') {
      return require('fs').existsSync(paths.appExecutable);
    } else if (process.platform === 'win32') {
      return require('fs').existsSync(paths.appExecutable);
    } else {
      // Linux - check if 'local' is in PATH or at expected location
      try {
        require('child_process').execSync('which local', { stdio: 'ignore' });
        return true;
      } catch {
        return require('fs').existsSync(paths.appExecutable);
      }
    }
  } catch {
    return false;
  }
}
