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

      const { success, error, linkCreated, bytesTransferred, duration } =
        result.nexusSyncPull;

      if (!success) {
        console.error(`\n❌ Failed to pull: ${error}`);
        process.exit(1);
      }

      if (linkCreated) {
        console.log(`✅ Created link: ${localSite} ↔ ${options.from}`);
      }

      if (bytesTransferred) {
        const mb = (bytesTransferred / 1024 / 1024).toFixed(2);
        console.log(`✅ Transferred: ${mb} MB`);
      }

      if (duration) {
        console.log(`✅ Duration: ${duration.toFixed(1)}s`);
      }

      console.log(`\n✅ Successfully pulled from WPE`);

      if (linkCreated) {
        console.log('\nYou can now use shorthand syntax:');
        console.log(`  nexus wp ${localSiteName}@${wpeTarget.environment} plugin list`);
        console.log(`  nexus sync pull ${localSite} --from=${wpeTarget.environment}`);
      }

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
          console.log('⚠️  This is a PRODUCTION environment. Data loss is permanent.');
        }

        // In POC, we'll skip confirmation. In production, use readline to prompt.
        console.log('');
        console.log('(Confirmation skipped in POC - use with caution!)');
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

      const { success, error, linkCreated, installCreated, bytesTransferred, duration } =
        result.nexusSyncPush;

      if (!success) {
        console.error(`\n❌ Failed to push: ${error}`);
        process.exit(1);
      }

      if (installCreated) {
        console.log(`✅ Created WPE install: ${wpeTarget.installId} (${wpeTarget.environment})`);
      }

      if (linkCreated) {
        console.log(`✅ Created link: ${localSite} ↔ ${options.to}`);
      }

      if (bytesTransferred) {
        const mb = (bytesTransferred / 1024 / 1024).toFixed(2);
        console.log(`✅ Transferred: ${mb} MB`);
      }

      if (duration) {
        console.log(`✅ Duration: ${duration.toFixed(1)}s`);
      }

      console.log(`\n✅ Successfully pushed to WPE`);

      if (linkCreated) {
        console.log('\nYou can now use shorthand syntax:');
        console.log(`  nexus wp ${localSiteName}@${wpeTarget.environment} plugin list`);
        console.log(`  nexus sync push ${localSite} --to=${wpeTarget.environment}`);
      }

      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

export { syncCommand };
