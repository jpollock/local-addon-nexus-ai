/**
 * Shared safe IPC handler registration utility.
 *
 * Removes any existing handler before registering to prevent
 * "Attempted to register a second handler" errors during hot-reload.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ipcMain } = require('electron');

/**
 * Register an IPC handler safely — removes existing handler first so
 * hot-reload and double-registration are never a problem.
 */
export function safeHandle(channel: string, handler: (...args: any[]) => any): void {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    // Handler didn't exist, that's fine
  }
  ipcMain.handle(channel, handler);
}
