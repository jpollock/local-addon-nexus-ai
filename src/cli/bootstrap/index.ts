/**
 * Bootstrap System
 *
 * Connects the CLI to Local's GraphQL server:
 * - Detects Local installation
 * - Installs and activates addon if needed
 * - Starts Local if needed
 * - Waits for GraphQL server to be ready
 * - Reads connection info
 */

import { isLocalInstalled, isLocalRunning, startLocal, restartLocal } from './process';
import { ensureAddon } from './addon';
import { readConnectionInfo, waitForGraphQL, ConnectionInfo } from './graphql';

export interface BootstrapResult {
  success: boolean;
  connectionInfo?: ConnectionInfo;
  error?: string;
  actions: string[];
}

/**
 * Main bootstrap function
 * Ensures addon is installed, Local is running, and GraphQL is accessible
 */
export async function bootstrap(
  options: {
    verbose?: boolean;
    skipAddonInstall?: boolean;
    onStatus?: (status: string) => void;
  } = {}
): Promise<BootstrapResult> {
  const actions: string[] = [];
  const log = (msg: string) => {
    actions.push(msg);
    if (options.verbose) {
      console.log(msg);
    }
    if (options.onStatus) {
      options.onStatus(msg);
    }
  };

  // Check if Local is installed
  if (!isLocalInstalled()) {
    return {
      success: false,
      error: 'Local is not installed. Download from https://localwp.com',
      actions,
    };
  }

  // Ensure addon is installed and activated (unless skipped)
  let needsRestart = false;
  if (!options.skipAddonInstall) {
    const addonResult = await ensureAddon({ onStatus: log });
    if (!addonResult.success) {
      return {
        success: false,
        error: addonResult.error || 'Failed to install addon',
        actions,
      };
    }
    needsRestart = addonResult.needsRestart;
  }

  // Check if Local is running
  const running = await isLocalRunning();

  if (needsRestart && running) {
    // Check if we can restart (need display on Linux)
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      log('Addon installed but requires Local restart to activate.');
      console.error('');
      console.error('Please restart Local from the desktop to activate the addon.');
      console.error('Then run this command again.');
      console.error('');
      // Try to continue anyway - addon might already be active
    } else {
      log('Restarting Local to activate addon...');
      await restartLocal();
    }
  } else if (!running) {
    log('Starting Local...');
    await startLocal();
  }

  // Wait for GraphQL server
  log('Waiting for GraphQL...');
  const ready = await waitForGraphQL();

  if (!ready) {
    return {
      success: false,
      error: 'Timed out waiting for Local. Is Local running?',
      actions,
    };
  }

  log('GraphQL server ready.');

  // Read connection info
  const connectionInfo = readConnectionInfo();

  if (!connectionInfo) {
    return {
      success: false,
      error: 'Could not read GraphQL connection info.',
      actions,
    };
  }

  return {
    success: true,
    connectionInfo,
    actions,
  };
}

export { ConnectionInfo } from './graphql';
export { getLocalPaths, LocalPaths } from './paths';
