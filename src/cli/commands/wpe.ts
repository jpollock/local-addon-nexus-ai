/**
 * WPE Commands
 *
 * Manage WP Engine accounts and installs.
 */

import { Command } from 'commander';
import { getClient } from '../utils/graphql';

const wpeCommand = new Command('wpe').description('Manage WP Engine accounts and installs');

/**
 * nexus wpe accounts
 */
wpeCommand
  .command('accounts')
  .description('List WP Engine accounts')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusWpeAccounts: any }>(`
        mutation {
          nexusWpeAccounts {
            success
            error
            accounts {
              id
              name
            }
          }
        }
      `);

      const { success, error, accounts } = result.nexusWpeAccounts;

      if (!success) {
        console.error(`\n❌ Failed to list accounts: ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(accounts, null, 2));
        return;
      }

      console.log('\nWP Engine Accounts:');
      if (accounts.length === 0) {
        console.log('  (none - not authenticated or no accounts)');
      } else {
        for (const account of accounts) {
          console.log(`  ${account.name}`);
          console.log(`    ID: ${account.id}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe installs
 */
wpeCommand
  .command('installs [account]')
  .description('List installs for an account (or all accounts)')
  .option('--json', 'Output as JSON')
  .action(async (account, options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusWpeInstalls: any }>(`
        mutation($account: String) {
          nexusWpeInstalls(account: $account) {
            success
            error
            installs {
              id
              name
              account
              accountName
              environment
              domain
            }
          }
        }
      `, { account: account || null });

      const { success, error, installs } = result.nexusWpeInstalls;

      if (!success) {
        console.error(`\n❌ Failed to list installs: ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(installs, null, 2));
        return;
      }

      console.log('\nWP Engine Installs:');
      if (installs.length === 0) {
        console.log('  (none)');
      } else {
        for (const install of installs) {
          console.log(`  ${install.name} (${install.environment})`);
          console.log(`    Account: ${install.accountName || install.account}`);
          console.log(`    Domain:  ${install.domain}`);
          console.log(`    Target:  wpe:${install.account}/${install.name}@${install.environment}`);
          console.log('');
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe install
 */
wpeCommand
  .command('install <installId>')
  .description('Get details about a specific install')
  .option('--json', 'Output as JSON')
  .action(async (installId, options) => {
    try {
      const client = getClient();

      const result = await client.mutate<{ nexusWpeInstall: any }>(`
        mutation($installId: String!) {
          nexusWpeInstall(installId: $installId) {
            success
            error
            install {
              id
              name
              account
              accountName
              environment
              domain
              phpVersion
              wpVersion
            }
          }
        }
      `, { installId });

      const { success, error, install } = result.nexusWpeInstall;

      if (!success) {
        console.error(`\n❌ Failed to get install: ${error}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(install, null, 2));
        return;
      }

      console.log(`\n${install.name}`);
      console.log('─'.repeat(Math.max(install.name.length, 40)));
      console.log(`Environment:  ${install.environment}`);
      console.log(`Account:      ${install.accountName || install.account}`);
      console.log(`Domain:       ${install.domain}`);
      if (install.wpVersion) {
        console.log(`WordPress:    ${install.wpVersion}`);
      }
      if (install.phpVersion) {
        console.log(`PHP:          ${install.phpVersion}`);
      }
      console.log(`Target:       wpe:${install.account}/${install.name}@${install.environment}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe backup
 */
wpeCommand
  .command('backup <target>')
  .description('Create a backup of a WPE install')
  .option('--description <text>', 'Backup description')
  .action(async (target, options) => {
    try {
      const client = getClient({ timeout: 300000 }); // 5 min for backup

      console.log(`\nCreating backup for ${target}...`);

      const result = await client.mutate<{ nexusWpeBackup: any }>(`
        mutation($input: NexusWpeBackupInput!) {
          nexusWpeBackup(input: $input) {
            success
            error
            backupId
          }
        }
      `, {
        input: {
          target,
          description: options.description || null,
        },
      });

      const { success, error, backupId } = result.nexusWpeBackup;

      if (!success) {
        console.error(`\n❌ Failed to create backup: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Backup created`);
      console.log(`   ID: ${backupId}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe cache
 */
wpeCommand
  .command('cache <target>')
  .description('Purge WPE install cache')
  .option('--purge', 'Purge cache (required)')
  .action(async (target, options) => {
    try {
      if (!options.purge) {
        console.error('\n❌ Must specify --purge to confirm cache purge');
        process.exit(1);
      }

      const client = getClient();

      console.log(`\nPurging cache for ${target}...`);

      const result = await client.mutate<{ nexusWpeCache: any }>(`
        mutation($target: String!) {
          nexusWpeCache(target: $target) {
            success
            error
          }
        }
      `, { target });

      const { success, error } = result.nexusWpeCache;

      if (!success) {
        console.error(`\n❌ Failed to purge cache: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Cache purged successfully`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe link
 */
wpeCommand
  .command('link <localSite> <wpeTarget>')
  .description('Link a local site to a WPE install')
  .action(async (localSite, wpeTarget, options) => {
    try {
      // Enforce @local syntax
      if (!localSite.endsWith('@local')) {
        console.error('\n❌ Local site must use @local format.');
        console.error(`   Use: nexus wpe link ${localSite}@local ${wpeTarget}`);
        process.exit(1);
      }

      const client = getClient();

      console.log(`\nLinking ${localSite} to ${wpeTarget}...`);

      const result = await client.mutate<{ nexusWpeLink: any }>(`
        mutation($input: NexusWpeLinkInput!) {
          nexusWpeLink(input: $input) {
            success
            error
          }
        }
      `, {
        input: {
          localSite,
          wpeTarget,
        },
      });

      const { success, error } = result.nexusWpeLink;

      if (!success) {
        console.error(`\n❌ Failed to link: ${error}`);
        process.exit(1);
      }

      console.log(`\n✅ Sites linked successfully`);
      console.log(`   ${localSite} ↔ ${wpeTarget}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * nexus wpe changes
 */
wpeCommand
  .command('changes <localSite>')
  .description('View changes between local and WPE')
  .option('--since <date>', 'Show changes since date')
  .action(async (localSite, options) => {
    try {
      if (!localSite.endsWith('@local')) {
        console.error('\n❌ Local site must use @local format.');
        console.error(`   Use: nexus wpe changes ${localSite}@local`);
        process.exit(1);
      }

      const client = getClient();

      const result = await client.mutate<{ nexusWpeChanges: any }>(`
        mutation($input: NexusWpeChangesInput!) {
          nexusWpeChanges(input: $input) {
            success
            error
            changes {
              type
              path
              status
            }
          }
        }
      `, {
        input: {
          localSite,
          since: options.since || null,
        },
      });

      const { success, error, changes } = result.nexusWpeChanges;

      if (!success) {
        console.error(`\n❌ Failed to get changes: ${error}`);
        process.exit(1);
      }

      console.log(`\nChanges for ${localSite}:`);
      if (changes.length === 0) {
        console.log('  (no changes)');
      } else {
        for (const change of changes) {
          const icon = change.type === 'added' ? '+' : change.type === 'modified' ? '~' : '-';
          console.log(`  ${icon} ${change.path}`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

export { wpeCommand };
