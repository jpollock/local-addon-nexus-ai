/**
 * Update command - Self-update the CLI
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { fetchLatestVersion, getCurrentVersion, isNewerVersion } from '../utils/version';

export const updateCommand = new Command('update')
  .description('Update the CLI to the latest version')
  .option('--check', 'Only check for updates, do not install')
  .action(async (options) => {
    const currentVersion = getCurrentVersion();

    if (options.check) {
      console.log('Checking for updates...');
      const latestVersion = await fetchLatestVersion();

      if (!latestVersion) {
        console.error('❌ Could not check for updates');
        process.exit(1);
      }

      if (isNewerVersion(latestVersion, currentVersion)) {
        console.log(`✅ Update available: ${currentVersion} → ${latestVersion}`);
        console.log(`\nRun \x1b[36mnexus update\x1b[0m to install`);
      } else {
        console.log(`✅ You're on the latest version (${currentVersion})`);
      }
      return;
    }

    console.log('Updating CLI...');

    try {
      // Run npm update
      execSync(`npm update -g local-addon-nexus-ai`, { stdio: 'inherit' });
      console.log('✅ CLI updated successfully');

      // Check new version
      const newVersion = await fetchLatestVersion();
      if (newVersion) {
        console.log(`\nUpdated to version ${newVersion}`);
      }
    } catch (error: any) {
      console.error('❌ Update failed');
      console.error('\nTry running manually:');
      console.error('  npm update -g local-addon-nexus-ai');
      process.exit(1);
    }
  });
