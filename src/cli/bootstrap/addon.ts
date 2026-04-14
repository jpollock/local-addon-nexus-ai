/**
 * Addon installation and activation management
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { getLocalPaths, ADDON_PACKAGE_NAME, ADDON_DIR_NAME } from './paths';
import { isLocalRunning, stopLocal, restartLocal } from './process';
import { detectPlatform, getPlatformDisplayName } from './platform';
import { downloadAddon, formatBytes } from './downloader';
import { extractTarball, verifyExtractedAddon } from './extractor';
import { getCurrentVersion } from '../utils/version';

/**
 * Get the addon installation path
 */
export function getAddonPath(): string {
  const paths = getLocalPaths();
  return path.join(paths.addonsDir, ADDON_DIR_NAME);
}

/**
 * Check if the addon is installed in Local's addons directory
 */
export function isAddonInstalled(): boolean {
  const addonPath = getAddonPath();

  // Check for directory or symlink
  try {
    const stat = fs.lstatSync(addonPath);
    return stat.isDirectory() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Get installed addon version from package.json
 * Returns null if addon not installed or version can't be read
 */
export function getInstalledAddonVersion(): string | null {
  const addonPath = getAddonPath();
  const packageJsonPath = path.join(addonPath, 'package.json');

  try {
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Check if installed addon is a development symlink
 */
export function isDevAddon(): boolean {
  const addonPath = getAddonPath();

  try {
    const stat = fs.lstatSync(addonPath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Check if the addon is activated in enabled-addons.json
 */
export function isAddonActivated(): boolean {
  const paths = getLocalPaths();

  try {
    if (!fs.existsSync(paths.enabledAddonsFile)) {
      return false;
    }

    const content = fs.readFileSync(paths.enabledAddonsFile, 'utf-8');
    const enabledAddons: Record<string, boolean> = JSON.parse(content);

    return enabledAddons[ADDON_PACKAGE_NAME] === true;
  } catch {
    return false;
  }
}

/**
 * Activate the addon by modifying enabled-addons.json
 * Returns true if restart is needed (addon was just activated)
 */
export function activateAddon(): boolean {
  const paths = getLocalPaths();

  try {
    let enabledAddons: Record<string, boolean> = {};

    if (fs.existsSync(paths.enabledAddonsFile)) {
      const content = fs.readFileSync(paths.enabledAddonsFile, 'utf-8');
      enabledAddons = JSON.parse(content);
    }

    // Check if already activated
    if (enabledAddons[ADDON_PACKAGE_NAME] === true) {
      return false; // Already active, no restart needed
    }

    // Activate the addon
    enabledAddons[ADDON_PACKAGE_NAME] = true;
    fs.writeFileSync(paths.enabledAddonsFile, JSON.stringify(enabledAddons, null, 2));

    // Verify write succeeded
    const verifyContent = fs.readFileSync(paths.enabledAddonsFile, 'utf-8');
    const verified = JSON.parse(verifyContent);
    if (verified[ADDON_PACKAGE_NAME] !== true) {
      console.error('Warning: Failed to persist addon activation');
      return false;
    }

    return true; // Restart needed
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to activate addon: ${message}`);
    console.error(`File: ${paths.enabledAddonsFile}`);
    return false;
  }
}

/**
 * Copy a directory recursively
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Find the bundled addon path (included in npm package)
 * Located at addon-dist/ relative to the CLI package root
 */
function findBundledAddonPath(): string | null {
  // From lib/cli/bootstrap/ -> addon-dist/
  const bundledPath = path.resolve(__dirname, '..', '..', '..', 'addon-dist');

  if (fs.existsSync(path.join(bundledPath, 'package.json'))) {
    return bundledPath;
  }

  return null;
}

/**
 * Find the local development addon path (for dev mode)
 * Only activates when running from a git repo — never matches an installed npm package.
 */
function findDevAddonPath(): string | null {
  // From lib/cli/bootstrap/ (compiled) or src/cli/bootstrap/ (ts-node), go up to project root
  const projectRoot = path.resolve(__dirname, '..', '..', '..');

  // Require .git to exist — installed npm packages never have .git
  if (!fs.existsSync(path.join(projectRoot, '.git'))) {
    return null;
  }

  // Verify this looks like the Nexus AI dev repo
  const srcMain = path.join(projectRoot, 'src', 'main', 'index.ts');
  if (!fs.existsSync(srcMain)) {
    return null;
  }

  return projectRoot;
}

/**
 * Prompt user for auto-download confirmation
 */
async function promptAutoDownload(platformName: string): Promise<boolean> {
  console.log('');
  console.log('Nexus AI addon not found.');
  console.log(`Detected platform: ${platformName}`);
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise<boolean>((resolve) => {
    rl.question('Download and install addon from releases.elasticapi.io? (Y/n) ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });
}

/**
 * Auto-download addon from releases.elasticapi.io
 */
async function autoDownloadAddon(
  options: {
    onStatus?: (status: string) => void;
  } = {}
): Promise<{ success: boolean; error?: string }> {
  const log = options.onStatus || (() => {});

  try {
    // Detect platform
    const platform = detectPlatform();
    const platformName = getPlatformDisplayName(platform);

    // Prompt user for confirmation
    const confirmed = await promptAutoDownload(platformName);

    if (!confirmed) {
      console.log('');
      console.log('Skipping auto-install. To install manually:');
      console.log('1. Download the addon for your platform from:');
      console.log('   https://releases.elasticapi.io/nexus-ai/latest.json');
      console.log(`2. Download: https://releases.elasticapi.io/nexus-ai/v{version}/${platform.assetName}`);
      console.log('3. Extract to your Local addons directory');
      console.log('4. Restart Local');
      console.log('');

      return { success: false, error: 'User cancelled auto-install' };
    }

    // Download to temp directory
    const tmpPath = path.join(os.tmpdir(), 'nexus-ai-addon.tgz');
    const version = getCurrentVersion();
    log(`Downloading ${platform.assetName}...`);

    await downloadAddon({
      assetName: platform.assetName,
      version,
      destPath: tmpPath,
      onProgress: (percent, downloaded, total) => {
        if (total > 0) {
          log(`Downloading... ${percent}% (${formatBytes(downloaded)} / ${formatBytes(total)})`);
        } else {
          log(`Downloading... ${formatBytes(downloaded)}`);
        }
      },
    });

    log('Download complete. Installing...');

    // Extract to addon directory
    const addonPath = getAddonPath();
    await extractTarball({
      tarPath: tmpPath,
      destDir: addonPath,
      stripComponents: 0  // Tarball contents are at root level
    });

    // Verify installation
    if (!verifyExtractedAddon(addonPath)) {
      fs.rmSync(addonPath, { recursive: true, force: true });
      throw new Error('Extracted addon is invalid. Installation failed.');
    }

    // Clean up temp file
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Non-fatal: temp file cleanup failure
    }

    log('✓ Addon installed successfully!');
    console.log('');

    // Auto-restart Local if running, otherwise prompt to start
    const running = await isLocalRunning();
    if (running) {
      console.log('Restarting Local to load addon...');
      await restartLocal();
      console.log('\x1b[32m✓ Local restarted\x1b[0m');
    } else {
      console.log('Start Local to use the addon.');
    }
    console.log('');

    return { success: true };
  } catch (error: any) {
    // Clean up on error
    const addonPath = getAddonPath();
    try {
      if (fs.existsSync(addonPath)) {
        fs.rmSync(addonPath, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    console.error('');
    console.error('Auto-install failed:', error.message);
    console.error('');
    console.error('Please install manually:');
    console.error('https://releases.elasticapi.io/nexus-ai/latest.json');
    console.error('');

    return { success: false, error: error.message };
  }
}

/**
 * Install the addon from bundled package or create dev symlink
 */
export async function installAddon(
  options: {
    onStatus?: (status: string) => void;
  } = {}
): Promise<{ success: boolean; error?: string; needsRestart: boolean }> {
  const log = options.onStatus || (() => {});
  const paths = getLocalPaths();
  const addonPath = getAddonPath();

  try {
    // Ensure addons directory exists
    if (!fs.existsSync(paths.addonsDir)) {
      fs.mkdirSync(paths.addonsDir, { recursive: true });
    }

    // Try bundled addon first (production - included in npm package)
    const bundledAddonPath = findBundledAddonPath();

    if (bundledAddonPath) {
      log('Installing bundled addon...');

      // Copy bundled addon to Local's addons directory
      // Dependencies are pre-installed in addon-dist, no npm install needed
      copyDirSync(bundledAddonPath, addonPath);

      log('Addon installed successfully.');
    } else {
      // Try development mode - create symlink to local addon in monorepo
      const devAddonPath = findDevAddonPath();

      if (devAddonPath) {
        log('Using development addon (symlink)...');

        fs.symlinkSync(devAddonPath, addonPath);
        log(`Created symlink: ${addonPath} -> ${devAddonPath}`);
      } else {
        // Try auto-download from releases.elasticapi.io
        log('Bundled addon not found. Attempting auto-download...');

        const downloadResult = await autoDownloadAddon({ onStatus: log });

        if (!downloadResult.success) {
          throw new Error(
            downloadResult.error || 'Addon not found. Please reinstall the CLI package: npm install -g local-addon-nexus-ai'
          );
        }
      }
    }

    // Activate the addon
    const needsRestart = activateAddon();

    return { success: true, needsRestart };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to install addon',
      needsRestart: false,
    };
  }
}

/**
 * Prompt user for addon update confirmation
 */
async function promptAddonUpdate(cliVersion: string, addonVersion: string): Promise<boolean> {
  console.log('');
  console.log(`\x1b[33mAddon version mismatch detected:\x1b[0m`);
  console.log(`  CLI:   ${cliVersion}`);
  console.log(`  Addon: ${addonVersion}`);
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise<boolean>((resolve) => {
    rl.question('Download updated addon to match CLI version? (Y/n) ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });
}

/**
 * Update addon to match CLI version
 */
async function updateAddon(
  options: {
    onStatus?: (status: string) => void;
  } = {}
): Promise<{ success: boolean; error?: string }> {
  const log = options.onStatus || (() => {});
  const addonPath = getAddonPath();

  try {
    // Backup existing addon
    const backupPath = `${addonPath}.backup-${Date.now()}`;
    log(`Backing up current addon to ${path.basename(backupPath)}...`);

    try {
      fs.renameSync(addonPath, backupPath);
    } catch (error: any) {
      throw new Error(`Failed to backup addon: ${error.message}`);
    }

    // Download new version
    const downloadResult = await autoDownloadAddon({ onStatus: log });

    if (!downloadResult.success) {
      // Restore backup on failure
      log('Download failed. Restoring backup...');
      try {
        if (fs.existsSync(addonPath)) {
          fs.rmSync(addonPath, { recursive: true, force: true });
        }
        fs.renameSync(backupPath, addonPath);
      } catch {
        console.error('\nFailed to restore backup. Your addon may be in an inconsistent state.');
        console.error(`Backup location: ${backupPath}`);
      }

      return { success: false, error: downloadResult.error };
    }

    // Success - remove backup
    try {
      fs.rmSync(backupPath, { recursive: true, force: true });
    } catch {
      // Non-fatal: backup cleanup failure
      console.log(`\nNote: Backup left at ${backupPath} (can be removed manually)`);
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Ensure addon is installed and activated
 */
export async function ensureAddon(
  options: {
    onStatus?: (status: string) => void;
  } = {}
): Promise<{ success: boolean; error?: string; needsRestart: boolean }> {
  const log = options.onStatus || (() => {});

  // Check if addon is installed
  if (!isAddonInstalled()) {
    log('Addon not installed. Installing...');
    const result = await installAddon(options);
    if (!result.success) {
      return result;
    }
    return { success: true, needsRestart: true };
  }

  // Check for version mismatch (skip for dev symlinks)
  if (!isDevAddon()) {
    const cliVersion = getCurrentVersion();
    const addonVersion = getInstalledAddonVersion();

    if (addonVersion && addonVersion !== cliVersion) {
      // Prompt user for update
      const shouldUpdate = await promptAddonUpdate(cliVersion, addonVersion);

      if (shouldUpdate) {
        const updateResult = await updateAddon(options);

        if (!updateResult.success) {
          console.error(`\nAddon update failed: ${updateResult.error}`);
          console.error('Continuing with existing addon version...\n');
          // Don't fail - continue with old version
        } else {
          console.log('');
          console.log('\x1b[32m✓ Addon updated successfully!\x1b[0m');

          // Auto-restart Local if running
          const running = await isLocalRunning();
          if (running) {
            console.log('Restarting Local to load new addon version...');
            await restartLocal();
            console.log('\x1b[32m✓ Local restarted\x1b[0m');
          } else {
            console.log('Local is not running. Start Local to use the updated addon.');
          }

          console.log('');
          return { success: true, needsRestart: false }; // Already restarted
        }
      } else {
        console.log('\nSkipping addon update. Continuing with current version...\n');
      }
    }
  }

  // Check if addon is activated
  if (!isAddonActivated()) {
    const running = await isLocalRunning();

    if (running) {
      // Local is running - it controls enabled-addons.json
      // We can't activate by modifying the file while Local runs
      // Try stopping Local first, then activating, then starting
      if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        // SSH session - can't restart Local
        console.error('');
        console.error('The CLI addon is installed but needs to be activated.');
        console.error('');
        console.error('Please activate from Local desktop app:');
        console.error('  1. Open Local');
        console.error('  2. Go to Addons');
        console.error(`  3. Enable "${ADDON_PACKAGE_NAME}"`);
        console.error('');
        console.error('Or restart Local from the desktop to auto-activate.');
        console.error('');
        // Try to continue anyway - maybe it works
        return { success: true, needsRestart: false };
      }

      log('Stopping Local to activate addon...');
      await stopLocal();

      // Wait a moment for Local to fully stop
      await new Promise((resolve) => setTimeout(resolve, 2000));

      log('Activating addon...');
      activateAddon();

      return { success: true, needsRestart: true };
    } else {
      // Local not running - safe to modify enabled-addons.json
      log('Activating addon...');
      const needsRestart = activateAddon();
      return { success: true, needsRestart };
    }
  }

  return { success: true, needsRestart: false };
}
