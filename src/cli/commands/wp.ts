/**
 * WordPress Commands
 *
 * Run wp-cli commands on local or WPE sites.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';
import { parseTarget } from '../utils/target';

const wpCommand = new Command('wp')
  .description('Run WP-CLI commands on sites')
  .argument('<target>', 'Site target (mysite@local or wpe:account/install@env)')
  .argument('<command...>', 'WP-CLI command and arguments')
  .allowUnknownOption() // Allow WP-CLI flags to pass through
  .option('--json', 'Output as JSON')
  .action(async (target, command, options) => {
    // Special handling for 'plugin list' to show formatted output
    const isPluginList = command.length >= 2 && command[0] === 'plugin' && command[1] === 'list';

    try {
      // Validate target syntax
      parseTarget(target);

      const client = getClient();

      if (isPluginList) {
        // Use specialized plugin list mutation for formatted output
        const result = await client.mutate<{ nexusWpPluginList: any }>(`
          mutation($target: String!) {
            nexusWpPluginList(target: $target) {
              success
              error
              plugins {
                name
                slug
                status
                version
                update
              }
            }
          }
        `, { target });

        const { success, error, plugins } = result.nexusWpPluginList;

        if (!success) {
          console.error(`\n❌ Failed to list plugins: ${error}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(plugins, null, 2));
          return;
        }

        console.log(`\nPlugins on ${target}:`);
        console.log('');

        if (plugins.length === 0) {
          console.log('  (no plugins installed)');
        } else {
          // Calculate column widths
          const nameWidth = Math.max(20, ...plugins.map((p: any) => p.name.length));
          const versionWidth = 10;
          const statusWidth = 12;

          // Header
          console.log(
            '  ' +
              'Name'.padEnd(nameWidth) +
              '  ' +
              'Status'.padEnd(statusWidth) +
              '  ' +
              'Version'.padEnd(versionWidth) +
              '  ' +
              'Update'
          );
          console.log('  ' + '-'.repeat(nameWidth + statusWidth + versionWidth + 12));

          // Plugins
          for (const plugin of plugins) {
            const statusIcon =
              plugin.status === 'active'
                ? '✅'
                : plugin.status === 'inactive'
                ? '⚫'
                : '📦';
            const updateInfo = plugin.update ? `→ ${plugin.update}` : '';

            console.log(
              '  ' +
                plugin.name.padEnd(nameWidth) +
                '  ' +
                (statusIcon + ' ' + plugin.status).padEnd(statusWidth) +
                '  ' +
                plugin.version.padEnd(versionWidth) +
                '  ' +
                updateInfo
            );
          }
        }

        console.log('');
      } else {
        // Generic WP-CLI command passthrough
        const result = await client.mutate<{ nexusWpCommand: any }>(`
          mutation($target: String!, $command: [String!]!) {
            nexusWpCommand(target: $target, command: $command) {
              success
              error
              stdout
              stderr
              exitCode
            }
          }
        `, { target, command });

        const { success, error, stdout, stderr, exitCode } = result.nexusWpCommand;

        // Output stdout (if any)
        if (stdout) {
          console.log(stdout);
        }

        // Output stderr (if any)
        if (stderr) {
          console.error(stderr);
        }

        // Show error if command failed
        if (!success && error) {
          console.error(`\n❌ Command failed: ${error}`);
          process.exit(exitCode || 1);
        }

        process.exit(exitCode || 0);
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

export { wpCommand };
