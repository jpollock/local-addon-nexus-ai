/**
 * Sync Commands
 *
 * Push/pull between local and WPE.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';
import { requireLocalTarget, requireWpeTarget } from '../utils/target';

const syncCommand = new Command('sync').description('Sync sites between local and WPE');

/**
 * nexus sync pull <local> --from=<wpe>
 */
syncCommand
  .command('pull <localSite>')
  .description('Pull from WPE to local')
  .requiredOption('--from <wpeTarget>', 'WPE target (wpe:account/install@environment)')
  .option('--db-only', 'Pull database only')
  .option('--files-only', 'Pull files only')
  .action(async (localSite, options) => {
    try {
      // Validate targets
      const localSiteName = requireLocalTarget(localSite);
      const wpeTarget = requireWpeTarget(options.from);

      const client = getClient({ timeout: 600000 }); // 10 min for pull

      console.log(`\nPulling ${options.from} → ${localSite}...`);
      if (options.dbOnly) {
        console.log('  (database only)');
      } else if (options.filesOnly) {
        console.log('  (files only)');
      }
      console.log('');

      const result = await client.mutate<{ nexusSyncPull: any }>(`
        mutation($input: NexusSyncPullInput!) {
          nexusSyncPull(input: $input) {
            success
            error
            linkCreated
            bytesTransferred
            duration
          }
        }
      `, {
        input: {
          localSite,
          wpeTarget: options.from,
          dbOnly: options.dbOnly || false,
          filesOnly: options.filesOnly || false,
        },
      });

      const { success, error } = result.nexusSyncPull;

      if (!success) {
        console.error(`\n❌ Failed to pull: ${error}`);
        process.exit(1);
      }

      // Pull operation is async - tell user to check Local app
      console.log(`\n✅ Pull operation queued successfully`);
      console.log(`\n📱 Check the Local app for pull progress.`);
      console.log(`⏳ The pull operation runs in the background.`);
      console.log(`\n⚠️  Do NOT run wp-cli commands on ${localSite} until the pull completes.`);
      console.log(`   Wait for Local to show "Pull complete" before using the site.`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus sync push <local> --to=<wpe>
 */
syncCommand
  .command('push <localSite>')
  .description('Push from local to WPE')
  .requiredOption('--to <wpeTarget>', 'WPE target (wpe:account/install@environment)')
  .option('--db', 'Include database (requires confirmation)')
  .option('--db-only', 'Push database only')
  .option('--files-only', 'Push files only')
  .option('--create', 'Create WPE install if does not exist')
  .action(async (localSite, options) => {
    try {
      // Validate targets
      const localSiteName = requireLocalTarget(localSite);
      const wpeTarget = requireWpeTarget(options.to);

      // Confirmation for database push
      if (options.db || options.dbOnly) {
        console.log(`\n⚠️  WARNING: This will overwrite the database on ${options.to}`);

        if (wpeTarget.environment === 'production') {
          console.log('⚠️⚠️⚠️  This is a PRODUCTION environment. Data loss is permanent.');
        }

        // Prompt for confirmation
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`\nType 'yes' to confirm database push: `, resolve);
        });

        rl.close();

        if (answer.toLowerCase() !== 'yes') {
          console.log('\nCancelled.');
          process.exit(0);
        }

        console.log('');
      }

      const client = getClient({ timeout: 600000 }); // 10 min for push

      console.log(`\nPushing ${localSite} → ${options.to}...`);
      if (options.dbOnly) {
        console.log('  (database only)');
      } else if (options.filesOnly) {
        console.log('  (files only)');
      } else if (options.db) {
        console.log('  (files + database)');
      } else {
        console.log('  (files only - use --db to include database)');
      }
      console.log('');

      const result = await client.mutate<{ nexusSyncPush: any }>(`
        mutation($input: NexusSyncPushInput!) {
          nexusSyncPush(input: $input) {
            success
            error
            linkCreated
            installCreated
            bytesTransferred
            duration
          }
        }
      `, {
        input: {
          localSite,
          wpeTarget: options.to,
          includeDb: options.db || options.dbOnly || false,
          dbOnly: options.dbOnly || false,
          filesOnly: options.filesOnly || false,
          create: options.create || false,
        },
      });

      const { success, error, confirmationToken } = result.nexusSyncPush;

      // Handle confirmation token (though we do CLI-level confirmation, MCP tool might also need it)
      if (confirmationToken) {
        console.error(`\n❌ Unexpected confirmation required at MCP level.`);
        console.error(`   This should have been handled at CLI level.`);
        process.exit(1);
      }

      if (!success) {
        console.error(`\n❌ Failed to push: ${error}`);
        process.exit(1);
      }

      // Push operation is async - tell user to check Local app
      console.log(`\n✅ Push operation queued successfully`);
      console.log(`\n📱 Check the Local app for push progress.`);
      console.log(`⏳ The push operation runs in the background.`);

      if (options.db || options.dbOnly) {
        console.log(`\n⚠️  Database is being pushed to ${options.to}`);
        if (wpeTarget.environment === 'production') {
          console.log(`⚠️  Monitor the push carefully in Local app.`);
        }
      }

      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

export { syncCommand };
