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

const program = new Command();

program
  .name('nexus')
  .description('Nexus AI CLI - WordPress site management with AI superpowers')
  .version('1.0.0-poc');

// Add commands
program.addCommand(sitesCommand);
program.addCommand(wpCommand);
program.addCommand(syncCommand);

// Global error handler
process.on('unhandledRejection', (error: any) => {
  console.error('\n❌ Unexpected error:', error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});

// Parse arguments
program.parse();
