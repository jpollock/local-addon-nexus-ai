#!/usr/bin/env node
/**
 * Nexus CLI
 *
 * Command-line interface for Nexus AI addon.
 * Communicates with Local via GraphQL.
 */

import { Command } from 'commander';
import { sitesCommand } from './commands/sites';
import { wpCommand } from './commands/wp';
import { syncCommand } from './commands/sync';
import { wpeCommand } from './commands/wpe';
import { blueprintsCommand } from './commands/blueprints';
import { updateCommand } from './commands/update';
import { fleetCommand } from './commands/fleet';
import { contentCommand } from './commands/content';
import { aiCommand } from './commands/ai';
import { auditCommand } from './commands/audit';
import { bootstrap } from './bootstrap';
import { checkForUpdates, getCurrentVersion } from './utils/version';
import { setBootstrapResult } from './utils/context';
import { startTracking, finishTracking, deriveCommandName } from './utils/telemetry';

const program = new Command();

program
  .name('nexus')
  .description('Nexus AI CLI - WordPress site management with AI superpowers')
  .version(getCurrentVersion());

// Add commands
program.addCommand(sitesCommand);
program.addCommand(wpCommand);
program.addCommand(syncCommand);
program.addCommand(wpeCommand);
program.addCommand(blueprintsCommand);
program.addCommand(updateCommand);
program.addCommand(fleetCommand);
program.addCommand(contentCommand);
program.addCommand(aiCommand);
program.addCommand(auditCommand);

// Global error handler
process.on('unhandledRejection', (error: any) => {
  console.error('\n❌ Unexpected error:', error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});

/**
 * Main execution
 */
async function main() {
  // Check for updates (non-blocking)
  checkForUpdates().catch(() => {});

  // Bootstrap the CLI (ensure Local is running, addon is installed)
  // Skip bootstrap for version, help, and update commands (don't need Local running)
  const skipBootstrap = process.argv.includes('--version') ||
                         process.argv.includes('-V') ||
                         process.argv.includes('--help') ||
                         process.argv.includes('-h') ||
                         process.argv.includes('help') ||
                         process.argv.includes('update');

  if (!skipBootstrap) {
    const spinner = process.stdout.isTTY ? true : false;

    if (spinner) {
      process.stdout.write('🔧 Connecting to Local...\r');
    }

    const result = await bootstrap({
      verbose: process.env.DEBUG === 'true',
      onStatus: (status) => {
        if (spinner) {
          process.stdout.write(`🔧 ${status}...\r`);
        }
      },
    });

    if (!result.success) {
      if (spinner) {
        process.stdout.write('\r' + ' '.repeat(80) + '\r'); // Clear line
      }
      console.error(`\n❌ ${result.error}\n`);
      if (result.actions.length > 0 && process.env.DEBUG) {
        console.error('Actions taken:');
        result.actions.forEach((action) => console.error(`  - ${action}`));
      }
      process.exit(1);
    }

    if (spinner) {
      process.stdout.write('\r' + ' '.repeat(80) + '\r'); // Clear line
    }

    // Store bootstrap result in context for commands to use
    setBootstrapResult(result);

    // Hint if no AI provider is configured
    try {
      const { getClient } = await import('./utils/graphql');
      const client = getClient();
      const configResult = await client.mutate<{ nexusAiGetConfig: any }>(`
        mutation { nexusAiGetConfig { success config { provider } } }
      `, {});
      if (configResult.nexusAiGetConfig?.success && !configResult.nexusAiGetConfig?.config?.provider) {
        console.log('💡 No AI provider configured. Run: nexus ai config\n');
      }
    } catch {
      // Non-blocking — don't fail startup if this check errors
    }
  }

  // Parse arguments — use parseAsync so async command actions are properly awaited
  const commandName = deriveCommandName();
  startTracking(commandName);
  let parseSuccess = true;
  let parseError: unknown;
  try {
    await program.parseAsync();
  } catch (err) {
    parseSuccess = false;
    parseError = err;
  } finally {
    await finishTracking(parseSuccess);
  }
  if (parseError) throw parseError;
}

// Run main
main().catch((error) => {
  console.error('\n❌ Unexpected error:', error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});
