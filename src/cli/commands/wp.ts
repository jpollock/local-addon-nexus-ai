/**
 * WordPress Commands
 *
 * Run wp-cli commands on local or WPE sites.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';
import { parseTarget } from '../utils/target';

const wpCommand = new Command('wp').description('Run WP-CLI commands on sites');

// ============================================================================
// Plugin Commands
// ============================================================================

const pluginCommand = new Command('plugin').description('Manage WordPress plugins');

pluginCommand
  .command('list <target>')
  .description('List plugins')
  .option('--json', 'Output as JSON')
  .option('--status <status>', 'Filter by status (active, inactive, all)')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

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
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }

      // Filter by status if requested
      let filtered = plugins;
      if (options.status && options.status !== 'all') {
        filtered = plugins.filter((p: any) => p.status === options.status);
      }

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      console.log(`\nPlugins on ${target}:`);
      if (filtered.length === 0) {
        console.log('  (no plugins)');
      } else {
        const nameWidth = Math.max(20, ...filtered.map((p: any) => p.name.length));
        console.log('  ' + 'Name'.padEnd(nameWidth) + '  Status          Version      Update');
        console.log('  ' + '-'.repeat(nameWidth + 40));
        for (const plugin of filtered) {
          const icon = plugin.status === 'active' ? '✅' : '⚫';
          const update = plugin.update ? `→ ${plugin.update}` : '';
          console.log(
            '  ' + plugin.name.padEnd(nameWidth) + '  ' +
            (icon + ' ' + plugin.status).padEnd(14) + '  ' +
            plugin.version.padEnd(11) + '  ' + update
          );
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

pluginCommand
  .command('install <target> <slug...>')
  .description('Install plugins')
  .option('--activate', 'Activate after installing')
  .action(async (target, slugs, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      for (const slug of slugs) {
        console.log(`Installing ${slug}...`);
        const cmd = ['plugin', 'install', slug];
        if (options.activate) cmd.push('--activate');

        const result = await client.mutate<{ nexusWpCommand: any }>(`
          mutation($target: String!, $command: [String!]!) {
            nexusWpCommand(target: $target, command: $command) {
              success
              error
              stdout
            }
          }
        `, { target, command: cmd });

        if (!result.nexusWpCommand.success) {
          console.error(`❌ Failed: ${result.nexusWpCommand.error}`);
        } else {
          console.log(`✅ Installed ${slug}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

pluginCommand
  .command('activate <target> <slug...>')
  .description('Activate plugins')
  .action(async (target, slugs, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      for (const slug of slugs) {
        const result = await client.mutate<{ nexusWpCommand: any }>(`
          mutation($target: String!, $command: [String!]!) {
            nexusWpCommand(target: $target, command: $command) {
              success
              error
            }
          }
        `, { target, command: ['plugin', 'activate', slug] });

        if (!result.nexusWpCommand.success) {
          console.error(`❌ ${slug}: ${result.nexusWpCommand.error}`);
        } else {
          console.log(`✅ Activated ${slug}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

pluginCommand
  .command('deactivate <target> <slug...>')
  .description('Deactivate plugins')
  .action(async (target, slugs, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      for (const slug of slugs) {
        const result = await client.mutate<{ nexusWpCommand: any }>(`
          mutation($target: String!, $command: [String!]!) {
            nexusWpCommand(target: $target, command: $command) {
              success
              error
            }
          }
        `, { target, command: ['plugin', 'deactivate', slug] });

        if (!result.nexusWpCommand.success) {
          console.error(`❌ ${slug}: ${result.nexusWpCommand.error}`);
        } else {
          console.log(`✅ Deactivated ${slug}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

pluginCommand
  .command('update <target> [slug...]')
  .description('Update plugins')
  .option('--all', 'Update all plugins')
  .option('--dry-run', 'Show what would be updated')
  .action(async (target, slugs, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const cmd = ['plugin', 'update'];
      if (options.all) {
        cmd.push('--all');
      } else if (slugs.length > 0) {
        cmd.push(...slugs);
      } else {
        console.error('\n❌ Specify plugin slugs or use --all');
        process.exit(1);
      }
      if (options.dryRun) cmd.push('--dry-run');

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: cmd });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(result.nexusWpCommand.stdout);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Theme Commands
// ============================================================================

const themeCommand = new Command('theme').description('Manage WordPress themes');

themeCommand
  .command('list <target>')
  .description('List themes')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: options.json ? ['theme', 'list', '--format=json'] : ['theme', 'list'] });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(result.nexusWpCommand.stdout);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

themeCommand
  .command('activate <target> <slug>')
  .description('Activate a theme')
  .action(async (target, slug, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
          }
        }
      `, { target, command: ['theme', 'activate', slug] });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(`\n✅ Activated theme: ${slug}\n`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Core Commands
// ============================================================================

const coreCommand = new Command('core').description('Manage WordPress core');

coreCommand
  .command('version <target>')
  .description('Get WordPress version')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: ['core', 'version'] });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(`WordPress ${result.nexusWpCommand.stdout.trim()}`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

coreCommand
  .command('update <target>')
  .description('Update WordPress core')
  .option('--version <version>', 'Update to specific version')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const cmd = ['core', 'update'];
      if (options.version) cmd.push('--version=' + options.version);

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: cmd });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(result.nexusWpCommand.stdout);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Database Commands
// ============================================================================

const dbCommand = new Command('db').description('Manage WordPress database');

dbCommand
  .command('export <target> [output]')
  .description('Export database')
  .action(async (target, output, options) => {
    try {
      parseTarget(target);
      const client = getClient({ timeout: 300000 }); // 5 min

      const cmd = ['db', 'export'];
      if (output) cmd.push(output);

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: cmd });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(result.nexusWpCommand.stdout);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

dbCommand
  .command('import <target> <file>')
  .description('Import database')
  .action(async (target, file, options) => {
    try {
      parseTarget(target);
      const client = getClient({ timeout: 300000 }); // 5 min

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: ['db', 'import', file] });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(`\n✅ Database imported\n`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

dbCommand
  .command('search-replace <target> <from> <to>')
  .description('Search and replace in database')
  .option('--dry-run', 'Show what would be changed')
  .option('--all-tables', 'Search all tables')
  .action(async (target, from, to, options) => {
    try {
      parseTarget(target);
      const client = getClient({ timeout: 300000 }); // 5 min

      const cmd = ['search-replace', from, to];
      if (options.dryRun) cmd.push('--dry-run');
      if (options.allTables) cmd.push('--all-tables');

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: cmd });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(result.nexusWpCommand.stdout);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Post Commands
// ============================================================================

const postCommand = new Command('post').description('Manage WordPress posts');

postCommand
  .command('create <target>')
  .description('Create a post')
  .requiredOption('--title <title>', 'Post title')
  .option('--content <content>', 'Post content')
  .option('--status <status>', 'Post status (publish, draft, etc.)', 'draft')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const cmd = ['post', 'create', '--post_title=' + options.title, '--post_status=' + options.status];
      if (options.content) cmd.push('--post_content=' + options.content);

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: cmd });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(`\n✅ Post created\n`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

postCommand
  .command('update <target> <id>')
  .description('Update a post')
  .option('--title <title>', 'Post title')
  .option('--content <content>', 'Post content')
  .option('--status <status>', 'Post status')
  .action(async (target, id, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const cmd = ['post', 'update', id];
      if (options.title) cmd.push('--post_title=' + options.title);
      if (options.content) cmd.push('--post_content=' + options.content);
      if (options.status) cmd.push('--post_status=' + options.status);

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
          }
        }
      `, { target, command: cmd });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(`\n✅ Post ${id} updated\n`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

postCommand
  .command('delete <target> <id>')
  .description('Delete a post')
  .option('--force', 'Bypass trash and force deletion')
  .action(async (target, id, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const cmd = ['post', 'delete', id];
      if (options.force) cmd.push('--force');

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
          }
        }
      `, { target, command: cmd });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(`\n✅ Post ${id} deleted\n`);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// User Command
// ============================================================================

wpCommand
  .command('user-list <target>')
  .description('List WordPress users')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: options.json ? ['user', 'list', '--format=json'] : ['user', 'list'] });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(result.nexusWpCommand.stdout);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Option Command
// ============================================================================

wpCommand
  .command('option-get <target> <key>')
  .description('Get WordPress option value')
  .action(async (target, key, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: ['option', 'get', key] });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(result.nexusWpCommand.stdout);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Health Command
// ============================================================================

wpCommand
  .command('health <target>')
  .description('Check site health')
  .option('--json', 'Output as JSON')
  .action(async (target, options) => {
    try {
      parseTarget(target);
      const client = getClient();

      const result = await client.mutate<{ nexusWpCommand: any }>(`
        mutation($target: String!, $command: [String!]!) {
          nexusWpCommand(target: $target, command: $command) {
            success
            error
            stdout
          }
        }
      `, { target, command: options.json ? ['site', 'health', '--format=json'] : ['site', 'health'] });

      if (!result.nexusWpCommand.success) {
        console.error(`\n❌ ${result.nexusWpCommand.error}`);
        process.exit(1);
      }

      console.log(result.nexusWpCommand.stdout);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

// Add subcommands
wpCommand.addCommand(pluginCommand);
wpCommand.addCommand(themeCommand);
wpCommand.addCommand(coreCommand);
wpCommand.addCommand(dbCommand);
wpCommand.addCommand(postCommand);

export { wpCommand };
